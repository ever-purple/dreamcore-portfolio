/**
 * 回归验证：粘贴**分享短链**能不能识别出正确的歌名 / 歌手 / 封面 / 外链播放器。
 *
 * 背景（2026-09-29 用户报的 bug）：
 *   收藏里粘 `https://163cn.tv/bhr5rXOI`（网易云分享短链），识别出来歌名是 "Bhr5rXOI"、
 *   没有封面、点播放没声音。根因是短链本身不含 song id，平台接口调不了，
 *   一路掉到「抓 og 标签 → 拿不到 → 用 URL 末段兜底」，于是短码成了歌名。
 *
 * 断言三件事：
 *   1. 标题 / 歌手 / 专辑封面 / 播放器地址都正确（走真实浏览器 + 真实网络）；
 *   2. 短链、带 id 的完整链接、移动版链接三种写法结果一致；
 *   3. 整个过程没有 console 错误。
 *
 * 用法：
 *   BASE=http://127.0.0.1:5199 node verify-music-link.mjs     # 打 vite dev（默认 5199）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';
const CDP_PORT = Number(process.env.CDP_PORT ?? 9381);
const CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const BROWSER = CANDIDATES.find((p) => fs.existsSync(p));
if (!BROWSER) {
  console.error('找不到可用的 Edge / Chrome，可用 EDGE_PATH=... 指定');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d = '') => {
  results.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`);
};

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (m) => {
      const j = JSON.parse(m.data);
      if (j.id && this.pending.has(j.id)) {
        this.pending.get(j.id)(j);
        this.pending.delete(j.id);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

async function waitTarget(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await (
        await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })
      ).json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p;
    } catch {
      /* 还没起来 */
    }
    await sleep(500);
  }
  throw new Error('CDP 没起来');
}

const profile = path.join(os.tmpdir(), '_edgelink' + Date.now());
const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-extensions',
    '--hide-scrollbars',
    '--mute-audio',
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let ws;
try {
  const target = await waitTarget(CDP_PORT);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__errs = [];
      window.addEventListener('error', (e) => window.__errs.push('error: ' + String(e.message || e.error)));
      window.addEventListener('unhandledrejection', (e) => window.__errs.push('reject: ' + String(e.reason)));`,
  });

  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await sleep(3500);
  const alive = await cdp.eval(`!!document.querySelector('#root') || !!document.body`);
  check('页面已加载', !!alive);

  /** 在页面上下文里跑真实的 fetchLinkMeta（Vite dev 支持直接 import 源码模块） */
  const resolve = (url) => cdp.eval(`(async () => {
    const m = await import('/src/lib/contentApi.ts');
    const meta = await m.fetchLinkMeta(${JSON.stringify(url)});
    return { title: meta.title, cover: meta.cover, embed: meta.embed, platform: meta.platform,
             artist: meta.extra && meta.extra.artist, album: meta.extra && meta.extra.album, url: meta.url };
  })()`);

  console.log('\n--- 1. 分享短链 ---');
  const short = await resolve('https://163cn.tv/bhr5rXOI');
  console.log('   ', JSON.stringify(short));
  check('歌名 = Soul Is A Star', short.title === 'Soul Is A Star', String(short.title));
  check('歌手 = Jagwar Twin', short.artist === 'Jagwar Twin', String(short.artist));
  check('专辑 = 33', short.album === '33', String(short.album));
  check('封面是网易云专辑图（https）', /^https:\/\/p\d\.music\.126\.net\//.test(short.cover || ''), String(short.cover));
  check(
    '播放器地址带正确 song id',
    /outchain\/player\?type=2&id=1968217744/.test(short.embed || ''),
    String(short.embed),
  );

  console.log('\n--- 2. 另外两种等价写法 ---');
  for (const u of ['https://music.163.com/#/song?id=1968217744', 'https://y.music.163.com/m/song?id=1968217744']) {
    const m = await resolve(u);
    check(`${u} → 同样识别为 Soul Is A Star`, m.title === 'Soul Is A Star' && !!m.embed, String(m.title));
  }

  console.log('\n--- 3. 识别不出内容时不再把短码当标题 ---');
  // 用一个不存在的短链：链路会失败，此时标题应当是域名而不是短码
  const ghost = await resolve('https://163cn.tv/zzZZ1234');
  console.log('   ', JSON.stringify(ghost));
  check('兜底标题不是短码', ghost.title !== 'zzZZ1234', String(ghost.title));

  const errs = await cdp.eval('window.__errs || []');
  check('无 console / 运行时报错', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('脚本执行', false, e.message);
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  browser.kill();
  await sleep(300);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
