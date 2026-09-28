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
const makeReq = (method, { body, query = {}, headers = {} } = {}) => ({
  method,
  body,
  query,
  headers,
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
  // 必须在 import 之前设好：_lib.ts 里 KV_URL 是模块加载时就读下来的常量
  process.env.KV_REST_API_URL = `http://127.0.0.1:${PORT}`;
  process.env.KV_REST_API_TOKEN = 'test-token';
  process.env.ADMIN_KEY = 'secret123';

  // Windows 上 path.join 出来的是 C:\... ，直接喂给 import() 会报
  // ERR_UNSUPPORTED_ESM_URL_SCHEME —— ESM 只认 file:// 开头的说明符。
  const load = (f) => import(pathToFileURL(path.join(here, '..', '_apitest', f)).href);
  const visit = (await load('visit.js')).default;
  const guestbook = (await load('guestbook.js')).default;
  const admin = (await load('admin.js')).default;

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

  // 附：没配存储那条不在这里测 —— KV_URL 是模块加载时就读进来的常量，
  // 同一个进程里删环境变量已经晚了。真机上配不配由 Vercel 决定。

  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项\n`);
  server.close();
  process.exit(fail > 0 ? 1 : 0);
});
