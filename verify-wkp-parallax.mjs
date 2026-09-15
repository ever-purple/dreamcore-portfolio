/**
 * 左栏视差（⑧）+ reduced-motion 降级 的双态回归。
 * 用法: node verify-wkp-parallax.mjs <mode>   mode = full | reduced
 *   full    = 模拟"系统动画效果开启"：断言完整幅度（ghost ±70 / 内容层 8~22 / brand ±5）
 *   reduced = 模拟"系统动画效果关闭"：断言**仍然是完整幅度**（策略：忽略 reduce）
 * 入口 deep link: ?works=1#about（#about 让 App 落在 studio，否则 ?works 没人读）
 * 直接连 CDP，不装依赖（Node 22 自带 WebSocket）。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODE = process.argv[2] === 'reduced' ? 'reduced' : 'full';
const RM = MODE === 'full' ? 'no-preference' : 'reduce';
/* #about 让 App 直接落在 studio（StudioSection 才读 ?works）；不加 hash 会停在首页。
   两个参数一起用：?works=1 打开木马浮层，#about 跳过首页。 */
const URL_ = 'http://127.0.0.1:4180/?works=1#about';
const PORT = MODE === 'full' ? 9333 : 9334;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = mkdtempSync(join(tmpdir(), 'edge-rail-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

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
let session;   // attach 拿到的 sessionId；所有 Page/Runtime 指令都走它
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
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

try {
  // ---- 连 browser 端点，再 attach 到 page（headless=new 下直连 page 端点会报
  //      "Not attached to an active page"，必须带 sessionId 走） ----
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
  // 关键：强制媒体特性（本机系统是 reduce，必须显式覆盖才能测另一态）
  await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: RM }] });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await send('Page.navigate', { url: URL_ });
  await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  // 导航后再压一次（override 有时会在导航时被丢掉，丢了就等于测了系统默认态）
  await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: RM }] }).catch(() => {});

  // 媒体态确认
  const mq = await evalJS(`return matchMedia('(prefers-reduced-motion: reduce)').matches;`).catch(() => null);
  await sleep(500);
  const mq2 = await evalJS(`return matchMedia('(prefers-reduced-motion: reduce)').matches;`);
  check(`媒体态 = ${MODE}`, mq2 === (MODE === 'reduced'), `reduce=${mq2} (探测初值 ${mq})`);

  // ---- 等木马 → 点开详情 ----
  let opened = false;
  for (let i = 0; i < 120; i++) {
    const state = await evalJS(`
      const items = [...document.querySelectorAll('.ww-item')].filter(e=>!e.classList.contains('is-empty'));
      if (!items.length) return { ready:false };
      if (!document.querySelector('.wkp')) { items[0].click(); return { ready:true, clicked:true }; }
      return { ready:true, clicked:false, wkp:true };
    `).catch(() => ({ ready: false }));
    if (state.wkp) { opened = true; break; }
    await sleep(500);
  }
  if (!opened) {
    for (let i = 0; i < 40; i++) {
      const has = await evalJS(`return !!document.querySelector('.wkp');`).catch(() => false);
      if (has) { opened = true; break; }
      await sleep(500);
    }
  }
  check('详情页已打开（.wkp 挂载）', opened);
  if (!opened) {
    const diag = await evalJS(`
      const q = (s) => document.querySelectorAll(s).length;
      const t = (s) => document.querySelector(s)?.textContent?.trim().slice(0,120) ?? null;
      return { ready: document.readyState, url: location.href,
        items: q('.ww-item'), overlay: q('.works-overlay'), wkp: q('.wkp'), canvas: q('canvas'),
        err: t('.works-error'), hint: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,300) };
    `).catch((e) => ({ evalError: e.message }));
    console.log('诊断:', JSON.stringify(diag));
    throw new Error('detail page never opened');
  }

  // 等入场结束 + 探针就绪
  await sleep(1800);
  const hooks = await evalJS(`
    const p = window.__wkpPar || [];
    return { lenis: !!window.__wkpLenis, layers: p.length, kinds: p.map(x=>x.kind) };
  `);
  check('Lenis 已启动（reduced 下也必须起）', hooks.lenis === true, `__wkpLenis=${hooks.lenis}`);
  check('视差层探针有左栏轨道', hooks.kinds.filter((k) => k.startsWith('rail-')).length >= 6,
    hooks.kinds.filter((k) => k.startsWith('rail-')).join(','));

  // ---- 预滚动：**分步 + 每步等一等**，把懒加载图全部唤醒。
  //      一步到底的做法（同 tick 里连设 11 次 scrollTop）不会触发懒加载解码，
  //      scrollHeight 会在采样途中从 6550 长到 13071，所有 p 的坐标全是错的。 ----
  let prevH = 0;
  for (let round = 0; round < 6; round++) {
    for (let i = 0; i <= 12; i++) {
      await evalJS(`
        const el = document.querySelector('.wkp-scroll');
        const max = el.scrollHeight - el.clientHeight;
        const y = Math.round(max * ${i} / 12);
        if (window.__wkpLenis) window.__wkpLenis.scrollTo(y, { immediate: true }); else el.scrollTop = y;
        return y;
      `);
      await sleep(180);
    }
    const h = await evalJS(`return document.querySelector('.wkp-scroll').scrollHeight;`);
    if (h === prevH) break;
    prevH = h;
  }
  for (let i = 0; i < 40; i++) {
    const pending = await evalJS(`return [...document.querySelectorAll('.wkp-scroll img')].filter((im) => !im.complete).length;`).catch(() => 0);
    if (pending === 0) break;
    await sleep(400);
  }
  const stable = await evalJS(`
    const el = document.querySelector('.wkp-scroll');
    return { h: el.scrollHeight, max: el.scrollHeight - el.clientHeight };
  `);
  console.log('预加载后 scrollHeight =', stable.h, ' max =', stable.max);

  // ---- 采样 ----
  const sample = async (p) => evalJS(`
    const el = document.querySelector('.wkp-scroll');
    const max = el.scrollHeight - el.clientHeight;
    const y = Math.round(max * ${p});
    if (window.__wkpLenis) window.__wkpLenis.scrollTo(y, { immediate: true });
    else el.scrollTop = y;
    const tf = (sel) => {
      const e = document.querySelector(sel); if (!e) return null;
      const m = new DOMMatrixReadOnly(getComputedStyle(e).transform);
      return { tx: +m.m41.toFixed(2), ty: +m.m42.toFixed(2) };
    };
    const rect = (sel) => { const e=document.querySelector(sel); if(!e) return null; const r=e.getBoundingClientRect(); return { t:+r.top.toFixed(1), b:+r.bottom.toFixed(1) }; };
    return {
      p: ${p}, y: Math.round(el.scrollTop), max,
      rail: {
        ghost: tf('.wkp-rail-ghost'), top: tf('.wkp-rail-top'), brand: tf('.wkp-brand'),
        intro: tf('.wkp-intro-wrap'), nav: tf('.wkp-nav'), meta: tf('.wkp-rail .wkp-meta'),
        foot: tf('.wkp-rail-foot'),
      },
      right: { grid: tf('.wkp-par-grid'), band: tf('.wkp-band-text'), figs: tf('.wkp-figs') },
      rects: {
        top: rect('.wkp-rail-top'), intro: rect('.wkp-intro-wrap'), nav: rect('.wkp-nav'),
        meta: rect('.wkp-rail .wkp-meta'), foot: rect('.wkp-rail-foot'),
      },
      scrollH: el.scrollHeight, clientH: el.clientHeight,
      docW: document.documentElement.scrollWidth, winW: window.innerWidth,
    };
  `);
  // 采样前先把 Lenis 停在目标点（上面用了 immediate）
  const wait = () => sleep(700);
  const S = [];
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    S.push(await sample(p));
    await wait();
  }
  // 重采样一次（immediate 后位置可能被 Lenis 内插微量修正）
  const S2 = [];
  for (const p of [0, 1]) {
    S2.push(await sample(p));
    await wait();
  }
  const first = S2[0], last = S2[1];
  console.log('\n采样:', JSON.stringify(S.map((s) => ({ p: s.p, y: s.y, rail: s.rail, right: s.right })), null, 0).slice(0, 1200));

  // ---- 断言：左栏每一层都真的动了，幅度符合预期 ----
  /* 2026-09-16 策略变更：全站忽略 reduce（src/lib/motion-pref.ts）。
     所以 **两种模式都断言完整幅度** —— reduced 模式跑通，就等于证明了
     "系统关着动画时也拿满效果"这条需求真的落地了。 */
  const K = 1;
  const exp = { ghost: -140, top: 16, intro: 26, nav: 36, meta: 44, foot: 24 };
  const railKeys = { ghost: 'ghost', top: 'top', intro: 'intro', nav: 'nav', meta: 'meta', foot: 'foot' };
  for (const [k, want] of Object.entries(exp)) {
    const a = first.rail[railKeys[k]], b = last.rail[railKeys[k]];
    if (!a || !b) { check(`左栏 ${k} 存在`, false); continue; }
    const d = +(b.ty - a.ty).toFixed(2);
    const target = want * K;
    const ok = Math.abs(d - target) <= Math.max(1.5, Math.abs(target) * 0.15);
    check(`左栏 ${k} 位移 = ${target.toFixed(1)}px`, ok, `实测 Δy=${d}`);
  }
  {
    const d = +(last.rail.brand.tx - first.rail.brand.tx).toFixed(2);
    const target = 10 * K;
    check(`左栏 brand 横向位移 = ${target.toFixed(1)}px`, Math.abs(d - target) <= Math.max(1.2, Math.abs(target) * 0.2), `实测 Δx=${d}`);
  }
  check('左栏 ghost 与内容层反向（纵深成立）',
    Math.sign(last.rail.ghost.ty - first.rail.ghost.ty) === -Math.sign(last.rail.nav.ty - first.rail.nav.ty),
    `ghost Δ=${(last.rail.ghost.ty - first.rail.ghost.ty).toFixed(1)}  nav Δ=${(last.rail.nav.ty - first.rail.nav.ty).toFixed(1)}`);

  // 右栏老效果未回归（网格是"背景层"：跟滚动反向滞后 → 向下走，Δy 为正）
  const rg = +(last.right.grid.ty - first.right.grid.ty).toFixed(1);
  const rb = +(last.right.band.ty - first.right.band.ty).toFixed(1);
  const rf = +(last.right.figs.ty - first.right.figs.ty).toFixed(1);
  check('右栏网格视差仍在（背景层 → 随滚动下移）', rg > 100, `Δy=${rg}`);
  check('右栏大字层视差仍在（大字层 → 上浮，与背景反向）', rb < -40 * K, `Δy=${rb}`);
  check('右栏卡片层视差仍在', Math.abs(rf) > 2, `Δy=${rf}`);

  // ---- 断言：左栏块不互撞 ----
  let worst = Infinity, worstP = null;
  for (const s of [...S, ...S2]) {
    const order = ['top', 'intro', 'nav', 'meta', 'foot'];
    for (let i = 0; i < order.length - 1; i++) {
      const a = s.rects[order[i]], b = s.rects[order[i + 1]];
      if (!a || !b) continue;
      const gap = b.t - a.b;
      if (gap < worst) { worst = gap; worstP = `${order[i]}→${order[i + 1]} @p=${s.p}`; }
    }
  }
  check('左栏相邻块不重叠', worst >= -0.5, `最小间隔 ${worst.toFixed(1)}px (${worstP})`);

  // ---- 断言：不产生额外滚动 ----
  const heights = [...S, ...S2].map((s) => s.scrollH);
  check('右栏 scrollHeight 全程不变', new Set(heights).size === 1, `值=${[...new Set(heights)].join('/')}`);
  const horiz = [...S, ...S2].every((s) => s.docW <= s.winW + 1);
  check('无横向滚动', horiz, S.map((s) => `${s.docW}/${s.winW}`).join(' '));

  // ---- 断言：CSS 降级是否按模式生效 ----
  const css = await evalJS(`
    const g = (sel, prop) => { const e=document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; };
    return { railT: g('.wkp-rail','transitionProperty'), innerT: g('.wkp-inner','transitionProperty'), ghostColor: g('.wkp-rail-ghost','color') };
  `);
  check('.wkp-inner 走完整过渡（opacity + transform，reduce 下也一样）',
    /opacity/.test(css.innerT || '') && /transform/.test(css.innerT || ''), `transitionProperty=${css.innerT}`);

  // ---- 丝滑度拆成两问：① Lenis 的帧循环有没有驱到 scrollTop；② 滚轮有没有被它接住 ----
  const env = await evalJS(`
    const el = document.querySelector('.wkp-scroll');
    const chain = []; let n = el;
    while (n && n !== document.documentElement) {
      chain.push(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\\s+/).join('.') : '') + (n.hasAttribute('data-lenis-prevent') ? ' [lenis-prevent]' : '') + (n.hasAttribute('data-lenis-prevent-wheel') ? ' [lenis-prevent-wheel]' : ''));
      n = n.parentElement;
    }
    const L = window.__wkpLenis;
    return { chain,
      smoothWheel: L?.options?.smoothWheel ?? null, duration: L?.options?.duration ?? null,
      isSmooth: L?.isSmooth ?? null, wrapper: L?.options?.wrapper?.className ?? null };
  `);
  console.log('滚动列祖先链:\n  ' + env.chain.join('\n  '));
  console.log('lenis:', JSON.stringify({ smoothWheel: env.smoothWheel, duration: env.duration, isSmooth: env.isSmooth, wrapper: env.wrapper }));
  check('Lenis 参数是完整版（smoothWheel + 1.15s + 包在右栏上）',
    env.smoothWheel === true && typeof env.wrapper === 'string' && env.wrapper.includes('wkp-scroll')
      && Math.abs((env.duration ?? 0) - 1.15) < 0.001,
    `smoothWheel=${env.smoothWheel} duration=${env.duration} wrapper=${env.wrapper}`);

  /* ⚠️ 不要用「CDP 往返采样 scrollTop」判断丝滑度：一次 Runtime.evaluate 往返就有
     10~30ms 抖动，900px 的滚动会看着"一帧就到"，把 Lenis 的缓出误判成瞬跳。
     正确做法：在页面里装一个 16ms 的 recorder，事件派发后一口气取回整条逐帧曲线。 */
  const recordScroll = async (dispatchWheel) => {
    await evalJS(`
      const el = document.querySelector('.wkp-scroll');
      if (window.__wkpLenis) window.__wkpLenis.scrollTo(0, { immediate: true }); else el.scrollTop = 0;
      window.__rec = [];
      return 1;
    `);
    await sleep(800);
    await evalJS(`
      window.__rec = [];
      const el = document.querySelector('.wkp-scroll');
      const t0 = performance.now();
      const id = setInterval(() => { window.__rec.push([Math.round(performance.now() - t0), Math.round(el.scrollTop)]); }, 16);
      setTimeout(() => clearInterval(id), ${dispatchWheel ? 2200 : 1600});
      return 1;
    `);
    if (dispatchWheel) {
      const box = await evalJS(`
        const r = document.querySelector('.wkp-scroll').getBoundingClientRect();
        return { x: Math.round(r.left + r.width * 0.6), y: Math.round(r.top + r.height * 0.5) };
      `);
      /* ⚠️ 必须先 mouseMoved 把 hover 目标落在滚动容器上：headless 里没有真实的指针位置，
         直接发 wheel 时事件可能落在 body 上，Lenis 收不到 —— 表现为"偶发滚不动"。 */
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, pointerType: 'mouse' });
      await sleep(120);
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 900, pointerType: 'mouse' });
      await sleep(2400);
    } else {
      await evalJS(`window.__wkpLenis && window.__wkpLenis.scrollTo(1200, { duration: 1.2 }); return 1;`);
      await sleep(1800);
    }
    return evalJS(`return window.__rec;`);
  };
  const analyze = (rec) => {
    const vals = rec.map((r) => r[1]);
    const final = Math.max(...vals, 0);
    const t95 = rec.find((r) => r[1] >= final * 0.95)?.[0] ?? null;
    return { n: rec.length, final, t95, distinct: new Set(vals).size, head: rec.slice(0, 8).map((r) => r[1]).join(',') };
  };

  /* ⚠️ headless 会把 rAF/定时器降频（测出来成块跳变、1.6s 只有十几帧），
     所以这里只能断言"整段耗时够长 + 有中间值"，逐帧密度不做要求 ——
     真正的硬证据是下面那个 stop() 拦截判定。 */
  /* 补间密度**不作为断言**：headless 会把 setInterval/rAF 降频到几百毫秒一档，
     实测曲线只剩 1~3 个台阶，看着像"瞬跳"其实是环境假象（同一份代码前台跑是 60fps）。
     Lenis 是否真的在接管，由下面两条确定性的判定负责：滚轮耗时够长 + stop() 后滚不动。 */
  const tweenRec = await recordScroll(false);
  const tw = analyze(tweenRec);
  console.log(`[信息] Lenis 补间实测: 帧=${tw.n} 独立值=${tw.distinct} 终值=${tw.final} 到95%用时=${tw.t95}ms（帧密度不可信，headless 降频）`);

  let wheelRec = await recordScroll(true);
  let wh = analyze(wheelRec);
  for (let att = 0; att < 2 && !(wh.final > 100); att++) {
    console.log(`[重试] 滚轮第 ${att + 1} 次没滚动（终值=${wh.final}），重发一次`);
    wheelRec = await recordScroll(true);
    wh = analyze(wheelRec);
  }
  check('滚轮滚动是缓动过程（非瞬跳）', wh.final > 100 && wh.t95 !== null && wh.t95 >= 250,
    `帧=${wh.n} 独立值=${wh.distinct}(headless 降频) 终值=${wh.final} 到95%用时=${wh.t95}ms 值序列=${wh.head}`);

  // 拦截判定：lenis.stop() 之后滚轮应当**完全无效**（说明事件被 Lenis 吃掉，不是浏览器原生滚）
  await evalJS(`
    const el = document.querySelector('.wkp-scroll');
    if (window.__wkpLenis) { window.__wkpLenis.scrollTo(0, { immediate: true }); window.__wkpLenis.stop(); }
    return 1;
  `);
  await sleep(700);
  const box2 = await evalJS(`
    const r = document.querySelector('.wkp-scroll').getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.6), y: Math.round(r.top + r.height * 0.5) };
  `);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box2.x, y: box2.y, deltaX: 0, deltaY: 900, pointerType: 'mouse' });
  await sleep(900);
  const afterStop = await evalJS(`return Math.round(document.querySelector('.wkp-scroll').scrollTop);`);
  await evalJS(`window.__wkpLenis?.start(); return 1;`);
  check('滚轮被 Lenis 拦截（stop() 后滚不动 = 非原生滚动）', afterStop === 0, `stop 后 scrollTop=${afterStop}`);

  console.log(`\n===== ${MODE.toUpperCase()} 汇总: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.log('未通过:', failed.map((f) => f.name).join(' | '));
} catch (e) {
  console.error('脚本异常:', e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  edge.kill();
  await sleep(600);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  process.exit(process.exitCode || 0);
}
