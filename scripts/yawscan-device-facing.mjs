/**
 * 正面朝向扫描：对三件设备各绕 Y 转 0/90/180/270 截局部放大图，
 * 用来判断「模型的正面（DVD 的屏幕算正面）朝哪边」。
 *
 * 输出：_yaw_{tag}_{yaw}.png，随后由 scripts/compose-yaw.py 拼成对比图。
 * 用法：NODE_PATH=node_modules node scripts/yawscan-device-facing.mjs
 */
import WebSocket from 'ws';
import fs from 'node:fs';

const CDP = 'http://127.0.0.1:9333';
const PAGE = 'http://127.0.0.1:4180/?studio=1&newsstand=1&nsfit=1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const created = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(created.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

let id = 0;
const pending = new Map();
ws.on('message', (buf) => {
  const m = JSON.parse(buf.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}, ms = 60000) => new Promise((res) => {
  const mid = ++id;
  const t = setTimeout(() => { pending.delete(mid); res({ __timeout: true }); }, ms);
  pending.set(mid, (m) => { clearTimeout(t); res(m); });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.__timeout || r.result?.exceptionDetails) return null;
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: PAGE });

const t0 = Date.now();
let ready = false;
while (Date.now() - t0 < 240000) {
  if ((await ev('window.__NSREADY === true')) === true) { ready = true; break; }
  await sleep(1500);
}
console.log('ready =', ready, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (!ready) { console.log('not ready'); ws.close(); process.exit(1); }

// 指针挪到角落，避免悬停姿态干扰
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 890, pointerType: 'mouse' });
await sleep(800);

// ⚠️ 不要用 0/1/2 当下标：书籍在展架回调里先 push，设备是之后异步放的，
// 顺序是「3 本书 + 3 件设备」。按 label 找才可靠。
const fit = JSON.parse(await ev('JSON.stringify(window.__NSFIT)'));
const devs = fit.items
  .filter((it) => it.label === 'dvd.glb' || it.label === 'dv.glb' || it.label === 'mp3.glb')
  .sort((a, b) => a.x[0] - b.x[0]);
console.log('devices:', devs.map((d) => `#${d.i} ${d.label}`).join('  '));

const YAW = [0, 90, 180, 270];
for (let n = 0; n < devs.length; n++) {
  const idx = devs[n].i;
  const tag = devs[n].label.replace('.glb', '');
  for (const yaw of YAW) {
    await ev(`window.__NSYAW(${idx}, ${yaw})`);
    await sleep(700);
    // ⚠️ 每转一次都要重取：旋转绕 holder 原点做，设备会摆出去
    const at = JSON.parse((await ev(`JSON.stringify(window.__NSAT(${idx}))`)) || 'null');
    if (!at) { console.log(`${tag} yaw${yaw}: no screen pos`); continue; }
    // 按投影包围盒裁切，四边留 35% 余量；scale 把这块区域按更高 DPR 渲染 → 清晰放大
    const padX = Math.max(14, at.w * 0.35);
    const padY = Math.max(14, at.h * 0.35);
    const cw = at.w + padX * 2;
    const ch = at.h + padY * 2;
    const scale = Math.min(8, Math.max(2, Math.round(760 / Math.max(cw, ch))));
    const r = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, at.x - cw / 2),
        y: Math.max(0, at.y - ch / 2),
        width: cw,
        height: ch,
        scale,
      },
    }, 240000);
    const out = `_yaw_${tag}_${yaw}.png`;
    if (r.result?.data) {
      fs.writeFileSync(out, Buffer.from(r.result.data, 'base64'));
      console.log(`  ${tag} yaw=${yaw} box=(${at.x0},${at.y0})-(${at.x1},${at.y1}) ${at.w}x${at.h} → clip ${Math.round(cw)}x${Math.round(ch)}@${scale}x`);
    } else {
      console.log('  ', out, 'FAILED');
    }
  }
}

ws.close();
fetch(`${CDP}/json/close/${created.id}`).catch(() => {});
process.exit(0);
