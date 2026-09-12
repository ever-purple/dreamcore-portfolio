/**
 * 可靠冒烟（无头 Edge + CDP）：验证重构后的策划案「左字右图」面板 + 版权保护。
 * 用缩略图点击开面板（避开 3D 射线第二次点击的时序抖动），端口沿用能连上的 9333 套路。
 * 用法：node scripts/verify-case.mjs   （需先起 preview：端口 4180）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9366;
const BASE = process.env.BASE ?? 'http://127.0.0.1:4180/?studio=1&admin=1';
const OUT = path.resolve('scripts/_shots');
const profile = path.join(os.tmpdir(), '_edgecase' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && this.pending.has(j.id)) { this.pending.get(j.id)(j); this.pending.delete(j.id); } }; }
  send(method, params = {}, sid) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); this.ws.send(JSON.stringify({ id, method, params, sessionId: sid })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
  async shot(file) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data, 'base64')); return path.join(OUT, file); }
}

async function waitForTarget(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('CDP 没起来');
}

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
try {
  fs.mkdirSync(OUT, { recursive: true });
  const target = await waitForTarget(CDP_PORT);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: BASE });
  await sleep(3000);
  await cdp.eval(`new Promise(r => { const x = indexedDB.deleteDatabase('dreamcore-carousel-projects'); x.onsuccess = x.onerror = x.onblocked = () => r('ok'); })`);

  /* —— 版权保护：右键 / 图片拖拽 / Ctrl+S —— */
  const cr = await cdp.eval(`(() => {
    const out = {};
    const cm = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.dispatchEvent(cm); out.contextmenuBlocked = cm.defaultPrevented;
    const img = document.createElement('img'); document.body.appendChild(img);
    const ds = new Event('dragstart', { bubbles: true, cancelable: true });
    img.dispatchEvent(ds); out.imgDragBlocked = ds.defaultPrevented; img.remove();
    const ks = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ks); out.ctrlSBlocked = ks.defaultPrevented;
    const ka = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    document.dispatchEvent(ka); out.normalKeyAllowed = !ka.defaultPrevented;
    return out;
  })()`);
  check('右键菜单被禁用', cr.contextmenuBlocked === true, JSON.stringify(cr));
  check('图片拖拽被禁用', cr.imgDragBlocked === true, String(cr.imgDragBlocked));
  check('Ctrl+S 另存被禁用', cr.ctrlSBlocked === true, String(cr.ctrlSBlocked));
  check('普通按键不受影响', cr.normalKeyAllowed === true, String(cr.normalKeyAllowed));

  /* 点开 Works 木马 */
  const opened = await cdp.eval(`(() => { const b = [...document.querySelectorAll('.studio-btn')].find(b => b.textContent.includes('Works')); if (!b) return 'no'; b.click(); return 'clicked'; })()`);
  check('工作室里能找到 Works 木马按钮', opened === 'clicked', opened);
  await sleep(3500);

  /* 3D 场景 */
  let ready = null;
  for (let i = 0; i < 50; i++) {
    ready = await cdp.eval(`(() => { const c = document.querySelector('.works-canvas-host canvas'); if (!c) return null; const gl = c.getContext('webgl2') || c.getContext('webgl'); return { frames: c.dataset.carouselFrames, pivots: c.dataset.carouselPivots, w: c.width, h: c.height, lost: gl ? gl.isContextLost() : 'nogl' }; })()`);
    if (ready) break; await sleep(500);
  }
  check('浮层内出现 3D 画布', Boolean(ready), JSON.stringify(ready));
  check('相框数 = 6', ready?.frames === '6', `frames=${ready?.frames}`);
  check('吊点数 = 4', ready?.pivots === '4', `pivots=${ready?.pivots}`);
  check('WebGL 上下文正常', ready?.lost === false, String(ready?.lost));
  await cdp.shot('01-carousel.png');

  /* 点 PLAN_01 缩略图 → 阅读态面板（左字右图） */
  await cdp.eval(`document.querySelectorAll('.works-thumb')[0].click()`);
  await sleep(700);
  for (let k = 0; k < 70; k++) { const ok = await cdp.eval(`(() => { const i = document.querySelector('.works-highlight'); return !!(i && i.complete && i.naturalWidth > 0); })()`); if (ok) break; await sleep(600); }
  const panel = await cdp.eval(`(() => { const p = document.querySelector('.works-panel'); if (!p) return null; return {
    code: p.querySelector('.works-panel-code')?.textContent,
    hasCase: !!p.querySelector('.works-case'), hasText: !!p.querySelector('.works-case-text'), hasMedia: !!p.querySelector('.works-case-media'),
    sections: p.querySelector('.works-sections')?.children.length || 0,
    firstHeading: p.querySelector('.works-section .works-sec')?.textContent,
    hasDownload: !!p.querySelector('.works-download'),
    editing: !!p.querySelector('#wk-title'),
    hlW: document.querySelector('.works-highlight')?.naturalWidth || 0 }; })()`);
  check('PLAN_01 面板弹出', Boolean(panel), JSON.stringify(panel));
  check('左字右图布局（.works-case）', panel?.hasCase === true, String(panel?.hasCase));
  check('左栏结构化文案', panel?.hasText === true, String(panel?.hasText));
  check('右栏高光图区', panel?.hasMedia === true, String(panel?.hasMedia));
  check('6 节结构化文案（观夏）', panel?.sections >= 2, `sections=${panel?.sections}`);
  check('观夏高光图（deck 首页）已渲染', panel?.hlW > 0, `w=${panel?.hlW}`);
  check('已填项目默认阅读态', panel?.editing === false, `editing=${panel?.editing}`);
  check('有「下载完整 PDF」入口（不再内嵌）', panel?.hasDownload === true, String(panel?.hasDownload));
  await cdp.shot('02-panel.png');

  /* 进编辑态（作者模式） */
  await cdp.eval(`[...document.querySelectorAll('.works-panel .works-btn-primary')].find(b => b.textContent.includes('编辑项目'))?.click()`);
  await sleep(700);
  const edit = await cdp.eval(`(() => { const p = document.querySelector('.works-panel'); return {
    hasTitle: !!p.querySelector('#wk-title'), hasRole: !!p.querySelector('#wk-role'), hasYear: !!p.querySelector('#wk-year'),
    hasImage: [...p.querySelectorAll('input[type=file]')].some(i => i.accept.includes('image')),
    hasSummary: !!p.querySelector('#wk-summary'),
    sectionEdits: p.querySelectorAll('.works-section-edit').length,
    hasSave: [...p.querySelectorAll('.works-btn-primary')].some(b => b.textContent.includes('保存')) }; })()`);
  check('编辑态：标题/角色/年份输入', edit.hasTitle && edit.hasRole && edit.hasYear, JSON.stringify(edit));
  check('编辑态：高光图上传（image）', edit.hasImage === true, String(edit.hasImage));
  check('编辑态：结构化文案编辑器', edit.sectionEdits >= 1, `edits=${edit.sectionEdits}`);
  check('编辑态：保存按钮', edit.hasSave === true, String(edit.hasSave));
  await cdp.shot('03-edit.png');
  await cdp.eval(`document.querySelector('.works-panel-close')?.click()`); await sleep(500);

  /* 空槽位（PLAN_05）→ 提交表单 */
  await cdp.eval(`document.querySelectorAll('.works-thumb')[4].click()`);
  await sleep(900);
  const empty = await cdp.eval(`(() => { const p = document.querySelector('.works-panel'); return {
    editing: !!p.querySelector('#wk-title'),
    hasImage: [...p.querySelectorAll('input[type=file]')].some(i => i.accept.includes('image')),
    hasSectionsEdit: !!p.querySelector('.works-sections-edit'),
    emptyNote: !!p.querySelector('.works-empty') }; })()`);
  check('空槽位直接进提交表单', empty.editing === true, JSON.stringify(empty));
  check('提交表单：高光图上传', empty.hasImage === true, String(empty.hasImage));
  check('提交表单：结构化文案编辑器', empty.hasSectionsEdit === true, String(empty.hasSectionsEdit));
  await cdp.shot('04-empty-form.png');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) console.log('失败：', failed.map((f) => f.name).join(' / '));
} catch (err) {
  check('脚本执行', false, err.message);
  console.log(`\n${results.length} 项，失败：`, results.filter((r) => !r.ok).map((f) => f.name).join(' / '));
} finally {
  edge.kill('SIGKILL');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
