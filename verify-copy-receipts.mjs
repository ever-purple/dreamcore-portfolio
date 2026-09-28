/**
 * 文案页（CopyProjectPage / 购物小票）素材与正文回归 —— 2026-09-22 用户第 5 条反馈。
 *
 * 覆盖（用户：「三张贴纸，一个文案对应一个」+ 3 张产品图 + 3 段新正文）：
 *   A  卡片数 = 4（有 cover 的全部上墙）
 *   B  每张卡片的 cover 是**各自的产品图**，且真的加载成功（naturalWidth>0，不是 404 破图）
 *   C  每张卡片的贴纸是**各自那张**：银鹭/郁美净/茶之韵 各一张，营养快线回落 mascot
 *   D  正文字体 'HYQiHei-40S' 的 @font-face 状态 = loaded（不是 error / 没声明）
 *   E  点开每张小票 → 右侧面板正文行数与空行分节数对上
 *   F  全程无 console error（含字体 invalid sfntVersion、图片 404）
 *   J  底图质量与蒙版（2026-09-22 第五轮定稿）：cover / 底图不低于源图原生分辨率 /
 *      纸纹层 z-index=1（=0 会被照片盖住）/ 压暗层是 135° 黑色渐变（0.30 → 0.72）
 *
 * 用法：先 `npm run dev`（5173），再 `node verify-copy-receipts.mjs`
 *
 * ⚠️ 脚本自己 spawn 无头 Edge（别用终端 Start-Process，工具调用结束会被回收 → CDP ECONNREFUSED）。
 * ⚠️ 无头 rAF 被节流到 ~1.6fps：入场动画/懒加载要**轮询**，sleep 固定时长会读到半路状态。
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9341;
const URL = 'http://127.0.0.1:5173/?studio=1&copy=1';
const EDGE = process.env.EDGE || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p)) || 'msedge';
const OUT = process.env.SHOT_DIR || tmpdir();
const PROFILE = join(tmpdir(), 'cp-edge-profile');

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--mute-audio',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
  `--user-data-dir=${PROFILE}`, 'about:blank'],
{ detached: true, stdio: 'ignore' });
edge.unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map(); let sid = null;
const consoleErrors = [];
const netFails = [];
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
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 75 }, sid);
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
};

let pass = 0; let fail = 0;
function check(ok, label, extra = '') {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ' :: ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' :: ' + extra : ''}`); }
}

/** 页面上 4 张卡片的 cover / sticker 落盘名 + 实际加载尺寸 */
const cardsInfo = () => evalJS(`(() => {
  const cards = [...document.querySelectorAll('.cp-receipt')];
  return cards.map((c) => {
    const cover = c.querySelector('.cp-receipt-img');
    const sticker = c.querySelector('.cp-receipt-sticker-img');
    return {
      name: c.querySelector('.cp-receipt-name')?.textContent || '',
      cover: cover ? (cover.currentSrc || cover.src).split('/').pop() : null,
      coverW: cover ? cover.naturalWidth : 0,
      coverH: cover ? cover.naturalHeight : 0,
      sticker: sticker ? (sticker.currentSrc || sticker.src).split('/').pop() : null,
      stickerW: sticker ? sticker.naturalWidth : 0,
      stickerH: sticker ? sticker.naturalHeight : 0,
    };
  });
})()`);

/** 点开第 i 张 → 读右侧面板正文行 / 分节数 / 字体 */
const openAndRead = (i) => evalJS(`(() => {
  const cards = [...document.querySelectorAll('.cp-receipt')];
  if (!cards[${i}]) return { err: 'no card' };
  cards[${i}].click();
  return 1;
})()`);

/**
 * 读右侧面板。
 * ⚠️ 2026-09-22 第四轮起结构变了：正文行从「一串平铺的 <p>（空行用 .cp-poem-gap 占位）」
 *    改成了「若干 .cp-poem-sec 块 → 再分到 .cp-poem-col 左右两栏」，
 *    块与块之间的留白由 CSS 外边距给。所以断言不能再数 .cp-poem-gap（那个类已经没人用了）。
 *    唯一区分"正文行"与"节名行"的钩子是 `.cp-poem-line`。
 */
const panelInfo = () => evalJS(`(() => {
  const panel = document.querySelector('.cp-receipt-panel');
  if (!panel) return { open: false };
  const poem = panel.querySelector('.cp-receipt-poem');
  const bodyLines = [...poem.querySelectorAll('.cp-poem-line')];
  const cols = [...poem.querySelectorAll('.cp-poem-col')];
  const cs = getComputedStyle(poem);
  return {
    open: true,
    title: document.querySelector('.cp-receipt-sheet .cp-receipt-name')?.textContent || '',
    lines: bodyLines.length,
    blocks: poem.querySelectorAll('.cp-poem-sec').length,
    heads: poem.querySelectorAll('.cp-poem-sec-head').length,
    cols: cols.length,
    isColumns: poem.classList.contains('is-columns'),
    layout: cols.map((c) => [...c.querySelectorAll('.cp-poem-sec')].map((s) => ({
      label: s.querySelector('.cp-poem-sec-label')?.textContent || null,
      lines: [...s.querySelectorAll('.cp-poem-line')].map((p) => p.textContent),
    }))),
    em: [...poem.querySelectorAll('.cp-em-u')].map((e) => e.textContent),
    mark: [...poem.querySelectorAll('.cp-em-mark')].map((e) => e.textContent),
    fontFamily: cs.fontFamily,
    isPhoto: panel.classList.contains('is-photo'),
    panelColor: getComputedStyle(panel).color,
    lineShadow: bodyLines[0] ? getComputedStyle(bodyLines[0]).textShadow : null,
    /* —— 2026-09-22 第五轮：底图素材质量 + 蒙版 —— */
    /* 底图的**原生分辨率**：旧版底图是 560×231 的横幅带，被 cover 拉到 1357 渲染
       = 放大 2.42 倍（用户「不要放大，不要压缩画质」）。这里锁住"别再退回小图"。 */
    photoNatW: (() => { const i = panel.querySelector('.cp-poem-photo'); return i ? i.naturalWidth : 0; })(),
    photoNat: (() => {
      const i = panel.querySelector('.cp-poem-photo');
      /* ⚠️ 这里**不能用模板字符串**：panelInfo 的整个函数体本身就是一个反引号模板，
         内层再写插值语法会被 Node 在外层就插值掉，直接 SyntaxError。一律用 + 拼。
         （连注释里都不要出现那两个字符，否则注释也会被扫到。） */
      return i ? i.naturalWidth + 'x' + i.naturalHeight : null;
    })(),
    photoRenderedW: (() => {
      const i = panel.querySelector('.cp-poem-photo');
      return i ? Math.round(i.getBoundingClientRect().width) : 0;
    })(),
    photoFit: (() => {
      const i = panel.querySelector('.cp-poem-photo');
      return i ? getComputedStyle(i).objectFit : null;
    })(),
    /* 纸纹层（::before）必须 z-index:1 —— 它是"第一个子节点"，等于 0 时会被照片盖住，
       而且**看不出来**（computed background-image 全对，就是没画出来）。 */
    grainZ: getComputedStyle(panel, '::before').zIndex,
    /* 压暗层（::after）= 最终选定的「135° 黑色渐变蒙版」（用户 2026-09-22 从 A/B 里选的 B）。 */
    scrimBg: getComputedStyle(panel, '::after').backgroundImage,
  };
})()`);

const fontStatus = () => evalJS(`(async () => {
  await document.fonts.ready;
  const faces = [...document.fonts].filter((f) => /HYQiHei/i.test(f.family));
  return faces.map((f) => ({ family: f.family, weight: f.weight, status: f.status }));
})()`);

/**
 * 旗黑是否**真的生效** —— 光看 status=loaded 还不够（可能加载成功但没命中元素）。
 *
 * ⚠️ 不能用「量宽度」判：中文字形等宽，任何 CJK 字体下 N 个字都是 N×字号 px
 *    （实测 12 字 × 20px = 240，旗黑/无衬线/衬线三者一模一样，看不出差别）。
 * 正确判据是**像素**：同一串字分别用旗黑与回退族画到 canvas，取 ImageData 逐字节比。
 * 字形不同 → 像素必然不同；若两者全等 = 旗黑没命中（静默回落到替代字体）。
 */
const fontEffective = () => evalJS(`(async () => {
  const S = '银鹭植物豆奶郁美净茶之韵';   // 每张小票标题里都出现的字
  try { await document.fonts.load('48px "HYQiHei-40S"', S); } catch {}
  await document.fonts.ready;
  const c = document.createElement('canvas');
  c.width = 900; c.height = 90;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const draw = (f) => {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    ctx.font = f;
    ctx.textBaseline = 'top';
    ctx.fillText(S, 4, 8);
    return ctx.getImageData(0, 0, c.width, c.height).data;
  };
  const a = draw('48px "HYQiHei-40S"');
  const b = draw('48px sans-serif');
  const d = draw('48px serif');
  // 逐字节数差异（只数非零字节，避免透明区噪声）
  const diff = (x, y) => { let n = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) n++; return n; };
  let ink = 0; for (let i = 3; i < a.length; i += 4) if (a[i] > 8) ink++;
  return {
    check: document.fonts.check('20px "HYQiHei-40S"'),
    inkPx: ink,
    diffVsSans: diff(a, b),
    diffVsSerif: diff(a, d),
  };
})()`);

(async () => {
  // 等 CDP 起来
  const t0 = Date.now();
  let target;
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
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails?.exception?.description || 'exception');
    }
    if (m.method === 'Network.loadingFailed') netFails.push(m.params.errorText);
  };
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.id, flatten: true });
  sid = sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);

  console.log(`\nopen ${URL}`);
  await send('Page.navigate', { url: URL }, sid);
  await sleep(1200);

  // 等页面入场 + 图片解码
  {
    const t = Date.now();
    for (;;) {
      const n = await evalJS(`document.querySelectorAll('.cp-receipt').length`);
      if (n >= 4) break;
      if (Date.now() - t > 20000) break;
      await sleep(500);
    }
  }
  await evalJS(`Promise.all([...document.querySelectorAll('.cp-receipt img')].map(i => i.decode().catch(()=>0)))`);
  await sleep(600);

  console.log('\n── A/B/C 卡片 · 产品图 · 贴纸 ──');
  const cards = await cardsInfo();
  check(cards.length === 4, 'A 卡片数 = 4', `got ${cards.length}`);
  /* 每条底图**应有的最小宽度** = 该素材的原生分辨率（由 scripts/prep-receipt-photos.py 产出，
     脚本里"只缩不放、不裁 2.42"）。断言用 `>=`：只防"又被压回小图"，不禁止为了 2x 屏
     从 2848 缩到 2084（营养快线就是缩过的）。
     ⚠️ 改素材后要同步这张表，否则断言比现实宽松/严格都会失真。 */
  const PHOTO_NATIVE = { 营养快线: 2084, 银鹭植物豆奶: 1024, 郁美净: 1024, 茶之韵: 770 };

  const expect = [
    { name: '营养快线', cover: 'nutrition-express-2.png', sticker: 'mascot-sticker.png' },    { name: '银鹭植物豆奶', cover: 'yinlu-peanut-milk.png', sticker: 'sticker-yinlu.png' },
    { name: '郁美净', cover: 'yumeijing-cream.png', sticker: 'sticker-yumeijing.png' },
    { name: '茶之韵', cover: 'tea-rhyme-glass.png', sticker: 'sticker-tea.png' },
  ];
  cards.forEach((c, i) => {
    const e = expect[i] || {};
    console.log(`  [${i}] ${c.name}`);
    check(c.cover === e.cover, `   B cover = ${e.cover}`, `got ${c.cover} ${c.coverW}x${c.coverH}`);
    check(c.coverW > 0 && c.coverH > 0, '   B cover 已解码', `${c.coverW}x${c.coverH}`);
    check(c.sticker === e.sticker, `   C sticker = ${e.sticker}`, `got ${c.sticker} ${c.stickerW}x${c.stickerH}`);
    check(c.stickerW > 0 && c.stickerH > 0, '   C sticker 已解码', `${c.stickerW}x${c.stickerH}`);
  });
  const uniqStickers = new Set(cards.map((c) => c.sticker));
  check(uniqStickers.size === 4, 'C 4 张卡片贴纸互不相同', [...uniqStickers].join(', '));

  await shot('cp-cards.jpg');

  console.log('\n── G 标题 / 折叠态是否被滚动裁掉 / 悬停放大 ──');
  /* G1 标题：用户 2026-09-22「去掉 &AI，加上文案，**文案字号比英文小**」。 */
  const titleInfo = await evalJS(`(() => {
    const h1 = document.querySelector('.cp-title');
    const cn = h1?.querySelector('.cp-title-cn');
    return {
      text: h1?.textContent?.trim() || '',
      en: Math.round(parseFloat(getComputedStyle(h1).fontSize)),
      cn: cn ? Math.round(parseFloat(getComputedStyle(cn).fontSize)) : 0,
    };
  })()`);
  check(!/&/.test(titleInfo.text), 'G1 标题里没有 &', titleInfo.text);
  check(titleInfo.text.includes('文案'), 'G1 标题带了「文案」', titleInfo.text);
  check(titleInfo.cn > 0 && titleInfo.cn < titleInfo.en, `G1 「文案」比英文小`,
    `en ${titleInfo.en}px / cn ${titleInfo.cn}px`);

  /* G2 折叠态不需要滚动 —— 用户 2026-09-22 报过「小票和贴纸显示不出来」，
     根因是 `.cp-scroll` 是 `overflow-y:auto`：一旦要滚动，骑在纸沿上探出 ~42px 的
     贴纸就会被裁掉（滚动容器的上沿就是裁剪线）。1440×900 这一档四张票要能一屏放下。 */
  const scrollInfo = await evalJS(`(() => {
    const sc = document.querySelector('.cp-scroll');
    const cards = [...document.querySelectorAll('.cp-receipt')];
    const scTop = sc.getBoundingClientRect().top;
    const worst = Math.min(...cards.map((c) => c.querySelector('.cp-receipt-sticker').getBoundingClientRect().top));
    return { scrollH: sc.scrollHeight, clientH: sc.clientHeight, scTop: Math.round(scTop), worstStickerTop: Math.round(worst) };
  })()`);
  check(scrollInfo.scrollH <= scrollInfo.clientH, 'G2 折叠态一屏放得下（不需要滚动）',
    `scrollH ${scrollInfo.scrollH} / clientH ${scrollInfo.clientH}`);
  check(scrollInfo.worstStickerTop >= scrollInfo.scTop - 1, 'G2 贴纸没有被滚动容器上沿裁掉',
    `贴纸顶 ${scrollInfo.worstStickerTop} vs 容器顶 ${scrollInfo.scTop}`);

  /* G3 悬停放大：缩放挂在 .cp-receipt-unit 上，贴纸是它的子节点、跟着一起大。
     ⚠️ 无头里过渡被节流，必须轮询等它跑完（固定 sleep 读到的是过渡起点 = 单位矩阵）。
     ⚠️⚠️ 等待条件**不能**再是"transform ≠ 单位矩阵"（2026-09-22 错落改版踩到）：
        错落之后 `.cp-receipt-unit` 的**静止态**就是 `rotate(±0.x°)`，天生非单位矩阵 ——
        一进来就 break，读到的是没放大的倾角（matrix(0.9999,…)，误报"没有放大"）。
        判据改成"从 matrix 里算出的缩放 > 1.02"：缩放 = hypot(a, b)。 */
  {
    const box = await evalJS(`(() => { const b = document.querySelector('.cp-receipt').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + 120) }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 }, sid);
    const scaleOf = (tf) => {
      const m = /matrix\(([-\d.e]+), ?([-\d.e]+)/.exec(tf || '');
      return m ? Math.hypot(Number(m[1]), Number(m[2])) : 0;
    };
    const t = Date.now();
    let tf = '';
    let scale = 0;
    for (;;) {
      tf = await evalJS(`getComputedStyle(document.querySelector('.cp-receipt .cp-receipt-unit')).transform`);
      scale = scaleOf(tf);
      if (scale > 1.02) break;
      if (Date.now() - t > 15000) break;
      await sleep(400);
    }
    check(scale > 1.02, 'G3 悬停时小票放大（贴纸随之一起）', `${tf} → scale ${scale.toFixed(4)}`);
    await shot('cp-hover.jpg');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 880, buttons: 0 }, sid);
    await sleep(400);
  }

  console.log('\n── D 字体（声明态）──');
  const faces0 = await fontStatus();
  console.log('  faces:', JSON.stringify(faces0));
  check(faces0.length > 0, 'D 声明了 HYQiHei 的 @font-face', `${faces0.length} 条`);
  /* ⚠️ 这里**不能**断言 status=loaded：此刻面板还没打开，旗黑没被任何元素命中，
     @font-face 按规范就是 unloaded（懒加载）。真实加载态放到 E 之后再查。 */
  check(faces0.every((f) => f.status !== 'error'), 'D 声明无 error',
    faces0.map((f) => f.status).join(','));

  console.log('\n── E 展开态正文 / 分栏 / 划词 ──');
  /* lines = `.cp-poem-line` 的条数（正文行，不含节名行）；
     blocks = 块数（有 sections 的按节，没有的按空行分组）；
     cols = 1 单栏 / 2 两栏（用户 2026-09-22：「前两个文案不用用虚线分开」）。 */
  const expectBody = {
    '营养快线': { lines: 11, blocks: 5, cols: 1 },
    '银鹭植物豆奶': { lines: 11, blocks: 3, cols: 1 },
    '郁美净': { lines: 22, blocks: 6, cols: 2 },
    '茶之韵': { lines: 16, blocks: 4, cols: 2, heads: 4 },
  };
  /* 茶之韵的断句必须**逐行**跟用户参考图（屏幕截图 170953 / 171635）一致 ——
     这是「排版按照这个来断句」那条要求的落点：节内是一句话用逗号串起来的，
     靠句末标点自动断会断不出来。 */
  const expectTea = {
    '起源': ['从高山处孕育，我们的故事从山野开始讲起。', '万年前的第一颗火种，带领我们开拓自然。', '一座座屹然立起的城市，将原始的山野之声困于万年以前。'],
    '探索': ['一群探险者搜寻着城市与群山对话的隧道，', '他们向着高山呐喊，', '那一声声回响仿佛来自万年以前。'],
    '交流': ['当他们试图与山野对话，', '发现了被众人遗忘的汲日月精华的高山茶，', '便一起与当地人起炉烧壶，', '聆听茶汤的沸腾，', '寄身于茶香之中，', '回味山野之声。'],
    '回归': ['探险者们总归是要回到城市，', '他们带着高山有机茶的茶之韵，', '让众人品一口甘甜，', '领略山野，回归山野，再续山野。'],
  };
  for (let i = 0; i < cards.length; i++) {
    await evalJS(`document.querySelectorAll('.cp-receipt')[${i}].click()`);
    /* ⚠️ 面板入场是 clip-path 揭开，无头里动画被节流 ——
       固定 sleep 会读到"半开"状态（右半边被裁掉，看着像"右栏被切了"）。
       判据用「不含非零百分比」而不是硬匹配某种写法（实测算出来是
       `inset(0px 0% 0px 0px)`）。 */
    {
      const t = Date.now();
      for (;;) {
        const cp = await evalJS(`(() => { const p = document.querySelector('.cp-receipt-panel'); return p ? getComputedStyle(p).clipPath : ''; })()`);
        if (!cp || cp === 'none' || !/[1-9]\d*(\.\d+)?%/.test(cp)) break;
        if (Date.now() - t > 20000) { console.log(`   ! [${i}] clip-path 没归零: ${cp}`); break; }
        await sleep(400);
      }
    }
    const p = await panelInfo();
    if (!p.open) { check(false, `E [${i}] 面板未打开`); continue; }
    console.log(`  [${i}] ${p.title} → ${p.lines} 行 / ${p.blocks} 块 / ${p.cols} 栏${p.heads ? ` / ${p.heads} 节名` : ''}`);
    check(p.title === cards[i].name, `   E 展开的小票与卡片同一条`, `${p.title} vs ${cards[i].name}`);
    check(/HYQiHei/i.test(p.fontFamily) || p.fontFamily.includes('HYQiHei-40S'),
      '   E 面板用了旗黑', p.fontFamily.split(',')[0]);
    const eb = expectBody[p.title];
    if (eb) {
      check(p.lines === eb.lines, `   E 正文行数 = ${eb.lines}`, `got ${p.lines}`);
      check(p.blocks === eb.blocks, `   E 块数 = ${eb.blocks}`, `got ${p.blocks}`);
      check(p.cols === eb.cols, `   E 栏数 = ${eb.cols}`, `got ${p.cols}`);
      check(p.isColumns === (eb.cols === 2), `   E 分栏类名与栏数一致`, `is-columns=${p.isColumns}`);
      if (eb.heads) check(p.heads === eb.heads, `   E 节名行 = ${eb.heads}`, `got ${p.heads}`);
    }
    if (p.title === '茶之韵') {
      const flat = p.layout.flat();
      const got = Object.fromEntries(flat.map((s) => [s.label, s.lines]));
      for (const [label, want] of Object.entries(expectTea)) {
        check(JSON.stringify(got[label]) === JSON.stringify(want),
          `   E 茶之韵「${label}」断句 = 参考图`,
          JSON.stringify(got[label]));
      }
      check(p.layout.length === 2 && p.layout[0].length === 2 && p.layout[1].length === 2,
        '   E 茶之韵 左 1·2 节 / 右 3·4 节',
        p.layout.map((c) => c.map((s) => s.label).join('+')).join(' | '));
    }
    if (p.title === '郁美净') {
      check(JSON.stringify(p.em) === JSON.stringify(['春雨', '夏日庭院', '温暖', '童年的味道']),
        '   H 郁美净划词 = 参考图那四处', JSON.stringify(p.em));
      check(JSON.stringify(p.mark) === JSON.stringify(['嗅觉是打开尘封记忆木盒的钥匙。']),
        '   H 郁美净整行高亮 = 首句', JSON.stringify(p.mark));
      check(p.layout.length === 2 && p.layout[0].length === 3 && p.layout[1].length === 3,
        '   E 郁美净 左 3 段 / 右 3 段',
        p.layout.map((c) => c.length).join(' | '));
    }
    if (p.title === '营养快线' || p.title === '银鹭植物豆奶') {
      check(p.em.length === 0 && p.mark.length === 0, `   H ${p.title} 没有划词/高亮`);
    }
    // 照片当底 + 浅色字 + 无投影
    check(p.isPhoto, '   I 面板挂了 is-photo（照片当底）');
    check(p.lineShadow === 'none', '   I 正文没有 text-shadow', String(p.lineShadow));
    /* —— J 底图质量 + 蒙版（2026-09-22 第五轮定稿）—— */
    check(p.photoFit === 'cover', '   J 底图仍是 cover 铺满', String(p.photoFit));
    /* 底图"不被压缩画质"的判据 = **不低于该素材的原生分辨率**：
       旧版一律压到 560 宽（横幅带），这里锁住"别再退回小图"。
       ⚠️ 倍率只报不判：茶之韵的源图只有 770×431（四张里最小），铺满 1042px 的面板
          必然放大 1.35x —— 这是**素材上限**，不是代码问题。想要彻底不放大只能换更大的原图。
        （营养快线 0.50x = 从 2848 缩下来的；郁美净/银鹭 1.02x = 基本贴原生。） */
    const nat = PHOTO_NATIVE[p.title] ?? 0;
    const up = p.photoNatW ? p.photoRenderedW / p.photoNatW : 0;
    check(p.photoNatW >= nat,
      '   J 底图不低于源图原生分辨率',
      `原生 ${p.photoNat} / 渲染 ${p.photoRenderedW}px = ${up.toFixed(2)}x` +
      (up > 1.05 ? '（源图偏小，会轻微放大）' : ''));
    check(p.grainZ === '1',
      '   J 纸纹层 z-index=1（=0 会被照片盖住）', String(p.grainZ));
    /* 蒙版 = 最终选定的 135° 黑色渐变（用户选的 B）。
       写死断言：起点 0.30 / 终点 0.72 —— 左上端不能再浅（正文左栏顶部就在那个区间，
       0.28 时浅色字会糊）。 */
    check(/^linear-gradient\(135deg/.test(p.scrimBg || ''),
      '   J 压暗层是 135° 线性渐变（左上→右下）', (p.scrimBg || '').slice(0, 100));
    check(/rgba\(0, 0, 0, 0\.3\) 0%/.test(p.scrimBg || '') && /rgba\(0, 0, 0, 0\.72\) 100%/.test(p.scrimBg || ''),
      '   J 渐变两端 = 0.30 → 0.72（左上端不可再浅）', (p.scrimBg || '').slice(0, 100));
    await shot(`cp-panel-${i}.jpg`);
    // 关掉
    await evalJS(`document.querySelector('.cp-receipt-close')?.click()`);
    await sleep(500);
  }

  /* —— J3 定稿清扫：A/B 对比开关必须已经彻底移除 ——
     用户 2026-09-22 在「纸纹渗入左上角」与「135° 黑蒙版渐变」之间**选了后者**，
     于是方案 A 与那个只在 ?photodemo 下出现的切换开关都删了。加一条守卫，
     免得日后有人把 `?photodemo` 那套又捡回来（页面上多出一块 UI 是很难被发现的）。 */
  const leftover = await evalJS(
    `document.querySelectorAll('.cp-photo-switch, .cp-photo-switch-btn, [data-photo-mode]').length`);
  check(leftover === 0, 'J3 方案 A 与对比开关已彻底移除', `残留节点 ${leftover} 个`);

  /* —— J4 错落排布 + 贴纸不再压票头（用户 2026-09-22：「遮挡问题解决掉，
        让四个小票排列错落」）——
     · 贴纸原来用 `translate(-50%, -58%)` 定位，压进纸面的深度 = 自身高度的 42%，
       四张贴纸高宽比不同 → 深度差到 9px，最深的整只吃进 "RECEIPT / No.00xx" 那一行
       （实测 stickerToHead = -9）。现在改成固定 `--cp-sticker-hang`，与贴纸大小无关。
     · 四张票原来顶边完全对齐（top 全是 229）。现在每张一个 margin-top + 轻微倾角。
       ⚠️ 必须 `align-items: start`：grid 默认 stretch 会把票拉到与行同高，
          表现成"顶边错开、底边齐刷刷"，那不是错落。 */
  const geo = await evalJS(`(() => {
    const R = (n) => Math.round(n);
    const cards = [...document.querySelectorAll('.cp-receipt')];
    const tops = cards.map((c) => R(c.getBoundingClientRect().top));
    const bots = cards.map((c) => R(c.getBoundingClientRect().bottom));
    const clear = cards.map((c) => {
      const s = c.querySelector('.cp-receipt-sticker').getBoundingClientRect();
      const h = c.querySelector('.cp-receipt-head');
      return h ? R(h.getBoundingClientRect().top - s.bottom) : null;
    });
    return {
      tops, bots, clear,
      topSpan: Math.max(...tops) - Math.min(...tops),
      botSpan: Math.max(...bots) - Math.min(...bots),
      minClear: Math.min(...clear),
    };
  })()`);
  check(geo.topSpan >= 20, 'J4 四张小票顶边已错落', `跨度 ${geo.topSpan}px  tops=${geo.tops}`);
  check(geo.botSpan >= 20, 'J4 底边同样错开（不是只被切短）', `跨度 ${geo.botSpan}px  bots=${geo.bots}`);
  check(geo.minClear >= 2, 'J4 贴纸不再压票头（最小间隙）', `${geo.minClear}px  各张=${geo.clear}`);

  console.log('\n── D2 字体（命中态，E 之后）──');
  const eff = await fontEffective();
  console.log('  ', JSON.stringify(eff));
  check(eff.check, 'D2 fonts.check(旗黑) = true');
  check(eff.inkPx > 200, 'D2 canvas 真有字面落墨', `ink=${eff.inkPx}px`);
  /* 真命中的判据：与两个回退族的像素都有差异（全等 = 静默回落，用户看到的是替代字） */
  check(eff.diffVsSans > 0 && eff.diffVsSerif > 0,
    'D2 旗黑真的生效（像素与回退不同）',
    `vs sans ${eff.diffVsSans} / vs serif ${eff.diffVsSerif}`);
  const faces1 = await fontStatus();
  console.log('  faces:', JSON.stringify(faces1));
  check(faces1.every((f) => f.status === 'loaded'), 'D2 @font-face 已 loaded',
    faces1.map((f) => f.status).join(','));

  console.log('\n── F 控制台 ──');
  check(consoleErrors.length === 0, 'F 无 console error', consoleErrors.slice(0, 3).join(' || '));
  /* ⚠️ `net::ERR_CACHE_OPERATION_NOT_SUPPORTED` 是无头浏览器**磁盘缓存层的偶发噪声**
     （实测同一份代码连跑两次，一次全绿、一次报它；报的时候资源其实也加载成功了）。
     只放行这一种：其余任何 loadingFailed 照旧算失败 —— 别把整个网络断言关掉。 */
  const realNetFails = netFails.filter((e) => !e.includes('ERR_CACHE_OPERATION_NOT_SUPPORTED'));
  check(realNetFails.length === 0, 'F 无网络失败（放行缓存层噪声）',
    realNetFails.slice(0, 3).join(' || ') || `已放行 ${netFails.length - realNetFails.length} 条缓存噪声`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  console.log(`截图落盘：${OUT}`);

  ws.close();
  try { process.kill(-edge.pid); } catch { try { edge.kill(); } catch { /* ignore */ } }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('PROBE ERROR:', e); process.exit(2); });
