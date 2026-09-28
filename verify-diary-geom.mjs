/**
 * 一次性探针：量出手账页「文字块结束后还剩多少空地」，以及右栏图片位的真实占位。
 * 用法：node _probe-journal.mjs [目标页序号,默认2] 
 * 产出：.workbuddy/tmp/journal-probe/ 下的几何 JSON + 截图
 */
import fs from 'node:fs';
import path from 'node:path';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9333';
const BASE = process.env.DIARY_URL || 'http://127.0.0.1:4177/?studio=1&diary=1';
const TARGET = Number(process.argv[2] || 2);
const OUT = path.resolve(process.env.SHOT_DIR || '.workbuddy/tmp/journal-probe');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// —— 浏览器级新建 target（绝不用 /json/new：已有标签页时会被劫持，2026-09-17 踩过）——
const created = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
let ws = created.webSocketDebuggerUrl;
let id = 0;
const pend = new Map();
let sock;

async function connect(url) {
  sock = new WebSocket(url);
  await new Promise((res, rej) => {
    sock.onopen = res;
    sock.onerror = rej;
  });
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m);
      pend.delete(m.id);
    }
  };
}

let sess = null;
async function send(method, params = {}, useSession = true) {
  const msg = { id: ++id, method, params };
  if (useSession && sess) msg.sessionId = sess;
  sock.send(JSON.stringify(msg));
  return new Promise((res) => pend.set(msg.id, res));
}
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

await connect(ws.replace(/^http/, 'ws'));
const att = await send('Target.attachToTarget', { targetId: created.id, flatten: true }, false);
sess = att.result?.sessionId;
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Number(process.env.W || 1440), height: Number(process.env.H || 900), deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE });
await sleep(Number(process.env.WAIT || 9000));

if (!(await ev(`!!document.querySelector('.diary-book')`))) {
  console.log('NOT READY url=', await ev('location.href'));
  process.exit(1);
}

// 翻到目标页
for (let p = 0; p < TARGET; p++) {
  const box = await ev(`(() => { const b = document.querySelector('.diary-nav.is-next'); if(!b) return null;
    const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  if (!box) { console.log('no next button at page', p); break; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await sleep(1100);
}

const info = await ev(`(() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) }; };
  const entry = q('.diary-entry');
  const sheet = q('.diary-sheet');
  const card = q('.ds-card');
  const clips = q('.ds-clips');
  const photo = q('.ds-photo');
  const frame = q('.ds-photo-frame');
  const table = q('.ds-table');
  const head = q('.ds-head') || q('.dr-head') || q('.diary-note-head');
  const runHead = q('.ds-run') || q('.ds-run-head') || q('.diary-run');
  const kids = [...(entry?.children || [])].map((el) => ({ cls: el.className.toString().slice(0, 40), ...box(el) }));
  return {
    url: location.href,
    pager: q('.diary-pager-num')?.textContent || '',
    pageText: (q('.ds-head-title') || q('.diary-note-title') || q('.dr-head-title'))?.textContent || '(封面)',
    sheet: box(sheet), entry: box(entry),
    entryScrollH: entry?.scrollHeight, entryClientH: entry?.clientHeight,
    head: box(head), card: box(card), clips: box(clips), photo: box(photo), frame: box(frame), table: box(table),
    photoHint: q('.ds-photo-hint')?.textContent || null,
    kids,
  };
})()`);

console.log(JSON.stringify(info, null, 1));
fs.writeFileSync(path.join(OUT, `geom-p${TARGET}.json`), JSON.stringify(info, null, 1));

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(OUT, `p${TARGET}.png`), Buffer.from(shot.result.data, 'base64'));
await send('Page.captureScreenshot', { format: 'png' });

// 只截纸面区域，便于看清留白
const shot2 = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: info.entry.x, y: Math.max(0, info.entry.y), width: info.entry.w, height: info.entry.h, scale: 1 },
});
fs.writeFileSync(path.join(OUT, `p${TARGET}-sheet.png`), Buffer.from(shot2.result.data, 'base64'));
console.log('shots ->', OUT);

sock.close();
fetch(`${CDP}/json/close/${created.id}`).catch(() => {});
