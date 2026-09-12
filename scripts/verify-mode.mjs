/**
 * 作者 / 访客模式一致性冒烟（无头 Edge + CDP）。
 *
 * 目标：证明「一套开关管全站」——
 *   作者模式：木马「＋提交项目」、案例面板「编辑项目」、About 灵感收藏上传/删除 都在
 *   访客模式：以上编辑入口全部不渲染，只能看
 *   且顶部徽标可实时切换（无需刷新），切换后 URL 同步 ?admin=1/0
 *
 * 用法：node scripts/verify-mode.mjs   （需先起 preview：端口 4180）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9367;
const HOST = 'http://127.0.0.1:4180';
const OUT = path.resolve('scripts/_shots');
const profile = path.join(os.tmpdir(), '_edgemode' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && this.pending.has(j.id)) { this.pending.get(j.id)(j); this.pending.delete(j.id); } };
  }
  send(method, params = {}, sid) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); this.ws.send(JSON.stringify({ id, method, params, sessionId: sid })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
  async shot(file) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data, 'base64')); }
}

async function waitForTarget(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('CDP 没起来');
}

const modeLabel = `document.querySelector('.mode-switch .mode-switch-label')?.textContent ?? null`;
const hasSubmitBtn = `[...document.querySelectorAll('.works-btn')].some(b => b.textContent.includes('提交项目'))`;

async function goto(cdp, url) {
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 70; i++) {
    const ok = await cdp.eval(`!!document.querySelector('.mode-switch')`).catch(() => false);
    if (ok) return true;
    await sleep(400);
  }
  return false;
}

async function openCarousel(cdp) {
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('.studio-btn')].find(b => b.textContent.includes('Works')); b?.click(); return !!b; })()`);
  for (let i = 0; i < 60; i++) {
    const ok = await cdp.eval(`!!document.querySelector('.works-canvas-host canvas')`).catch(() => false);
    if (ok) return true;
    await sleep(400);
  }
  return false;
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

  /* ============ A. 作者模式 ?admin=1 ============ */
  await goto(cdp, `${HOST}/?studio=1&admin=1`);
  check('A 徽标显示「作者模式」', (await cdp.eval(modeLabel)) === '作者模式', await cdp.eval(modeLabel));
  await openCarousel(cdp);
  check('A 木马出现「＋提交项目」', (await cdp.eval(hasSubmitBtn)) === true, String(await cdp.eval(hasSubmitBtn)));

  // 案例面板应能进编辑态（「编辑项目」按钮存在）
  await cdp.eval(`document.querySelectorAll('.works-thumb')[0].click()`);
  await sleep(900);
  const aEditBtn = await cdp.eval(`[...document.querySelectorAll('.works-panel .works-btn-primary')].some(b => b.textContent.includes('编辑项目'))`);
  check('A 案例面板出现「编辑项目」', aEditBtn === true, String(aEditBtn));
  await cdp.eval(`document.querySelector('.works-panel-close')?.click()`);
  await sleep(400);
  await cdp.shot('05-mode-author.png');

  /* ============ B. 访客模式 ?admin=0 ============ */
  await goto(cdp, `${HOST}/?studio=1&admin=0`);
  check('B 徽标显示「访客模式」', (await cdp.eval(modeLabel)) === '访客模式', await cdp.eval(modeLabel));
  await openCarousel(cdp);
  check('B 木马没有「＋提交项目」', (await cdp.eval(hasSubmitBtn)) === false, String(await cdp.eval(hasSubmitBtn)));

  await cdp.eval(`document.querySelectorAll('.works-thumb')[0].click()`);
  await sleep(900);
  const bRead = await cdp.eval(`(() => { const p = document.querySelector('.works-panel'); return {
    hasCase: !!p?.querySelector('.works-case'),
    editBtn: [...document.querySelectorAll('.works-panel .works-btn-primary')].some(b => b.textContent.includes('编辑项目')),
    form: !!p?.querySelector('#wk-title') }; })()`);
  check('B 案例仍可只读打开（左字右图）', bRead.hasCase === true, JSON.stringify(bRead));
  check('B 案例面板没有「编辑项目」', bRead.editBtn === false, String(bRead.editBtn));
  check('B 案例面板不出现编辑表单', bRead.form === false, String(bRead.form));
  await cdp.eval(`document.querySelector('.works-panel-close')?.click()`);
  await sleep(400);
  await cdp.shot('06-mode-guest.png');

  /* ============ C. 徽标实时切换（当前访客 → 点一下变作者）============ */
  await cdp.eval(`document.querySelector('.mode-switch').click()`);
  await sleep(500);
  const afterToggle = await cdp.eval(modeLabel);
  const urlHasAdmin = await cdp.eval(`new URLSearchParams(location.search).get('admin')`);
  const submitAfter = await cdp.eval(hasSubmitBtn);
  check('C 点击徽标切到「作者模式」（无需刷新）', afterToggle === '作者模式', String(afterToggle));
  check('C 切换后 URL 同步 ?admin=1', urlHasAdmin === '1', String(urlHasAdmin));
  check('C 切换后木马即时出现「＋提交项目」', submitAfter === true, String(submitAfter));
  // 再点回来
  await cdp.eval(`document.querySelector('.mode-switch').click()`);
  await sleep(400);
  check('C 再点一次回到「访客模式」', (await cdp.eval(modeLabel)) === '访客模式', await cdp.eval(modeLabel));

  /* ============ D. About / Green OS 页同一开关 ============ */
  await goto(cdp, `${HOST}/?greenos=1&direct=1&admin=1`);
  await cdp.eval(`[...document.querySelectorAll('.about-nav-item')].find(b => b.textContent.includes('灵感'))?.click()`);
  await sleep(700);
  const aInsp = await cdp.eval(`(() => ({ badge: !!document.querySelector('.about-insp-edit-badge'), file: [...document.querySelectorAll('.about-overlay input[type=file]')].length }))()`);
  check('D 作者模式：灵感收藏出现「作者模式」徽标', aInsp.badge === true, JSON.stringify(aInsp));

  await goto(cdp, `${HOST}/?greenos=1&direct=1&admin=0`);
  await cdp.eval(`[...document.querySelectorAll('.about-nav-item')].find(b => b.textContent.includes('灵感'))?.click()`);
  await sleep(700);
  const gInsp = await cdp.eval(`(() => ({ badge: !!document.querySelector('.about-insp-edit-badge'), file: [...document.querySelectorAll('.about-overlay input[type=file]')].length }))()`);
  check('D 访客模式：灵感收藏没有「作者模式」徽标', gInsp.badge === false, JSON.stringify(gInsp));
  check('D 访客模式：灵感收藏没有上传入口', gInsp.file === 0, `fileInputs=${gInsp.file}`);
  await cdp.shot('07-about-guest.png');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) console.log('失败：', failed.map((f) => `${f.name}[${f.detail}]`).join(' / '));
} catch (err) {
  check('脚本执行', false, err.message);
  console.log(`\n失败：`, results.filter((r) => !r.ok).map((f) => f.name).join(' / '));
} finally {
  edge.kill('SIGKILL');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
