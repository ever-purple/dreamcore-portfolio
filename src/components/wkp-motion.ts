/* 详情页滚动动效中枢（2026-09-14）：Lenis 惯性阻尼 + ScrollTrigger 视差/缩放/逐字。
 *
 * 用户原话是「把这几个效果合理的、有取舍的加到内页，现在动起来太死板了」，
 * 参考 izanami-official.com 的滚动惯性、gilhuybrecht.com 的丝滑。取舍如下：
 *   · 平滑滚动：只接管右栏 .wkp-scroll（左栏固定，本来就没有滚动）；
 *   · 首屏视差：大图慢、文字快+淡出（①）；
 *   · 滚动缩放：只做配图入场（scale 0.96→1 + 轻微上浮，「迎面走来」），不做旋转（④）；
 *   · 逐字 scrub：只做宣言带一块 —— 这种效果就这一块最出效果，铺满全文就廉价了（③）；
 *   · 首屏大标题：入场 kinetic reveal 一次，不跟滚动绑（②）。
 * prefers-reduced-motion 时**降级不杀死**（2026-09-15 改，原来是一刀切整套跳过）：
 * Windows「动画效果」关掉后 Chromium 全量上报 reduce，一刀切 = Lenis 不起（原生滚动
 * 阶梯式跳动，体感卡顿）+ 视差全灭 + CSS 过渡被清零，页面看起来"什么都没做"。
 * 降级策略：Lenis 照跑但收紧到 0.75s 短惯性、所有位移幅度 ×0.35、入场只留透明度 ——
 * 运动量大幅减小，但页面是活的。
 *

 * 2026-09-15 追加：多层级视差（⑤⑥⑦，用户要求「背景、大字排版、浮动卡片以不同的
 * 速度和轨道位移」）—— 这条**推翻了**上一版「每屏都视差会晕」的取舍，但晕不晕取决于
 * 幅度：所以三条轨道全部压在 ±46px 以内、且方向分明（背景反向滞后 / 大字同向上浮 /
 * 卡片交错），全页只留网格一条"可见的慢速运动"，其余都藏在 5~7% 不透明度的 ghost 里。
 *
 * 2026-09-15 再追加：⑧ 左栏视差（用户：「左边的也要有视差效果」）—— 左栏是固定列
 * 自己不滚，所以挂右栏滚动进度驱动，幅度自上而下递增（8/13/18/22/12px）以免相邻块撞上。
 * 详见 ⑤⑥⑦ 处的注释。 */

import gsap from 'gsap';
import { EASE } from '@/lib/ease';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import { prefersReduced } from '@/lib/motion-pref';

gsap.registerPlugin(ScrollTrigger, SplitText);

export type WkpMotion = {
  /** null = 没启用（找不到内容节点）。调用方用它接管 jumpTo / 归零 */
  lenis: Lenis | null;
  destroy: () => void;
};

export function initWkpMotion(scrollEl: HTMLElement): WkpMotion {
  /* 动效策略见 src/lib/motion-pref.ts：作者要求"系统关着动画也拿满效果"，
     所以这里恒为 false（K=1、Lenis 1.15s、入场带位移）。
     下面这套 K / reduced 的降级管线**保留**：哪天要把 FORCE_FULL_MOTION 关掉，
     幅度、时长、入场形式会自动整体降级，不用再改这里。 */
  const reduced = prefersReduced();
  const K = reduced ? 0.35 : 1;
  const amp = (v: number) => Math.round(v * K * 1000) / 1000;
  const content = scrollEl.firstElementChild as HTMLElement | null;
  if (!content) return { lenis: null, destroy: () => {} };

  /* ---- Lenis：与主页同参数（duration 1.15 + 指数缓出），只包右栏容器 ----
     主页的 window lenis 在 App.tsx 里已经用 virtualScroll 钩子让位（.wkp 在场时 return false），
     两边不抢；这里 wrapper 模式改的是真实 scrollTop，ScrollTrigger 直接认。 */
  const lenis = new Lenis({
    wrapper: scrollEl,
    content,
    duration: reduced ? 0.75 : 1.15,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    wheelMultiplier: 1,
    touchMultiplier: 1.6,
  });
  lenis.on('scroll', ScrollTrigger.update);
  const raf = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(raf); // 主页已 lagSmoothing(0)，帧循环复用同一套

  const ctx = gsap.context(() => {
    /* ① 首屏视差：大图慢（-5%→+6%）、文字块快（下沉 + 淡出）。
       2026-09-16 把大图的静态 scale 收到 1.0（原来是 1.14，再之前收到过 1.02）：
       首屏大图已改 object-fit: contain + 容器 aspect-ratio 跟图片比例（index.css .wkp-hero + coverAr），
       完整且铺满一个像素都不裁，**contain 同比例盒子里已经是边到边 100%**，
       再叠 scale 等于把图放大到溢出容器、四周被 .wkp-hero 的 overflow:hidden 裁掉。
       所以这里不再设静态 scale，只留上下位移（yPercent），让封面边到边贴着容器自己呼吸。 */
    const heroImg = scrollEl.querySelector<HTMLElement>('.wkp-hero-img');
    const heroCopy = scrollEl.querySelector<HTMLElement>('.wkp-hero-copy');
    if (heroImg) {
      gsap.set(heroImg, { transformOrigin: '50% 50%' });
      gsap.fromTo(
        heroImg,
        { yPercent: amp(-5) },
        {
          yPercent: amp(6),
          ease: 'none',
          scrollTrigger: { trigger: '.wkp-hero', scroller: scrollEl, start: 'top top', end: 'bottom top', scrub: true },
        },
      );
    }
    if (heroCopy) {
      gsap.to(heroCopy, {
        yPercent: amp(14),
        opacity: 0,
        ease: 'none',
        scrollTrigger: { trigger: '.wkp-hero', scroller: scrollEl, start: 'top top', end: '70% top', scrub: true },
      });
    }

    /* ② 首屏大标题 kinetic reveal：整块从下方升起 + 淡入（只放一次）。
       不用 SplitText 逐字 —— 标题经 breakPhrase 断行后是「text + br + text」多子节点，
       SplitText 的 chars 拆不动这种结构（实测 span=0）；整块 reveal 一样有 kinetic 感。 */
    const title = scrollEl.querySelector<HTMLElement>('.wkp-hero-title');
    if (title && title.textContent?.trim()) {
      /* reduced 下摘掉升起位移，只留一次短淡入 */
      gsap.from(title, {
        ...(reduced ? {} : { yPercent: 22 }),
        opacity: 0,
        duration: reduced ? 0.35 : 0.9,
        ease: EASE.world,
        delay: 0.15,
      });
    }
    const note = scrollEl.querySelector<HTMLElement>('.wkp-hero-note');
    if (note) {
      gsap.from(note, { y: amp(14), opacity: 0, duration: reduced ? 0.3 : 0.7, ease: EASE.world, delay: 0.6 });
    }

    /* ③ 宣言带逐字 scrub：字随滚动一颗颗点亮。
       宣言带是纯文本单节点（不 breakPhrase），SplitText chars 能正常拆。 */
    const band = scrollEl.querySelector<HTMLElement>('.wkp-band');
    const bandText = scrollEl.querySelector<HTMLElement>('.wkp-band-text');
    if (band && bandText && bandText.textContent?.trim()) {
      const split = new SplitText(bandText, { type: 'chars' });
      gsap.fromTo(
        split.chars,
        { opacity: 0.13 },
        {
          opacity: 1,
          ease: 'none',
          duration: 0.4,
          stagger: 0.02,
          scrollTrigger: { trigger: band, scroller: scrollEl, start: 'top 92%', end: 'top 30%', scrub: 0.5 },
        },
      );
    }

    /* ④ 配图入场缩放：scale 0.96→1 + 轻微上浮（迎面走来）。不做 opacity ——
       .wkp-step-figs img 的 hover 有 opacity 过渡，GSAP 每帧改 opacity 会跟过渡打架。 */
    scrollEl.querySelectorAll<HTMLElement>('.wkp-figs img, .wkp-step-figs img').forEach((img) => {
      gsap.fromTo(
        img,
        { y: amp(56), scale: 1 - 0.04 * K },
        {
          y: 0,
          scale: 1,
          ease: 'none',
          scrollTrigger: { trigger: img, scroller: scrollEl, start: 'top 98%', end: 'top 58%', scrub: true },
        },
      );
    });

    /* ==================================================================
       ⑤⑥⑦ 多层级视差（Multi-layer Parallax，2026-09-15）
       ------------------------------------------------------------------
       三条**速度不同、方向也不同**的轨道，做出纸面之下的纵深：
         ⑤ 背景层 = 页级环境层（网格 + 两团柔斑）+ 屏内 ghost 大字
                    —— 最慢，跟滚动**反向**往下推（滞后），读数上就是"更远"；
         ⑥ 大字层 = 宣言正文 / 大招标题（text-*），外加一条反着走的行首小眉标（meta-*）
                    —— 最快，跟滚动同向**上浮**，像从背景里冲出来；
         ⑦ 卡片层 = 配图块 / 五列卡 / 步骤配图 / 团队卡（card-*）
                    —— 交错轨道：相邻卡一上一下（i % 2），团队卡再叠一条横向斜轨。
       ------------------------------------------------------------------
       三条硬约束（改这里前先读）：
         1. 全部只动 transform —— 不参与布局，scrollHeight 一动不动，
            左栏目录 jumpTo 的落点才不会被这层效果带偏（那是对着 scrollTop 算的）；
         2. 位移量一律 ≤ 46px —— 相邻两屏之间的 padding 只有 28~56px，
            再大就会在下滑途中压到隔壁屏的正文上；
         3. 触发器一律选**不带视差的那一层**（板块 / 卡片组本身）：
            ScrollTrigger 量的就是触发元素的 rect，拿被位移的元素当 trigger，
            量出来的位置本身就带着位移，start/end 会整体漂移；
         4. .wkp-scroll 是 overflow:auto —— 绝不要把页级环境层整体 translate 到内容盒
            下方，那会让底部多出一截空白可滚。位移只能落在被 .wkp-par 裁切的子层上。
       ================================================================== */
    const parLayers: { kind: string; el: HTMLElement }[] = [];
    const inner = content;
    const track = (el: HTMLElement | null, kind: string, from: gsap.TweenVars, to: gsap.TweenVars) => {
      if (!el) return;
      parLayers.push({ kind, el });
      gsap.fromTo(el, from, { ...to, ease: 'none' });
    };
    const pass = (trigger: HTMLElement | null) => ({
      trigger: trigger ?? undefined,
      scroller: scrollEl,
      start: 'top bottom',
      end: 'bottom top',
      scrub: true,
    });

    /* ---- ⑤ 背景层：最慢 + 反向滞后 ---- */
    const parGrid = scrollEl.querySelector<HTMLElement>('.wkp-par-grid');
    const bandSec = scrollEl.querySelector<HTMLElement>('.wkp-band');
    /* 网格：整页只留这一条"看得见的慢速运动"（±200px ≈ 滚动距离的 5%）。
       ⚠️ 动的是网格自己，**不动它的父层 .wkp-par** —— 父层是环境层的裁切框
       （inset:0 + overflow:hidden），一旦把它 translate 到内容盒下方，
       溢出区域会算进 .wkp-scroll 的 scrollable overflow，页面底部凭空多一截空白可滚。 */
    track(parGrid, 'bg-grid', { yPercent: amp(-1.5) }, { yPercent: amp(1.5), scrollTrigger: { trigger: inner, scroller: scrollEl, start: 'top top', end: 'bottom bottom', scrub: true } });
    /* 两团柔斑各跟一个不同的板块走，方向还相反 —— 让"背景"在滚动途中自己错开 */
    const blobA = scrollEl.querySelector<HTMLElement>('.wkp-par-blob.is-a');
    const blobB = scrollEl.querySelector<HTMLElement>('.wkp-par-blob.is-b');
    const backAnchor =
      scrollEl.querySelector<HTMLElement>('.wkp-steps') ??
      scrollEl.querySelector<HTMLElement>('.wkp-team') ??
      scrollEl.querySelector<HTMLElement>('.wkp-block');
    if (bandSec) track(blobA, 'bg-blob-a', { y: amp(-110) }, { y: amp(110), scrollTrigger: pass(bandSec) });
    if (backAnchor) track(blobB, 'bg-blob-b', { y: amp(130) }, { y: amp(-130), scrollTrigger: pass(backAnchor) });

    /* 屏内 ghost 大字（薄荷宣言带 + 每屏正文序号）：也是背景层，同样反向滞后。
       band 的 ghost 压在正文之下（DOM 在前 + 都是 static，先画的在下面）。 */
    scrollEl.querySelectorAll<HTMLElement>('.wkp-band-ghost').forEach((g) => {
      track(g, 'bg-band-ghost', { y: amp(-34) }, { y: amp(34), scrollTrigger: pass(g.closest('.wkp-band')) });
    });
    scrollEl.querySelectorAll<HTMLElement>('.wkp-block-ghost').forEach((g) => {
      track(g, 'bg-block-ghost', { y: amp(-30) }, { y: amp(30), scrollTrigger: pass(g.closest('.wkp-block')) });
    });

    /* ---- ⑥ 大字层：最快 + 同向上浮 ---- */
    /* 宣言正文：整句上浮 92px。③ 逐字点亮改的是它的**子 span**，这里改父级 transform，
       两者互不覆盖（一个动 opacity，一个动 transform）。 */
    const bandCopy = scrollEl.querySelector<HTMLElement>('.wkp-band-text');
    if (bandCopy) track(bandCopy, 'text-band', { y: amp(46) }, { y: amp(-46), scrollTrigger: pass(bandSec) });
    /* 大招标题（三步 / Team） */
    scrollEl.querySelectorAll<HTMLElement>('.wkp-h2').forEach((h) => {
      track(h, 'text-h2', { y: amp(30) }, { y: amp(-30), scrollTrigger: pass(h.closest('.wkp-steps, .wkp-team') as HTMLElement | null) });
    });
    /* 小眉标（12.5px 的行首标签）：这条是**反向滞后**的 —— 它跟右边的正文是一对
       （正文不动），反向一小段就把"标签在纸面下方、正文在上层"的层次读出来了。
       kind 用 meta- 前缀而不是 text-：它不是"大字层"，探针要按前缀分组统计。 */
    scrollEl.querySelectorAll<HTMLElement>('.wkp-label').forEach((l) => {
      track(l, 'meta-label', { y: amp(-16) }, { y: amp(16), scrollTrigger: pass(l.closest('.wkp-block')) });
    });

    /* ---- ⑦ 卡片层：交错轨道 ---- */
    /* 为什么动容器、不动里面的图：④ 已经用"入场缩放"占了 img 的 transform，
       两处都写 img 就会互相覆盖；分开动还能叠出"卡片缓慢浮 + 图片迎面走"的双层感。 */
    scrollEl.querySelectorAll<HTMLElement>('.wkp-figs, .wkp-media').forEach((el, i) => {
      const s = (i % 2 ? -1 : 1) * amp(24);
      track(el, 'card-figs', { y: s }, { y: -s, scrollTrigger: pass(el.closest('.wkp-block')) });
    });
    scrollEl.querySelectorAll<HTMLElement>('.wkp-step-figs').forEach((el, i) => {
      const s = (i % 2 ? -1 : 1) * amp(22);
      track(el, 'card-stepfigs', { y: s }, { y: -s, scrollTrigger: pass(el.closest('.wkp-step')) });
    });
    /* 五列卡：幅度按 i%3 递增（18/23/28），上下交替 —— 相邻两列永远不在同一条轨上 */
    scrollEl.querySelectorAll<HTMLElement>('.wkp-col').forEach((el, i) => {
      const s = (i % 2 ? -1 : 1) * amp(18 + (i % 3) * 5);
      track(el, 'card-col', { y: s }, { y: -s, scrollTrigger: pass(el.closest('.wkp-cols')) });
    });
    /* 团队卡：纵向交错 + **一条横向斜轨**（相邻卡左右错开），是全页唯一的斜轨 */
    scrollEl.querySelectorAll<HTMLElement>('.wkp-person').forEach((el, i) => {
      const s = (i % 2 ? -1 : 1) * amp(12);
      const sx = (i % 2 ? -1 : 1) * amp(10);
      track(el, 'card-person', { y: s, x: sx }, { y: -s, x: -sx, scrollTrigger: pass(el.closest('.wkp-team')) });
    });

    /* ==================================================================
       ⑧ 左栏视差（用户：「左边的也要有视差效果」）
       ------------------------------------------------------------------
       左栏是 position:fixed，自己不滚 —— 它的视差只能由**右栏滚动进度**驱动，
       所以全部挂整页 pass（start:'top top' / end:'bottom bottom'），
       右栏读到哪儿，左栏那层纸就错位到哪儿。
       幅度自上而下递增（8/13/18/22/12px）：相邻块 26px gap 只会越滚越大，
       不会撞上（交错方向就会撞）；最底 foot 收到 12px，否则 ↗ 被 overflow:hidden 切掉。
       详见 index.css ⑧ 段。 */
    const railPass = { trigger: inner, scroller: scrollEl, start: 'top top', end: 'bottom bottom', scrub: true };
    /* ⚠️ 左栏不在 scrollEl 里！scrollEl 传进来的是**右栏滚动列 .wkp-scroll**，
       左栏 .wkp-rail 是它的兄弟节点（都在 .wkp 下）。用 scrollEl.querySelector 查左栏
       会全部返回 null —— 第一版就是这么静默失败的（层数为 0，页面看着"没效果"）。
       所以左栏的层一律从页面根 `.wkp` 上查；触发器仍挂在 scrollEl（右栏滚它才动）。 */
    const railScope = (scrollEl.closest('.wkp') ?? scrollEl) as HTMLElement;
    const railGhost = railScope.querySelector<HTMLElement>('.wkp-rail-ghost');
    if (railGhost) track(railGhost, 'rail-ghost', { y: amp(70) }, { y: amp(-70), scrollTrigger: railPass });
    const railTop = railScope.querySelector<HTMLElement>('.wkp-rail-top');
    if (railTop) track(railTop, 'rail-top', { y: amp(-8) }, { y: amp(8), scrollTrigger: railPass });
    /* 品牌字只走横向：它上面/下面就是 Back（相隔仅 2px），纵向量会把两行挤在一起 */
    const railBrand = railScope.querySelector<HTMLElement>('.wkp-brand');
    if (railBrand) track(railBrand, 'rail-brand', { x: amp(-5) }, { x: amp(5), scrollTrigger: railPass });
    const railIntro = railScope.querySelector<HTMLElement>('.wkp-intro-wrap');
    if (railIntro) track(railIntro, 'rail-intro', { y: amp(-13) }, { y: amp(13), scrollTrigger: railPass });
    /* 目录整体走一条轨；逐行再用 .wkp-nav-num 做 ±3px 的交替微错位。
       ⚠️ 不动 .wkp-nav-item 本身：它有 hover 的 translateX(3px)，
       GSAP 的内联 transform 会把它整个顶掉（悬停反馈消失）。 */
    const railNav = railScope.querySelector<HTMLElement>('.wkp-nav');
    if (railNav) track(railNav, 'rail-nav', { y: amp(-18) }, { y: amp(18), scrollTrigger: railPass });
    railScope.querySelectorAll<HTMLElement>('.wkp-nav-num').forEach((n, i) => {
      const s = (i % 2 ? -1 : 1) * amp(3);
      track(n, 'rail-navnum', { y: s }, { y: -s, scrollTrigger: railPass });
    });
    const railMeta = railScope.querySelector<HTMLElement>('.wkp-rail .wkp-meta');
    if (railMeta) track(railMeta, 'rail-meta', { y: amp(-22) }, { y: amp(22), scrollTrigger: railPass });
    const railFoot = railScope.querySelector<HTMLElement>('.wkp-rail-foot');
    if (railFoot) track(railFoot, 'rail-foot', { y: amp(-12) }, { y: amp(12), scrollTrigger: railPass });

    /* 回归脚本用：列出所有视差层（kind + 元素），量 transform 的位移率。仅 dev。 */
    if (import.meta.env.DEV) (window as unknown as { __wkpPar?: unknown }).__wkpPar = parLayers;
  }, scrollEl);

  return {
    lenis,
    destroy: () => {
      gsap.ticker.remove(raf);
      ctx.revert();
      lenis.destroy();
      if (import.meta.env.DEV) delete (window as unknown as { __wkpPar?: unknown }).__wkpPar;
    },
  };
}
