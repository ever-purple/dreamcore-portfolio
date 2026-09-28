/**
 * 一次性探针：走完 20 页手账，逐页记录「结构和空地」的几何。
 * 关注：.diary-entry 可用高 / 实内容高 / 左右栏各自高度 → 左栏空洞 & 页底带状空隙。
 * 用法：node _probe-journal-all.mjs
 * 产出：.workbuddy/tmp/journal-probe/all.json
 */
import fs from 'node:fs';
import path from 'node:path';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9333';
const BASE = process.env.DIARY_URL || 'http://127.0.0.1:4177/?studio=1&diary=1';
const OUT = path.resolve('.workbuddy/tmp/journal-probe');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const created = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
let id = 0;
const pend = new Map();
const sock = new WebSocket(created.webSocketDebuggerUrl.replace(/^http/, 'ws'));
await new Promise((res, rej) => {
  sock.onopen = res;
  sock.onerror = rej;
});
sock.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
let sess = null;
async function send(method, params = {}, useSession = true) {
  const msg = { id: ++id, method, params };
  if (useSession && sess) msg.sessionId = sess;
  sock.send(JSON.stringify(msg));
  return new Promise((res) => pend.set(msg.id, res));
}
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

const att = await send('Target.attachToTarget', { targetId: created.id, flatten: true }, false);
sess = att.result?.sessionId;
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE });
await sleep(Number(process.env.WAIT || 9000));

if (!(await ev(`!!document.querySelector('.diary-book')`))) {
  console.log('NOT READY', await ev('location.href'));
  process.exit(1);
}

const snap = () => ev(`(() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
             bottom: Math.round(r.bottom), right: Math.round(r.right) }; };
  const entry = q('.diary-entry');
  const kind = entry ? (entry.className.match(/diary-(chapter|sec|review)/) || [])[1] : null;
  // 左栏 = .ds-card 或 null；右栏 = .ds-clips
  const card = q('.ds-card');
  const clips = q('.ds-clips');
  const body = q('.ds-body');
  const cardBottom = card ? Math.round(card.getBoundingClientRect().bottom) : null;
  const bodyBottom = body ? Math.round(body.getBoundingClientRect().bottom) : null;
  const afterBody = body?.nextElementSibling;
  const entryR = entry?.getBoundingClientRect();
  // .diary-sheet 的可用高（内容区）
  const sheet = q('.diary-entry');
  return {
    pager: q('.diary-pager-num')?.textContent || '',
    kind,
    title: (q('.ds-head-title') || q('.diary-note-title') || q('.dr-head-title'))?.textContent || '(封面)',
    section: q('.ds-head-no')?.textContent || null,
    entry: box(entry),
    entryScrollH: entry?.scrollHeight, entryClientH: entry?.clientHeight,
    avail: entry ? Math.round(entryR.height) : null,
    contentH: entry?.scrollHeight,
    body: box(body), card: box(card), clips: box(clips),
    photo: box(q('.ds-photo')), table: box(q('.ds-table')),
    clipKinds: [...(body?.querySelectorAll('.ds-clips > *') || [])].map((e) => e.className.toString().slice(0, 24)),
    // 左栏空洞：card 底 → body 底（右栏存在时才有意义）
    leftVoid: card && body ? Math.round(body.getBoundingClientRect().bottom - card.getBoundingClientRect().bottom) : null,
    // 页底带：body 底 → entry 内容底
    tailBand: body && entry ? Math.round(entry.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom) : null,
  };
})()`);

const rows = [];
for (let p = 0; p < 20; p++) {
  const s = await snap();
  rows.push(s);
  console.log(`${String(p).padStart(2)} ${String(s.kind || 'cover').padEnd(8)} ${String(s.pager).padEnd(9)} avail ${s.avail} content ${s.contentH} slack ${s.avail - s.contentH}  leftVoid ${s.leftVoid} tailBand ${s.tailBand}  ${String(s.title).slice(0, 22)} [${(s.clipKinds || []).join(',')}]`);
  if (p === 19) break;
  const box = await ev(`(() => { const b = document.querySelector('.diary-nav.is-next'); if(!b) return null;
    const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  if (!box) { console.log('no next @', p); break; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await sleep(1000);
}

fs.writeFileSync(path.join(OUT, 'all.json'), JSON.stringify(rows, null, 1));
console.log('\nsaved ->', path.join(OUT, 'all.json'));
sock.close();
fetch(`${CDP}/json/close/${created.id}`).catch(() => {});
