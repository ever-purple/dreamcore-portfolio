/**
 * 报刊亭视频页（MediaGalleryPage）滚动行为回归 —— 2026-09-21 用户反馈三条的自动化验证。
 *
 * 覆盖：
 *   A  静止态：**只露左边**（左邻 opacity≈0.34）、**右边藏起来**（opacity≈0 且 pointer-events:none）
 *   B  滚动中途的弯曲：弧顶朝**屏幕中心**（下滑→右边鼓 / 上滑→左边鼓），远处那张几乎不弯
 *   C  手势粒度：一次"推"最多换一条 —— 4 格滚轮不换、20 格也只换 1（防惯性连跳）
 *   D  悬停当前卡：画面放大 ~11%（照参考站 uv=scale(uv,0.1*uHover)），且**不得**有播放徽标
 *   E  换片时"幽灵标题"脱流盖在同一位置（position:absolute + 与真标题纵向重叠 + 不占高度）
 *      —— 2026-09-21 曾漏写这条 CSS，幽灵层把真标题顶下去一行，所以固化进来
 *   F  过渡途中影片不许"变白"：所有可见卡片 opacity 必须 ≈1（半透明压白底 = 发灰发白）
 *
 * 用法：先 `npm run dev`（端口 4177），再 `node verify-media-gallery.mjs`
 *   ⚠️ 脚本会**自己 spawn 无头 Edge**（PowerShell/终端里 Start-Process 起的会在工具调用结束时被回收，
 *      表现是 CDP 端口 ECONNREFUSED）。跑完自己 kill。
 *   ⚠️ 滚轮必须用**页面内合成 WheelEvent 同步连发**：CDP 的 Input.dispatchMouseEvent 每次往返 >100ms，
 *      会被 BURST_MS=160 切成"多次手势"，测不出"同一推只换一条"（实测 15 次派发被当成 8 次手势）。
 *   ⚠️ 无头 rAF 被节流到 ~1.6fps，落位要**轮询**（settle()），sleep 固定时长会读到半路的值。
 *
 * 依赖 dev-only 钩子 `window.__mjpCards()`（见 MediaGalleryPage 里的 dev 块）。
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9333;
const URL = 'http://127.0.0.1:4177/?studio=1&media=1&channel=landscape&motion=full';
const EDGE = process.env.EDGE || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p)) || 'msedge';
const OUT = process.env.SHOT_DIR || tmpdir();
const PROFILE = join(tmpdir(), 'mjp-edge-profile');

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--mute-audio',
  // 下面这几条是对付无头节流的（不然 rAF ≈1.6fps，落位要等半分钟）
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
  '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${PROFILE}`, 'about:blank'],
{ detached: true, stdio: 'ignore' });
edge.unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map(); let sid = null; const errors = [];
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
/** 页面内同步连发 n 次滚轮 —— 这才等价于"一次手势" */
const burst = (n, dy) =>
  evalJS(`(() => { for (let i = 0; i < ${n}; i++) window.dispatchEvent(new WheelEvent('wheel', { deltaY: ${dy}, deltaMode: 0, cancelable: true })); return 1; })()`);
const scroll = () => evalJS('window.__mjpCards().scroll');
const cards = () => evalJS(`(() => { const s = window.__mjpCards();
  return s.cards.filter((c) => Math.abs(c.off) < 1.4).map((c) => ({ off: +c.off.toFixed(2), bend: +c.bend.toFixed(3), apex: +c.apex.toFixed(3) })); })()`);
async function settle(timeoutMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    const s = await scroll();
    /* ⚠️ 容差不能放松到 0.01（2026-09-21 踩过）：lerp(0.1) 收敛到最后会出现
       `current = 10.9905` 这种"差 0.0095"的状态，0.01 的容差会把它当成已落定，
       而此时 opacity 的 settle 门（1 − bulge/0.3）只走到 0.937 —— 邻格读到 0.38/0.06
       而不是 0.34/0，把 A2 误判成失败。收紧到 0.004，同时要求 bulge 真的贴 0。 */
    if (Math.abs(s.current - Math.round(s.current)) < 0.004) return s;
    if (Date.now() - t0 > timeoutMs) return s;
    await sleep(400);
  }
}
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 }, sid);
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
};
const rest = () => evalJS(`(() => {
  const cs = [...document.querySelectorAll('.mjp__media')];
  const cur = cs.findIndex((c) => c.classList.contains('is-current'));
  const op = (i) => (cs[i] ? +cs[i].style.opacity : null);
  const pe = (i) => (cs[i] ? cs[i].style.pointerEvents || '(default)' : null);
  return { cur, curOp: op(cur), left: op(cur - 1), right: op(cur + 1), rightPE: pe(cur + 1),
           title: document.querySelector('.mjp__info__title')?.textContent,
           cards: cs.length, ticker: document.querySelector('.mjp__ticker')?.innerText.replace(/\\s+/g, ''),
           posters: [...new Set([...document.querySelectorAll('video')].map((v) => (v.poster || '').split('/').pop()))].filter(Boolean) };
})()`);

const results = [];
const check = (name, ok, extra = {}) => {
  results.push({ name, ok });
  console.log(JSON.stringify({ case: name, ...extra, ok }));
};

(async () => {
  let ver;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { ver = await r.json(); break; } } catch { /* 还没起来 */ }
    await sleep(500);
  }
  if (!ver) throw new Error('CDP 起不来（Edge spawn 失败？）');
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    if (m.method === 'Runtime.exceptionThrown' && m.sessionId === sid) errors.push((m.params.exceptionDetails.exception?.description || 'ex').slice(0, 200));
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  sid = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Page.enable', {}, sid); await send('Runtime.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: URL }, sid);
  await sleep(8000);

  // ---- A. 静止态：左露右藏 ----
  const a = await rest();
  check('A-rest-left-peek-only', a.curOp === 1 && a.left > 0.3 && a.right < 0.05 && a.rightPE === 'none', a);
  await shot('_mjp-rest.jpg');

  // ---- C. 一次手势最多一条 ----
  await settle();
  const b0 = (await scroll()).base;
  await burst(4, 100);                       // 400 < 500：不该换
  await sleep(400);
  const b1 = (await scroll()).base;
  await burst(20, 100);                      // 2000 = 4 格，同一推 → 只换 1
  await sleep(400);
  const b2 = (await scroll()).base;
  const b3 = (await settle()).base;
  check('C-one-scroll-one-item', b1 === b0 && b2 === b0 + 1 && b3 === b2,
    { b0, after4notches: b1, after20notches: b2, settled: b3 });

  // ---- B. 中途弯曲：弧顶朝屏幕中心 + 远处不弯 ----
  await burst(3, 100);                       // 300 = 半程（凸起但不换）
  await sleep(200);
  const mid = await cards();
  await shot('_mjp-mid.jpg');
  const toward = mid.filter((c) => Math.abs(c.off) > 0.05 && Math.abs(c.off) < 1.3)
    .every((c) => (c.off > 0 ? c.apex < -0.02 : c.apex > 0.02));
  const farFlat = mid.filter((c) => Math.abs(c.off) > 1).every((c) => c.bend < 0.2);
  check('B-bulge-toward-center', toward && farFlat, { cards: mid, towardCenter: toward, farFlat });
  await settle();

  // ---- A2. 落位后右邻重新藏好 ----
  const a2 = await rest();
  check('A2-rest-again-hidden', a2.right < 0.05 && a2.rightPE === 'none', a2);

  // ---- D. 悬停当前卡：画面放大 ~11%（照参考站 uv=scale(uv, 0.1*uHover)）----
  /* ⚠️ headless 里 `Input.dispatchMouseEvent({type:'mouseMoved'})` **触发不了 CSS :hover**
     （实测 hovered=false）—— 必须走 CDP 的 `CSS.forcePseudoState` 强制伪类。
     ⚠️ 这里**不再校验播放徽标**：那枚圆形播放键已于 2026-09-21 按用户要求删掉
       （「不要这个播放键」）。参考站 hover 的唯一反馈就是画面放大，所以徽标若又出现，
       应该由下面"徽标不该存在"这一条直接判失败。 */
  {
    let d;
    try {
      await send('DOM.enable', {}, sid);
      await send('CSS.enable', {}, sid);
      const { root } = await send('DOM.getDocument', { depth: 1 }, sid);
      const { nodeId } = await send('DOM.querySelector',
        { nodeId: root.nodeId, selector: '.mjp__media.is-current' }, sid);
      if (!nodeId) d = { skip: '没找到 .mjp__media.is-current' };
      else {
        await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] }, sid);
        await sleep(1100); // 等 transition 走完（canvas transform 0.8s）
        d = await evalJS(`(() => {
          const c = document.querySelector('.mjp__media.is-current');
          const cv = c?.querySelector('.mjp__media-canvas');
          const tr = cv ? getComputedStyle(cv).transform : 'none';
          let scale = null;
          if (tr && tr !== 'none') { const m = new DOMMatrixReadOnly(tr); scale = +Math.hypot(m.a, m.b).toFixed(3); }
          return { hovered: !!c?.matches(':hover'),
                   canvasScale: scale, canvasTransform: tr,
                   badgeCount: document.querySelectorAll('.mjp__media-play').length };
        })()`);
        // 画面被放大（1.05~1.2 都算"照参考站放大了"）+ 播放键必须不存在
        d.ok = d.hovered && d.canvasScale > 1.05 && d.canvasScale < 1.2 && d.badgeCount === 0;
        // 撤掉强制伪类，别影响后面的用例
        await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }, sid);
        await sleep(300);
      }
    } catch (err) { d = { skip: 'forcePseudoState 不可用: ' + err.message }; }
    check('D-hover-canvas-zoom-no-badge', d.ok === true, d);
  }

  // ---- E. 换片时"幽灵标题"必须**脱流**盖在同一位置（本轮曾漏写这条 CSS，把标题顶下去一行）----
  /* 判据（不依赖动画时序）：
       ① 幽灵层 computed position = absolute（脱流）；
       ② 幽灵层与真标题**纵向重叠**（同一位置，而不是被挤到下一行）；
       ③ 幽灵在时 .mjp__info 的 offsetHeight 与落定后一致（没占高度）。
     ⚠️ 不要拿 .mjp__info__len 的 rect.top 做前后对比：信息块自己挂着 --speed 位移
       （滚动时会晃 ±7px），换片瞬间一定有位移，那不是"被顶下去"。 */
  {
    await settle();
    const titleBefore = await evalJS(`document.querySelector('.mjp__info__title:not(.mjp__info__title--ghost)')?.textContent`);
    await burst(20, 100);                    // 提交一格 → 触发标题入场 + 旧标题出场
    /* ⚠️ 别用固定 `sleep(450)` 去读幽灵层（2026-09-21 踩过）：无头下 rAF / 定时器被节流到
       ~2.5Hz（实测页面内 setInterval(16ms) 在 2600ms 里只跑了 6 次），于是 lerp(0.1) 要
       走 7 帧才越过取整阈值 —— **标题真正换掉发生在 2.6s 之后**，450ms 时读到的还是"没换片"。
       实测证据：那个时刻 `.mjp__info__title--ghost` 确实存在于 DOM（ghostText = 旧标题）。
       所以这里改成**轮询等它出现**（最多 ~10s）。 */
    const probeGhost = () => evalJS(`(() => {
      const info = document.querySelector('.mjp__info');
      const ghost = document.querySelector('.mjp__info__title--ghost');
      const title = document.querySelector('.mjp__info__title:not(.mjp__info__title--ghost)');
      if (!ghost || !title) return { ghostPresent: false };
      const gb = ghost.getBoundingClientRect(), tb = title.getBoundingClientRect();
      return { ghostPresent: true,
               pos: getComputedStyle(ghost).position,
               hWithGhost: info ? info.offsetHeight : null,
               overlapY: Math.min(gb.bottom, tb.bottom) - Math.max(gb.top, tb.top),
               dLeft: +Math.abs(gb.left - tb.left).toFixed(1),
               dTop: +Math.abs(gb.top - tb.top).toFixed(1),
               charCount: title.querySelectorAll('.mjp__info__char').length,
               ghostCharCount: ghost.querySelectorAll('.mjp__info__char').length,
               ghostText: ghost.textContent,
               titleText: title.textContent };
    })()`);
    let e = { ghostPresent: false };
    for (let i = 0; i < 36; i += 1) {
      e = await probeGhost();
      if (e.ghostPresent) break;
      await sleep(280);
    }
    const s2 = await settle();
    const hAfter = await evalJS(`document.querySelector('.mjp__info')?.offsetHeight`);
    const titleAfter = await evalJS(`document.querySelector('.mjp__info__title:not(.mjp__info__title--ghost)')?.textContent`);
    /* 换片后标题必须**真的变了** —— 2026-09-21 用 SplitText 时踩过：它改写 React 管的 DOM，
       导致标题永远停在第一条（切到第 10 条还是第 9 条的字），而入场动画照跑，极难发现。 */
    const titleChanged = !!titleBefore && !!titleAfter && titleBefore !== titleAfter;
    if (!e.ghostPresent) {
      /* 幽灵层必须出现（动画 1s / 兜底 1600ms 才卸载，且无头下还会被拉长）。
         它缺席只说明一件事：VideoInfo 被重新挂载了（`key={current.id}` 又加回来了），
         于是出场动画整段是死代码。这正是本用例要守住的回归。 */
      check('E-title-ghost-out-of-flow', false,
        { ...e, titleChanged, note: '幽灵层缺席 → VideoInfo 很可能又被 key 重新挂载了' });
    } else {
      const ok = e.pos === 'absolute' && e.hWithGhost === hAfter && e.overlapY > 0 && e.dTop < 12
        && titleChanged && e.charCount > 0 && e.ghostCharCount > 0
        && e.ghostText === titleBefore;
      check('E-title-ghost-out-of-flow', ok,
        { ...e, hAfter, settled: s2.current, titleBefore, titleAfter, titleChanged });
    }
  }

  // ---- F. 过渡途中影片不许"变白"----
  /* 判据：中途所有**真的看得见**的卡片（与视口水平重叠 > 40px）opacity 必须 ≈1。
     半透明压在**白底**上就是"画面发灰发白"（2026-09-21 用户：「滚动过渡时影片不要变白」）。
     起因是上一版把压暗剖面直接按 |off| 算，而 |off| 在过渡途中本来就会离开 0
     （走半格时原来那条的 off 就是 −0.5）→ 正在飞的两张一起掉到 ~0.67。
     ⚠️ 判据要看 opacity 而不是 filter：filter 那层是 `brightness(0.6)`（**压暗**），
        方向固定、和底色无关；会随底色变化的是 opacity。 */
  {
    await settle();
    await burst(20, 100);                    // 提交一格，进入过渡
    let f = null;
    for (let i = 0; i < 120; i += 1) {
      const s = await evalJS(`(() => {
        const st = window.__mjpCards();
        const mx = st.cards.reduce((a, c) => (c.bend > a.bend ? c : a), { bend: -1 });
        const vw = window.innerWidth;
        const vis = [...document.querySelectorAll('.mjp__media')].map((el, i) => {
          const b = el.getBoundingClientRect();
          const visW = Math.round(Math.max(0, Math.min(b.right, vw) - Math.max(b.left, 0)));
          return { i, off: +(i - st.scroll.current).toFixed(2),
                   op: +(+el.style.opacity || 0).toFixed(3), visW };
        }).filter((x) => x.visW > 40);
        return { maxBend: +mx.bend.toFixed(3), vis };
      })()`);
      if (s.maxBend >= 0.6) { f = s; break; }
      await sleep(60);
    }
    if (!f) check('F-no-white-out-mid-transition', false, { note: '没采到 bulge≥0.6 的过渡帧' });
    else {
      const minOp = f.vis.length ? Math.min(...f.vis.map((v) => v.op)) : null;
      const ok = f.vis.length > 0 && f.vis.every((v) => v.op >= 0.95);
      check('F-no-white-out-mid-transition', ok,
        { maxBend: f.maxBend, minVisibleOpacity: minOp, visible: f.vis });
    }
    await settle();
  }

  check('Z-no-console-error', errors.length === 0, { errors: errors.slice(0, 3) });
  const bad = results.filter((r) => !r.ok).map((r) => r.name);
  console.log(bad.length ? `\nFAILED: ${bad.join(', ')}` : '\nALL PASS');
  console.log(`截图：${OUT}/_mjp-rest.jpg / _mjp-mid.jpg`);
  ws.close();
  try { process.kill(edge.pid); } catch { /* 已退出 */ }
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); try { process.kill(edge.pid); } catch {} process.exit(1); });
