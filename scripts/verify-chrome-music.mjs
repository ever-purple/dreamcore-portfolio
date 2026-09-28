/**
 * 回归测试（无头 Edge + CDP）：统一外壳的字族/大小写 + 工作室音乐的淡出行为
 *                              + 字族统一 + 铺满屏的饱和色 + 画面层调色滤镜。
 *
 * 覆盖 2026-09-16 两批改动：
 *   第一批（听感 / 截图反馈）
 *     ① Menu / Close 大小写一致（Title Case）
 *     ② `My Studio` 的字族不再落 Cinzel（与 Menu 同一支笔 → Caveat）
 *     ③ 进子页面 = 3.4s 幂曲线淡出（不再"压低听"、也不再"前半秒就没了"）；视频页 = pause
 *   第二批（用户："字体统一" / 大字那个颜色不好看 / 加日剧调色滤镜）
 *     ④ 字族三族制落地：屏幕外英文一律 Caveat、中文 display 一律 NanoOldSongA。
 *        重点验**回退链**：'Juice ITC' / 'PF频凡胡涂体' / Cinzel 这三个
 *        "声明了但本机没有/只有大写"的坑，必须真的从 computedStyle 里消失。
 *     ⑤ 铺满整屏的高饱和色块换掉：全屏菜单底 rgba(85,5,7,.98)（饱和 82%）→ --pal-veil（30%）。
 *        ⚠️ 同批的"首页大字 --pal-mint → --pal-paper"**当天晚些被用户推翻**：
 *           他点名「换成原来的薄荷绿」并在两种薄荷里选了原版霓虹薄荷，
 *           现行 = #7ee8c7（--pal-mint-neon）。断言见下面 E 段，别再改回 paper。
 *     ⑥ 日剧调色滤镜只挂在**画面层**（首页 canvas / 工作室视频层），
 *        纸面（body、颗粒层）必须仍然是 `filter: none` —— 这是
 *        "别把纸张颜色弄成绿色红色的"的回归断言。
 *   第三批（2026-09-16 深夜，用户四条截图反馈）
 *     ⑦ 首页那行 16vw「Portfolio」**去掉投影**：`.reveal-mask { overflow:hidden }`
 *        会把 44px 模糊的 textShadow 裁成一个**矩形**，用户看到的就是这个矩形
 *        （"矩形阴影 + 字影"是同一层影子的两种观感）。断言已由"必须有影"翻成"必须是 none"。
 *     ⑧ 视频与音乐页底色：薄荷 → **白**（用户："改成白色"）。薄荷轮的三层叠加整段删掉，
 *        只留 `background: #ffffff` —— 断言连 backgroundImage === 'none' 一起验。
 *        背景大字随之从奶油白翻成**淡墨**（白底上水印只能比底更暗）。
 *     ⑨ MENU 加薄荷（用户贴全屏 MENU 截图："薄荷巧克力配色"）：底本来就是巧克力，
 *        所以动的是**文字层** —— 奶油 #f3e9d2 → --pal-mint。
 *        收口在页面级变量 `--menu-ink` 上（link / underline / crosshair 三处消费）。
 *   第四批（2026-09-17，用户：「薄荷巧克力配色有点不正宗，按图片里的颜色对比调」）
 *     ⑩ 薄荷**换了值**：旧 --pal-mint #98cab8 是 S32%/L69% 的灰绿鼠尾草，
 *        参考图实测的"正宗薄荷"是 S45%/L80% 的粉彩 #b5e3d6（两张独立图互相印证），
 *        巧克力 --pal-veil 也按实测从 #3b2320 提到更暖的 #4a2e23。
 *        ⚠️ 下面是**值断言**，改色时必须同步改这里 —— 它们锁的就是"现在这支薄荷"。
 *
 * ## 音乐是怎么"验"的
 * 声音听不见，所以走 **AudioParam / HTMLMediaElement 原型插桩**：
 * 把 linearRamp / setTargetAtTime / pause 全记下来，再驱动 UI 读回调用序列 ——
 * 于是"斜坡到底几秒、目标增益多少"是**实测值**而非推断。
 *
 * ## 字族/颜色是怎么"验"的
 * 都不用截图比对（截图比对只会验"我改的那一版"，验不出未来回归）。
 *  · class 级规则 → 造一个**游离节点**挂上 class 读 computedStyle（CSS 是全局的）；
 *  · 真节点（首页大字、canvas、视频层）→ 真导航过去读。
 * 这样验的是"浏览器最终解析出什么字体/什么颜色"，恰好能抓住
 * "字体名打错 → 静默回退"这类肉眼要盯半天的问题。
 *
 * ⚠️ 两个坑（第一版音乐探针踩过，别再犯）：
 *   1. `Page.addScriptToEvaluateOnNewDocument` 里的 hook **不能读 `this.context.currentTime`** ——
 *      某些 Edge 版本上 AudioParam.context 是 undefined，抛出的异常会冒进 React 事件处理器，
 *      把整个应用打崩（表现为"点了 Menu 之后整页白屏"）。改用上一次 `setValueAtTime`
 *      钉住的起点时间来推斜坡时长。
 *   2. 必须先 `window.dispatchEvent(new PointerEvent('pointerdown'))` 再点按钮：
 *      studioMusic 的 AudioContext 只在**真实手势**里 `unlock()` 才建链，
 *      JS 的 `.click()` 不触发 pointerdown —— 少了这一步一个 AudioParam 调用都抓不到。
 *
 * 用法：
 *   BASE=http://127.0.0.1:5190 node scripts/verify-chrome-music.mjs   # 打 preview
 *   node scripts/verify-chrome-music.mjs                              # 打 preview:4180
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9377;
const BASE = process.env.BASE ?? 'http://127.0.0.1:4180';
const profile = path.join(os.tmpdir(), '_edgeprobe' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d = '') => {
  results.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`);
};

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = (m) => {
      const j = JSON.parse(m.data);
      if (j.id && this.pending.has(j.id)) { this.pending.get(j.id)(j); this.pending.delete(j.id); }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

const RECORDER = `
window.__musicLog = [];
window.__errs = [];
window.addEventListener('error', (e) => window.__errs.push('error: ' + String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => window.__errs.push('reject: ' + String(e.reason)));
try {
  const _ce = console.error;
  console.error = function (...a) { window.__errs.push('console.error: ' + a.map(String).join(' ').slice(0, 300)); return _ce.apply(this, a); };
} catch (e) {}
try {
  const _sv = AudioParam.prototype.setValueAtTime;
  AudioParam.prototype.setValueAtTime = function (v, t) {
    this.__svT = t;
    window.__musicLog.push({ k: 'set', v, t });
    return _sv.call(this, v, t);
  };
  /* 淡出走的是**分段线性**（listRamp），起点时间就是上一次 setValueAtTime 的 t —— 记下来，
     于是 Node 侧能把整条增益曲线还原出来，断言"中点还听得见"（用户抱怨过"太快"）。 */
  const _lin = AudioParam.prototype.linearRampToValueAtTime;
  AudioParam.prototype.linearRampToValueAtTime = function (value, time) {
    window.__musicLog.push({ k: 'lin', v: value, t: time, t0: this.__svT ?? time });
    return _lin.call(this, value, time);
  };
  const _exp = AudioParam.prototype.exponentialRampToValueAtTime;
  AudioParam.prototype.exponentialRampToValueAtTime = function (value, time) {
    /* ⚠️ 别用 this.context.currentTime：某些 Edge 版本上 AudioParam.context 是 undefined，
       抛进 React 事件处理器会把整个应用打崩（第一版探针就这么误伤过）。 */
    window.__musicLog.push({ k: 'exp', v: value, dur: +(time - (this.__svT ?? time)).toFixed(3) });
    return _exp.call(this, value, time);
  };
  const _tgt = AudioParam.prototype.setTargetAtTime;
  AudioParam.prototype.setTargetAtTime = function (value, time, tau) {
    window.__musicLog.push({ k: 'target', v: value, tau });
    return _tgt.call(this, value, time, tau);
  };
  const _pause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function () {
    window.__musicLog.push({ k: 'pause', src: String(this.currentSrc || this.src).split('/').pop() });
    return _pause.call(this);
  };
} catch (e) { window.__recErr = String(e); }
`;

async function waitTarget(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
      const p = list.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p;
    } catch {}
    await sleep(500);
  }
  throw new Error('CDP 没起来');
}

const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-extensions', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

let ws;
try {
  const target = await waitTarget(CDP_PORT);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });

  /* ---------- A. 工作室：字族 + 大小写 + 音乐淡出 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/?studio=1&direct=1` });
  await sleep(2500);
  for (let i = 0; i < 60; i++) {
    const ok = await cdp.eval(`!!document.querySelector('.studio-chrome__label')`);
    if (ok) break;
    await sleep(500);
  }

  const chrome = await cdp.eval(`(() => {
    const back = document.querySelector('.studio-chrome__back');
    const label = document.querySelector('.studio-chrome__label');
    const pill = document.querySelector('.studio-pill .hand__txt');
    const cs = label ? getComputedStyle(label) : null;
    const pcs = pill ? getComputedStyle(pill) : null;
    return {
      labelText: label?.textContent ?? null,
      labelFont: cs?.fontFamily ?? null,
      labelSize: cs?.fontSize ?? null,
      labelSpacing: cs?.letterSpacing ?? null,
      labelTransform: cs?.textTransform ?? null,
      backFont: back ? getComputedStyle(back).fontFamily : null,
      pillText: pill?.textContent ?? null,
      pillFont: pcs?.fontFamily ?? null,
      recErr: window.__recErr ?? null,
    };
  })()`);
  console.log('  chrome =', JSON.stringify(chrome));
  check('左上文案 = "My Studio"（Title Case）', chrome.labelText === 'My Studio', String(chrome.labelText));
  check('左上字族落在 Caveat（不再是 Cinzel）',
    /Caveat/i.test(chrome.backFont || '') && !/Cinzel/i.test((chrome.backFont || '').replace(/.*Caveat[^,]*,\s*/, '')),
    String(chrome.backFont));
  check('右上文案 = "Menu"（与 Close 同规则）', chrome.pillText === 'Menu', String(chrome.pillText));
  check('右上字族 = Caveat（与左上同一支笔）', /Caveat/i.test(chrome.pillFont || ''), String(chrome.pillFont));
  check('插桩生效', chrome.recErr === null, String(chrome.recErr));

  const sizeOk = parseFloat(chrome.labelSize) >= 16;
  check('返回标签字号跟上了 Caveat（≥16px）', sizeOk, String(chrome.labelSize));

  /* ⚠️ 必须先给一次**真实手势**：studioMusic 的 AudioContext 只在
     pointerdown/keydown 里 `unlock()` 才建链（web Audio 的硬约束，见模块头）。
     少了它 ctx 永远是 null，走的是 audio.volume 降级路径 —— 一个 AudioParam 调用都抓不到。 */
  await cdp.eval(`window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); 'unlocked'`);
  await sleep(400);

  /* 点 Menu → 期望 3.4s 指数淡出 */
  await cdp.eval(`window.__musicLog.length = 0; window.__errs.length = 0; document.querySelector('.studio-pill').click(); 'ok'`);
  await sleep(1200);
  const errs = await cdp.eval(`window.__errs.slice(0, 8)`);
  if (errs.length) console.log('  ⚠ 页面报错 =', JSON.stringify(errs, null, 1));
  const domAfter = await cdp.eval(`({ pill: !!document.querySelector('.studio-pill'), menu: !!document.querySelector('.studio-menu-overlay'), body: document.body.innerText.slice(0, 80) })`);
  console.log('  点 Menu 后 DOM =', JSON.stringify(domAfter));
  const away = await cdp.eval(`window.__musicLog.slice()`);
  const ramp = away.filter((e) => e.k === 'lin');
  const t0 = ramp.length ? ramp[0].t0 : null;
  // 把分段线性还原成增益曲线上的取样点（相对时间 0..1）
  const curve = t0 === null ? [] : ramp.map((e) => ({ k: +((e.t - t0) / (ramp[ramp.length - 1].t - t0)).toFixed(3), v: e.v }));
  const at = (k) => (curve.length ? curve.reduce((best, p) => (Math.abs(p.k - k) < Math.abs(best.k - k) ? p : best), curve[0]).v : null);
  const total = t0 === null ? null : +(ramp[ramp.length - 1].t - t0).toFixed(3);
  console.log(`  淡出曲线（${ramp.length} 段，总长 ${total}s）:`,
    curve.map((p) => `${p.k}→${p.v.toFixed(3)}`).join('  '));

  check('开菜单 → 走"渐弱"（分段线性增益曲线）', ramp.length >= 8, `段数=${ramp.length}`);
  check('淡出总时长 ≈ 3.4s', total !== null && Math.abs(total - 3.4) < 0.25, `total=${total}`);
  check('曲线终点 = 0（真的消失了）',
    curve.length > 0 && curve[curve.length - 1].v === 0, String(curve[curve.length - 1]?.v));
  /* ↓↓↓ 这一条就是用户「消失得太快」的回归断言：
     等 dB 版本在中点已经 -41dB（听不见）了；幂曲线版本中点应在 -13dB 上下，
     也就是**前半程一直听得见它在变小**。 */
  check('中点仍听得见（≥0.15，约 -13dB）—— 不能前半秒就没了',
    (at(0.5) ?? 0) >= 0.15, `gain@50% = ${at(0.5)?.toFixed(3)}`);
  check('3/4 处仍在渐弱（≥0.04，约 -25dB）',
    (at(0.75) ?? 0) >= 0.04, `gain@75% = ${at(0.75)?.toFixed(3)}`);
  check('曲线单调下降（不能有回升的台阶）',
    curve.every((p, i) => i === 0 || p.v <= curve[i - 1].v + 1e-6), '');
  check('淡出时**没有**扫低通（低通是"太快"的另一半原因）',
    !away.some((e) => e.k === 'exp' && e.v > 500), JSON.stringify(away.filter((e) => e.k === 'exp')));
  check('开菜单时**没有** pause（是"走远"，不是"掐断"）',
    !away.some((e) => e.k === 'pause'), JSON.stringify(away.filter((e) => e.k === 'pause')));
  check('开菜单时**没有**用 setTargetAtTime 压低（旧的 duck 已彻底移除）',
    !away.some((e) => e.k === 'target'), JSON.stringify(away.filter((e) => e.k === 'target')));

  /* 关菜单 → 期望 setTargetAtTime 缓缓抬回 0.7 */
  await cdp.eval(`window.__musicLog.length = 0; [...document.querySelectorAll('.studio-pill')].pop().click(); 'ok'`);
  await sleep(900);
  const back = await cdp.eval(`window.__musicLog.slice()`);
  const tgt = back.find((e) => e.k === 'target' && e.v > 0.5);
  check('关菜单 → 抬回前台 0.7（TAU 0.35，缓缓推上来）', tgt && tgt.tau === 0.35, JSON.stringify(tgt));

  /* ---------- B. 视频页：必须立刻停 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/?studio=1&direct=1&media=1` });
  await sleep(3000);
  const media = await cdp.eval(`window.__musicLog.slice()`);
  check('进「视频与音乐」页 → 立刻 pause 音乐',
    media.some((e) => e.k === 'pause' && /studio-music/.test(e.src || '')),
    JSON.stringify(media.filter((e) => e.k === 'pause')));
  check('视频页没有走淡出（不该再慢慢消失）',
    !media.some((e) => e.k === 'lin'), JSON.stringify(media.filter((e) => e.k === 'lin')));

  /* ---- 第五轮：视频页回到白底（用户：「@image#4 改成白色」→ 确认 = 整页薄荷底→白底）----
     薄荷轮的底是**三层叠加**（基础渐变 + 台光 + 角落补光）；白底轮把整段删掉、只留一个色值，
     因为白底上没有"比白更亮"的空间、三层叠加全是无效功。
     所以这里连"叠了几层"一起断言：backgroundImage 必须恰好是 none ——
     只要还剩一层 radial/linear-gradient，就说明薄荷那三层没删干净（白底会带上一点薄荷底味）。 */
  let mjp = null;
  for (let i = 0; i < 20; i++) {
    mjp = await cdp.eval(`(() => {
      const el = document.querySelector('.mjp');
      const bgw = document.querySelector('.mjp__bgword');
      /* ⚠️ 必须取**非当前卡**：.mjp__media.is-current 有自己的 opacity:1 覆盖，
         直接 querySelector('.mjp__media') 拿到的往往是当前那张，读到 1 会误判成回归。 */
      const off = document.querySelector('.mjp__media:not(.is-current)');
      const cur = document.querySelector('.mjp__media.is-current');
      if (!el) return null;
      const ecs = getComputedStyle(el);
      return {
        bgImage: ecs.backgroundImage,
        bgColor: ecs.backgroundColor,
        bgwordColor: bgw ? getComputedStyle(bgw).color : null,
        bgwordOpacity: bgw ? getComputedStyle(bgw).opacity : null,
        offOpacity: off ? getComputedStyle(off).opacity : null,
        curOpacity: cur ? getComputedStyle(cur).opacity : null,
      };
    })()`);
    if (mjp?.bgwordColor) break;
    await sleep(400);
  }
  console.log('  mjp =', JSON.stringify(mjp));
  check('视频页底 = 纯白 rgb(255, 255, 255)，且 backgroundImage = none（薄荷三层叠加已删净）',
    mjp?.bgColor === 'rgb(255, 255, 255)' && mjp?.bgImage === 'none', JSON.stringify(mjp));
  /* 白底上"水印"只能比底更暗 —— 薄荷轮的奶油白 #fbf8f0 在白底上是白压白（对比 1.0），
     所以整条反过来：巧克力墨 + opacity 0.08。 */
  check('视频页背景大字 = 淡墨（巧克力墨 rgb(49, 38, 28) / opacity 0.08），不再是奶油白',
    mjp?.bgwordColor === 'rgb(49, 38, 28)' && mjp?.bgwordOpacity === '0.08',
    `${mjp?.bgwordColor} / ${mjp?.bgwordOpacity}`);
  check('视频页非当前卡 opacity 回到白底版 0.34（深底版是 0.3）',
    mjp?.offOpacity === '0.34', String(mjp?.offOpacity));
  check('视频页当前卡仍是全不透明 1（.mjp__media.is-current 覆盖）',
    mjp?.curOpacity === '1', String(mjp?.curOpacity));

  /* ---------- C. 字族统一（2026-09-16 第二批 / 用户："字体统一"）----------
     CSS 是全局的：给任意 class 造一个游离节点读 computedStyle，就能证明
     "这条规则真的解析出来了"（而不是字体名打错 / var 落空 → 静默回退到系统字体）。
     这一招正好覆盖上一轮踩的两个坑：'Juice ITC'、'PF频凡胡涂体' 都声明了但本机不存在，
     声明看着没错、渲染全是回退 —— 只有读 computedStyle 才能发现。 */
  const probe = (cls, text) => cdp.eval(`(() => {
    const host = document.createElement('div');
    host.className = ${JSON.stringify(cls)};
    host.textContent = ${JSON.stringify(text)};
    document.body.appendChild(host);
    const cs = getComputedStyle(host);
    const out = {
      font: cs.fontFamily, size: cs.fontSize, spacing: cs.letterSpacing,
      color: cs.color, bg: cs.backgroundColor, filter: cs.filter,
      transform: cs.textTransform, weight: cs.fontWeight,
    };
    host.remove();
    return out;
  })()`);

  const menuEn = await probe('menu-en', 'About Me');
  const menuZh = await probe('menu-zh', '关于我');
  const openBtn = await probe('home-open', 'Open');
  const scrollLbl = await probe('home-scroll', 'Scroll');
  const wwCode = await probe('ww-code', 'A-01');
  const wwTitle = await probe('ww-title', '香氛品牌观夏 夏季营销');
  const wwEn = await probe('ww-en', 'BRAND');
  const wpCode = await probe('works-panel-code', '[A-01]');
  const wpTitle = await probe('works-panel-title', '香氛品牌观夏 夏季营销');
  const wSideMeta = await probe('works-side-meta', 'NEXT');
  const menuOverlay = await probe('studio-menu-overlay', 'x');
  console.log('  menu-en  =', JSON.stringify(menuEn));
  console.log('  menu-zh  =', JSON.stringify(menuZh));
  console.log('  open     =', JSON.stringify(openBtn), 'scroll =', JSON.stringify(scrollLbl));

  const firstFamily = (f) => String(f || '').split(',')[0].replace(/["']/g, '').trim();
  const noFallbackCinzel = (f) => !/, *("?)Cinzel\1/.test(String(f || '').split('Caveat')[1] || '');

  check('菜单英文落 Caveat（原 Juice ITC 本机不存在 → 一直回退 Cinzel）',
    firstFamily(menuEn.font) === 'Caveat', String(menuEn.font));
  check('Cinzel 已从菜单英文的回退链里摘掉（它只有大写，是"看着不对"的根源）',
    noFallbackCinzel(menuEn.font), String(menuEn.font));
  check('菜单中文落 NanoOldSongA（原 PF频凡胡涂体 本机不存在 → 回退 Noto Serif）',
    firstFamily(menuZh.font) === 'NanoOldSongA', String(menuZh.font));
  check('Open 按钮落 Caveat（原 font-body 无衬线 + 全大写）',
    firstFamily(openBtn.font) === 'Caveat' && openBtn.transform !== 'uppercase',
    `${openBtn.font} / transform=${openBtn.transform}`);
  check('Open 字号补过 Caveat 的低 x-height（≥20px）',
    parseFloat(openBtn.size) >= 20, String(openBtn.size));
  check('Scroll 落 Caveat（去掉 uppercase）',
    firstFamily(scrollLbl.font) === 'Caveat' && scrollLbl.transform !== 'uppercase',
    `${scrollLbl.font} / transform=${scrollLbl.transform}`);
  check('木马项目代号 .ww-code 落 Caveat', firstFamily(wwCode.font) === 'Caveat', String(wwCode.font));
  check('木马项目名 .ww-title 落 NanoOldSongA（原为 body 回退 Noto Serif）',
    firstFamily(wwTitle.font) === 'NanoOldSongA', String(wwTitle.font));
  check('木马 .ww-en 落 Caveat', firstFamily(wwEn.font) === 'Caveat', String(wwEn.font));
  check('策划案详情标题 .works-panel-title 落 NanoOldSongA',
    firstFamily(wpTitle.font) === 'NanoOldSongA', String(wpTitle.font));
  check('PREV/NEXT 落 Caveat', firstFamily(wSideMeta.font) === 'Caveat', String(wSideMeta.font));

  /* ---------- D. 配色第二轮：把"铺满整屏的饱和色"换掉 ---------- */
  const palette = await cdp.eval(`(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      paper: cs.getPropertyValue('--pal-paper').trim(),
      mint: cs.getPropertyValue('--pal-mint').trim(),
      mintSoft: cs.getPropertyValue('--pal-mint-soft').trim(),
      mintDeep: cs.getPropertyValue('--pal-mint-deep').trim(),
      mintNeon: cs.getPropertyValue('--pal-mint-neon').trim(),
      veil: cs.getPropertyValue('--pal-veil').trim(),
      grade: cs.getPropertyValue('--grade-world').trim(),
    };
  })()`);
  console.log('  palette =', JSON.stringify(palette));
  /* --pal-paper 还在用（纸面 / 主字），只是**不再是首页大字的落地色** —— 别再把它写回大字 */
  check('--pal-paper = #e8e6e0（纸面 / 主字）', palette.paper === '#e8e6e0', String(palette.paper));
  check('--pal-mint-neon = #7ee8c7（首页大字的落地色）', palette.mintNeon === '#7ee8c7', String(palette.mintNeon));
  /* 第五轮：薄荷从"灰绿鼠尾草"换成参考图实测的"粉彩薄荷"（S45%/L80%）。
     这两条是**用户那句"有点不正宗"的回归锁** —— 改回 #98cab8 就会红。 */
  check('--pal-mint = #b5e3d6（实测粉彩薄荷：S45%/L80%，不再是 S32%/L69% 的鼠尾草绿）',
    palette.mint === '#b5e3d6', String(palette.mint));
  check('--pal-mint-soft = #defeec / --pal-mint-deep = #8ec6b4（浅薄荷面 / 深一档薄荷）',
    palette.mintSoft === '#defeec' && palette.mintDeep === '#8ec6b4',
    `${palette.mintSoft} / ${palette.mintDeep}`);
  check('--pal-veil = #4a2e23（全屏菜单底：比旧 #3b2320 更暖的巧克力）',
    palette.veil === '#4a2e23', String(palette.veil));
  check('全屏菜单底色不再是 rgba(85,5,7,.98)',
    !/rgba?\(85, 5, 7/.test(menuOverlay.bg), String(menuOverlay.bg));
  /* ⚠️ 这里**不能**只认 rgba()：底色走的是 color-mix(in srgb, var(--pal-veil) 98%, transparent)
     —— 为的是让 98% 这个透明度跟着 token 走，而不是在 CSS 里再抄一份 #4a2e23 字面量。
     代价是 Chromium 把计算值报成 `color(srgb 0.290196 0.180392 0.137255 / 0.98)`，
     所以先把 srgb 分量归一成 0-255 再断言（0.290196×255 = 74 = 0x4a ✓ 确实是 veil）。 */
  const normBg = menuOverlay.bg.toLowerCase().replace(
    /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/,
    (_, r, g, b, a) => `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a ?? 1})`,
  );
  check('全屏菜单底色 = veil #4a2e23（alpha 0.98）',
    /rgba?\(74, 46, 35/.test(normBg) && /0\.98/.test(normBg), String(menuOverlay.bg));

  /* ---- 第五轮：MENU 加薄荷（用户贴了一张**全屏 MENU** 的截图说「薄荷巧克力配色」）----
     底本来就已是巧克力，所以"加薄荷"动的是**文字层**：奶油 #f3e9d2 → --pal-mint（#b5e3d6）。
     ⚠️ --menu-ink 是**页面级**变量（挂在 .studio-menu-overlay 上、由 .studio-menu-link 消费），
        所以必须造"父 overlay + 子 link"的小树才读得到 —— 单挂一个 .studio-menu-link，
        var 落空后 color 会走 inherit，读出来是父级的颜色，等于没验到。
     ⚠️ inline 必须 `animation: none`：.studio-menu-overlay 带 menu-fade-in 的 forwards 动画，
        只写 opacity:0 挡不住它 —— 探针会在页面上闪一块全屏巧克力色。 */
  const menuInk = await cdp.eval(`(() => {
    const host = document.createElement('div');
    host.className = 'studio-menu-overlay';
    host.setAttribute('style', 'position:absolute;inset:auto;width:0;height:0;opacity:0;pointer-events:none;z-index:-1;animation:none');
    const link = document.createElement('span'); link.className = 'studio-menu-link';
    const ul = document.createElement('span'); ul.className = 'menu-underline';
    const cross = document.createElement('div'); cross.className = 'menu-crosshair-h';
    host.append(link, ul, cross);
    document.body.appendChild(host);
    const out = {
      token: getComputedStyle(host).getPropertyValue('--menu-ink').trim(),
      link: getComputedStyle(link).color,
      underline: getComputedStyle(ul).color,
      crosshair: getComputedStyle(cross).backgroundColor,
    };
    host.remove();
    return out;
  })()`);
  /* color-mix 的计算值在 Chromium 里报成 `color(srgb r g b / a)`，先归一成 0-255 再断言 */
  const normMix = (s) => String(s).toLowerCase().replace(
    /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/,
    (_, r, g, b, a) => `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a ?? 1})`,
  );
  console.log('  menuInk =', JSON.stringify(menuInk));
  check('MENU 薄荷变量 --menu-ink = --pal-mint（#b5e3d6）', menuInk.token === '#b5e3d6', String(menuInk.token));
  check('MENU 菜单字 = 薄荷 rgb(181, 227, 214)（不再是奶油 #f3e9d2）',
    menuInk.link === 'rgb(181, 227, 214)', String(menuInk.link));
  check('MENU 手写下划线跟着转薄荷（与菜单字同色）',
    menuInk.underline === 'rgb(181, 227, 214)', String(menuInk.underline));
  check('MENU 十字辅助线 = 薄荷 20%（浅到只当网格，不抢字）',
    /rgba\(181, 227, 214, 0?\.2\)/.test(normMix(menuInk.crosshair)), `${menuInk.crosshair} → ${normMix(menuInk.crosshair)}`);

  check('.works-panel-code 的绿统一到 --pal-green rgb(101, 116, 93)',
    wpCode.color === 'rgb(101, 116, 93)', String(wpCode.color));

  /* 策划案内页（.wkp）的配色变量。⚠️ .wkp 本身是 `position:fixed; inset:0; z-index:300;
     opacity:0` 的全屏浮层 —— 直接挂一个到 body 上虽然看不见，但会插进布局。
     所以用 inline style 把它压成 0×0 不参与层叠的哑节点，只读它的自定义属性。 */
  const wkpVars = await cdp.eval(`(() => {
    const host = document.createElement('div');
    host.className = 'wkp';
    host.setAttribute('style', 'position:absolute;inset:auto;width:0;height:0;opacity:0;pointer-events:none;z-index:-1');
    document.body.appendChild(host);
    const cs = getComputedStyle(host);
    const out = {
      band: cs.getPropertyValue('--wkp-band-bg').trim(),
      bandInk: cs.getPropertyValue('--wkp-band-ink').trim(),
      paper: cs.getPropertyValue('--wkp-paper').trim(),
      accent: cs.getPropertyValue('--wkp-accent').trim(),
    };
    host.remove();
    return out;
  })()`);
  console.log('  wkp vars =', JSON.stringify(wkpVars));
  check('策划案宣言带 = 薄荷实底（用户：「我也喜欢薄荷巧克力的搭配」）',
    wkpVars.band === '#b5e3d6', String(wkpVars.band));
  check('宣言带文字 = 巧克力棕 #6b4423（薄荷的配对色）',
    wkpVars.bandInk === '#6b4423', String(wkpVars.bandInk));
  check('策划案**纸面**仍是中性暖米白（用户："别把纸张颜色弄成绿色红色的"）',
    wkpVars.paper === '#e9e7e1', String(wkpVars.paper));
  /* ⚠️ 这条**名字是历史遗留**：现在薄荷早就是主色了（宣言带整条实底）。
     它真正锁的是"--wkp-accent 与 --wkp-band-bg 是同一支薄荷"，别再分叉成两种绿。 */
  check('--wkp-accent 与宣言带同支薄荷 #b5e3d6（左栏深棕 #514132 上 6.9:1）',
    wkpVars.accent === '#b5e3d6' && wkpVars.accent === wkpVars.band,
    `${wkpVars.accent} / band ${wkpVars.band}`);

  /* ---- 全站底色：酒红 → 巧克力（用户："这个的底色也可以试着换一下" + 薄荷巧克力）---- */
  const base = await cdp.eval(`(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      choc: cs.getPropertyValue('--pal-choc').trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  })()`);
  console.log('  base =', JSON.stringify(base));
  check('--pal-choc = #3b2b21', base.choc === '#3b2b21', String(base.choc));
  check('全站底色不再是酒红 rgb(85, 5, 7)',
    base.bodyBg !== 'rgb(85, 5, 7)', String(base.bodyBg));
  check('全站底色 = 巧克力 rgb(59, 43, 33)',
    base.bodyBg === 'rgb(59, 43, 33)', String(base.bodyBg));

  /* ---- 调色滤镜：**不能是全局降饱和**（用户："你现在全是发灰的颜色"）----
     这是那一轮返工的回归断言：saturate 必须 ≥1（保留/略升），
     且不许出现 sepia 那种"统一抹灰"的手法。 */
  const gradeNum = (await cdp.eval(
    `getComputedStyle(document.documentElement).getPropertyValue('--grade-world').trim()`,
  ));
  const sat = parseFloat((gradeNum.match(/saturate\(([\d.]+)\)/) || [])[1] ?? '0');
  const con = parseFloat((gradeNum.match(/contrast\(([\d.]+)\)/) || [])[1] ?? '0');
  console.log('  grade =', gradeNum, '| saturate =', sat, '| contrast =', con);
  check('调色滤镜**不降饱和**（saturate ≥ 1，日剧感靠反差不是靠发灰）', sat >= 1, String(sat));
  check('调色滤镜把反差拉起来（contrast ≥ 1.1）', con >= 1.1, String(con));
  check('调色滤镜没用 sepia（sepia 会把全画面统一抹暖抹灰）',
    !/sepia/.test(gradeNum), gradeNum);

  /* ---------- E. 画面层：日剧调色滤镜 + 首页大字的真实节点 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/?studio=1&direct=1` });
  await sleep(2500);
  let lens = null;
  for (let i = 0; i < 40; i++) {
    lens = await cdp.eval(`(() => {
      const el = document.querySelector('.studio-lens-root');
      return el ? { filter: getComputedStyle(el).filter } : null;
    })()`);
    if (lens) break;
    await sleep(500);
  }
  console.log('  lens =', JSON.stringify(lens));
  check('工作室房间（视频层）挂上了调色滤镜',
    !!lens && /saturate\([\d.]+\)/.test(lens.filter), String(lens?.filter));
  check('滤镜挂在 .studio-lens-root 而**不是** .studio-cam（后者的 forwards 动画会吃掉它）',
    await cdp.eval(`getComputedStyle(document.querySelector('.studio-cam')).filter === 'none'`), '');

  await cdp.send('Page.navigate', { url: `${BASE}/` });
  let hero = null;
  for (let i = 0; i < 60; i++) {
    hero = await cdp.eval(`(() => {
      const line = document.querySelector('.reveal-line.font-jheri');
      const cv = document.querySelector('#home canvas');
      if (!line || !cv) return null;
      return {
        text: line.textContent,
        color: getComputedStyle(line).color,
        shadow: getComputedStyle(line).textShadow,
        canvasFilter: getComputedStyle(cv).filter,
        hasGradeClass: cv.classList.contains('world-grade'),
      };
    })()`);
    if (hero) break;
    await sleep(500);
  }
  console.log('  hero =', JSON.stringify(hero));
  /* 2026-09-16 晚用户改主意：「换成原来的薄荷绿」（并在两种薄荷里点名了**原版霓虹薄荷**）
     —— 于是这条断言从 --pal-paper 翻回霓虹薄荷 #7ee8c7（index.css 调色板注释第四轮 ⑨）。 */
  check('首页大字 = Portfolio，颜色 = 霓虹薄荷 --pal-mint-neon rgb(126, 232, 199)',
    hero?.text === 'Portfolio' && hero?.color === 'rgb(126, 232, 199)', String(hero?.color));
  /* 2026-09-16 第五轮 / 用户：「@image#3 字周围有矩形阴影，而且字好像也有阴影，去掉」。
     根因：.reveal-mask 是 `overflow: hidden`，44px 模糊的 textShadow 被它裁成**一个矩形**
     —— 用户看到的"矩形阴影"和"字影"其实是同一件事（同一层影子的两种观感）。
     所以这条断言反过来：现在必须恰好是 none。再挂任何投影，那个矩形就会立刻回来。 */
  check('首页大字**没有**投影了（曾经 44px 模糊被 .reveal-mask 裁成矩形）',
    hero?.shadow === 'none', String(hero?.shadow));
  check('首页画面 canvas 带上 world-grade + 调色滤镜',
    hero?.hasGradeClass === true && /saturate\([\d.]+\)/.test(hero?.canvasFilter || ''),
    String(hero?.canvasFilter));

  /* 纸面必须**没有**被调色 —— 这是用户"别把纸张颜色弄成绿色红色的"的回归断言 */
  const paper = await cdp.eval(`(() => {
    const el = document.querySelector('.noise-overlay');
    return { noiseFilter: el ? getComputedStyle(el).filter : null, bodyFilter: getComputedStyle(document.body).filter };
  })()`);
  console.log('  paper =', JSON.stringify(paper));
  check('纸面 / 全站底没有套调色滤镜（body 与颗粒层都是 none）',
    paper.bodyFilter === 'none' && paper.noiseFilter === 'none', JSON.stringify(paper));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) console.log('失败：', failed.map((f) => f.n).join(' / '));
} catch (err) {
  check('脚本执行', false, err.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill('SIGKILL');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
