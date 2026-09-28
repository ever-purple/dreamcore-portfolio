/**
 * 实习日记（翻页本）回归测试 —— 无头 Edge + CDP，零 npm 依赖。
 *
 * 为什么必须留着这个脚本：日记页是**翻页本**，一张纸被切成 12 条竖带、
 * 每条各渲染一份完整内容（见 NotebookOverlay）。这带来三个只会「静默坏掉」的坑：
 *
 *   1. **单页溢出** —— 内容一旦超过一页高度，12 条带会各自冒出一个滚动条。
 *      不跑脚本几乎看不出来（每条的溢出量一样，肉眼只当是纸边阴影）。
 *   2. **子集字体回退** —— 标题/日期/标签走 NanoOldSongA 的**子集**字体；
 *      diary.ts 里新增 display 字段名若没同步进 scripts/subset-nanooldsong.py，
 *      新字会静默回退到 Noto Serif，和其余字**混排**（同一行两种字，很难察觉）。
 *      本脚本用 CSS.getPlatformFontsForNode 直接问浏览器"这段字实际用了哪个字体"。
 *   3. **控制台 / 网络报错** —— 翻页与装饰层容易带出 WebGL、资源 404 之类的问题。
 *
 * 用法：
 *   1. 起 dev：`node node_modules/vite/bin/vite.js --port 4177 --strictPort`
 *   2. 起无头 Edge（必须用 PowerShell 起，Bash 会在 ~600ms 杀掉 Chromium）：
 *      & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
 *        --headless=new --remote-debugging-port=9333 `
 *        --user-data-dir="<repo>/_edge-diary" --no-first-run --window-size=1440,900 about:blank
 *   3. `node verify-diary.mjs`
 *
 * 退出码：0 = 通过（无溢出、字体无回退、无控制台/网络错误）；1 = 有问题（详见输出）。
 *
 * ⚠️ 本机 CDP 截图的两个硬限制（实测，改脚本前先读）：
 *   · `Page.captureScreenshot` 的 `clip.scale` 是**必填**，且只能为 1（>1 或 dpr>1 会挂死）；
 *   · clip 任一边越出视口也会挂死。所以全页截图不带 clip、局部截图必须钳进视口。
 */
import fs from 'node:fs';
import path from 'node:path';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9333';
const URL_BASE = process.env.DIARY_URL || 'http://127.0.0.1:4177/?studio=1&diary=1';
/** 截图落在 .workbuddy/ 下（项目数据目录，不是源码目录，避免污染仓库） */
const OUT = process.env.DIARY_SHOT_DIR || path.resolve('.workbuddy/tmp/diary-verify');
fs.mkdirSync(OUT, { recursive: true });

/**
 * 截图格式 —— `DIARY_SHOT_FORMAT=jpeg` 直接出 JPEG，省掉「PNG 再转 JPG」那一步
 * （CDP 本来就支持，转一道还要靠 Pillow）。
 */
const SHOT_FORMAT = process.env.DIARY_SHOT_FORMAT === 'jpeg' ? 'jpeg' : 'png';

/**
 * 预览命名 —— `DIARY_SHOT_NAMES=1` 时沿用 OUT 里**已有的**文件名（按序号配对），
 * 而不是 p0.png 这种。刻意**不重新推导**名字：推导规则里塞着「「」《》要不要去掉」
 * 这类细节，重推一次就会产出一批新名字，看 diff 像是删了 20 个又加了 20 个。
 * 名字在启动时读一次（写之前），所以边写边读不会自污染。
 */
const PREVIEW_NAMES = (() => {
  if (!process.env.DIARY_SHOT_NAMES) return [];
  try {
    return fs.readdirSync(OUT).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  } catch {
    return [];
  }
})();
if (process.env.DIARY_SHOT_NAMES && PREVIEW_NAMES.length !== 20) {
  console.log(`⚠️ DIARY_SHOT_NAMES 已开，但目标目录里不是 20 张图（实为 ${PREVIEW_NAMES.length}）→ 退回 pN 命名`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => {
  console.log('WATCHDOG TIMEOUT');
  process.exit(3);
}, 240000);

const ver = await (await fetch(`${CDP}/json/version`)).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  bws.onopen = res;
  bws.onerror = rej;
});

let id = 0;
const pending = new Map();
const timeouts = [];
const consoleErrs = [];
const netBad = [];
let sess = null;

bws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  if (!m.method) return;
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrs.push({
      kind: 'exception',
      text: m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text,
    });
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrs.push({ kind: 'console', text: m.params.args?.map((a) => a.value).join(' ') });
  } else if (m.method === 'Network.responseReceived') {
    const r = m.params.response;
    if (r.status >= 400) netBad.push({ status: r.status, url: r.url, type: m.params.type });
  } else if (m.method === 'Network.loadingFailed') {
    netBad.push({ status: 'FAILED', err: m.params.errorText, url: m.params.requestId });
  }
};

const bsend = (method, params = {}, ms = 30000) =>
  new Promise((res) => {
    const mid = ++id;
    const t = setTimeout(() => {
      pending.delete(mid);
      timeouts.push(method);
      res({ __timeout: true });
    }, ms);
    pending.set(mid, (m) => {
      clearTimeout(t);
      res(m);
    });
    bws.send(JSON.stringify({ id: mid, method, params, ...(sess ? { sessionId: sess } : {}) }));
  });

// 自建隔离 target（避开扩展欢迎页）
// ⚠️ 别改回 `fetch('/json/new?about:blank', { method:'PUT' })`：
//    浏览器里已经开着别的标签页时（实测：4173 上还挂着上一轮的 preview 页），
//    这个 HTTP 端点会把**已有标签页**还回来而不是新建 —— 于是 attach 到了 4173 那个页面，
//    后面一连串症状全指不到真因：hasDiary=false → 余量全 n/a → pageText=undefined
//    → 最后崩在 `r.pageText.slice()` 的 TypeError 上。
//    走浏览器级 Target.createTarget 一定新建，也不会劫持别的页签。
const created = await bsend('Target.createTarget', { url: 'about:blank' });
const createdId = created.result?.targetId;
if (!createdId) {
  console.log('CREATE TARGET FAILED', JSON.stringify(created));
  process.exit(1);
}
const att = await bsend('Target.attachToTarget', { targetId: createdId, flatten: true });
sess = att.result?.sessionId;
if (!sess) {
  console.log('ATTACH FAILED', JSON.stringify(att));
  process.exit(1);
}
/* ⚠️ 必须把这个 target 激活成前台标签（2026-09-22 踩过两次）：
   无头 Edge 里非活动标签的 requestAnimationFrame 会被冻结，而翻页时间轴是 GSAP
   （靠 rAF）驱动的 —— 不激活的话点「下一页」永远停在封面，19 页量出**完全相同**
   的余量（都 190），判定还因为 maxOver=0 假通过。激活只需要一行，别省。 */
await bsend('Target.activateTarget', { targetId: createdId });

const send = (method, params = {}) => bsend(method, params);
const ev = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))
    .result?.result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('DOM.enable');
await send('CSS.enable');
await send('Emulation.setEmulatedMedia', {
  media: '',
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.setWebLifecycleState', { state: 'active' });

await send('Page.navigate', { url: URL_BASE });
await send('Page.setWebLifecycleState', { state: 'active' });

async function until(fn, ms, step = 200) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
}
const ready = await until(() => ev(`!!document.querySelector('.diary-book')`), 30000);
if (!ready) {
  console.log('NOT READY. bodyText =', await ev(`(document.body.innerText||'').slice(0,200)`));
  console.log('url =', await ev('location.href'));
  process.exit(1);
}
await sleep(800);

const identity = {
  url: await ev('location.href'),
  title: await ev('document.title'),
  hasDiary: await ev(`(document.body.innerText||'').includes('实习日记')`),
};

/**
 * 联网自检 —— 这一条是**为了报错能指到真因**：上面那个 ready 只查 `.diary-book` 存不存在，
 * 而日记层没开（URL 少了 `diary=1`）时页面照样能渲染出别的子页，检查会通过，
 * 然后一路走到「余量全 n/a → pageText 是 undefined → 崩在 .slice」，
 * 报错读起来像是在骂排版，实际是连错了页面。实测踩过一次，别再省这几行。
 */
if (!identity.hasDiary || !identity.url.includes('diary=1')) {
  console.log('=== 致命：连到的页面没有日记层，后面所有读数都不可信 ===');
  console.log(JSON.stringify(identity));
  console.log('期望 URL：', URL_BASE);
  process.exit(4);
}

const getNodeId = async (sel) => {
  const doc = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: sel });
  return q.result?.nodeId || 0;
};

/** 走子集字体 NanoOldSongA 的字段 —— 新增 display 字段时把选择器补在这里。
 *  2026-09-17 第二轮：一页只承载一个板块 / 篇首 / 复盘，选择器不再每页都命中；
 *  没命中的会记 MISSING，判定环节会跳过（见文件尾部 bad 收集循环）。 */
const FONT_SELS = [
  // 篇首页
  //   ⚠️ .diary-note-no 不在列表里 —— 它是写死的 Caveat 手写数字（'01.'），
  //      不是 display 宋体，收进来只会得到一条假回退告警（实测踩过）。
  '.diary-note-title',
  '.diary-tape-meta',
  '.dc-challenge-label',
  '.dc-stat-v',
  '.dc-stat-l',
  // 板块页 / 复盘页共用的跑马页眉
  '.ds-run-no',
  '.ds-run-tail',
  // 板块页
  '.ds-head-no',
  '.ds-head-title',
  '.ds-result-k',
  '.ds-table-cap',
  '.ds-stat-v',
  // 复盘页
  '.dr-head-title',
  '.dr-foot-zh',
  // 进度胶囊（在翻页层上，不随页重建）—— 「篇 / 封面 / 篇首」这些新收进来的字靠它兜底
  '.diary-progress-num',
  '.diary-progress-unit',
  // 清爽版式（2026-09-22 重写）的内页选择器
  '.dx-title',
  // 右上角手写抬头 —— 字体是 PFHuTu-Meta 子集（家族名 PFanHuTuTi），判定处单独放行
  '.dx-meta-where',
  // 第三轮（2026-09-22 晚）：月份圈选行（手写体）、小标题与块标签、📌 抬头、
  // 思维导图（根节点 / 一级组名走 NanoOldSongA，细目走正文字体不查）
  '.dx-months',
  '.dx-k',
  '.dx-pin',
  '.dx-mm-root',
  '.dx-mm-node',
];

const report = [];
/** 总页数从页码器读（形如 `01 / 20`）—— 写死过 5，分页口径一改就悄悄失准，不再犯 */
const TOTAL_PAGES = await (async () => {
  const t = (await ev(`document.querySelector('.diary-pager-num')?.textContent || ''`)) || '';
  const m = t.match(/\/\s*(\d+)/);
  return m ? Number(m[1]) : 5;
})();

for (let p = 0; p < TOTAL_PAGES; p++) {
  if (p > 0) {
    // 点右下「下一页」圆圈键（真实点击，带 clickCount）
    const box = await ev(`(() => {
      const b = document.querySelector('.diary-nav.is-next');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
    })()`);
    if (!box) {
      report.push({ page: p, error: 'no next button' });
      break;
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse',
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
    });
    // 等翻页动画结束（pager 文本更新 + 余量）
    await until(async () => (await ev(`document.querySelector('.diary-pager-num')?.textContent`))?.startsWith(String(p + 1).padStart(2, '0')), 8000);
    await sleep(900);
  }

  const overflow = await ev(`(() => {
    const sheets = [...document.querySelectorAll('.diary-sheet')];
    let maxOver = 0, sh = 0, ch = 0;
    for (const s of sheets) {
      const over = s.scrollHeight - s.clientHeight;
      if (over > maxOver) { maxOver = over; sh = s.scrollHeight; ch = s.clientHeight; }
    }
    return { sheets: sheets.length, maxOver, sh, ch };
  })()`);

  /**
   * 余量（slack）—— 只报"溢出"是不够的：改版后每页都很空，
   * 要放大字号得先知道还剩多少高度可用，否则只能一次次试。
   *
   * ⚠️ 必须用 offsetTop + offsetHeight 累加，**不能**用 getBoundingClientRect：
   *    翻页层给 .diary-band 加了 3D 变换，rect 会被投影放大，量出来全是假的。
   *    .diary-entry 是 position:relative，所以它的子元素 offsetParent 就是它自己。
   * 另外 .diary-entry 有 min-height:100%，直接读它自己的高度读不出内容自然高度。
   */
  const slack = await ev(`(() => {
    const sheet = document.querySelector('.diary-sheet');
    const art = sheet && sheet.firstElementChild;
    if (!sheet || !art) return null;
    const cs = getComputedStyle(sheet);
    const avail = sheet.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    let contentH = 0;
    for (const k of art.children) {
      // ⚠️ 复盘页最后的 <Doodle> 是 **SVG**，SVGElement 没有 offsetTop/offsetHeight
      //    （只有 HTMLElement 才有）。不兜底就是 undefined+undefined=NaN，
      //    再被 JSON 序列化成 null —— 整页余量读不出来。踩过一次。
      const top = k.offsetTop || 0;
      const h = k.offsetHeight || 0;
      contentH = Math.max(contentH, top + h);
    }
    return { avail: Math.round(avail), contentH: Math.round(contentH), slack: Math.round(avail - contentH) };
  })()`);

  const fonts = {};
  for (const sel of FONT_SELS) {
    const nid = await getNodeId(sel);
    if (!nid) {
      fonts[sel] = 'MISSING';
      continue;
    }
    const pf = await send('CSS.getPlatformFontsForNode', { nodeId: nid });
    fonts[sel] = (pf.result?.fonts || []).map((f) => `${f.familyName}(${f.glyphCount})`).join(' + ') || 'EMPTY';
  }

  const shot = await send('Page.captureScreenshot', {
    format: SHOT_FORMAT,
    ...(SHOT_FORMAT === 'jpeg' ? { quality: 88 } : null),
  });
  if (shot.result?.data) {
    const name =
      PREVIEW_NAMES.length === 20
        ? PREVIEW_NAMES[p]
        : `p${p}.${SHOT_FORMAT === 'jpeg' ? 'jpg' : 'png'}`;
    fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.result.data, 'base64'));
  }

  // 页标题按页型取：篇首页 / 板块页 / 复盘页各有一个大标题，封面没有
  // ⚠️ 末尾的 `|| ''`：`ev()` 在页面还没就绪 / 连错页时会返回 undefined，
  //    不兜底就一路带着 undefined 进 report，最后崩在打印的 .slice() 上（踩过）。
  // 2026-09-24 晚：清爽版式（.dx-*）是 2026-09-22 重写的，标题/抬头选择器补上回退；
  // 旧的 .diary-progress 进度胶囊已被移除（换成底部 .diary-jumpbar 跳转条），
  // 括号里改读 .diary-pager-num —— 再读旧类名只会永远得到空串（19 页假告警的根因）。
  const pageText =
    (await ev(`(() => {
    const q = (s) => document.querySelector(s);
    const t = q('.diary-note-title') || q('.ds-head-title') || q('.dr-head-title') || q('.dx-title');
    const org = q('.diary-tape-org') || q('.ds-run-org') || q('.dx-meta-where');
    const pager = (q('.diary-pager-num')?.textContent || '').replace(/\\s+/g, ' ').trim();
    return (t ? t.textContent : '(封面)') + ' @ ' + (org ? org.textContent : '-') + ' [' + pager + ']';
  })()`)) || '';

  report.push({ page: p, pageText, overflow, slack, fonts, shotBytes: shot.result?.data?.length || 0 });
}

console.log('=== IDENTITY ===');
console.log(JSON.stringify(identity));
console.log('=== 余量（可用高 / 内容高 / 剩余）===');
for (const r of report) {
  const s = r.slack;
  console.log(
    `  page ${String(r.page).padStart(2)}  ${s ? `avail ${s.avail}  content ${String(s.contentH).padStart(4)}  slack ${String(s.slack).padStart(4)}` : 'n/a'}   ${r.pageText.slice(0, 40)}`,
  );
}
console.log('=== REPORT ===');
console.log(JSON.stringify(report, null, 2));
console.log('=== CONSOLE ERRORS ===');
console.log(JSON.stringify(consoleErrs, null, 2));
console.log('=== NET >=400 ===');
console.log(JSON.stringify(netBad, null, 2));
console.log('=== TIMEOUTS ===', JSON.stringify(timeouts));

/* ---- 判定：这三件事任意一件出问题都算失败 ---- */
const bad = [];
for (const r of report) {
  if (r.overflow && r.overflow.maxOver > 0) bad.push(`page ${r.page} 溢出 ${r.overflow.maxOver}px`);
  for (const [sel, f] of Object.entries(r.fonts || {})) {
    // 手写体选择器（.dx-meta-where 抬头 / .dx-months 月份圈选行）合法字体是
    // PFanHuTuTi（PFHuTu-Meta 子集）；其余（标题/小标签/抬头）必须是 NanoOldSong。
    const HAND = ['.dx-meta-where', '.dx-months'];
    const okFont =
      f === 'MISSING' ||
      (HAND.includes(sel) ? f.includes('PFanHuTuTi') : f.includes('NanoOldSong'));
    if (f && !okFont) bad.push(`page ${r.page} ${sel} 字体回退为 ${f}`);
  }
  // 进度胶囊（.diary-progress）已随 2026-09-22 改版移除 —— 原来的「封面 / 篇 0N…」两级
  // 断言从此永远拿到空串（存量假告警）。退回页码器健康检查：形如 "03 / 19" 且随页递增。
  const prog = (r.pageText.match(/\[([^\]]*)\]/) || [])[1] || '';
  if (!/^\d{2} \/ \d{2}$/.test(prog)) {
    bad.push(`page ${r.page} 页码器读数异常：「${prog}」`);
  } else if (Number(prog.slice(0, 2)) !== r.page + 1) {
    bad.push(`page ${r.page} 页码器应显示 ${String(r.page + 1).padStart(2, '0')}，实为「${prog}」`);
  }
}
if (report.length !== TOTAL_PAGES) {
  bad.push(`翻页只走了 ${report.length} 页，页码器声明 ${TOTAL_PAGES} 页`);
}
if (timeouts.length) bad.push(`CDP 超时: ${timeouts.join(',')}`);
console.log('\n=== 判定 ===');
if (bad.length) {
  for (const b of bad) console.log('✗ ' + b);
} else {
  console.log('✓ 全部通过：无单页溢出 / 子集字体无回退 / 无 CDP 超时');
}

await fetch(`${CDP}/json/close/${created.id}`).catch(() => {});
clearTimeout(watchdog);
process.exit(bad.length ? 1 : 0);
