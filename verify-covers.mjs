/**
 * 封面「完整且铺满」回归 —— 对应 2026-09-16 用户的三轮反馈：
 *   ①「封面显示不全，检查所有封面」   → 全改 contain / 窗口匹配图片比例
 *   ②「不要虚化边缘的」                → 撤掉所有模糊铺底，留白露容器自己的底
 *   ③「图片要完整且铺满」              → 容器 aspect-ratio = 图片自然比例
 *                                      → contain 后照片边到边铺满，零裁切零留白
 * 外加「旋转木马模型的吹风调小」。
 *
 * 「完整且铺满」的判据：img.onLoad 时把图片自然宽高比写到容器 inline aspect-ratio，
 * img 再用 object-fit: contain —— contain 在同比例盒子里就是 100% 填充。
 * 验证手段：读容器 inline style 的 aspect-ratio，跟图片 naturalWidth/naturalHeight 比；
 * 比例吻合即证明窗口与图同比例。
 * ⚠️ 唯一例外（2026-09-16）：详情页首屏 .wkp-hero 用 coverAr('.wkp-hero', 16/9)
 *    把容器钳到 16:9、img 用 cover 居中裁 —— 4:3 封面曾把首屏顶到一屏多高。
 *
 * 用法: node verify-covers.mjs
 * 前置: 本机 4180 上跑着 dev server（源码态，__wkp* 探针只在 dev 构建存在）
 * 直接连 CDP，不装依赖（Node 22 自带 WebSocket）。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = 'http://127.0.0.1:4180/?works=1#about';
const PORT = 9335;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = mkdtempSync(join(tmpdir(), 'edge-cov-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const warn = (name, detail) => console.log(`WARN  ${name}${detail ? '  — ' + detail : ''}`);

const edge = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1600,1000',
  'about:blank',
], { stdio: 'ignore' });

let ws;
let session;
let rid = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++rid;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params, ...(session ? { sessionId: session } : {}) }));
  });

async function evalJS(expr) {
  const r = await send('Runtime.evaluate', {
    expression: `(()=>{${expr}})()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result?.value;
}

/* —— 探针集 ——
   fitOf / coverVis / veilOf 含义同前；
   多了 arOf(el)：读容器 inline style 的 aspect-ratio，转成数字比值返回 [w, h]；
   用来和图片 naturalWidth/Height 比，验证「完整且铺满」。 */
const PROBE = `
  const fitOf = (el) => getComputedStyle(el).objectFit;
  const coverVis = (img) => {
    const box = img.getBoundingClientRect();
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!nw || !nh || !box.width || !box.height) return null;
    const s = Math.max(box.width / nw, box.height / nh);
    return [Math.min(1, box.width / (nw * s)), Math.min(1, box.height / (nh * s))];
  };
  const pct = (img) => {
    const v = coverVis(img);
    return v ? v.map((n) => (n * 100).toFixed(0) + '%').join('×') : '?';
  };
  const veilOf = (el) => {
    const b = getComputedStyle(el, '::before');
    return (b.backgroundImage || 'none') + '|' + (b.filter || 'none');
  };
  /* box 渲染宽高比 —— 只对**未被 3D 旋转 / 缩放**的容器可信；
     被旋转的父级 transform 会通过 getBoundingClientRect 把高度压缩（rotateX 投影），
     算出来比真实值偏宽，木马缩略图里那 4 个就属于这种情况（不算 bug，是设计）。 */
  const boxAR = (el) => {
    const r = el.getBoundingClientRect();
    return r.width && r.height ? r.width / r.height : null;
  };
  /* 读容器 inline style 的 aspect-ratio（如 "2880 / 1994"），转成数字比值；
     这是 coverAr 写下去的直接证据，不受任何祖先 transform 影响 —— 验证"完整且铺满"
     的最稳的探针：只要这个值跟图片 natAR 一致，浏览器就会按同比例渲染容器，
     contain 在同比例盒子里就必然是边到边 100%。 */
  const inlineAR = (el) => {
    const v = el.style.getPropertyValue('aspect-ratio') || el.style.aspectRatio || '';
    const m = v.match(/([\\d.]+)\\s*\\/\\s*([\\d.]+)/);
    return m ? Number(m[1]) / Number(m[2]) : null;
  };
`;

try {
  let version = null;
  for (let i = 0; i < 40; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (version.webSocketDebuggerUrl) break;
    } catch { /* 还没起来 */ }
    await sleep(300);
  }
  if (!version?.webSocketDebuggerUrl) throw new Error('no cdp endpoint');

  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };

  await send('Target.setDiscoverTargets', { discover: true });
  let targetId = null;
  for (let i = 0; i < 40 && !targetId; i++) {
    const { targetInfos } = await send('Target.getTargets');
    targetId = targetInfos.find((t) => t.type === 'page')?.targetId ?? null;
    if (!targetId) await sleep(300);
  }
  if (!targetId) throw new Error('no page target');
  ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }));

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL_ });
  await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});

  /* ---------- 1. 木马缩略图：aspect-ratio = 图片比例 ---------- */
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const n = await evalJS(`return document.querySelectorAll('.ww-cover img').length;`).catch(() => 0);
    if (n > 0) { ready = true; break; }
    await sleep(400);
  }
  check('木马缩略图已渲染（.ww-cover img）', ready);
  if (!ready) throw new Error('works wheel never rendered');
  /* 等 img.onLoad 把 aspect-ratio 写进 inline（cover 是 lazy，1200ms 不够时易甩下 WARN）。
     不仅等相框 fit 探针，还要逐张等 .ww-cover 的 inline aspect-ratio 写好；
     离焦点远的 item 用 loading="lazy"，不滚到可能一直不下载。 */
  let framesReady = 0;
  for (let i = 0; i < 40 && framesReady < 4; i++) {
    framesReady = await evalJS(
      `return (window.__wkpFrameFits && Object.keys(window.__wkpFrameFits).length) || 0;`,
    ).catch(() => 0);
    if (framesReady < 4) await sleep(300);
  }
  /* 滚动木马到视口中央触发 lazy load，再等 4 张图全部完成 onLoad */
  await evalJS(`
    const ww = document.querySelector('.ww-wrap, [class*="ww-"]');
    ww && ww.scrollIntoView({ block: 'center' });
  `).catch(() => {});
  let coversLoaded = 0;
  for (let i = 0; i < 60 && coversLoaded < 4; i++) {
    coversLoaded = await evalJS(`
      return [...document.querySelectorAll('.ww-cover img')]
        .filter((img) => img.complete && img.naturalWidth > 0).length;
    `).catch(() => 0);
    if (coversLoaded < 4) await sleep(300);
  }
  warn('木马缩略图加载进度', `${coversLoaded}/4 张已 onLoad`);
  await sleep(600);

  const ww = await evalJS(`
    ${PROBE}
    const withImg = [...document.querySelectorAll('.ww-cover')].filter((c) => c.querySelector('img'));
    /* 4 张 cover 里有些用 loading="lazy"，离视口远就不下载，naturalWidth 一直 0；
       inlineAR 拿不到属于预期，只对已 onLoad 的几张断言。没加载的留 WARN。 */
    const loaded = withImg.filter((c) => {
      const img = c.querySelector('img');
      return img.complete && img.naturalWidth > 0;
    });
    return {
      count: withImg.length,
      loaded: loaded.length,
      fits: withImg.map((c) => fitOf(c.querySelector('img'))),
      veils: withImg.map((c) => veilOf(c)),
      imgFilter: withImg.map((c) => getComputedStyle(c.querySelector('img')).filter),
      staged: document.querySelectorAll('.cover-stage').length,
      covers: loaded.map((c) => {
        const img = c.querySelector('img');
        /* 用 inlineAR 而非 boxAR —— 父级 .ww-item 在 3D 弧上被 rotateX 倾斜，
           容器被投影到屏幕后高度被 cos(angle) 压扁，boxAR 算出来比真实值偏宽；
           inlineAR 读的是 coverAr 写进 style 的原始比例，跨 transform 永远准。 */
        const ar = inlineAR(c);
        const natAR = img.naturalWidth / img.naturalHeight;
        return {
          nat: [img.naturalWidth, img.naturalHeight],
          box: img.getBoundingClientRect().width + '×' + img.getBoundingClientRect().height,
          ar,
          natAR,
          diff: ar != null ? Math.abs(ar - natAR) : null,
        };
      }),
    };
  `);
  if (ww.loaded < ww.count) warn('部分缩略图 lazy 尚未下载', `${ww.loaded}/${ww.count} 张`);
  check('每个缩略图 img 都是 contain', ww.fits.every((f) => f === 'contain'),
    `${ww.count} 张，object-fit=${[...new Set(ww.fits)].join('/')}`);
  check('缩略图没有模糊铺底（::before 空）+ img 自身没被虚化',
    ww.veils.every((v) => v.startsWith('none|')) && ww.imgFilter.every((f) => f === 'none'),
    `${ww.veils[0]} | ${ww.imgFilter[0]}`);
  check('全站已不存在 .cover-stage', ww.staged === 0, `found=${ww.staged}`);
  /* 「完整且铺满」的核心证据：每张已加载缩略图的 inline aspect-ratio = 图片 naturalW/naturalH。
     父级 .ww-item 即使被 3D 旋转 / 缩放，inline 写在 .ww-cover 自己 style 上的比例不变，
     浏览器解析后按这个比例布局容器，contain 在同比例盒子里就是边到边 100% 填充。 */
  check('缩略图 inline aspect-ratio = 图片自然宽高比（完整且铺满）',
    ww.covers.length > 0 && ww.covers.every((c) => c.diff != null && c.diff < 0.005),
    ww.covers.map((c) => `inlineAR=${c.ar?.toFixed(3) ?? '?'} natAR=${c.natAR?.toFixed(3) ?? '?'} Δ=${c.diff?.toFixed(4) ?? '?'} (${c.nat?.join('×') ?? '?'})`).join(' | '));

  /* ---------- 2. 木马相框 ----------
     frameTexture 把窗口比例画成与图片一致：winW/iw === = winH/ih。
     老 cover 语义下 16:9 在 0.85 的竖窗里只剩 47.6% 宽；
     新方案下窗口跟着图走，照片边到边铺满窗口（窗口外的纸色是相框的垫纸）。 */
  const frames = await evalJS(`return window.__wkpFrameFits ? Object.values(window.__wkpFrameFits) : null;`);
  if (!frames) {
    warn('相框 fit 探针（__wkpFrameFits）没拿到，跳过相框检查');
  } else {
    const ratio = (f) => [f[2] / f[0], f[3] / f[1]];   // [winW/iw, winH/ih]
    const aspectPreserved = frames.every((f) => Math.abs(ratio(f)[0] - ratio(f)[1]) < 0.005);
    const windowFitsArea = frames.every((f) => f[2] <= 440.5 && f[3] <= 520.5);
    const crop = frames.map((f) => {
      const [rw, rh] = ratio(f);
      const dw = f[0] * rw, dh = f[1] * rh;
      return `${f[0]}×${f[1]} → ${dw.toFixed(0)}×${dh.toFixed(0)}`;
    });
    check(`木马相框 ${frames.length} 面：窗口比例 = 图片比例（不畸变）`,
      aspectPreserved && windowFitsArea,
      crop.join(' '));
    check('相框窗口落在 440×520 内窗里（不溢出）', windowFitsArea,
      `最大=${frames.map((f) => `${f[2]}×${f[3]}`).join(' ')}`);
  }

  /* ---------- 3. 详情页：首屏 + 飞行层 ---------- */
  const origin = await evalJS(`
    const it = [...document.querySelectorAll('.ww-item')].find((e) => e.querySelector('.ww-cover img'));
    if (!it) return null;
    const r = (it.querySelector('.ww-cover img') ?? it.querySelector('.ww-cover')).getBoundingClientRect();
    it.click();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  `);
  check('从缩略图点开详情页', !!origin);

  let flightSeen = null;
  for (let i = 0; i < 60 && !flightSeen; i++) {
    flightSeen = await evalJS(`
      const tl = window.__wkpFlip;
      const fly = document.querySelector('.wkfly');
      if (!tl || !fly) return null;
      tl.pause(0);
      const a = fly.getBoundingClientRect();
      tl.pause(1);
      const b = fly.getBoundingClientRect();
      const hero = document.querySelector('.wkp-hero-img');
      const hb = hero ? hero.getBoundingClientRect() : null;
      return {
        a: { x: a.left, y: a.top, w: a.width, h: a.height },
        b: { x: b.left, y: b.top, w: b.width, h: b.height },
        hero: hb ? { x: hb.left, y: hb.top, w: hb.width, h: hb.height } : null,
        tag: fly.tagName,
        fit: getComputedStyle(fly).objectFit,
      };
    `).catch(() => null);
    if (!flightSeen) await sleep(20);
  }

  let opened = false;
  for (let i = 0; i < 60; i++) {
    opened = await evalJS(`return !!document.querySelector('.wkp');`).catch(() => false);
    if (opened) break;
    await sleep(250);
  }
  check('详情页已挂载（.wkp）', opened);
  if (!opened) throw new Error('detail page never opened');
  await sleep(2000); // 给首屏图的 onLoad 一点时间写 aspect-ratio

  const hero = await evalJS(`
    ${PROBE}
    const img = document.querySelector('.wkp-hero-img');
    const hd = document.querySelector('.wkp-hero');
    if (!img || !hd) return null;
    return {
      fit: fitOf(img),
      veil: veilOf(hd),
      imgFilter: getComputedStyle(img).filter,
      nat: [img.naturalWidth, img.naturalHeight],
      ar: boxAR(hd),
      arStr: boxAR(hd) != null ? boxAR(hd).toFixed(3) : null,
      heroBox: (() => {
        const r = hd.getBoundingClientRect();
        return r.width + '×' + r.height;
      })(),
      imgBox: (() => {
        const r = img.getBoundingClientRect();
        return r.width + '×' + r.height;
      })(),
    };
  `);
  check('详情页首屏存在（.wkp-hero-img）', !!hero);
  if (hero) {
    /* 2026-09-16 契约更新：4:3 封面（1600×1200）把首屏顶到一屏多高，
       coverAr('.wkp-hero', 16/9) 把容器钳到 16:9，图片交给 object-fit: cover
       居中裁（裁的是天空/海面，标语在画面中部不受影响）。 */
    check('首屏大图是 cover（容器钳 16:9 后由 cover 居中裁）', hero.fit === 'cover', `object-fit=${hero.fit}`);
    check('首屏没有模糊铺底 + img 自身没被虚化',
      hero.veil.startsWith('none|') && hero.imgFilter === 'none', `${hero.veil} | ${hero.imgFilter}`);
    check('首屏容器 aspect-ratio = max(自然比例, 16/9)（竖封面钳到 16:9）',
      hero.ar && hero.nat[0] > 0 &&
        Math.abs(hero.ar - Math.max(hero.nat[0]/hero.nat[1], 16/9)) < 0.005,
      `${hero.arStr} ← ${hero.nat.join('×')}，hero=${hero.heroBox} img=${hero.imgBox}`);
    /* cover/contain 下 img 元素盒子都撑满容器（object-fit 只管绘制），盒子应相等 */
    check('首屏 img 盒子 = hero 盒子（零留白，零裁切）',
      hero.heroBox === hero.imgBox,
      `hero=${hero.heroBox} img=${hero.imgBox}`);
  }

  if (!flightSeen) {
    warn('飞行层（__wkpFlip）没抓到，跳过起飞/落点检查');
  } else {
    const dx = (p, q) => Math.max(
      Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.w - q.w), Math.abs(p.h - q.h),
    );
    check('飞行层是 img 且 object-fit: contain', flightSeen.tag === 'IMG' && flightSeen.fit === 'contain',
      `tag=${flightSeen.tag} object-fit=${flightSeen.fit}`);
    check('飞行层起点 = 缩略图盒子', !!origin && dx(flightSeen.a, origin) <= 2,
      `Δ=${origin ? dx(flightSeen.a, origin).toFixed(2) : 'n/a'}px`);
    check('飞行层终点 = 首屏大图盒子', !!flightSeen.hero && dx(flightSeen.b, flightSeen.hero) <= 2,
      flightSeen.hero ? `Δ=${dx(flightSeen.b, flightSeen.hero).toFixed(2)}px` : '没量到首屏大图');
  }

  /* 详情页里真出现过的媒体封面 */
  const media = await evalJS(`
    ${PROBE}
    const img = document.querySelector('.wkp-media-cover-img');
    const btn = document.querySelector('.wkp-media-cover');
    if (!img) return { none: true };
    return {
      fit: fitOf(img),
      veil: veilOf(btn),
      nat: [img.naturalWidth, img.naturalHeight],
      ar: boxAR(btn),
      arStr: boxAR(btn) != null ? boxAR(btn).toFixed(3) : null,
    };
  `);
  if (media?.none) {
    warn('该项目没有媒体封面（.wkp-media-cover-img），跳过');
  } else if (media) {
    check('媒体封面是 contain', media.fit === 'contain', `object-fit=${media.fit}`);
    check('媒体封面容器 aspect-ratio = 图片比例', media.ar && media.nat[0] > 0 &&
      media.ar && media.nat[0] > 0 && Math.abs(media.ar - media.nat[0]/media.nat[1]) < 0.005,
      `${media.arStr} ← ${media.nat.join('×')}`);
  }

  /* ---------- 4. 注入探针读 CSS 计算值 ---------- */
  const injected = await evalJS(`
    ${PROBE}
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:400px;';
    host.innerHTML = \`
      <div class="cp-card-media"><img id="q1" alt=""></div>
      <div class="works-form-thumb"><img id="q2" alt=""></div>
      <button class="wkp-media-cover"><img id="q3" class="wkp-media-cover-img" alt=""></button>
    \`;
    document.body.appendChild(host);
    const out = {
      cpCard: fitOf(g('#q1')),
      thumb: fitOf(g('#q2')),
      mediaCover: fitOf(g('#q3')),
    };
    function g(s) { return host.querySelector(s); }
    host.remove();
    return out;
  `);
  check('文案卡片封面（.cp-card-media img）是 contain', injected.cpCard === 'contain', injected.cpCard);
  check('后台高光缩略图（.works-form-thumb img）是 contain', injected.thumb === 'contain', injected.thumb);
  check('媒体封面（.wkp-media-cover-img）是 contain', injected.mediaCover === 'contain', injected.mediaCover);

  /* ---------- 5. 源码接线 ---------- */
  const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const wkp = src('./src/components/WorkProjectPage.tsx');
  const wheel = src('./src/components/WorksWheel.tsx');
  const copy = src('./src/components/CopyProjectPage.tsx');
  const detail = src('./src/components/WorkDetail.tsx');
  const scene = src('./src/lib/carousel/carousel-scene.ts');
  const css = src('./src/index.css');
  const helper = src('./src/lib/cover-ar.ts');
  const wiring = [
    ['src/lib/cover-ar.ts 工具存在', helper.includes('coverAr') && helper.includes('aspect-ratio')],
    ['WorksWheel.tsx 调用了 coverAr(.ww-cover)',
      wheel.includes("coverAr('.ww-cover')")],
    ['CopyProjectPage.tsx 调用了 coverAr(.cp-card-media)',
      copy.includes("coverAr('.cp-card-media')")],
    ['WorkProjectPage.tsx 首屏调用了 coverAr(.wkp-hero)',
      /coverAr\('\.wkp-hero'[^)]*\)/.test(wkp)],
    ['WorkProjectPage.tsx 媒体封面调用了 coverAr(.wkp-media-cover)',
      wkp.includes("coverAr('.wkp-media-cover')")],
    ['WorkDetail.tsx 后台高光缩略图调用了 coverAr(.works-form-thumb)',
      detail.includes("coverAr('.works-form-thumb')")],
    ['index.css .wkp-hero 已去掉 min-height、留下 aspect-ratio 兜底',
      !/min-height:\s*min\(88vh/.test(css) && /aspect-ratio:\s*16\s*\/\s*9/.test(css)],
    ['index.css .ww-cover 已去掉 height: 68px、留下 aspect-ratio 兜底',
      !/\.ww-cover[^}]*height:\s*68px/.test(css)],
    ['index.css .cp-card-media 已留下 4/3 兜底（被 onLoad 覆盖）',
      /\.cp-card-media[^}]*aspect-ratio:\s*4\s*\/\s*3/.test(css)],
    ['index.css .works-form-thumb 已是容器类（不是裸 img）',
      /\.works-form-thumb[^}]*aspect-ratio/.test(css) && /\.works-form-thumb img/.test(css)],
    ['index.css 全站已不存在 .cover-stage',
      !css.includes('.cover-stage')],
    ['相框 frameTexture 用宽高配比公式（不写死 440×520）',
      /if \(ar >= AREA_W \/ AREA_H\)/.test(scene)],
    ['相框 frameTexture 不再画模糊底', !/blur\(/.test(scene)],
  ];
  wiring.forEach(([n, ok]) => check(`源码接线 · ${n}`, ok));

  /* ---------- 6. 吹风调小 ---------- */
  const num = (k) => Number((scene.match(new RegExp(`const ${k} = ([\\d.]+)`)) ?? [])[1]);
  const [wb, wg, wf, wSwing, wSpin] =
    ['WIND_BASE', 'WIND_GUST', 'WIND_FREQ', 'WIND_SWING', 'WIND_SPIN'].map(num);
  check('风力已调小（BASE 0.55→0.25 / GUST 0.45→0.20）', wb === 0.25 && wg === 0.2,
    `BASE=${wb} GUST=${wg}`);
  check('摆幅已调小（SWING 0.22→0.10 / SPIN 0.14→0.06）', wSwing === 0.1 && wSpin === 0.06,
    `SWING=${wSwing} SPIN=${wSpin}`);
  check('WIND_FREQ 保持 2.0（高于 2.6 弹簧会把摆幅滤掉）', wf === 2.0, `FREQ=${wf}`);
} catch (err) {
  check('脚本无异常', false, err.message);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  edge.kill();
  await sleep(200);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log('失败项:');
    failed.forEach((f) => console.log(`  · ${f.name}${f.detail ? ' — ' + f.detail : ''}`));
  }
  process.exit(failed.length ? 1 : 0);
}