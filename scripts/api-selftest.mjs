/**
 * 云函数本地自检 —— 起一个假的 Upstash，把 visit / guestbook / admin 三个接口真跑一遍。
 *
 *   npm run test:api
 *
 * 目的：改完 api/ 下的云函数能立刻验证，不用先推 Vercel 再抓瞎。
 * 它只测「接口逻辑」，不测 Upstash 本身（那是人家的事）。
 *
 * 不需要网络、不需要 Upstash 账号，也不需要配任何环境变量。
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ---------------- 假的 Upstash REST ---------------- */
const store = new Map(); // key -> string（incr / get 用）
const lists = new Map(); // key -> string[]（lpush / lrange / ltrim 用）

function fakeUpstash() {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      // 先按 / 切段、再逐段解码。反过来（整串先解码再切）会把留言里的 </b>
      // 当成路径分隔符，一条留言被切成两半 —— 我第一版就踩了这个坑。
      const parts = req.url
        .split('/')
        .filter(Boolean)
        .map((s) => {
          try {
            return decodeURIComponent(s);
          } catch {
            return s;
          }
        });

      const cmd = parts.shift();
      const args = parts;
      let result = null;

      if (process.env.DBG) {
        console.log(`    [dbg] 原始url=${req.url.slice(0, 120)}`);
        console.log(`    [dbg] ${cmd} 段数=${parts.length} ← ${JSON.stringify(args.map((a) => a.slice(0, 40)))}`);
      }

      if (cmd === 'incr') {
        const key = args[0];
        const next = (Number(store.get(key) ?? 0) || 0) + 1;
        store.set(key, String(next));
        result = next;
      } else if (cmd === 'get') {
        result = store.has(args[0]) ? store.get(args[0]) : null;
      } else if (cmd === 'set') {
        store.set(args[0], args[1]);
        result = 'OK';
      } else if (cmd === 'lpush') {
        const arr = lists.get(args[0]) ?? [];
        for (let i = 1; i < args.length; i += 1) arr.unshift(args[i]);
        lists.set(args[0], arr);
        result = arr.length;
      } else if (cmd === 'lrange') {
        const arr = lists.get(args[0]) ?? [];
        const start = Number(args[1] ?? 0);
        const stop = Number(args[2] ?? -1);
        result = arr.slice(start, stop < 0 ? undefined : stop + 1);
      } else if (cmd === 'ltrim') {
        const arr = lists.get(args[0]) ?? [];
        lists.set(args[0], arr.slice(Number(args[1]), Number(args[2]) + 1));
        result = 'OK';
      } else if (cmd === 'lindex') {
        // visitlog 补写用：按 index 取一条，越界返回 null
        const arr = lists.get(args[0]) ?? [];
        const i = Number(args[1]);
        result = i >= 0 && i < arr.length ? arr[i] : null;
      } else if (cmd === 'lset') {
        // visitlog 补写用：原地替换某一条，不改动 list 长度
        const arr = lists.get(args[0]) ?? [];
        const i = Number(args[1]);
        if (i < 0 || i >= arr.length) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'index out of range' }));
          return;
        }
        arr[i] = args[2];
        result = 'OK';
      } else if (cmd === 'expire') {
        // 假实现：TTL 一律当作设置成功，不做真实过期
        result = 1;
      } else if (cmd === 'del') {
        result = lists.delete(args[0]) ? 1 : 0;
      } else {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `unknown cmd ${cmd}` }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result }));
    });
  });
}

/* ---------------- 假 req / res ---------------- */
const makeRes = () => ({
  statusCode: 200,
  headers: {},
  body: undefined,
  status(c) {
    this.statusCode = c;
    return this;
  },
  setHeader(k, v) {
    this.headers[k] = v;
  },
  json(b) {
    this.body = b;
  },
  send(s) {
    this.body = s;
  },
});
const makeReq = (method, { body, query = {}, headers = {}, url } = {}) => ({
  method,
  body,
  query,
  headers,
  url: url ?? '/api/insp',
});

/* ---------------- 断言 ---------------- */
let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`);
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8899;
const server = fakeUpstash();

server.listen(PORT, async () => {
  // 必须在 import 之前设好：几个函数文件顶部的 KV_URL 是模块加载时就读下来的常量
  process.env.KV_REST_API_URL = `http://127.0.0.1:${PORT}`;
  process.env.KV_REST_API_TOKEN = 'test-token';
  process.env.ADMIN_KEY = 'secret123';
  process.env.BLOB_READ_WRITE_TOKEN = 'test-blob-token';

  // 拦截「上传到 Vercel Blob」的真实外网 fetch，返回一个假 URL。
  // insp.ts 的 putBlob / deleteBlob 都走全局 fetch，这里只拦 blob.vercel-storage.com。
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('blob.vercel-storage.com')) {
      if ((init?.method ?? 'GET').toUpperCase() === 'DELETE') {
        return { ok: true, status: 200 } ;
      }
      // 假 Blob 上传：返回一个稳定 URL
      return {
        ok: true,
        status: 200,
        json: async () => ({ url: `https://fake.blob.vercel-storage.com/insp/${url.split('/').pop()}` }),
      };
    }
    return realFetch(input, init);
  };

  // Windows 上 path.join 出来的是 C:\... ，直接喂给 import() 会报
  // ERR_UNSUPPORTED_ESM_URL_SCHEME —— ESM 只认 file:// 开头的说明符。
  const load = (f) => import(pathToFileURL(path.join(here, '..', '_apitest', f)).href);
  const visit = (await load('visit.js')).default;
  const guestbook = (await load('guestbook.js')).default;
  const admin = (await load('admin.js')).default;
  const visitlog = (await load('visitlog.js')).default;
  const insp = (await load('insp.js')).default;

  console.log('\n【访客统计 /api/visit】');
  let res = makeRes();
  await visit(makeReq('POST', { body: { unique: true } }), res);
  check('第一次访问 = 第 1 位访客', res.body.count === 1 && res.body.pv === 1, res.body);

  res = makeRes();
  await visit(makeReq('POST', { body: {} }), res);
  check('同人不重复计数，浏览量 +1', res.body.count === 1 && res.body.pv === 2, res.body);

  res = makeRes();
  await visit(makeReq('GET'), res);
  check('GET 读回当前值', res.body.count === 1 && res.body.pv === 2, res.body);

  console.log('\n【留言 /api/guestbook】');
  res = makeRes();
  await guestbook(
    makeReq('POST', { body: { name: '小明', email: 'a@b.com', html: '你好 <b>粗体</b>' } }),
    res,
  );
  const first = res.body;
  check('发留言成功', first.ok === true, first);
  check('回传最新 1 条且是刚发的', first.list?.[0]?.html === '你好 <b>粗体</b>', first.list);

  res = makeRes();
  await guestbook(makeReq('POST', { body: { html: '第二条' } }), res);
  check('没写名字默认匿名', res.body.list?.[0]?.name === '匿名', res.body.list?.[0]);
  check('最新的一条在最前', res.body.list[0].html === '第二条', res.body.list);

  res = makeRes();
  await guestbook(
    makeReq('POST', { body: { html: '带脚本 <script>alert(1)</script> 残留 <b>保留</b>' } }),
    res,
  );
  const cleaned = res.body.list[0].html;
  check('script 标签被剥掉', !/script/i.test(cleaned), cleaned);
  check('正常排版保留', /<b>保留<\/b>/.test(cleaned), cleaned);

  res = makeRes();
  await guestbook(makeReq('POST', { body: { html: '   ' } }), res);
  check('空白留言被拒（400）', res.statusCode === 400, res.body);

  res = makeRes();
  await guestbook(makeReq('GET'), res);
  check('GET 只回最近 3 条', Array.isArray(res.body.list) && res.body.list.length === 3, res.body.list);

  console.log('\n【后台 /api/admin】');
  res = makeRes();
  await admin(makeReq('GET'), res);
  check('不带头 → 401', res.statusCode === 401, res.body);

  res = makeRes();
  await admin(makeReq('GET', { headers: { 'x-admin-key': 'wrong' } }), res);
  check('口令错 → 401', res.statusCode === 401, res.body);

  res = makeRes();
  await admin(makeReq('GET', { headers: { 'x-admin-key': 'secret123' } }), res);
  check('口令对 → 200', res.statusCode === 200 && res.body.ok === true, res.body);
  check('后台能看到全部留言', res.body.guestbook?.length === 3, res.body.guestbook?.length);
  check('后台能拿到访客数', res.body.uv === 1 && res.body.pv === 2, {
    uv: res.body.uv,
    pv: res.body.pv,
  });

  console.log('\n【清空留言】');
  res = makeRes();
  await guestbook(makeReq('DELETE', { headers: { 'x-admin-key': 'wrong' } }), res);
  check('口令错 → 不能清', res.statusCode === 401, res.body);

  res = makeRes();
  await guestbook(makeReq('DELETE', { headers: { 'x-admin-key': 'secret123' } }), res);
  check('口令对 → 清空成功', res.body.ok === true, res.body);

  res = makeRes();
  await guestbook(makeReq('GET'), res);
  check('清空后确实没了', res.body.list.length === 0, res.body.list);

  /* ---------------- 访问日志 /api/visitlog ---------------- */
  console.log('\n【访问日志 /api/visitlog】');

  res = makeRes();
  await visitlog(makeReq('GET'), res);
  check('没口令读不到日志', res.statusCode === 401, res.body);

  // 模拟：带 ?from= 标记的面试官，从手机点进来
  res = makeRes();
  await visitlog(
    makeReq('POST', {
      body: { visitId: 'v-abc', from: '某某公司', ref: 'linkedin.com', path: 'home' },
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605 Safari/604' },
    }),
    res,
  );
  check('记一条访问成功', res.body.ok === true, res.body);

  // 切栏目 → 补写同一条，不该多出一条
  res = makeRes();
  await visitlog(
    makeReq('POST', { body: { visitId: 'v-abc', sections: ['intro', 'inspiration'], dwell: 42 } }),
    res,
  );
  check('切栏目是补写不是新增', res.body.ok === true && res.body.patched === true, res.body);

  // 下载简历
  res = makeRes();
  await visitlog(
    makeReq('POST', { body: { visitId: 'v-abc', events: ['简历下载'], sections: ['intro'], dwell: 95 } }),
    res,
  );
  check('简历下载能记上', res.body.ok === true && res.body.patched === true, res.body);

  // 另一位访客：没带标记
  res = makeRes();
  await visitlog(makeReq('POST', { body: { visitId: 'v-xyz', path: 'studio' } }), res);
  check('第二位访客单独成条', res.body.ok === true && !res.body.patched, res.body);

  res = makeRes();
  await visitlog(makeReq('GET', { headers: { 'x-admin-key': 'secret123' } }), res);
  const logs = res.body.logs ?? [];
  check('日志总数 = 2（补写没多记）', logs.length === 2, logs.length);
  check('最新在前', logs[0]?.id === 'v-xyz', logs.map((l) => l.id));

  const tagged = logs.find((l) => l.id === 'v-abc');
  check('来源标记存下来了', tagged?.from === '某某公司', tagged?.from);
  check('栏目轨迹合并正确', JSON.stringify(tagged?.sections) === '["intro"]', tagged?.sections);
  check('简历下载动作记上了', (tagged?.events ?? []).includes('简历下载'), tagged?.events);
  check('停留时长更新到 95 秒', tagged?.dwell === 95, tagged?.dwell);
  check('手机端识别成 mobile', tagged?.device === 'mobile', tagged?.device);
  check('UA 粗判出 iOS', /iOS/.test(tagged?.ua ?? ''), tagged?.ua);
  check('没有口令的访客读不到别人的日志', res.statusCode === 200);

  // 附：没配存储那条不在这里测 —— KV_URL 是模块加载时就读进来的常量，
  // 同一个进程里删环境变量已经晚了。真机上配不配由 Vercel 决定。

  /* ---------------- 灵感收藏云端 /api/insp ---------------- */
  console.log('\n【灵感收藏云端 /api/insp】');

  // 读：公开，没数据时返回 store:null
  res = makeRes();
  await insp(makeReq('GET'), res);
  check('读（无数据）公开返回 ok', res.statusCode === 200 && res.body.ok === true, res.body);
  check('无数据时 store 为 null', res.body.store === null, res.body.store);

  // 写：没口令 → 401
  res = makeRes();
  await insp(makeReq('PUT', { body: { savedAt: 1, store: { vision: [] } } }), res);
  check('写没口令 → 401', res.statusCode === 401, res.body);

  // 写：口令对 → 成功
  res = makeRes();
  await insp(
    makeReq('PUT', {
      body: { savedAt: 100, store: { vision: [{ id: 'v1', src: 'https://x' }], knowledge: [] } },
      headers: { 'x-admin-key': 'secret123' },
    }),
    res,
  );
  check('作者写整份数据成功', res.statusCode === 200 && res.body.ok === true, res.body);

  // 读回
  res = makeRes();
  await insp(makeReq('GET'), res);
  check('写后能读回', res.body.ok === true && res.body.savedAt === 100, res.body);
  check('vision 那条在', res.body.store?.vision?.length === 1, res.body.store?.vision);

  // 写：只收白名单键，塞垃圾键会被丢弃
  res = makeRes();
  await insp(
    makeReq('PUT', {
      body: { savedAt: 200, store: { vision: [], evil: [{ x: 1 }], hack: 'no' } },
      headers: { 'x-admin-key': 'secret123' },
    }),
    res,
  );
  check('垃圾键被丢弃（只留白名单）', res.body.ok === true, res.body);
  res = makeRes();
  await insp(makeReq('GET'), res);
  check('读回不含 evil/hack 键', !('evil' in res.body.store) && !('hack' in res.body.store), res.body.store);

  // 上传：没口令 → 401
  res = makeRes();
  await insp(makeReq('POST', { url: '/api/insp/upload', query: { ext: 'png' }, body: { data: 'aGVsbG8=' } }), res);
  check('上传没口令 → 401', res.statusCode === 401, res.body);

  // 上传：口令对 → 返回假 Blob URL
  res = makeRes();
  await insp(
    makeReq('POST', {
      url: '/api/insp/upload',
      query: { ext: 'png', kind: 'image', name: '测试图.png' },
      body: { data: 'aGVsbG8=' }, // "hello" 的 base64
      headers: { 'x-admin-key': 'secret123' },
    }),
    res,
  );
  check('上传成功返回 URL', res.statusCode === 200 && res.body.ok === true, res.body);
  check('URL 是 https 绝对地址', /^https:\/\/.+\.blob\.vercel-storage\.com\//.test(res.body.url ?? ''), res.body.url);

  // 上传：非法扩展名 → 400
  res = makeRes();
  await insp(
    makeReq('POST', {
      url: '/api/insp/upload',
      query: { ext: 'exe' },
      body: { data: 'xxxx' },
      headers: { 'x-admin-key': 'secret123' },
    }),
    res,
  );
  check('非法扩展名 → 400', res.statusCode === 400, res.body);

  // 删除 Blob：口令对 → ok
  res = makeRes();
  await insp(
    makeReq('DELETE', {
      url: '/api/insp/blob',
      query: { url: 'https://fake.blob.vercel-storage.com/insp/abc.png' },
      headers: { 'x-admin-key': 'secret123' },
    }),
    res,
  );
  check('删除 Blob 成功', res.statusCode === 200 && res.body.ok === true, res.body);

  // 删除：非法 url → 400
  res = makeRes();
  await insp(
    makeReq('DELETE', { url: '/api/insp/blob', query: { url: 'javascript:alert(1)' }, headers: { 'x-admin-key': 'secret123' } }),
    res,
  );
  check('删非法 url → 400', res.statusCode === 400, res.body);

  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项\n`);
  server.close();
  process.exit(fail > 0 ? 1 : 0);
});
