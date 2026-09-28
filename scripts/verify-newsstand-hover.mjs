/**
 * 无头回归：报刊亭书籍悬停（2026-09-22 两轮）
 *
 * 第一轮「一直在抖」：书悬停会动，而拾取射线打书本体 —— 光标在下边缘时书一动
 * 就脱靶，hover 反复横跳。修复：每本书配**固定在架上静止位**的隐形代理盒
 * （HoverItem.pickObj），拾取只看「光标 vs 书格」，与动画解耦；
 * 外加悬停滞回（连续 3 次脱靶才撤销 hover，吃掉鼠标微噪声的边界抖动）。
 *
 * 第二轮「穿模卡模」：原悬停「抬升 0.048 + 放大 1.12」把书顶顶到 0.769，
 * **穿进上层搁板（底面 ≈0.714）0.032**（?nsgeo=1 实测板厚）。重设计为
 * 「抽出来 + 向你倾倒」：前抽 0.09 + 绕书脚前倾 10°，书顶高度几乎不变。
 *
 * 断言：
 *   A  book:1 中心命中（lift 爬升 = 命中静止位代理盒）
 *   B  光标钉在书格下边缘 10s（周期性重发 pointermove 模拟手抖）
 *      → 前倾角收敛到 +6° 且**钉住不回摆**（旧代码在此必然振荡）
 *   C  光标移开 → 姿态单调回到静止（后仰 -4°）
 *   D  设备（dvd.glb）悬停冒烟 —— hitsItem 重构后设备路径不受影响
 *   E  三本书悬停到顶，书顶（搁板坐标系）全部 ≤ 0.714（上层搁板底面）—— 不穿模
 *
 * 无头环境注意（踩过的坑）：
 *   · rAF 节流 ~1.6fps：读数必须**轮询取 max/min**，单次读数会漏；
 *   · 架子跟随鼠标缓动：每步移动后必须等 __NSATP 矩形连续不变（停稳）再验证；
 *   · __NSATP 投的是**代理盒**（__NSAT 投的书本体会跟着悬停动画动）。
 *
 * 用法：dev server（5173）跑着即可，脚本自建无头 Edge：
 *   node scripts/verify-newsstand-hover.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9362;
const DEV = process.env.DEV_URL || 'http://127.0.0.1:5173';
const PAGE = `${DEV}/?studio=1&newsstand=1&nsfit=1&nsgeo=1`;
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync) || 'msedge';
const PROFILE = join(tmpdir(), 'ns-hover-regression-profile');

/** 上层搁板底面（?nsgeo=1 实测：朝下面桶 0.72，下沿 0.714）—— 书顶不得高于此 */
const SHELF_BOARD_BOTTOM = 0.714;
/** 书悬停前倾目标角（restPitch -4° + BOOK_TILT_FWD 10°） */
const BOOK_HOVER_PITCH = 6;
/** 书静止后仰角 */
const BOOK_REST_PITCH = -4;

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--mute-audio',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
  `--user-data-dir=${PROFILE}`, 'about:blank'], { detached: true, stdio: 'ignore' });
edge.unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map(); let sid = null;
let pass = 0; let fail = 0;
function check(ok, label, extra = '') {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ' :: ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' :: ' + extra : ''}`); }
}
function send(method, params = {}, session) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function evalJS(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result.value;
}
const mouse = (type, x, y) => send('Input.dispatchMouseEvent',
  { type, x, y, button: 'left', buttons: 0, clickCount: 0 }, sid);

const t0 = Date.now(); let target;
for (;;) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
    if (target) break;
  } catch { /* retry */ }
  if (Date.now() - t0 > 15000) throw new Error('Edge CDP 起不来');
  await sleep(400);
}
ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => { ws.onopen = res; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const { sessionId } = await send('Target.attachToTarget', { targetId: target.id, flatten: true });
sid = sessionId;
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: PAGE }, sid);
for (let i = 0; i < 60; i++) {
  await sleep(700);
  const f = await evalJS(`(window.__NSFIT && window.__NSFIT.count) || 0`);
  if (f >= 6) break;
}
const fit = await evalJS(`window.__NSFIT || null`);
if (!fit || fit.count < 6) { console.log('FAIL: nsfit 探针未就绪'); process.exit(1); }

const liftOf = (i) => evalJS(`window.__NSFIT.items[${i}].lift`);
const pitchOf = (i) => evalJS(`window.__NSFIT.items[${i}].pitchNowDeg`);
const rectOf = (i) => evalJS(`window.__NSATP(${i})`);
async function extremum(idx, getter, ms, dir = 'max') {
  const end = Date.now() + ms;
  let m = dir === 'max' ? -Infinity : Infinity;
  while (Date.now() < end) {
    const v = await getter(idx);
    m = dir === 'max' ? Math.max(m, v) : Math.min(m, v);
    await sleep(250);
  }
  return m;
}
/** 等架子停稳：__NSATP 矩形连续两次读数相同（架子跟转时矩形会漂） */
async function waitSettled(idx, maxMs = 8000) {
  const end = Date.now() + maxMs;
  let prev = await rectOf(idx);
  while (Date.now() < end) {
    await sleep(600);
    const cur = await rectOf(idx);
    if (cur.x0 === prev.x0 && cur.y0 === prev.y0 && cur.x1 === prev.x1 && cur.y1 === prev.y1) return cur;
    prev = cur;
  }
  return prev;
}
/** 迭代瞄准：架子跟转让投影矩形漂移，用「读矩形 → 移中心 → 验证」的不动点迭代 */
async function aimCenter(idx, threshold, rounds = 8) {
  let hit = -1; let px = 0; let py = 0;
  for (let round = 0; round < rounds; round++) {
    const r = await rectOf(idx);
    px = r.x; py = r.y;
    await mouse('mouseMoved', px, py);
    hit = await extremum(idx, liftOf, 2600);
    if (hit > threshold) break;
  }
  return { hit, px, py };
}

/* ---------- A/B/C：book:1 悬停钉住 ---------- */
console.log('\n── A/B/C 书籍悬停（book:1）──');
const bookIdx = await evalJS(`window.__NSFIT.items.findIndex(it => it.label === 'book:1')`);
const aim = await aimCenter(bookIdx, 0.0015);
check(aim.hit > 0.0015, 'A 中心命中：lift 爬升', `max lift=${aim.hit.toFixed(4)}`);

if (aim.hit > 0.0015) {
  const settled = await waitSettled(bookIdx);
  // 下边缘 = 代理矩形底边向上 4px（录屏里光标停留的位置）
  let goodY = 0;
  for (let off = 4; off <= 40 && !goodY; off += 4) {
    const y = settled.y1 - off;
    await mouse('mouseMoved', settled.x, y);
    await waitSettled(bookIdx, 6000);
    const l = await extremum(bookIdx, liftOf, 2600);
    if (l >= 0.002) goodY = y;
  }
  check(goodY > 0, 'B0 下边缘存在稳定命中点', goodY ? `y=${goodY}（矩形底 ${settled.y1}）` : '40px 内全出界');
  if (goodY) {
    await mouse('mouseMoved', settled.x, goodY);
    await waitSettled(bookIdx, 6000);
    await extremum(bookIdx, pitchOf, 4000, 'max'); // 等收敛
    console.log('—— 钉在下边缘持续采样 10s ——');
    const pitch = [];
    const lift = [];
    const end = Date.now() + 10000;
    let n = 0;
    while (Date.now() < end) {
      if (n % 2 === 0) await mouse('mouseMoved', settled.x, goodY); // 模拟手抖
      pitch.push(await pitchOf(bookIdx));
      lift.push(await liftOf(bookIdx));
      await sleep(250);
      n++;
    }
    const tail = pitch.slice(-6);
    const minP = Math.min(...tail);
    const maxP = Math.max(...tail);
    check(minP > BOOK_HOVER_PITCH - 1.2 && maxP - minP < 1.0,
      'B 钉在下边缘 10s：前倾角钉住 +6° 无抖动',
      `末6样 [${minP.toFixed(2)}°, ${maxP.toFixed(2)}°] lift≈${lift[lift.length - 1].toFixed(4)}`);

    await mouse('mouseMoved', 10, 10);   // 滞回需要连续 3 次脱靶才撤销 hover
    await mouse('mouseMoved', 10, 11);
    await mouse('mouseMoved', 10, 12);
    const a = [];
    const e2 = Date.now() + 20000;
    while (Date.now() < e2) { a.push(await pitchOf(bookIdx)); await sleep(300); }
    check(Math.abs(a[a.length - 1] - BOOK_REST_PITCH) < 1.2,
      'C 移开正常复位到后仰 -4°', `末值=${a[a.length - 1].toFixed(2)}°`);
  }
}

/* ---------- D：设备悬停冒烟 ---------- */
console.log('\n── D 设备悬停冒烟（dvd.glb）──');
const devIdx = await evalJS(`window.__NSFIT.items.findIndex(it => it.label === 'dvd.glb')`);
const devAim = await aimCenter(devIdx, 0.015);
check(devAim.hit > 0.015, 'D 设备悬停正常（hitsItem 重构无回归）', `max lift=${devAim.hit.toFixed(4)}`);
await evalJS(`window.__NSPOKE(-1)`);

/* ---------- E：三本书悬停到顶全部不穿上层搁板 ---------- */
console.log('\n── E 悬停穿模断言（书顶 ≤ 0.714 = 上层搁板底面）──');
await waitSettled(bookIdx, 4000);
const bookIdxs = await evalJS(`window.__NSFIT.items.map((it, i) => it.kind === 'book' ? i : -1).filter(i => i >= 0)`);
let worstTop = -Infinity;
for (const i of bookIdxs) {
  await evalJS(`window.__NSPOKE(${i})`);
  // 等 lift 收敛到 BOOK_LIFT≈0.003（rAF 节流下多等几轮）
  for (let k = 0; k < 12; k++) {
    await sleep(500);
    const l = await liftOf(i);
    if (l >= 0.0028) break;
  }
  const it = await evalJS(`(({ label, y, pitchNowDeg }) => ({ label, y, pitchNowDeg }))(window.__NSFIT.items[${i}])`);
  const top = it.y[1];
  worstTop = Math.max(worstTop, top);
  console.log(`  ${it.label}: 悬停顶=${top.toFixed(4)} pitch=${it.pitchNowDeg}° ${top <= SHELF_BOARD_BOTTOM ? '✓' : '✗ 穿模 ' + (top - SHELF_BOARD_BOTTOM).toFixed(4)}`);
}
await evalJS(`window.__NSPOKE(-1)`);
check(worstTop <= SHELF_BOARD_BOTTOM, 'E 三本书悬停到顶均不穿上层搁板', `最高书顶=${worstTop.toFixed(4)}`);

console.log(`\n=== ${pass} passed / ${fail} failed ===`);
process.exit(fail ? 1 : 0);
