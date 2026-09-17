import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import gsap from 'gsap';
import { EASE } from '@/lib/ease';
import type { ProjectState } from '@/data/works';
import { coverAr } from '@/lib/cover-ar';
import { WORK_PAGES } from '@/data/work-pages';
import { CursorLabel } from '@/components/CursorLabel';
import { ImageFocus, type ImageFocusHandle } from '@/components/ImageFocus';
import { PageDecor } from '@/components/PageDecor';
import { initWkpMotion, type WkpMotion } from '@/components/wkp-motion';
import { prefersReduced } from '@/lib/motion-pref';
import { useEscape } from '@/lib/escape-stack';

type Props = {
  /** 当前展示的项目 */
  project: ProjectState;
  /** 全部槽位：左栏数字导航用（点了就地切换项目） */
  slots: ProjectState[];
  /** 作者模式：页脚会出现「编辑项目」入口 */
  canEdit?: boolean;
  onClose: () => void;
  /** 切换到某个槽位（就地换项目，不退回木马） */
  onSwitch: (slot: number) => void;
  /** 打开编辑 / 提交表单（仅作者模式传） */
  onEdit?: () => void;
  /**
   * 共享元素（FLIP / Shared Element Transition）：木马轨道里被点中的那张封面**元素**。
   * 详情页从它的位置与尺寸长成首屏大图，关闭时再缩回它身上 ——
   * 就是「网格无缝展开为全屏视窗」那种展开，只是共享元素换成了封面。
   * 不传（从 3D 相框双击进来 / 项目没有封面）→ 退回原来的整页淡入 + 轻微放大。
   */
  origin?: HTMLElement | null;
  /** 起点在**点击那一刻**的矩形：轨道随后会自己转过去，只有那一刻的矩形对得上 */
  originRect?: DOMRect | null;
};

/**
 * 项目详情页 —— 全屏「左栏固定 + 右栏滚动」的编辑型版式。
 *
 * 版式参考：左栏深色（项目元信息 / 数字目录 / Back），
 * 右栏米白纸面（首屏大标题 → 大字宣言带 → 逐屏「左小标签 + 右正文」→
 * 三步流程 → 页脚动作）。滚动时左栏不动、右栏内容逐屏淡入推进。
 * 注：左栏原有一个 See Live Site 外链，2026-09-14 按用户要求删除。
 *
 * 内容来源：
 *  · 元信息 / sections 来自 works.ts（也就是木马槽位本身的数据）
 *  · 大标题 / 宣言 / 流程 / 团队 来自 data/work-pages.ts（按 code 挂载，可逐个补）
 * 没写 work-pages 条目的项目自动降级成精简版，页面不会东缺一块西缺一块。
 *
 * 用 portal 挂到 body：木马浮层入场时 opacity 从 0 → 1，
 * opacity < 1 的元素会给 fixed 子元素造出包含块，挂在里面会被锁住。
 */
/* slots / onSwitch：左栏数字导航已从「切换项目」改成「本页板块目录」，
   但页脚与首屏右侧的「下一个项目」箭头仍要用它们就地切换槽位（2026-09-14 加回）。 */
export function WorkProjectPage({
  project,
  slots,
  canEdit = false,
  origin,
  originRect,
  onClose,
  onSwitch,
  onEdit,
}: Props) {
  const copy = WORK_PAGES[project.code] ?? {};
  const scrollRef = useRef<HTMLDivElement>(null);

  /* 「上一个 / 下一个项目」：只在**已填写的**槽位之间导航（跳过空槽）。
     · next：往后找，到尾回卷到第一个（任何时候都有）；
     · prev：往前找，**不回卷** —— 第一个已填项目上不出现（2026-09-14 用户要求）。
     全站只有当前这一个已填项目 → 两个都为 null，箭头不渲染。 */
  const { prevSlot, nextSlot } = useMemo(() => {
    if (!onSwitch) return { prevSlot: null, nextSlot: null };
    const filled = slots.filter((s) => s.filled);
    if (filled.length <= 1) return { prevSlot: null, nextSlot: null };
    const idx = filled.findIndex((s) => s.slot === project.slot);
    return {
      prevSlot: idx > 0 ? filled[idx - 1].slot : null,
      nextSlot: filled[(idx + 1) % filled.length].slot,
    };
  }, [slots, project.slot, onSwitch]);
  const [entered, setEntered] = useState(false);
  /** 「Focus」放大的那张图；非空时铺满整屏。origin = 被点的那张缩略图（FLIP 用） */
  const [focus, setFocus] = useState<{
    src: string;
    caption?: string;
    origin: HTMLElement | null;
  } | null>(null);
  /** 左栏目录里当前高亮到第几屏 */
  const [tocSec, setTocSec] = useState(0);
  /** 已激活（点击播放键、开始内嵌播放）的视频区块 key 集合 */
  const [activeVideo, setActiveVideo] = useState<string | null>(null);
  /* Esc 要判断"现在有没有开着大图"，用 ref 镜像，免得每次开图都重绑键盘 */
  const focusRef = useRef<typeof focus>(null);
  focusRef.current = focus;
  /* 放大层的关闭要走它自己的动画（缩回缩略图后再卸载），所以拿它的句柄 */
  const focusHandleRef = useRef<ImageFocusHandle>(null);
  /** 滚动动效（Lenis + ScrollTrigger）的句柄：jumpTo / 归零要走它的 lenis */
  const motionRef = useRef<WkpMotion | null>(null);

  const zoom = (src: string, caption?: string, origin?: HTMLElement | null) =>
    setFocus({ src, caption, origin: origin ?? null });
  const zoomKey = (src: string, caption?: string) => (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      zoom(src, caption, e.currentTarget);
    }
  };

  /* ==================================================================
     共享元素展开（FLIP / Shared Element Transition）
     木马轨道的封面缩略图 → 详情页首屏大图，同一张图无缝长开。
     ------------------------------------------------------------------
     为什么不是直接给 .wkp-hero-img 做 FLIP，而是另起一层「飞行层」（.wkfly）：
       .wkp 入场时是**整块** opacity 0→1（还有 scale 1.04→1），挂在它内部的任何
       元素都躲不开这个淡入。而共享元素必须**从第一帧起就 100% 不透明** ——
       否则缩略图淡出、大图淡入，中途会看到两层半透明的图互相压着（重影）。
       所以飞行层挂在 body 下、当 .wkp 的**兄弟节点**，z-index 压过它，
       起手就精确盖住缩略图（同一张图、同一个盒子 → 逐像素重合，看不出接缝）。
     ------------------------------------------------------------------
     尺寸用 width/height 补间而不是 scale：
       缩略图是 100×68，大图是整屏，宽高比不同。scale 会把图拉变形；
       补 width/height 时 object-fit:cover 每帧重算裁切，内容不畸变。
       代价是每帧一次 layout —— 但这一层是 fixed 且脱流的，只有它自己在动。
     ================================================================== */

  /* 只有「从轨道点进来」这条路带 origin；从 3D 相框双击进来（onDetail）是 null。
     冻结在挂载那一刻：换项目（onSwitch）不该重放一次展开。 */
  const [flipOn] = useState(() => {
    if (!origin || !originRect || !project.cover) return false;
    /* 动效策略见 src/lib/motion-pref.ts：保留判据，但开关打开时恒 true
       （原来这里会让"系统关了动效"的用户退回整页淡入） */
    return !prefersReduced();
  });
  /** 转场期间挂 .is-flip：让出 .wkp / .wkp-inner 的 transform，量到的才是终点位置 */
  const [flipClass, setFlipClass] = useState(flipOn);
  /** 关闭中：整页走 CSS 淡出 */
  const [out, setOut] = useState(false);

  const heroImgRef = useRef<HTMLImageElement>(null);
  const flightRef = useRef<HTMLImageElement>(null);
  /** 首屏大图的解码 Promise：起飞时预解码，落点交接前确保已解完，消除"空白→弹出" */
  const heroDecodeRef = useRef<Promise<void>>(Promise.resolve());
  const enterOriginRef = useRef<DOMRect | null>(originRect ?? null);
  const originElRef = useRef<HTMLElement | null>(origin ?? null);
  const flipTlRef = useRef<ReturnType<typeof gsap.timeline> | null>(null);
  const closingRef = useRef(false);

  /* 摆位：首帧绘制**之前**就要把飞行层压到缩略图上、把真图藏起来，
     否则会先闪一帧"大图已经铺满首屏"再往回缩。
     ⚠️ 这里**不量终点** —— 终点的量法有坑，见下面那个 effect 的注释。 */
  useLayoutEffect(() => {
    if (!flipOn) return;
    const flight = flightRef.current;
    const hero = heroImgRef.current;
    const from = enterOriginRef.current;
    if (!flight || !hero || !from || from.width < 2) return;
    gsap.set(hero, { autoAlpha: 0 });
    gsap.set(flight, {
      autoAlpha: 1,
      x: from.left,
      y: from.top,
      width: from.width,
      height: from.height,
      borderRadius: 8,
    });
  }, [flipOn]);

  /* 所有关闭路径（Back / 左栏空白 / Esc）都走这里：
     先把大图缩回原缩略图、整页淡出，动画放完才真正卸载（onClose）——
     跟放大层 ImageFocus 的关闭是同一套路，不然图会瞬间消失、反演白做。 */
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    const hero = heroImgRef.current;
    const flight = flightRef.current;
    const el = originElRef.current;

    /* 没在飞 / 起点已不在 DOM（轨道把它 display:none 了）→ 直接关 */
    if (!flipOn || !hero || !flight || !el || !el.isConnected) {
      closingRef.current = true;
      onClose();
      return;
    }
    const now = hero.getBoundingClientRect();
    const from = el.getBoundingClientRect();
    const vh = window.innerHeight;
    /* 右栏被滚下去了（大图不在视口里）→ 硬缩回去会很怪，退化成淡出 */
    if (now.width < 2 || from.width < 2 || now.bottom < 0 || now.top > vh) {
      closingRef.current = true;
      onClose();
      return;
    }

    closingRef.current = true;
    flipTlRef.current?.kill();
    flipTlRef.current = null;
    setOut(true); // 整页 CSS 淡出（.wkp.is-out）
    gsap.set(hero, { autoAlpha: 0 });
    gsap.set(flight, {
      autoAlpha: 1,
      x: now.left,
      y: now.top,
      width: now.width,
      height: now.height,
      borderRadius: 0,
    });
    flipTlRef.current = gsap.timeline({ onComplete: onClose });
    flipTlRef.current.to(
      flight,
      {
        x: from.left,
        y: from.top,
        width: from.width,
        height: from.height,
        borderRadius: 8,
        duration: 0.46,
        ease: EASE.in,
      },
      0,
    );
  }, [flipOn, onClose]);

  /* ============ 左栏整块 = 「返回」热区 ============
     2026-09-14 按用户要求（参考截图：左栏大片空白处只出手指、没有动作名，点了也没反应）：
       · 左栏任意位置都显示光标动作名 Back（挂在 aside 上，就近覆盖整块）；
       · 点左栏任意非按钮区域 → 关闭详情页回木马。
     两条不让位规则：
       1) 目录项 / Back 按钮自己带 data-cursor 和 onClick，`closest()` 取最近祖先 + 这里
          先 `closest('button,…')` 早退，所以它们的 Jump / Back 不会被整块吞掉；
       2) 用按下-抬手位移阈值挡「拖选正文文字」——拖选结束时浏览器同样会派发 click，
          不挡的话在左栏想复制一段字就会顺手把页面关掉。 */
  const railDownRef = useRef<{ x: number; y: number } | null>(null);
  const onRailPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    railDownRef.current = { x: e.clientX, y: e.clientY };
  };
  const onRailClick = (e: ReactMouseEvent<HTMLElement>) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest('button, a, input, textarea, select, [role="button"]')) return;
    const d = railDownRef.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; // 是拖选，不是点击
    requestClose();
  };

  /* 入场：首帧先在下方 12px + 透明，下一帧再落位（否则不会有过渡） */
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  /* Esc：先关大图，再关整页。
     走全站统一的 Esc 栈（@/lib/escape-stack）—— 以前是"捕获阶段 + stopPropagation"
     自己造优先级（注释原话：「否则一下把木马也关了」），现在栈本身就保证
     一次按键只命中栈顶那一个处理器。 */
  useEscape(() => {
    /* 放大层开着 → 交给它自己的关闭动画（先缩回缩略图再卸载）。
       直接 setFocus(null) 会让图瞬间消失，FLIP 的关闭动画就白做了。 */
    if (focusRef.current) focusHandleRef.current?.close();
    else requestClose();
  });

  /* 滚动动效：Lenis 惯性阻尼 + ScrollTrigger 视差/缩放/逐字（见 wkp-motion.ts）。
     挂在 project.slot 上：换项目时 inner 重建，整套触发器跟着重建。
     ⚠️ 声明顺序要在「归零」effect 之前 —— 先起 lenis，归零才能走 lenis.scrollTo。 */
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const m = initWkpMotion(root);
    motionRef.current = m;
    /* 回归脚本要直接驱动滚动（immediate），把 lenis 暴露出去（仅 dev 构建） */
    if (import.meta.env.DEV) (window as unknown as { __wkpLenis?: WkpMotion['lenis'] }).__wkpLenis = m.lenis;
    return () => {
      m.destroy();
      motionRef.current = null;
      if (import.meta.env.DEV) delete (window as unknown as { __wkpLenis?: WkpMotion['lenis'] }).__wkpLenis;
    };
  }, [project.slot]);

  /* 起飞：量终点 + 跑补间。
     ⚠️ 这个 effect **必须声明在上面的 initWkpMotion 之后** —— React 按声明顺序跑 effect，
     而首屏大图身上带着 wkp-motion.ts 垫的视差 transform（`scale: 1.14` + `yPercent: -5`，
     是"滚动时不露边"的余量，静止时就生效）。
     实测：抢在视差之前量，`getBoundingClientRect()` 会得到 1214×792 / top 0，
     而图片真实停在 1214×903 / top -95 —— 飞行层落位后与真图差 40px，
     交接那一帧画面会明显往上一跳。放在 wkp-motion 之后量，两端就严丝合缝
     （飞行层与被隐藏的真图是同一个盒子、同一张图、同一个 object-fit，所以交接是逐像素的）。 */
  useEffect(() => {
    if (!flipOn) return;
    const flight = flightRef.current;
    const hero = heroImgRef.current;
    if (!flight || !hero) return;

    /* 先把首屏大图的解码踢起来：转场约 0.62s，落点前基本解完，
       消除"落点先空白再啪一下弹出" */
    heroDecodeRef.current = hero.decode().catch(() => {});

    let cancelled = false;
    let tl: gsap.core.Timeline | null = null;
    let raf1 = 0;
    let safety = 0;

    /* ⚠️ 先等首屏大图 decode 完，**再量终点** —— 量早了会拿到错的盒子：
       .wkp-hero 的高度由 aspect-ratio 决定，CSS 兜底是 16/9（654px 高），
       图片 onLoad 后 coverAr 才把真实比例（4/3 → 872px 高）写上 inline。
       -w1600 瘦身 + decoding="async" 之后，onLoad 晚于本 effect 同步执行，
       同步量终点 = 拿兜底比例当落点 —— 飞行层落地还差 217px，交接那一帧明显一跳。
       decode() 必然晚于 onLoad，等它就是等 coverAr 写完。
       race 800ms：decode 万一悬挂也不让起飞卡死（飞行层已停在缩略图上，最多晚点出发）。 */
    void Promise.race([heroDecodeRef.current, new Promise((r) => setTimeout(r, 800))])
      .then(() => {
        if (cancelled) return;
        const to = hero.getBoundingClientRect();
        if (to.width < 2 || to.height < 2) return;

        /* ⚠️ 先 **paused**，等"飞行层压在缩略图上"这一帧真正绘制出来再 play。
           否则：挂载这一大坨（Lenis / ScrollTrigger / SplitText / portal）会把主线程占住，
           GSAP 的补间却按真实时间在跑 —— 实测第一帧画出来时进度已经到 50%，
           用户看到的不是"从缩略图长开"，而是"凭空冒出一张半大的图"。
           暂停到首帧之后，等于把动画的第 0 帧真正交到眼睛里。 */
        tl = gsap.timeline({
          paused: true,
          onComplete: () => {
            /* 交接：先亮真图、同一帧收掉飞行层 —— 两者位置尺寸完全一致，看不出换人。
               等首屏大图解码完再交接，否则落点会先空白、再"啪"地弹出（尤其首屏 -w1600 大图） */
            const reveal = () => {
              gsap.set(hero, { autoAlpha: 1 });
              gsap.set(flight, { autoAlpha: 0 });
              setFlipClass(false);
            };
            void heroDecodeRef.current.then(reveal).catch(reveal);
          },
        });
        flipTlRef.current = tl;
        tl.to(
          flight,
          {
            x: to.left,
            y: to.top,
            width: to.width,
            height: to.height,
            borderRadius: 0,
            duration: 0.62,
            ease: EASE.world,
          },
          0,
        );
        /* 暴露给回归脚本（仅 dev，同 __wkpLenis / __wkpCarousel 的约定）：
           暂停 + progress(n) 可以把转场定格在任意进度上截图，
           比对着录屏猜帧可靠得多。 */
        if (import.meta.env.DEV) (window as unknown as { __wkpFlip?: unknown }).__wkpFlip = tl;

        raf1 = requestAnimationFrame(() => {
          raf1 = requestAnimationFrame(() => tl?.play());
        });
        /* 兜底：万一 rAF 被掐（标签页不可见），也别让首屏大图永远藏着 */
        safety = window.setTimeout(() => tl?.play(), 600);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      window.clearTimeout(safety);
      tl?.kill();
      flipTlRef.current = null;
      if (import.meta.env.DEV) delete (window as unknown as { __wkpFlip?: unknown }).__wkpFlip;
    };
    // 只在挂载时起飞；换项目不重放
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipOn]);

  /* 换项目：右栏回到顶部（左栏保持不动）。
     有 lenis 必须走 lenis.scrollTo —— 直接写 scrollTop 会被 lenis 的内部状态弹回去。 */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const l = motionRef.current?.lenis;
    if (l) l.scrollTo(0, { immediate: true, force: true });
    else el.scrollTop = 0;
  }, [project.slot]);

  /* 逐屏淡入：观察右栏里的 .wkp-rise，进视野就加 is-in */
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll('.wkp-rise'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          en.target.classList.add('is-in');
          io.unobserve(en.target);
        });
      },
      { root, rootMargin: '0px 0px -10% 0px', threshold: 0.06 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // project.slot 变化会重建 inner（key），重新挂观察
  }, [project.slot]);

  /* 首屏的滚动动效（大标题视差 + 淡出）已挪进 wkp-motion.ts 的 ScrollTrigger 实现，
     这里不再手写 rAF —— 两处同时写 transform 会打架。 */

  /* ---------- 右栏内容拼装 ---------- */

  const blocks = useMemo(() => {
    const out: {
      key: string;
      label: string;
      body: string;
      images: string[];
      layout?: 'stack' | 'grid2' | 'hcols';
      cols?: { title: string; images: string[] }[];
      link?: string;
      video?: string;
      audio?: { title: string; src: string }[];
    }[] = [];
    // 按 section 的 **key** 取覆盖项（label / body / images）。
    // 2026-09-14 从「按下标」改成「按 key」：sections 会被站内作者模式的保存动作
    // 整份覆盖（见 src/data/works.local.ts），下标对齐时用户在编辑器里增删一节，
    // 后面所有屏的配图就整体错位一格，而且不报错，只是图文对不上。
    project.sections.forEach((s, i) => {
      const ov = copy.blocks?.[s.key] ?? {};
      out.push({
        key: s.key || `b${i}`,
        label: (ov.label ?? s.heading) || '',
        body: (ov.body ?? s.body) || '',
        images: ov.images ?? [],
        layout: ov.layout,
        cols: ov.cols,
        link: ov.link,
        video: ov.video,
        audio: ov.audio,
      });
    });
    return out.filter((b) => b.label || b.body || b.images.length || (b.cols?.length ?? 0));
  }, [project.sections, copy.blocks]);

  /* 左栏目录：跟着右栏滚动高亮当前板块。
     用滚动位置算而不是 IntersectionObserver —— 各屏高度差很大
     （首屏整屏 + 正文长屏），IO 的"进入视野"判定会在长屏上跳来跳去。 */
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const secs = Array.from(root.querySelectorAll<HTMLElement>('[data-sec]'));
      if (!secs.length) return;
      const rootTop = root.getBoundingClientRect().top;
      const probe = root.clientHeight * 0.34;   // 以视口 1/3 高处为判定线
      let idx = 0;
      let snapped = -1;
      secs.forEach((el, i) => {
        const top = el.getBoundingClientRect().top - rootTop;
        if (top <= probe) idx = i;
        // 某屏正好贴着容器顶（刚点完目录）→ 直接认定是它。
        // 不加这条的话，比判定线还矮的屏会被下一屏抢走高亮
        // （实测第 4 屏「项目物料 / 产出」就比 0.34×900≈306px 矮）。
        if (Math.abs(top) <= 10) snapped = i;
      });
      setTocSec(snapped >= 0 ? snapped : idx);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    root.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      root.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [project.slot, blocks.length]);

  /** 目录点了滚到第 i 屏（在右栏这个滚动容器内定位，不动整页） */
  const jumpTo = (i: number) => {
    // 先乐观高亮：平滑滚动要几百毫秒，不先亮的话点击瞬间看不出反馈
    setTocSec(i);
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-sec="${i}"]`);
    if (!root || !el) return;
    const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    const l = motionRef.current?.lenis;
    if (l) l.scrollTo(top, { duration: 1.1 });
    else root.scrollTo({ top, behavior: 'smooth' });
  };

  /* 长句在首个中文标点处断行（2026-09-14 用户点名两处排版）：
     text-wrap:balance 会把「不破不立，月有 / 隙才照得进光」从半句中间切开。
     只断一次；短句 / 无标点的不动。
     上限 26：宣言带「把苏州园林的「月洞门」转译成一套当代情绪哲学：」有 22 字
     才到「：」，18 的旧上限会匹配失败导致不断行（2026-09-14 排查修复）。 */
  const breakPhrase = (s: string) => {
    if (s.length < 10) return s;
    const m = s.match(/^(.{2,26}?[，：；—、])(.+)$/);
    return m ? (<>{m[1]}<br />{m[2]}</>) : s;
  };

  /* 宣言带专用断行（2026-09-14 用户要求：冒号前占一行、冒号后另起一行）：
     在「：」处断成两段；前半句由「字号缩小」保证一行装下（见 .wkp-band-text 的 font-size），
     不再做段内次级断行。例：把苏州园林的「月洞门」转译成一套当代情绪哲学：/ 接受不完美，才装得下自己。 */
  const breakStatement = (s: string) => {
    const m = s.match(/^(.{2,26}?[：])(.+)$/);
    if (!m) return breakPhrase(s);
    return (<>{m[1]}<br />{m[2]}</>);
  };

  const tagList = project.tags.split(/\s+/).filter(Boolean);
  const metaRows = [
    { k: '角色', v: project.role },
    { k: '客户', v: project.client },
    { k: '年份', v: project.year },
    { k: '编号', v: project.code },
  ].filter((r) => Boolean(r.v));

  const heroLine = copy.heroLine ?? project.title;
  const statement = copy.statement;
  const steps = copy.steps ?? [];
  const stepsToc = copy.stepsToc;
  const team = copy.team ?? [];
  const isEmpty = !project.filled;

  return createPortal(
    <>
    <div
      className={`wkp${entered ? ' is-in' : ''}${flipClass ? ' is-flip' : ''}${out ? ' is-out' : ''}`}
      role="dialog"
      aria-modal="true"
      data-cursor=""
      data-cursor-tone="dark"
      aria-label={`项目详情：${project.code} ${project.title}`}
    >
      {/* ---- 背景装饰（2026-09-17 / 用户第 1 条"美化子页面"）----
          左栏（深棕实底）不铺装饰：.pdecor--wkp 的 --pdecor-inset-left 把可用范围
          缩到右栏纸面（窄屏左栏翻到顶部时那条会归零，见 index.css）。
          下面那句字是**项目编号** —— 每个案子自己的花体签名。 */}
      <PageDecor variant="wkp" word={project.code.replace('_', ' ')} />

      {/* ==================== 左栏：固定不滚动 ==================== */}
      {/* 整块都是「返回」热区：光标动作名 Back + 点空白处返回（见 onRailClick 注释）。
          目录项 Jump / Back 按钮自带 data-cursor，就近覆盖，不受影响。 */}
      <aside
        className="wkp-rail"
        data-cursor="Back"
        data-cursor-tone="dark"
        onPointerDown={onRailPointerDown}
        onClick={onRailClick}
      >
        {/* 左栏的"背景层"：项目编号的巨型淡字，跟右栏滚动反向滞后（见 index.css ⑧ 段）。
            放在最前 = 画在最底；pointer-events:none，不挡整块 Back 热区。 */}
        <span className="wkp-rail-ghost" aria-hidden="true">
          {project.code.replace('_', ' ')}
        </span>
        <div className="wkp-rail-top">
          <div className="wkp-rail-id">
            <p className="wkp-brand">{project.code.replace('_', ' ')}</p>
            <button
              type="button"
              className="wkp-back"
              onClick={requestClose}
              data-cursor="Back"
              data-cursor-tone="dark"
            >
              Back
            </button>
          </div>
          {/* 2026-09-14 按用户要求：整站不再出现「去线上」入口（共三处，这是其一）。
              左栏原来这里是 See Live Site ↗ / 「仅本机可见」二选一，两个分支一并去掉。
              works.ts 里的 link 字段保留（当作项目元信息），只是不再渲染。 */}
        </div>

        <div className="wkp-intro-wrap">
          {copy.introTitle ? <h2 className="wkp-intro-title">{copy.introTitle}</h2> : null}
          <p className="wkp-intro">{copy.intro ?? project.summary}</p>
        </div>

        {/* 板块目录：数字 + 板块标题，点了滚到右栏对应那一屏。
            2026-09-14 按用户要求从「点数字切换项目」改成目录
            （参考素材 Clipboard_Screenshot-1.png：「每个数字后面放板块标题，例如 1 项目背景」）。 */}
        <nav className="wkp-nav" aria-label="本页板块">
          {blocks.map((b, i) => (
            <button
              key={b.key}
              type="button"
              className={`wkp-nav-item${i === tocSec ? ' is-on' : ''}`}
              onClick={() => jumpTo(i)}
              aria-current={i === tocSec ? 'true' : undefined}
              title={b.label}
              data-cursor="Jump"
              data-cursor-tone="dark"
            >
              <span className="wkp-nav-num">{i + 1}</span>
              <span className="wkp-nav-title">{b.label}</span>
            </button>
          ))}
          {/* 三步流程也可进目录（stepsToc 设置时）：排在板块之后，序号接续 */}
          {stepsToc && steps.length && !isEmpty ? (
            <button
              key="__steps__"
              type="button"
              className={`wkp-nav-item${blocks.length === tocSec ? ' is-on' : ''}`}
              onClick={() => jumpTo(blocks.length)}
              aria-current={blocks.length === tocSec ? 'true' : undefined}
              title={stepsToc}
              data-cursor="Jump"
              data-cursor-tone="dark"
            >
              <span className="wkp-nav-num">{blocks.length + 1}</span>
              <span className="wkp-nav-title">{stepsToc}</span>
            </button>
          ) : null}
        </nav>

        <dl className="wkp-meta">
          {metaRows.map((r) => (
            <div className="wkp-meta-row" key={r.k}>
              <dt>{r.k}</dt>
              <dd>{r.v}</dd>
            </div>
          ))}
        </dl>

        <div className="wkp-rail-foot">
          <span className="wkp-rail-arrow" aria-hidden="true">
            ↗
          </span>
        </div>
      </aside>

      {/* ==================== 右栏：可滚动纸面 ====================
          2026-09-14：滚动交给本页自己的 Lenis（wkp-motion.ts），不再挂
          data-lenis-prevent；主页的 window lenis 在 App.tsx 里用 .wkp 存在性让位。 */}
      <div
        className="wkp-scroll"
        ref={scrollRef}
        data-cursor=""
        data-cursor-tone="light"
      >
        <div className="wkp-inner" key={project.slot} data-cursor="" data-cursor-tone="light">
          {/* ---- ① 背景层：页级环境层（网格 + 两团柔斑）----
               必须挂在 .wkp-inner 的**第一个**孩子：它 z-index:0，其余板块靠
               `.wkp-inner > *:not(.wkp-par){z-index:1}` 抬到它上面。
               位移在 wkp-motion.ts 里 scrubbed（最慢、跟滚动反向＝滞后）。
               纯装饰：aria-hidden，且 pointer-events:none（CSS 里），不吃鼠标事件。 ---- */}
          <div className="wkp-par" aria-hidden="true">
            <span className="wkp-par-grid" />
            <span className="wkp-par-blob is-a" />
            <span className="wkp-par-blob is-b" />
          </div>

          {/* ---- 首屏：大图 + 超大标题 —— 图片可「Focus」放大 ----
               首屏高度由 .wkp-hero 的 aspect-ratio 决定，比例在图 onLoad 时按
               自然宽高写到 inline —— 任意比例的封面都边到边铺满整块首屏。 ---- */}
          <header className="wkp-hero">
            {project.cover ? (
              <img
                className="wkp-hero-img"
                ref={heroImgRef}
                src={project.cover}
                alt=""
                draggable={false}
                decoding="async"
                onLoad={coverAr('.wkp-hero', 16 / 9)}
                data-cursor="Focus"
                data-cursor-tone="dark"
                role="button"
                tabIndex={0}
                aria-label="放大查看封面图"
                onClick={(e) => zoom(project.cover as string, `${project.code.replace('_', ' ')} · 封面`, e.currentTarget)}
                onKeyDown={zoomKey(project.cover, `${project.code.replace('_', ' ')} · 封面`)}
              />
            ) : (
              <div className="wkp-hero-empty" aria-hidden="true" />
            )}
            <span className="wkp-hero-veil" aria-hidden="true" />
            <div className="wkp-hero-copy">
              {isEmpty ? null : <h1 className="wkp-hero-title">{breakPhrase(heroLine)}</h1>}
              {isEmpty ? (
                <p className="wkp-hero-note">空槽位 · 等待提交</p>
              ) : null}
            </div>
          </header>

          {/* ---- 大字宣言带：逐字随滚动点亮（wkp-motion.ts），不挂 wkp-rise。
               breakStatement 三段断行（2026-09-14 用户要求「接受不完美…」单独成行，
               且不许在半句里折断）；SplitText 拆字时保留 <br>，逐字 scrub 不受影响。 ---- */}
          {statement && !isEmpty ? (
            <section className="wkp-band" data-cursor="" data-cursor-tone="light">
              {/* ① 背景层：这一屏的 ghost 大字（薄荷底挡住了页级环境层，所以自带一层）。
                  低到 7.5% 巧克力棕，只提供纵深、不抢正文；跟滚动反向滞后（见 wkp-motion.ts）。 */}
              <span className="wkp-band-ghost" aria-hidden="true">
                {project.code.replace('_', ' ').toUpperCase()}
              </span>
              <p className="wkp-band-text">{breakStatement(statement)}</p>
            </section>
          ) : null}

          {/* ---- 正文屏：左小标签 + 右段落 ---- */}
          {blocks.map((b, i) => (
            <section className="wkp-block wkp-rise" key={b.key} data-sec={i}>
              {/* ① 背景层：纸面上的超大幽灵序号（跟左栏目录同一套编号）。
                  用 span 而不是伪元素 —— ::before 已经被 .wkp-label 的短横线占了，
                  而且伪元素没法单独做 ScrollTrigger。 */}
              <span className="wkp-block-ghost" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <p className="wkp-label">{b.label}</p>
              <div className="wkp-body">
                {b.body
                  .split(/\n\n+/)
                  .filter(Boolean)
                  .map((para, k) => (
                    <p className="wkp-p" key={k}>
                      {para}
                    </p>
                  ))}
                {i === 0 && tagList.length ? (
                  <p className="wkp-tags">
                    {tagList.map((t) => (
                      <span className="wkp-tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </p>
                ) : null}
                {i === 0 && !b.body && !tagList.length ? (
                  <p className="wkp-p wkp-p-dim">
                    {isEmpty ? '这一项还没有内容。作者模式下可以点右下角「提交项目」填进来。' : '文案待补充。'}
                  </p>
                ) : null}
                {/* 区块外链（保留给其他场景）：正文下方「观看视频 ↗」 */}
                {b.link ? (
                  <a
                    className="wkp-link"
                    href={b.link}
                    target="_blank"
                    rel="noreferrer"
                    data-cursor="Play"
                    data-cursor-tone="light"
                  >
                    观看视频
                    <span className="wkp-link-arrow" aria-hidden="true">↗</span>
                  </a>
                ) : null}
                {/* 区块内嵌视频：封面 + 播放键，点击后 iframe 页面内播放（不跳转） */}
                {b.video ? (
                  <div className="wkp-media">
                    {activeVideo === b.key ? (
                      <iframe
                        className="wkp-media-frame"
                        src={b.video}
                        title={b.label || '视频'}
                        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                        allowFullScreen
                        loading="lazy"
                      />
                    ) : (
                      <button
                        type="button"
                        className="wkp-media-cover"
                        onClick={() => setActiveVideo(b.key)}
                        data-cursor="Play"
                        data-cursor-tone="light"
                        aria-label={`播放：${b.label || '视频'}`}
                      >
                        {b.images?.[0] ? (
                          <img
                            className="wkp-media-cover-img"
                            src={b.images[0]}
                            alt=""
                            decoding="async"
                            loading="lazy"
                            onLoad={coverAr('.wkp-media-cover')}
                          />
                        ) : (
                          <span className="wkp-media-cover-empty" aria-hidden="true" />
                        )}
                        <span className="wkp-media-play" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
                            <path d="M8 5.5v13l11-6.5z" />
                          </svg>
                        </span>
                      </button>
                    )}
                  </div>
                ) : null}
                {/* 区块内嵌音频（原生播放器，自带播放键） */}
                {b.audio?.length ? (
                  <div className="wkp-audio">
                    {b.audio.map((a) => (
                      <div className="wkp-audio-item" key={a.src}>
                        <p className="wkp-audio-title">{a.title}</p>
                        <audio className="wkp-audio-player" src={a.src} controls preload="none" />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              {b.cols?.length ? (
                <div className="wkp-cols" data-cursor="" data-cursor-tone="light">
                  {b.cols.map((col, ci) => (
                    <div className="wkp-col" key={ci}>
                      {col.title ? <p className="wkp-col-title">{col.title}</p> : null}
                      <div className="wkp-col-imgs">
                        {col.images.map((src) => (
                          <img
                            key={src}
                            src={src}
                            alt=""
                            decoding="async"
                            loading="lazy"
                            data-cursor="Focus"
                            data-cursor-tone="light"
                            role="button"
                            tabIndex={0}
                            aria-label={`放大查看：${col.title || b.label || '配图'}`}
                            onClick={(e) => zoom(src, col.title || b.label || undefined, e.currentTarget)}
                            onKeyDown={zoomKey(src, col.title || b.label || undefined)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : b.images.length && !b.video ? (
                <div className={`wkp-figs${b.layout === 'grid2' ? ' is-grid2' : ''}${b.images.length > 1 ? ' is-multi' : ''}${b.images.length >= 3 ? ' is-grid' : ''}`}>
                  {b.images.map((src) => (
                    <img
                      key={src}
                      src={src}
                      alt=""
                      decoding="async"
                      loading="lazy"
                      data-cursor="Focus"
                      data-cursor-tone="light"
                      role="button"
                      tabIndex={0}
                      aria-label={`放大查看：${b.label || '配图'}`}
                      onClick={(e) => zoom(src, b.label || undefined, e.currentTarget)}
                      onKeyDown={zoomKey(src, b.label || undefined)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ))}

          {/* ---- 三步流程 ---- */}
          {steps.length && !isEmpty ? (
            <section className="wkp-steps" data-sec={stepsToc ? blocks.length : undefined}>
              <h2 className="wkp-h2 wkp-rise">{copy.stepsTitle ?? '三步'}</h2>
              <div className="wkp-steps-grid">
                {steps.map((s, i) => (
                  <article className="wkp-step wkp-rise" key={s.title}>
                    <div className="wkp-step-head">
                      <p className="wkp-step-no">{s.no ?? String(i + 1).padStart(2, '0')}</p>
                      <h3 className="wkp-step-title">{s.title}</h3>
                    </div>
                    <div className="wkp-step-content">
                      <p className="wkp-step-body">{s.body}</p>
                    </div>
                    {/* 配图必须是 .wkp-step 的直接子级（不能包在 content 里），
                        才能用 grid-column:1/-1 跨两栏、和 .wkp-figs 同一条左缘同一个宽度。 */}
                    {s.images?.length ? (
                      <div className="wkp-step-figs">
                        {s.images.map((src) => (
                          <img
                            key={src}
                            src={src}
                            alt=""
                            decoding="async"
                            loading="lazy"
                            data-cursor="Focus"
                            data-cursor-tone="light"
                            role="button"
                            tabIndex={0}
                            aria-label={`放大查看：${s.title} 配图`}
                            onClick={(e) => zoom(src, s.title, e.currentTarget)}
                            onKeyDown={zoomKey(src, s.title)}
                          />
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {/* ---- 团队 ---- */}
          {team.length && !isEmpty ? (
            <section className="wkp-team">
              <h2 className="wkp-h2 wkp-rise">Team</h2>
              <div className="wkp-team-grid">
                {team.map((m, i) => (
                  <article className="wkp-person wkp-rise" key={`${m.name}-${i}`}>
                    <span className="wkp-avatar">
                      {m.avatar ? <img src={m.avatar} alt="" loading="lazy" decoding="async" /> : null}
                    </span>
                    <p className="wkp-person-name">{m.name}</p>
                    <p className="wkp-person-role">{m.role}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {/* ---- 页脚动作 ---- */}
          <footer className="wkp-foot">
            <div className="wkp-foot-actions">
              {/* 2026-09-14 按用户要求：详情页不给访客下载完整 PDF，入口已移除。
                  同时 public/works/guanxia-summer.pdf 已移出 public，避免被直接抓 URL。
                  作者模式的 WorkDetail 表单里仍有 PDF 上传/下载，那是作者自己用的。 */}
              {/* 「去线上」入口其二（页脚）已删；此处只剩「回到木马」等站内动作 */}
              {canEdit && onEdit ? (
                <button
                  type="button"
                  className="wkp-act is-primary"
                  onClick={onEdit}
                  data-cursor="Edit"
                  data-cursor-tone="light"
                >
                  {isEmpty ? '＋ 提交项目' : '编辑项目'}
                </button>
              ) : null}
              {/* 页脚动作：原「← 回到木马」按钮 2026-09-14 按用户要求改成
                  「下一个项目」箭头（回到木马仍可点左栏 Back / 空白处返回）。 */}
              {nextSlot !== null && !isEmpty ? (
                <button
                  type="button"
                  className="wkp-act wkp-act-next"
                  onClick={() => onSwitch?.(nextSlot)}
                  aria-label={`下一个项目：${slots[nextSlot]?.title ?? ''}`}
                  data-cursor="Next"
                  data-cursor-tone="light"
                >
                  下一个项目
                  <span className="wkp-act-next-arrow" aria-hidden="true">›</span>
                </button>
              ) : null}
            </div>
            <p className="wkp-foot-hint">点图可放大 · Esc 返回 · 左栏数字可跳转板块</p>
          </footer>
        </div>
      </div>

      {/* 全局「上一个 / 下一个项目」箭头（2026-09-14 用户要求）：
          挂在 .wkp（fixed 根）上而不是 .wkp-scroll 里 → 右栏滚到哪都钉在视口右缘。
          只出箭头不出文字；「上一个」从第二个已填项目起才出现。
          z-index 30 < 放大层 .wkf 的 40：开大图时箭头被盖住，不会误点。 */}
      {!isEmpty && (prevSlot !== null || nextSlot !== null) ? (
        <div className="wkp-pn">
          {prevSlot !== null ? (
            <button
              type="button"
              className="wkp-pn-btn wkp-pn-prev"
              onClick={() => onSwitch?.(prevSlot)}
              aria-label={`上一个项目：${slots[prevSlot]?.title ?? ''}`}
              data-cursor="Prev"
              data-cursor-tone="light"
            >
              <span aria-hidden="true">‹</span>
            </button>
          ) : null}
          {nextSlot !== null ? (
            <button
              type="button"
              className="wkp-pn-btn wkp-pn-next"
              onClick={() => onSwitch?.(nextSlot)}
              aria-label={`下一个项目：${slots[nextSlot]?.title ?? ''}`}
              data-cursor="Next"
              data-cursor-tone="light"
            >
              <span aria-hidden="true">›</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 点图放大后的整屏层（在里面光标显示 Close）。
          关闭必须走它的 close()（ref 句柄）—— 那是 FLIP 的「缩回原缩略图」动画，
          所以这里不给它 onClose={setFocus(null)} 之外的能力，卸载由动画 onComplete 触发。 */}
      {focus ? (
        <ImageFocus
          ref={focusHandleRef}
          src={focus.src}
          caption={focus.caption}
          origin={focus.origin}
          onClose={() => setFocus(null)}
        />
      ) : null}

      {/* 纯文字跟随标签（Focus / Back / Close / Jump …），系统光标保留 */}
      <CursorLabel />
    </div>

    {/* 共享元素飞行层（见上方 FLIP 注释）：挂在 .wkp **外面**、当它的兄弟节点，
        才躲得开 .wkp 入场时那块整页 opacity 淡入。转场结束/关闭后它 autoAlpha 归 0，
        位置尺寸留空不占视觉；src 与轨道缩略图同一个地址，浏览器直接用缓存，不会二次下载。 */}
    {flipOn ? (
      <img
        className="wkfly"
        ref={flightRef}
        src={project.cover ?? ''}
        alt=""
        aria-hidden="true"
        decoding="async"
        draggable={false}
      />
    ) : null}
    </>,
    document.body,
  );
}

export default WorkProjectPage;
