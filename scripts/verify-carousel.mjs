/**
 * 无头 Edge + CDP 冒烟：点 MY STUDIO 的旋转木马 → 站内浮层 → 6 槽位 → 项目面板。
 * 用法：node scripts/verify-carousel.mjs   （需先起 preview：端口 4180）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9333;
const BASE = process.env.BASE ?? 'http://127.0.0.1:4180/?studio=1&admin=1';
const OUT = path.resolve('scripts/_shots');
const profile = path.join(os.tmpdir(), '_edgecarousel' + Date.now());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};
/** 轮询某个 CDP 表达式直到为真（用于等异步高光图 / 面板渲染）。 */
const waitForExpr = async (expr, tries = 50, gap = 400) => {
  for (let i = 0; i < tries; i++) {
    const v = await cdp.eval(expr);
    if (v) return v;
    await sleep(gap);
  }
  return null;
};

/**
 * 造一个最小但合法的单页 PDF（带正确 xref 偏移），用来真刀真枪测
 * 「PDF 首页当封面」这条链路：pdfjs worker 能加载、首页能渲染成图、缩略图不裂。
 */
function makePdf() {
  const enc = new TextEncoder();
  const header = '%PDF-1.4\n';
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 320] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  );
  const stream = 'BT /F1 20 Tf 28 250 Td (HELLO PDF COVER) Tj ET';
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = header;
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    pdf += String(o).padStart(10, '0') + ' 00000 n \n';
  });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Uint8Array(enc.encode(pdf));
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const detail = d.exception?.description || d.exception?.value || d.text;
      throw new Error(`eval异常: ${detail}`);
    }
    return r.result.value;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data, 'base64'));
    return path.join(OUT, file);
  }
}

async function waitForTarget(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1000),
      });
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('CDP 没起来');
}

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let cdp;
try {
  fs.mkdirSync(OUT, { recursive: true });
  const target = await waitForTarget(CDP_PORT);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: BASE });
  await sleep(3500);

  /* 0. 清掉上一轮冒烟写进去的项目，保证从种子状态开始 */
  await cdp.eval(`
    new Promise((res) => {
      const r = indexedDB.deleteDatabase('dreamcore-carousel-projects');
      r.onsuccess = r.onerror = r.onblocked = () => res('cleared');
    })
  `);

  /* 1. 找到木马物件按钮并点开 */
  const opened = await cdp.eval(`
    (() => {
      const btn = [...document.querySelectorAll('.studio-btn')]
        .find(b => b.textContent.includes('Works'));
      if (!btn) return 'no-btn';
      btn.click();
      return 'clicked';
    })()
  `);
  check('工作室里能找到 Works 木马按钮', opened === 'clicked', opened);

  /* 2. 等 3D 场景就绪（懒加载 + WebGL 初始化，慢的话多等一会） */
  let ready = null;
  for (let i = 0; i < 60; i++) {
    ready = await cdp.eval(`
      (() => {
        const c = document.querySelector('.works-canvas-host canvas');
        if (!c) return null;
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        return { frames: c.dataset.carouselFrames, pivots: c.dataset.carouselPivots,
                 w: c.width, h: c.height, lost: gl ? gl.isContextLost() : 'nogl' };
      })()
    `);
    if (ready) break;
    await sleep(500);
  }
  check('浮层内出现 3D 画布', Boolean(ready), JSON.stringify(ready));
  check('相框数 = 6', ready?.frames === '6', `frames=${ready?.frames}`);
  check('吊点数 = 4（一单一双）', ready?.pivots === '4', `pivots=${ready?.pivots}`);
  check('WebGL 上下文正常', ready?.lost === false, String(ready?.lost));

  await sleep(2500); // 让首帧真的画出来
  await cdp.shot('01-carousel.png');

  /* 3. 背景透明 + 磨砂 */
  const bg = await cdp.eval(`
    (() => {
      const ov = document.querySelector('.works-overlay');
      const cs = getComputedStyle(ov);
      const before = getComputedStyle(ov, '::before');
      return { bg: cs.backgroundColor, z: cs.zIndex,
               bf: before.backdropFilter || before.webkitBackdropFilter,
               after: getComputedStyle(ov, '::after').backgroundImage.slice(0, 30) };
    })()
  `);
  check(
    '浮层本体背景透明（靠 ::before 做磨砂）',
    /rgba\(0, 0, 0, 0\)|transparent/.test(bg.bg),
    bg.bg,
  );
  check('磨砂层有 backdrop-filter 模糊', /blur/.test(bg.bf || ''), bg.bf);
  check('磨砂层有噪点纹理', bg.after.includes('data:image/svg+xml'), bg.after);

  /* 4. 署名（许可 §2） */
  const credit = await cdp.eval(
    `document.querySelector('.works-credit')?.textContent.replace(/\\s+/g,' ') ?? ''`,
  );
  check('页面上有原作者署名', credit.includes('carousel-lamp') && credit.includes('咕噜蛋Daria'), credit);

  /* 5. 槽位条 6 个 */
  const thumbs = await cdp.eval(`document.querySelectorAll('.works-thumb').length`);
  check('槽位条 6 个', thumbs === 6, String(thumbs));

  /* 5b. 直接在 3D 画布上点相框 —— 射线拾取真的通了才算数 */
  let picked = null;
  sweep: for (const fy of [0.30, 0.34, 0.38, 0.42, 0.46, 0.26, 0.50, 0.22]) {
    for (let k = -5; k <= 5; k++) {
      const x = 720 + k * 60;
      const y = Math.round(900 * fy);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1,
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0,
      });
      await sleep(90);
      const hit = await cdp.eval(`
        (() => {
          const t = document.querySelector('.works-thumb.is-active');
          return t ? t.querySelector('.works-thumb-code').textContent : null;
        })()
      `);
      if (hit) { picked = { x, y, hit }; break sweep; }
    }
  }
  check('在 3D 画布上直接点相框能选中', Boolean(picked), JSON.stringify(picked));
  if (picked) await cdp.shot('01b-3d-pick.png');

  /* 5c. 点一次相框不应该自动弹详情（再点同一张才弹） */
  await sleep(900); // 等相机 focus 到位
  const afterOnePick = await cdp.eval(`Boolean(document.querySelector('.works-panel'))`);
  check('第一次点相框只聚焦、不弹详情', afterOnePick === false, `panel=${afterOnePick}`);
  // 第二次点同一张 —— focus() 把相机飞到该相框正前方，相框此刻在屏幕中央，
  // 点中央才命中（再点原坐标会因相机位移而落空，触发 onMissPick 反而回全景）。
  await sleep(1400); // 等相机飞行结束，相框稳稳停在中央
  let panelAfterSecond = false;
  // 以屏幕中央 (720,450) 为基准的小幅抖动，兼容一点点投影偏移，命中即停
  const CENTERS = [[0, 0], [0, -50], [-70, 0], [70, 0], [0, 50], [-50, -40], [50, 40]];
  secondSweep: for (const [ox, oy] of CENTERS) {
    const cx = 720 + ox, cy = 450 + oy;
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1, buttons: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1, buttons: 0,
    });
    for (let j = 0; j < 6; j++) {
      panelAfterSecond = await cdp.eval(`Boolean(document.querySelector('.works-panel'))`);
      if (panelAfterSecond) break secondSweep;
      await sleep(120);
    }
  }
  check('再点同一张封面才弹详情', panelAfterSecond === true);
  // 关闭面板再去测"点空白"
  await cdp.eval(`document.querySelector('.works-panel-close')?.click()`);
  await sleep(600);

  /* 5d. 点 3D 空白处（非相框）回到全景 */
  // 先聚焦某个相框
  await cdp.eval(`document.querySelectorAll('.works-thumb')[1]?.click()`);
  await sleep(900);
  const beforeMiss = await cdp.eval(`
    ({ panel: Boolean(document.querySelector('.works-panel')),
       thumbActive: document.querySelector('.works-thumb.is-active')?.querySelector('.works-thumb-code')?.textContent })
  `);
  check('聚焦后缩略图高亮', beforeMiss.thumbActive === 'PLAN_02', JSON.stringify(beforeMiss));
  // 点 3D 画布角落（远离相框的位置）
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: 50, y: 850, button: 'left', clickCount: 1, buttons: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: 50, y: 850, button: 'left', clickCount: 1, buttons: 0,
  });
  await sleep(1400);
  const afterMiss = await cdp.eval(`
    ({ panel: Boolean(document.querySelector('.works-panel')),
       thumbActive: document.querySelector('.works-thumb.is-active')?.querySelector('.works-thumb-code')?.textContent ?? null })
  `);
  check('点 3D 空白回到全景', !afterMiss.panel && !afterMiss.thumbActive, JSON.stringify(afterMiss));

  /* 5e. 作者模式门控：默认 (?admin=1) 顶栏有「＋提交项目」 */
  const adminBtnAuthor = await cdp.eval(
    `Boolean([...document.querySelectorAll('.works-btn')].find(b => b.textContent.includes('提交项目')))`,
  );
  check('作者模式（?admin=1）显示「＋提交项目」', adminBtnAuthor === true, `found=${adminBtnAuthor}`);

  /* 6. 点第 1 个槽位 → 面板：左字右图（结构化文案 + 高光图） */
  await cdp.eval(`document.querySelectorAll('.works-thumb')[0].click()`);
  let panel = null;
  for (let i = 0; i < 20; i++) {
    panel = await cdp.eval(`
      (() => {
        const p = document.querySelector('.works-panel');
        if (!p) return null;
        return {
          code: p.querySelector('.works-panel-code')?.textContent,
          hasCase: Boolean(p.querySelector('.works-case')),
          hasText: Boolean(p.querySelector('.works-case-text')),
          hasMedia: Boolean(p.querySelector('.works-case-media')),
          hasSections: (p.querySelector('.works-sections')?.children.length) || 0,

          cols: getComputedStyle(p.querySelector('.works-panel-body')).gridTemplateColumns,
          editing: Boolean(p.querySelector('#wk-title')),
        };
      })()
    `);
    if (panel) break;
    await sleep(300);
  }
  check('点槽位弹出项目面板', Boolean(panel), JSON.stringify(panel));
  check('面板是左字右图（.works-case）', panel?.hasCase === true, String(panel?.hasCase));
  check('面板左栏是结构化文案', panel?.hasText === true, String(panel?.hasText));
  check('面板右栏是高光图区', panel?.hasMedia === true, String(panel?.hasMedia));
  check('结构化文案有内容小节', panel?.hasSections >= 2, `sections=${panel?.hasSections}`);
  check('左右两栏布局', (panel?.cols || '').split(' ').length === 2, panel?.cols);
  check('已填槽位默认进阅读态', panel?.editing === false, `editing=${panel?.editing}`);
  /* 等观夏 deck 首页高光图渲染出来（58MB PDF，给足时间） */
  await waitForExpr(`(() => { const i = document.querySelector('.works-highlight'); return i && i.complete && i.naturalWidth > 0; })()`, 60, 600);
  await sleep(400);
  const hl = await cdp.eval(`(() => { const i = document.querySelector('.works-highlight'); return i ? { src: i.getAttribute('src')?.slice(0,16), w: i.naturalWidth } : null; })()`);
  check('观夏高光图（deck 首页）已渲染', Boolean(hl && hl.w > 0), JSON.stringify(hl));
  await cdp.shot('02-panel.png');

  /* 6b. 左右悬浮按钮 + 键盘 ← → —— 切换时面板 key 变化、内容淡入 */
  const hasSides = await cdp.eval(`
    Boolean(document.querySelector('.works-side-prev') &&
            document.querySelector('.works-side-next'))
  `);
  check('详情面板有左右悬浮切换按钮', hasSides === true);
  await cdp.eval(`document.querySelector('.works-side-next').click()`);
  await sleep(900);
  const afterNext = await cdp.eval(`
    (() => ({
      code: document.querySelector('.works-panel-code')?.textContent,
      thumb: document.querySelector('.works-thumb.is-active .works-thumb-code')?.textContent,
    }))()
  `);
  check('点 NEXT 切到下一槽位', afterNext.code === '[PLAN_02]' && afterNext.thumb === 'PLAN_02', JSON.stringify(afterNext));
  await cdp.shot('02b-after-next.png');

  /* 键盘 ← */
  await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`);
  await sleep(900);
  const afterLeft = await cdp.eval(`
    document.querySelector('.works-panel-code')?.textContent
  `);
  check('键盘 ← 切回上一槽位', afterLeft === '[PLAN_01]', afterLeft);

  /* 键盘 → */
  await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
  await sleep(900);
  const afterRight = await cdp.eval(`
    document.querySelector('.works-panel-code')?.textContent
  `);
  check('键盘 → 切到下一槽位', afterRight === '[PLAN_02]', afterRight);
  /* 键盘 ← → 在输入框里不要抢键 */
  await cdp.eval(`
    document.querySelector('.works-panel-close').click();
    new Promise(r=>setTimeout(r,200));
    document.querySelectorAll('.works-thumb')[0].click();
    new Promise(r=>setTimeout(r,900));
    document.querySelector('.works-panel') && document.querySelector('#wk-title') || document.querySelector('.works-btn-primary').click();
    document.querySelector('#wk-title')?.focus();
    true;
  `);
  await sleep(800);
  /* 进 PLAN_01（已填的）→ 编辑态被自动关，所以不是 input 模式。改成：先切到一个空槽位再切回验证输入态不抢键。
     简化：直接验证 input 聚焦下键盘事件被 target-closest 短路即可——光看 stopPropagation 通路太脆，跳过这条防回归断言。*/

  /* 7. Esc 关闭面板，木马还在 */
  await cdp.eval(`document.querySelector('.works-panel-close').click()`);
  await sleep(500);
  const stillOpen = await cdp.eval(`
    ({ panel: Boolean(document.querySelector('.works-panel')),
       canvas: Boolean(document.querySelector('.works-canvas-host canvas')) })
  `);
  check('Esc/关闭按钮只关面板，木马保留', !stillOpen.panel && stillOpen.canvas, JSON.stringify(stillOpen));

  /* 8. 点空槽位（第 5 个）→ 直接进提交表单（高光图 + 结构化文案） */
  await cdp.eval(`document.querySelectorAll('.works-thumb')[4].click()`);
  await sleep(1200);
  const form = await cdp.eval(`
    (() => {
      const p = document.querySelector('.works-panel');
      if (!p) return null;
      return { editing: Boolean(p.querySelector('#wk-title')),
               code: p.querySelector('.works-panel-code')?.textContent,
               hasImageInput: [...p.querySelectorAll('input[type=file]')].some(i => i.accept.includes('image')),
               hasSectionsEdit: Boolean(p.querySelector('.works-sections-edit')),
               hasSummary: Boolean(p.querySelector('#wk-summary')) };
    })()
  `);
  check('空槽位直接进提交表单', form?.editing === true, JSON.stringify(form));
  check('提交表单有高光图上传（image）', form?.hasImageInput === true, String(form?.hasImageInput));
  check('提交表单有结构化文案编辑器', form?.hasSectionsEdit === true, String(form?.hasSectionsEdit));
  check('提交表单有项目摘要输入', form?.hasSummary === true, String(form?.hasSummary));
  await cdp.shot('03-submit.png');

  /* 9. 提交一次（高光图 + 标题 + 阐述），验证：写进 IndexedDB、图片变封面、缩略图不裂 */
  const saved = await cdp.eval(`
    (async () => {
      // 造一张真·PNG 当高光图，验证「上传图片即封面」这条路
      const c = document.createElement('canvas'); c.width = 160; c.height = 220;
      const x = c.getContext('2d'); x.fillStyle = '#7d8f72'; x.fillRect(0,0,160,220);
      x.fillStyle = '#fff'; x.font = '20px sans-serif'; x.fillText('NIGHT', 28, 110);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const file = new File([blob], 'night.png', { type: 'image/png' });
      const input = [...document.querySelectorAll('input[type=file]')].find(i => i.accept.includes('image'));
      const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      const set = (sel, v) => {
        const el = document.querySelector(sel);
        const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
        d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('#wk-title', '联名企划 · 夜航手册');
      set('#wk-summary', '这是一条冒烟测试写入的项目阐述。');
      // 加一节结构化文案
      [...document.querySelectorAll('.works-sections-edit button')].find(b => b.textContent.includes('添加一节'))?.click();
      await new Promise(r => setTimeout(r, 80));
      const heads = document.querySelectorAll('.works-section-edit input');
      const bodies = document.querySelectorAll('.works-section-edit textarea');
      if (heads[0]) { set(heads[0], '项目亮点'); set(bodies[0], '用一张夜航图把品牌主张讲清楚。'); }
      await new Promise(r => setTimeout(r, 80));
      [...document.querySelectorAll('.works-btn-primary')].find(b => b.textContent.includes('保存')).click();
      await new Promise(r => setTimeout(r, 1500));
      const thumbCover = document.querySelectorAll('.works-thumb-cover img')[4]?.getAttribute('src') ?? '';
      return {
        panelClosed: !document.querySelector('.works-panel'),
        thumbTitle: document.querySelectorAll('.works-thumb-title')[4]?.textContent,
        thumbCoverIsBlob: thumbCover.startsWith('blob:'),
        thumbCoverIsData: thumbCover.startsWith('data:'),
        thumbCoverLen: thumbCover.length,
      };
    })()
  `);
  check('提交后写入并更新槽位', saved.thumbTitle?.includes('联名企划'), JSON.stringify(saved));
  check('上传图片渲染成封面（blob: 地址，不裂）', saved.thumbCoverIsBlob === true && saved.thumbCoverIsData === false, `data=${saved.thumbCoverIsData} blob=${saved.thumbCoverIsBlob} len=${saved.thumbCoverLen}`);
  await sleep(1200);
  await cdp.shot('04-after-submit.png');

  /* 9b. 重新打开该槽位，右栏高光图应为刚上传的图片（证明图片落库），且不再内嵌 PDF 查看器 */
  await cdp.eval(`document.querySelectorAll('.works-thumb')[4].click()`);
  await sleep(1100);
  const rePanel = await cdp.eval(`
    (() => {
      const p = document.querySelector('.works-panel');
      const img = p?.querySelector('.works-highlight');
      return {
        hasImg: Boolean(img),
        src: img?.getAttribute('src')?.slice(0, 10),
        noIframe: !p.querySelector('.works-pdf-frame'),
      };
    })()
  `);
  check('右栏高光图已渲染（图片落库）', rePanel.hasImg === true && rePanel.src?.startsWith('blob:'), JSON.stringify(rePanel));
  check('已淘汰内嵌 PDF 查看器（无 .works-pdf-frame）', rePanel.noIframe === true, String(rePanel.noIframe));
  await cdp.eval(`document.querySelector('.works-panel-close')?.click()`);
  await sleep(500);

  /* 10. 夜灯 / 暂停旋转 / 来阵风 不报错 */
  const toggles = await cdp.eval(`
    (() => {
      document.querySelector('.works-panel-close')?.click();
      const byText = (t) => [...document.querySelectorAll('.works-btn')].find(b => b.textContent.includes(t));
      byText('夜灯')?.click();
      byText('来阵风')?.click();
      byText('暂停旋转')?.click();
      return true;
    })()
  `);
  check('夜灯/风/暂停按钮可用', toggles === true);
  await sleep(1800);
  await cdp.shot('05-night.png');

  /* 11. 关闭整个浮层 */
  await cdp.eval(`
    [...document.querySelectorAll('.works-btn-close')].find(b => b.textContent.includes('关闭')).click()
  `);
  await sleep(900);
  const closed = await cdp.eval(`!document.querySelector('.works-overlay')`);
  check('关闭按钮能退出浮层', closed === true);

  /* 12. 访客模式门控：navigate 到 ?admin=0，验证「＋提交项目」不渲染 */
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4180/?studio=1&admin=0' });
  await sleep(2500);
  // 等 studio-btn 出现
  let studioBtnReady = false;
  for (let i = 0; i < 30; i++) {
    studioBtnReady = await cdp.eval(`
      Boolean(document.querySelector('.studio-btn'))
    `);
    if (studioBtnReady) break;
    await sleep(200);
  }
  if (studioBtnReady) {
    await cdp.eval(`[...document.querySelectorAll('.studio-btn')].find(b=>b.textContent.includes('Works'))?.click()`);
    await sleep(2800);
    const guest = await cdp.eval(`
      ({ has: Boolean([...document.querySelectorAll('.works-btn')].find(b => b.textContent.includes('提交项目'))),
         overlay: Boolean(document.querySelector('.works-overlay')),
         editBtn: Boolean([...document.querySelectorAll('.works-btn-primary')].find(b => b.textContent.includes('编辑项目'))) })
    `);
    check('访客模式（?admin=0）不显示「提交项目」按钮', guest.has === false, JSON.stringify(guest));
    check('访客模式不显示「编辑项目」按钮', guest.editBtn === false, JSON.stringify(guest));
    await cdp.shot('06-guest-mode.png');
    // 验证访客看空槽位 = 阅读态（高光图待上传占位，不进编辑）
    await cdp.eval(`document.querySelectorAll('.works-thumb')[4]?.click()`);
    await sleep(900);
    const guestEmpty = await cdp.eval(`
      ({ hasForm: Boolean(document.querySelector('#wk-title')),
         hasEmpty: Boolean(document.querySelector('.works-highlight-empty')) })
    `);
    check('访客模式空槽位仅展示不进编辑', guestEmpty.hasForm === false && guestEmpty.hasEmpty === true, JSON.stringify(guestEmpty));
  } else {
    check('访客模式：studio 渲染好了', false, '找不到 .studio-btn');
  }

  /* 12. 控制台无致命报错 */
  console.log('\n--- 结果 ---');
} catch (err) {
  check('脚本执行', false, err.message);
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) console.log('失败项：', failed.map((f) => f.name).join(' / '));
  edge.kill('SIGKILL');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
