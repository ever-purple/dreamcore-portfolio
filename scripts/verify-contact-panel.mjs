/**
 * 工作室「向下滚动露出联系方式」面板的回归套件（30 项断言）。
 *
 *   A. 钉值 (?contact=1) 量**静态版式**：成对排版 / 大字是主角 / 逐字上浮的盒子 / 底部页脚线
 *   B. 真派发 wheel 量**「12 格」**：11 格 → 11/12 不满、第 12 格 → 1、一甩只吃 1 格、
 *      小格鼠标（deltaY=50）也必须 12 下满、上滚 12 格回 0
 *   C. 一格阶跃逐帧采样三条位置曲线 → **阻尼（过冲）+ 滚动视差（到位时间差）**
 *   D. 连滚 6 格逐帧采样三条惯性曲线 → **惯性（滚轮停了它还在滑）**+ 纸的底边夹子
 *
 * 覆盖面来自 `StudioContactPanel.tsx` 文件头的四条用户需求：
 *   ① 参考站（ilcapoproduction.com）版的联系方式版式
 *   ② 滚轮一共 12 格才完全出来
 *   ③ 向上的过程要有阻尼感 + 滚动视差
 *   ④ 快速划过去之后有惯性
 *
 * 用法：BASE=http://127.0.0.1:5190 node scripts/verify-contact-panel.mjs
 * （⚠️ BASE 默认是 4180 preview，不显式传 5190 会打空端口 → 全是 null，别误判成代码坏了）
 *
 * ⚠️ 环境坑（都踩过，别删）：
 *  1. 无头把后台页 rAF 压到 ~2.5fps，`--disable-*-throttling` 不管用 → 注入 rAF 垫片。
 *  2. 这一页软件渲染每帧几百毫秒，**绝不能用毫秒判到位**，一律换帧序（第几帧越过阈值）。
 *  3. **采样器必须读 inline style，不能读 getComputedStyle**：组件本来就用
 *     `root.style.setProperty()` 写这些变量，读 inline 是 O(1)；而
 *     `getComputedStyle(root).getPropertyValue()` 每读一次都触发一次**样式重算**，
 *     6 个变量 × 每帧 = 把主线程算死 —— 上一版就是这么"静默挂死 11 分钟"的
 *     （页面线程被打满，连 CDP 的 Runtime.evaluate 都排不上队）。
 *  4. 每次 CDP 调用都要有超时：不然一旦卡住就是无限等待，看不出是哪儿挂的。
 *  5. 并行派发多个 wheel 会被丢事件（12 发只到 7），要**串行**发。
 *  6. 二次 `__arm()` 必须先 `__disarm()`：两个采样循环叠加同样会把页面打满，
 *     症状是后面连 `Input.dispatchMouseEvent` 都超时。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9373;
const BASE = process.env.BASE ?? 'http://127.0.0.1:5190';
const SHOT_DIR = '_shots7';
const profile = path.join(os.tmpdir(), '_edgec7' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const ok = (n, pass, d = '') => {
  out.push({ n, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`);
};
const ms60 = (f) => `${(f * 16.7).toFixed(0)}ms@60fps`;

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = (m) => {
      const j = JSON.parse(m.data);
      if (j.id && this.pending.has(j.id)) { this.pending.get(j.id)(j); this.pending.delete(j.id); }
    };
  }
  /** ⚠️ 一定要超时（见文件头「环境坑 4」） */
  send(method, params = {}, ms = 30000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`CDP 超时 ${ms}ms: ${method}`)); }, ms);
      this.pending.set(id, (m) => {
        clearTimeout(t);
        m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr, ms = 60000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, ms);
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async shot(name) {
    try {
      const r = await this.send('Page.captureScreenshot', { format: 'png' }, 90000);
      fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, 'base64'));
    } catch (e) { console.log('  截图跳过：' + e.message); }
  }
  wheel(deltaY, x = 550, y = 380) {
    // 页面被渲染压满时派发输入可能要等很久，给足 60s（30s 实测被咬过）
    return this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }, 60000);
  }
}

/** rAF 垫片：40ms 一帧（≈25fps）就够画曲线，比 16ms 少 2.5 倍的渲染压力 */
const RAF_SHIM = `
(() => {
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 40);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
})();
`;

/**
 * 采样器：arm() 后逐帧记录 3 条位置进度 + 3 条惯性额外位移。
 * ⚠️ 读 inline style —— 见文件头「环境坑 3」。变量是组件用 setProperty 写上去的，
 *    读 inline 拿到的就是它的真值，且**零样式重算**。
 */
const SAMPLER = `
window.__trace = [];
window.__armed = false;
window.__disarm = () => { window.__armed = false; };
window.__arm = () => {
  // ⚠️ 先停掉上一轮，否则二次 arm 会有**两个循环同时采样**，
  //    页面被算满 → 后面连 Input.dispatchMouseEvent 都超时（实测过）。
  window.__disarm();
  window.__trace = [];
  const root = document.querySelector('.studio-contact');
  const rd = (n) => { const v = root.style.getPropertyValue(n); return v ? Number(v) : 0; };
  window.__armed = true;
  const loop = () => {
    if (!window.__armed) return;
    window.__trace.push([
      rd('--contact-p'), rd('--contact-pg'), rd('--contact-pi'),
      rd('--contact-pv'), rd('--contact-pgv'), rd('--contact-piv'),
    ]);
    if (window.__trace.length < 400) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return 'armed';
};
`;
/** trace 的列号 */
const C_P = 0, C_PG = 1, C_PI = 2, C_PV = 3, C_PGV = 4, C_PIV = 5;

/** 读三条位置 + 三条惯性 + is-open */
const READ = `(() => {
  const root = document.querySelector('.studio-contact');
  const cs = getComputedStyle(root);
  const rd = (n) => Number(cs.getPropertyValue(n));
  return {
    p: rd('--contact-p'), pg: rd('--contact-pg'), pi: rd('--contact-pi'),
    pv: rd('--contact-pv'), pgv: rd('--contact-pgv'), piv: rd('--contact-piv'),
    open: root.classList.contains('is-open'), pe: cs.pointerEvents,
  };
})()`;

fs.mkdirSync(SHOT_DIR, { recursive: true });
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1100,700',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  'about:blank',
]);
let ws = null;
try {
  let info = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const t = list.find((x) => x.type === 'page');
      if (t?.webSocketDebuggerUrl) { info = t; break; }
    } catch { /* 还没起来 */ }
    await sleep(400);
  }
  if (!info) throw new Error('连不上 CDP');
  ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: RAF_SHIM });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SAMPLER });

  const goto = async (url) => {
    await cdp.send('Page.navigate', { url }, 60000);
    for (let i = 0; i < 50; i++) {
      if (await cdp.eval(`!!document.querySelector('.studio-contact__sheet')`)) break;
      await sleep(400);
    }
    await sleep(2000);
  };
  /** 串行滚 N 格（⚠️ 并行会丢事件，见文件头「环境坑 5」） */
  const scroll = async (n, deltaY = 100, gap = 80) => {
    for (let i = 0; i < n; i++) { await cdp.wheel(deltaY); await sleep(gap); }
  };
  /* ============ A. 钉值量静态版式 ============ */
  console.log('\n— A. 静态版式（?contact=1 钉满）—');
  await goto(`${BASE}/?studio=1&direct=1&contact=1`);

  const layout = await cdp.eval(`(() => {
    const q = (s) => document.querySelector(s);
    const all = (s) => [...document.querySelectorAll(s)];
    const cs = (s) => getComputedStyle(q(s));
    const rect = (s) => q(s).getBoundingClientRect();
    const pairs = cs('.studio-contact__pairs');
    const label = cs('.studio-contact__pair-label');
    const value = cs('.studio-contact__pair-value');
    const rolls = all('.studio-contact__roll');
    const meta = rect('.studio-contact__meta');
    const sheet = rect('.studio-contact__sheet');
    const vh = window.innerHeight;
    return {
      pairsDisplay: pairs.display, pairsJustify: pairs.justifyContent,
      pairCount: all('.studio-contact__pair').length,
      labelSize: parseFloat(label.fontSize), labelFamily: label.fontFamily,
      valueSize: parseFloat(value.fontSize), valueFamily: value.fontFamily,
      valueTransform: value.textTransform,
      rollCount: rolls.length,
      rollOverflow: rolls[0] ? getComputedStyle(rolls[0]).overflow : null,
      titleFamily: cs('.studio-contact__title').fontFamily,
      metaBottomGap: Math.round(vh - meta.bottom),
      metaJustify: cs('.studio-contact__meta-row').justifyContent,
      vh, sheetH: Math.round(sheet.height),
      metaInsideSheet: meta.bottom <= sheet.bottom + 1 && meta.bottom > sheet.bottom - 200,
      rollShiftMax: Math.max(...rolls.map((r) => {
        const m = /matrix\\(1, 0, 0, 1, 0, ([-\\d.]+)\\)/.exec(getComputedStyle(r.firstElementChild).transform);
        return m ? Math.abs(Number(m[1])) : 0;
      })),
      metaOpacity: Number(cs('.studio-contact__meta').opacity),
    };
  })()`);
  console.log('  ' + JSON.stringify(layout));

  ok('A1 成对排版是真 flex 两栏（不是旧的行式列表）',
    layout.pairsDisplay === 'flex' && layout.pairCount === 2,
    `${layout.pairsDisplay} / ${layout.pairCount} 对`);
  ok('A2 大字才是主角：值字号 ≥ 标签的 2 倍（参考站的核心特征）',
    layout.valueSize >= layout.labelSize * 2,
    `值 ${layout.valueSize}px vs 标签 ${layout.labelSize}px（${(layout.valueSize / layout.labelSize).toFixed(2)}×）`);
  ok('A3 值是衬线体（2026-09-17 起不再 uppercase：真邮箱大写会变成另一个地址）',
    /NanoOldSongA/.test(layout.valueFamily),
    `${layout.valueTransform} / ${layout.valueFamily.slice(0, 22)}`);
  ok('A4 逐字上浮的盒子确实存在且 overflow:hidden（每个字一个）',
    layout.rollCount > 10 && layout.rollOverflow === 'hidden',
    `${layout.rollCount} 个字盒 / overflow=${layout.rollOverflow}`);
  ok('A5 钉到 p=1 时所有字都归位（残余位移 = 0）',
    layout.rollShiftMax < 0.6, `最大残余 ${layout.rollShiftMax}px`);
  ok('A6 底部页脚线压在纸内（不超出屏幕、不悬空）',
    layout.metaInsideSheet && layout.metaBottomGap > 0,
    `距底 ${layout.metaBottomGap}px / 纸高 ${layout.sheetH}px / vh ${layout.vh}`);
  ok('A7 页脚两端分开（©2026 与 Credits 各占一边）',
    layout.metaJustify === 'space-between', layout.metaJustify);
  ok('A8 p=1 时 meta 已显影（hint 已按用户要求删除）',
    layout.metaOpacity > 0.99,
    `meta ${layout.metaOpacity}`);
  await cdp.shot('01-contact-full.png');

  await goto(`${BASE}/?studio=1&direct=1&contact=0.5`);
  const rolls = await cdp.eval(`(() => {
    const px = (el) => {
      const m = /matrix\\(1, 0, 0, 1, 0, ([-\\d.]+)\\)/.exec(getComputedStyle(el.firstElementChild).transform);
      return m ? Number(m[1]) : 0;
    };
    return [...document.querySelectorAll('.studio-contact__title .studio-contact__roll')].map(px);
  })()`);
  console.log('  标题逐字位移 =', rolls.map((v) => v.toFixed(1)).join(', '));
  const mono = rolls.every((v, i) => i === 0 || v >= rolls[i - 1] - 0.4);
  ok('A9 逐字错峰：越靠后的字掉得越深（升上来得越晚）',
    rolls.length === 4 && mono && rolls[3] > rolls[0] + 1,
    `${rolls.map((v) => v.toFixed(1)).join(' < ')}`);

  /* ============ B. 「滚轮 12 格」 ============ */
  console.log('\n— B. 滚轮一共 12 格才完全出来 —');
  await goto(`${BASE}/?studio=1&direct=1`);
  const at0 = await cdp.eval(READ);
  ok('B0 起始是收起态（p=0、不接管指针事件）',
    at0.p === 0 && at0.open === false && at0.pe === 'none',
    `p=${at0.p} open=${at0.open} pe=${at0.pe}`);

  await scroll(11);
  await sleep(3000);
  const at11 = await cdp.eval(READ);
  console.log(`  滚 11 格 → p=${at11.p}`);
  /* ⚠️ 容差要留出弹簧自己的过冲（末段 1/12 的 6% ≈ +0.005），所以用区间而不是等号；
     精确收敛到 target 这件事由 C7 断言（那里是纯位置、没有来回滚的干扰）。 */
  ok('B1 滚 11 格只到 0.9 出头、明显没满（"要 12 格"的前提）',
    at11.p > 0.9 && at11.p < 0.97, `p=${at11.p}`);

  await scroll(1);
  await sleep(2800);
  const at12 = await cdp.eval(READ);
  console.log(`  第 12 格 → p=${at12.p} open=${at12.open} pe=${at12.pe}`);
  ok('B2 第 12 格才完全出来（p=1 且接管指针事件）',
    at12.p > 0.995 && at12.open === true && at12.pe === 'auto',
    `p=${at12.p} open=${at12.open} pe=${at12.pe}`);
  await cdp.shot('02-contact-12notches.png');

  await cdp.wheel(1200);
  await sleep(900);
  const atMax = await cdp.eval(READ);
  ok('B3 已满之后继续往下滚不越界（仍然 p=1）', Math.abs(atMax.p - 1) < 0.005, `p=${atMax.p}`);

  await scroll(12, -100);
  await sleep(2800);
  const back = await cdp.eval(READ);
  ok('B4 上滚 12 格完全收回（p=0、交还指针事件）',
    back.p < 0.005 && back.pe === 'none', `p=${back.p} pe=${back.pe}`);

  await cdp.wheel(1200);
  await sleep(2400);
  const one = await cdp.eval(READ);
  console.log(`  单次甩 1200 → p=${one.p}`);
  ok('B5 单次猛甩只吃 1 格（防"一甩就到底"，要的是阻力感）',
    Math.abs(one.p - 1 / 12) < 0.005, `p=${one.p}（期望 0.0833）`);

  await goto(`${BASE}/?studio=1&direct=1`);
  await scroll(11, 50);
  await sleep(2400);
  const small11 = await cdp.eval(READ);
  await scroll(1, 50);
  await sleep(2600);
  const small12 = await cdp.eval(READ);
  console.log(`  小格鼠标(deltaY=50)：11 下 → p=${small11.p}，12 下 → p=${small12.p}`);
  ok('B6 小格鼠标（deltaY=50）同样 12 下满 —— "一下 = 一格"与 deltaY 大小无关',
    Math.abs(small11.p - 11 / 12) < 0.01 && small12.p > 0.995,
    `11 下 ${small11.p} / 12 下 ${small12.p}`);

  /* ============ C. 阻尼 + 视差（一格阶跃，帧序） ============
     ⚠️ 用**一格**（target 0 → 1/12）当阶跃就够：线性弹簧的动力学是**尺度无关**的，
        阶跃 0.2 与 0.0833 的"第几帧到位""过冲百分比"完全一样，而小阶跃不会撞到任何边界。 */
  console.log('\n— C. 阻尼感 + 滚动视差 —');
  await goto(`${BASE}/?studio=1&direct=1`);
  const fps = await cdp.eval(`new Promise((res) => {
    let n = 0; const t0 = Date.now();
    const loop = () => { n++; if (Date.now() - t0 < 600) requestAnimationFrame(loop); else res(n); };
    requestAnimationFrame(loop);
  })`);
  console.log('  垫片后 600ms 帧数 =', fps);

  const STEP = 1 / 12;
  await cdp.eval(`window.__arm()`);
  await cdp.wheel(100);
  await sleep(1200);
  await cdp.shot('03-contact-onestep.png');
  /* ⚠️ 不能"等三列都稳了就收采样"：幽灵**越过 target 之后才到过冲峰值**，
     停太早会把它的过冲整段裁掉（第一版就是这样把幽灵量成"没有过冲"的）。
     固定等足够久，让它跑过峰值再读。 */
  await sleep(7000);
  const trace = await cdp.eval(`window.__trace`);
  await cdp.eval(`window.__disarm()`);
  console.log(`  采样 ${trace.length} 帧 | 收尾 = ${JSON.stringify(trace[trace.length - 1]?.slice(0, 3))}`);

  const S = trace.map((r) => r[C_P]);
  const G = trace.map((r) => r[C_PG]);
  const I = trace.map((r) => r[C_PI]);
  const fAt = (a) => { const k = a.findIndex((v) => v >= 0.99 * STEP); return k < 0 ? null : k; };
  const over = (a) => (Math.max(...a) / STEP - 1) * 100;
  const fPi = fAt(I), fP = fAt(S), fG = fAt(G);
  console.log(`  正文 第 ${fPi} 帧（${ms60(fPi)}）过冲 ${over(I).toFixed(1)}%`);
  console.log(`  纸   第 ${fP} 帧（${ms60(fP)}）过冲 ${over(S).toFixed(1)}%`);
  console.log(`  幽灵 第 ${fG} 帧（${ms60(fG)}）过冲 ${over(G).toFixed(1)}%`);

  ok('C1 三层都真的推进并到位', fPi !== null && fP !== null && fG !== null, `${fPi}/${fP}/${fG}`);
  /* ⚠️ 显式判 null：`null >= null * 1.5` 会退化成 `0 >= 0` 而**假通过** */
  ok('C2 **滚动视差**：到达时间有序递进（正文 < 纸 < 幽灵）',
    fPi !== null && fG !== null && fPi < fP && fP < fG, `${fPi} < ${fP} < ${fG}`);
  ok('C3 速度差够大：幽灵比纸晚 ≥ 50%（看得见的"纸停了字还在走"）',
    fG !== null && fP !== null && fG >= fP * 1.5,
    `比值 ${fG !== null && fP ? (fG / fP).toFixed(2) : 'n/a'}`);
  ok('C4 **阻尼感**：纸有过冲但不廉价（设计 6%）',
    over(S) > 2 && over(S) < 10, `${over(S).toFixed(1)}%`);
  ok('C5 更轻的正文过冲更大、更重的幽灵几乎不过冲',
    over(S) > 2 && over(I) > over(S) && over(G) < over(S),
    `正文 ${over(I).toFixed(1)}% / 纸 ${over(S).toFixed(1)}% / 幽灵 ${over(G).toFixed(1)}%`);
  let rising = 0, viol = 0;
  for (let k = 0; k < trace.length; k++) {
    if (S[k] > 0.05 * STEP && S[k] < 0.97 * STEP) {
      rising++;
      if (!(I[k] >= S[k] && S[k] >= G[k])) viol++;
    }
  }
  ok(`C6 上升全程三层次序恒定（${rising} 帧 0 反转）`, rising > 5 && viol === 0, `反转 ${viol}`);
  ok('C7 三层一起收敛到 1（停得住，不永远晃）',
    [S, G, I].every((a) => Math.abs(a[a.length - 1] - STEP) < 0.004),
    JSON.stringify(trace[trace.length - 1].slice(0, 3)));

  /* ============ D. 惯性 ============
     ⚠️ 只能**逐帧采峰值**：惯性弹簧会反向摆回过零，停下后抽查很可能正好抓到 0
        （第一版睡了 260ms 再看，读到 -0.001 判它"没有惯性" —— 冤枉了）。 */
  console.log('\n— D. 惯性：滚轮停了，位移还在走 —');
  await cdp.eval(`window.__arm()`);
  await scroll(6);
  /* 幽灵那层的惯性滑行最长（~45 帧），要留够时间让它自己归零 */
  await sleep(9000);
  const itrace = await cdp.eval(`window.__trace`);
  await cdp.eval(`window.__disarm()`);
  const col = (i) => itrace.map((r) => r[i]);
  const pvP = Math.max(...col(C_PV));
  const pgvP = Math.max(...col(C_PGV));
  const pivP = Math.max(...col(C_PIV));
  const negMin = Math.min(...col(C_PV), ...col(C_PGV), ...col(C_PIV));
  console.log(`  采样 ${itrace.length} 帧 | 连滚 6 格惯性峰值：纸 ${(pvP * 100).toFixed(2)}% / 幽灵 ${(pgvP * 100).toFixed(2)}% / 正文 ${(pivP * 100).toFixed(2)}%`);
  console.log(`  负侧最大回摆 ${(negMin * 100).toFixed(2)}%（弹簧回摆，正常）`);

  ok('D1 三层都真的有惯性额外位移（滚轮停了，它自己还在滑一段）',
    pvP > 0.008 && pgvP > 0.008 && pivP > 0.004,
    `纸 ${(pvP * 100).toFixed(2)}% / 幽灵 ${(pgvP * 100).toFixed(2)}% / 正文 ${(pivP * 100).toFixed(2)}%`);
  ok('D2 幽灵大字滑得最远（最远层惯性最大 —— "惯性也参与视差"）',
    pgvP > pvP && pgvP > pivP,
    `幽灵 ${(pgvP * 100).toFixed(2)}% > 纸 ${(pvP * 100).toFixed(2)}% / 正文 ${(pivP * 100).toFixed(2)}%`);
  ok('D3 惯性最终自己收回 0（静止时排版与加惯性之前完全一致）',
    [C_PV, C_PGV, C_PIV].every((i) => itrace[itrace.length - 1][i] === 0),
    JSON.stringify(itrace[itrace.length - 1].slice(3)));
  /* 每层各自的预算：纸最要紧（它 > 1 会露底，虽然有 CSS 夹子兜着，也不该指望它）、
     幽灵本来就大半在屏幕外，飘得多一点正是要的效果；正文最轻，只要不跳就行。 */
  ok('D4 惯性在各自预算内（纸 < 10%、正文 < 5%、幽灵 < 18%）',
    pvP < 0.1 && pivP < 0.05 && pgvP < 0.18,
    `纸 ${(pvP * 100).toFixed(2)}% / 正文 ${(pivP * 100).toFixed(2)}% / 幽灵 ${(pgvP * 100).toFixed(2)}%`);

  /* ---- D5. 纸的 min(1, …) 夹子 ----
     ⚠️ 用 `?contactv=` **钉住**惯性来确定性地验，而不是"滚轮冲过去然后抢拍一张"：
        后者要靠 Input.dispatchMouseEvent，页面被采样跑久之后它会超时（实测 60s 也过不去）。 */
  const probeGap = async (contactv) => {
    await goto(`${BASE}/?studio=1&direct=1&contact=1&contactv=${contactv}`);
    return cdp.eval(`(() => {
      const sheet = document.querySelector('.studio-contact__sheet');
      const r = sheet.getBoundingClientRect();
      const inner = document.querySelector('.studio-contact__inner').getBoundingClientRect();
      const vh = window.innerHeight;
      const cx = inner.top + inner.height / 2;
      return { bottom: r.bottom, top: r.top, vh,
               tf: getComputedStyle(sheet).transform,
               innerCenterRatio: cx / vh };
    })()`);
  };
  const push = await probeGap(0.08);
  console.log(`  p=1 且惯性 +0.08（纸若不夹住，bottom 会到 ${(push.vh * 0.92).toFixed(0)}）：${JSON.stringify(push)}`);
  ok('D5 惯性把进度顶到 1 以上时，纸被 min(1, …) 夹住 —— 屏幕底部不留缝',
    push.bottom >= push.vh - 1.5,
    `bottom=${push.bottom.toFixed(1)} vs vh=${push.vh} / ${push.tf}`);
  /* 夹子只作用于纸：正文/幽灵该飘还得飘，不然"惯性"就白做了 */
  ok('D6 夹子只管纸 —— 正文照旧被惯性推上去（没有一起被夹死）',
    push.innerCenterRatio < 0.5,
    `正文中心在 ${(push.innerCenterRatio * 100).toFixed(1)}% 高度（< 50% = 确实被推上去了）`);

  const still = await probeGap(0);
  ok('D7 惯性为 0 时纸正好铺满视口（顶边贴 0、底边贴视口底）',
    Math.abs(still.top) < 1.5 && still.bottom >= still.vh - 1.5,
    `top=${still.top.toFixed(1)} bottom=${still.bottom.toFixed(1)} vh=${still.vh}`);

  const failed = out.filter((r) => !r.pass);
  console.log(`\n${out.length - failed.length}/${out.length} 通过`);
  if (failed.length) console.log('失败：', failed.map((f) => f.n).join(' / '));
} catch (err) {
  ok('脚本执行', false, err.message);
  console.log(err.stack?.split('\n').slice(0, 4).join('\n'));
} finally {
  try { ws?.close(); } catch {}
  edge.kill('SIGKILL');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  console.log('DONE');
  process.exit(0);
}
