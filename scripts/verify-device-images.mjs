/**
 * 无头验证：快速版场景图层在「桌面视口 / 移动视口」下**只下载各自一套**图。
 *
 * 背景（这条测试防的就是它回归）：
 *   早期快速版把桌面图层和移动图层各写成一份并列的 <div>（`__desktop` / `__mobile`），
 *   再用 CSS `display:none` 藏掉不用的那套。**`display:none` 拦不住 <img> 的下载** ——
 *   结果手机进了快速版，桌面那 8 张（含最重的 desk-crt-scene）照样被拉下来，
 *   白白拖慢首屏。现已改为**单一 `<picture>` + `<source media="(max-width:760px)">`**：
 *   浏览器按当前视口只挑一条 source，移动端没有对应资源的电脑图层用透明 GIF 占位，
 *   不产生任何网络请求。
 *
 * 判据（两个视口各跑一遍）：
 *   · 桌面 1440×900：只出现 surreal-desktop/*（8 张），surreal-mobile/* 必须为 0
 *   · 移动 390×844：只出现 surreal-mobile/*（6 张），surreal-desktop/* 必须为 0
 *   并逐张核对文件名集合，防止「数量对了但下错了图」。
 *
 * 用法：先起预览服务（`npm run preview`，端口 4180），然后
 *   node scripts/verify-device-images.mjs
 *
 * 可用环境变量覆盖：
 *   BASE=http://127.0.0.1:4180  预览地址
 *   WAIT=7000                   每次导航后的静置时长（ms）
 *   CDP_PORT=9368               调试端口（与 verify-mode.mjs 的 9367 错开）
 *
 * 配套：src/components/QuickViewShell.tsx（SceneLayer 组件）
 *       src/meadow-v2.css（.qv-world / .qv-foreground 定位）
 *       scripts/verify-mode.mjs（同款自 spawn Edge + CDP 的写法）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = Number(process.env.CDP_PORT || 9368);
const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const WAIT = Number(process.env.WAIT || 7000);

/** 期望的文件名集合（与 public/quick-view-v2/ 实际内容一致） */
const DESKTOP_EXPECT = [
  'base-sky-meadow.webp', 'cloud.webp', 'curtain.webp', 'desk-crt-scene.webp',
  'desk-crt-screen-glow.webp', 'floating-house.webp', 'goldfish.webp', 'house-shadow.webp',
];
const MOBILE_EXPECT = [
  'base-sky-meadow.webp', 'cloud.webp', 'curtain.webp',
  'floating-house.webp', 'goldfish.webp', 'house-shadow.webp',
];

const profile = path.join(os.tmpdir(), '_edgedevimg' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

/**
 * 等 **浏览器级** CDP 端点就绪（`/json/version` → webSocketDebuggerUrl）。
 * 不用 `/json/list` 抓页面 target：本脚本每次测量都自己 `Target.createTarget`，
 * 页面 target 由脚本创建，浏览器级连接才能下发 `Target.createBrowserContext`。
 */
async function waitForBrowser(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      const v = await res.json();
      if (v.webSocketDebuggerUrl) return v;
    } catch {}
    await sleep(500);
  }
  throw new Error(`CDP 没起来（端口 ${port}）`);
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) {
        this.handlers.forEach((h) => h(m));
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id; const p = { id, method, params };
    if (sessionId) p.sessionId = sessionId;
    this.ws.send(JSON.stringify(p));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }
  async eval(expr, sessionId) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

/**
 * 跑一个视口。**每个视口开独立浏览器上下文**（`Target.createBrowserContext`）——
 * 这条是踩过坑的：最初复用同一个标签页跑两遍，结果移动那一轮把桌面 8 张也报了进来。
 * 根因是复用标签页时桌面图已进 HTTP 缓存 + 页面已预热，第二轮会因缓存/时序差异
 * 产生额外请求，量出来的不是「该视口真实需要什么」。独立上下文 = 独立缓存，
 * 每次都是从零冷启动，结果才可比。
 *
 * 另外两条硬要求：
 *   · `Emulation.setDeviceMetricsOverride` 必须在 `Page.navigate` **之前**下发，
 *     否则页面会按默认视口完成首次 `<source media>` 选择，量出来就是错的。
 *   · 所有域都要挂在**该 context 自己的 sessionId** 上，否则收不到网络事件。
 */
async function measure(cdp, label, width, height, mobile) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  const seen = new Map();   // 文件名 → initiator 类型
  const failed = [];
  cdp.handlers = [(m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Network.requestWillBeSent') {
      const u = m.params.request.url;
      const i = u.indexOf('/quick-view-v2/');
      if (i >= 0) seen.set(u.slice(i + '/quick-view-v2/'.length), m.params.initiator?.type || '?');
    }
    if (m.method === 'Network.loadingFailed' && m.params.errorText !== 'net::ERR_ABORTED') {
      failed.push(`${m.params.errorText} ${m.params.requestId}`);
    }
  }];

  try {
    for (const d of ['Page', 'Network', 'Runtime']) await cdp.send(`${d}.enable`, {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile }, sessionId);
    await cdp.send('Page.navigate', { url: `${BASE}/?quick` }, sessionId);

    // 等快速版挂载（与 QuickViewShell 的 body class 同源），再静置收尾网络
    for (let i = 0; i < 40; i++) {
      const on = await cdp.eval(`document.body.classList.contains('quick-view-active')`, sessionId).catch(() => false);
      if (on) break;
      await sleep(250);
    }
    await sleep(WAIT);

    // 诊断：document 里每个场景 <img> 最终选中的资源（currentSrc）
    const picked = await cdp.eval(
      `JSON.stringify([...document.querySelectorAll('picture img')]
         .map(i => (i.currentSrc || i.src || '').split('/quick-view-v2/').slice(-1)[0])
         .filter(s => s.includes('surreal-')))`, sessionId).catch(() => '[]');

    const entries = [...seen.entries()];
    const desktop = entries.filter(([f]) => f.startsWith('surreal-desktop/'));
    const mob = entries.filter(([f]) => f.startsWith('surreal-mobile/'));
    console.log(`\n=== ${label}（${width}×${height}, mobile=${mobile}）===`);
    console.log(`  桌面素材请求 ${desktop.length} 个：${desktop.map(([f, s]) => `${f.split('/')[1]}(${s})`).join(', ') || '—'}`);
    console.log(`  移动素材请求 ${mob.length} 个：${mob.map(([f, s]) => `${f.split('/')[1]}(${s})`).join(', ') || '—'}`);
    console.log(`  文档里实际选中的 img：${JSON.parse(picked || '[]').join(', ') || '—'}`);
    if (failed.length) console.log(`  网络失败：${failed.join(', ')}`);
    return {
      desktop: desktop.map(([f]) => f.split('/')[1]).sort(),
      mobile: mob.map(([f]) => f.split('/')[1]).sort(),
      picked: JSON.parse(picked || '[]'),
      failed,
    };
  } finally {
    cdp.handlers = [];
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
}

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-extensions',
  '--hide-scrollbars', '--mute-audio', '--window-size=1440,900',
  'about:blank',
], { stdio: 'ignore' });

/**
 * ⚠️ 退出码必须留到 finally 里再 exit：`process.exit()` 是从 C++ 侧直接终止进程，
 * **不会执行 finally**。若在 try 里 exit，下面的 edge.kill() / 清 profile 全被跳过，
 * 每次跑完都会漏一个无头 Edge 进程 + 一个 %TEMP% 里的浏览器 profile。
 */
let exitCode = 0;

try {
  const browser = await waitForBrowser(CDP_PORT);
  const ws = new WebSocket(browser.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 1 << 28 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const cdp = new CDP(ws);

  const d = await measure(cdp, '桌面视口', 1440, 900, false);
  check('桌面：请求的全是 surreal-desktop（未误下移动素材）', d.mobile.length === 0, `mobile 命中 ${d.mobile.length} 个`);
  check('桌面：桌面图 8 张且文件名与预期一致', eq(d.desktop, [...DESKTOP_EXPECT].sort()),
    `实测 ${d.desktop.length} 张`);
  check('桌面：文档里实际选中的 img 全来自 surreal-desktop',
    d.picked.length > 0 && d.picked.every((s) => s.startsWith('surreal-desktop/')),
    d.picked.join(', ') || '—');
  check('桌面：无网络失败', d.failed.length === 0, d.failed.join(','));

  const m = await measure(cdp, '移动视口', 390, 844, true);
  check('移动：请求的全是 surreal-mobile（未误下桌面素材）', m.desktop.length === 0, `desktop 命中 ${m.desktop.length} 个`);
  check('移动：移动图 6 张且文件名与预期一致', eq(m.mobile, [...MOBILE_EXPECT].sort()),
    `实测 ${m.mobile.length} 张`);
  check('移动：文档里实际选中的 img 全来自 surreal-mobile',
    m.picked.length > 0 && m.picked.every((s) => s.startsWith('surreal-mobile/')),
    m.picked.join(', ') || '—');
  check('移动：无网络失败', m.failed.length === 0, m.failed.join(','));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 汇总：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) console.log('失败项：' + failed.map((f) => f.name).join(' / '));
  ws.close();
  exitCode = failed.length ? 1 : 0;
} catch (err) {
  console.error('FATAL', err);
  console.error('失败项：' + results.filter((r) => !r.ok).map((f) => f.name).join(' / '));
  exitCode = 2;
} finally {
  edge.kill('SIGKILL');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(exitCode);
}
