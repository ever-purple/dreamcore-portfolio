/**
 * 设备姿态挑选：一次起多个页面（每个页面一个候选姿态），各拍一张局部放大图 +
 * 一张整架图，并打印该姿态下设备在**搁板坐标系**里的 AABB，用来校验
 * 「不超出搁板进深 / 不穿天花板 / 底座贴台面」。
 *
 * 候选姿态通过 ?nsrot=file:pitch,yaw,roll,width 在**摆放阶段**生效，
 * 因此包围盒是真实摆放结果（会重新居中 + 贴面），不是运行时改 rotation 的假象。
 *
 * 用法：先起预览服务 + 无头 Edge（见 headless-web-verify skill），然后
 *   node scripts/pick-device-pose.mjs（ws 已是 devDependency）
 */
import WebSocket from 'ws';
import fs from 'node:fs';

const CDP = 'http://127.0.0.1:9333';
const BASE = 'http://127.0.0.1:4180/?studio=1&newsstand=1&nsfit=1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 搁板可用空间（scripts/_probe-rack.mjs 实测） */
const SHELF = { z: [-0.0721, 0.0548], ceil: 0.92, floor: 0.74 };

const CANDS = [
  { tag: 'fr15', q: '&nscam=3.3,1.45' },
  { tag: 'fr16', q: '&nscam=3.3,1.6' },
  { tag: 'fr17', q: '&nscam=3.3,1.75' },
];

const conn = async () => {
  const created = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0;
  const pending = new Map();
  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}, ms = 120000) => new Promise((res) => {
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
  return { ws, send, ev, id: created.id };
};

for (const c of CANDS) {
  const { ws, send, ev, id } = await conn();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: BASE + c.q });
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < 240000) {
    if ((await ev('window.__NSREADY === true')) === true) { ok = true; break; }
    await sleep(1500);
  }
  console.log(`\n=== ${c.tag}  ready=${ok}  in ${((Date.now() - t0) / 1000).toFixed(1)}s  ${c.q}`);
  if (!ok) { ws.close(); fetch(`${CDP}/json/close/${id}`).catch(() => {}); continue; }

  // 指针居中 → 架子不转；清掉误触发的悬停
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 450, pointerType: 'mouse' });
  await sleep(1200);
  await ev('window.__NSPOKE(-1)');
  await sleep(900);

  const fit = JSON.parse(await ev('JSON.stringify(window.__NSFIT)'));
  for (const it of fit.items.filter((i) => i.kind === 'device')) {
    const over = it.z[0] < SHELF.z[0] - 0.002 || it.z[1] > SHELF.z[1] + 0.002;
    const ceil = it.y[1] + 0.028 > SHELF.ceil;
    console.log(
      `  ${it.label.padEnd(9)} z=[${it.z[0].toFixed(4)},${it.z[1].toFixed(4)}] ${over ? 'OVER' : 'ok  '}` +
        `  y=[${it.y[0].toFixed(4)},${it.y[1].toFixed(4)}] ${ceil ? 'CEIL' : 'ok  '}` +
        `  up=(${it.up.x},${it.up.y},${it.up.z}) front=(${it.front.x},${it.front.y},${it.front.z})` +
        `  rest p/y/r=${it.restPitchDeg}/${it.yawNowDeg}/${it.restRollDeg} w=${(it.x[1] - it.x[0]).toFixed(4)}`,
    );
  }

  const dvd = fit.items.find((i) => i.label === 'dvd.glb');
  const mp3 = fit.items.find((i) => i.label === 'mp3.glb');

  const shoot = async (idx, tag, scale = 5) => {
    const at = JSON.parse((await ev(`JSON.stringify(window.__NSAT(${idx}))`)) || 'null');
    if (!at) { console.log('   no rect', tag); return; }
    const pad = Math.round(Math.max(at.w, at.h) * 0.3);
    const cw = at.w + pad * 2;
    const ch = at.h + pad * 2;
    const r = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: Math.max(0, at.x - cw / 2), y: Math.max(0, at.y - ch / 2), width: cw, height: ch, scale },
    }, 300000);
    if (r.result?.data) {
      fs.writeFileSync(`_pick_${tag}.png`, Buffer.from(r.result.data, 'base64'));
      console.log(`   -> _pick_${tag}.png  ${at.w}x${at.h}`);
    } else console.log('   shot FAILED', tag);
  };

  await shoot(dvd.i, `${c.tag}_dvd`);
  // MP3 悬停（站起到 45°）
  await ev(`window.__NSPOKE(${mp3.i})`);
  await sleep(1600);
  await shoot(mp3.i, `${c.tag}_mp3`);
  const hv = JSON.parse(await ev('JSON.stringify(window.__NSFIT)'));
  const m2 = hv.items.find((i) => i.label === 'mp3.glb');
  console.log(`   mp3 hover: roll=${m2.rollNowDeg} lift=${m2.lift} scale=${m2.scaleNow}`);

  // 整架小图，检查是否穿模 / 悬空
  const full = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, 300000);
  if (full.result?.data) fs.writeFileSync(`_pick_${c.tag}_full.png`, Buffer.from(full.result.data, 'base64'));

  ws.close();
  fetch(`${CDP}/json/close/${id}`).catch(() => {});
}
process.exit(0);
