import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { CursorLabel } from '@/components/CursorLabel';
import {
  CHANNEL_LABEL,
  CHANNEL_WORD,
  MEDIA_PAGE_COPY,
  MEDIA_WORKS,
  type MediaChannel,
  type MediaWork,
} from '@/data/mediaWorks';

/**
 * 报刊亭「第一排」落地页 —— 视频 / 音乐作品。结构 + 动效复刻 mattjinn.com/videos/。
 *
 * **版式（2026-09-15 第三轮，照录屏逐项量过）**
 *   · 列表页是**纯白底**（实测 #ffffff），卡片静止时是正矩形；
 *   · 视频条中心落在视口 **44%** 高度（偏上），卡片高约 53vh；
 *   · **卡片上不叠任何文字** —— 标题/时长在卡片**下方居中**（83% / 87%），
 *     就是 `.mjp__info`，未来要加的「介绍」也挂在这儿（`work.blurb` 有值才渲染）；
 *   · 左下角刻度尺 `04 ⌇⌇⌇ 04`（当前序号 / 刻度 / 总数）在 92% 高度；
 *   · 相邻卡片只在屏幕边缘露一条 —— 所以 `--mjp-gap` 取卡片高度的 0.5 倍。
 *
 * **斜着错位摆放（2026-09-15 第五轮，照用户第二段录屏 214638 逐帧量出来的）**
 *   录屏里静止时：当前卡居屏幕中轴、左邻的**顶边比它高 84~85px**（卡片高 366px → 0.232×卡高），
 *   右邻则低同样的量；全分辨率逐列拟合的顶边斜率是 **0.00°** ——
 *   所以两侧卡片是**平移错位**，不是转过去的（错位是版式，转是另一回事）。
 *   整条片子因此是一条向右下倾斜约 5.7° 的阶梯，`--mjp-stagger` 就是这个错位量。
 *
 * **动效**
 *   ① **惯性阻尼**：滚轮累计 deltaY，位置按 `acc / 500` 跟随（**推满 5 格才走一格**），
 *      每帧 lerp(current, target, 0.1) 追；停手 160ms 后吸附到最近整格。
 *      ⚠️ 别把比率调回 0.01 —— 那是"一格滚轮 = 整数 1 = 直接换一个项目"，太灵敏且没有阻力感。
 *   ② **沿斜线切换**：`--off` 推进一格时每条卡的 `translateY` 都会变 0.232h，
 *      于是切换不再是纯水平滑动 —— 整条片子斜着往上（或往下）滑过去，
 *      这就是用户要的"滚动切换要有反应"。
 *   ③ **曲面 / 鱼眼**：速度（0~1，一阶低通，松开滚轮先涨后落）驱动 ①卡片按离中心的距离
 *      在圆柱面上后退 + 转过去 ②viewport 的 perspective 从 1900px 收到 ~1000px。
 *      ⚠️ 速度一定要按"一帧走了几格"归一化，别照抄原版喂 shader 的小系数（0.01 量级），
 *      在 CSS 里换算出来形变等于没有 —— 这是实测踩过的坑。
 *   ④ **侧转**：离中心越远的卡片固定侧转 3.5°/格（很小；主作用是给边上的卡一点厚度）。
 *   ⑤ **多层视差**：卡片 1×／背景大字 0.042×（横竖都跟着 `--cur` 慢移）／标题块与刻度尺
 *      反向小幅摆（跟 `--speed`）。
 *   ⑥ **标题逐字符 3D 翻转**：SplitText 拆 chars，从 rotateX(-90) 依次翻入
 *      （transformOrigin 50% 50% -25px + perspective 200px）；切视频时翻的是下方标题。
 *   ⑦ **点击无缝放大**：FLIP —— 记下卡片矩形，播放器先贴合上去再撑满全屏，退出原路收回。
 *   ⑧ 播放器控件整行**贴画面中线**（左标题 / 中进度 / 右 Mute·Full），Credits 在最左下。
 *
 * 注：它本人是把视频贴成 WebGL 纹理来渲染的；这里用 DOM + CSS 3D 达到接近的观感，
 * 不引 WebGL —— 这套页面已经在 three.js 的报刊亭场景隔壁，再开一个 GL 上下文不划算。
 *
 * ⚠️ 顶栏标题与播放器 Back 都放**右边**：正中间被站内「作者模式」角标占着，放中间会被压住。
 *
 * prefers-reduced-motion 时**动效**降级：无阻尼、无形变、无翻转，凑满 5 格直接切
 * （灵敏度不降级 —— 那是交互设计，不是动画偏好）。
 * ⚠️ 内嵌 / 无头的渲染环境常常**默认就报 reduce**，整套阻尼和凸起会被吃掉；
 *    要在这类环境里看完整效果，URL 加 `?motion=full` 显式打开（见 MOTION_FORCED）。
 */

import { prefersReduced } from '@/lib/motion-pref';
import { cylinderFrom, drawBentCard, type CylinderParams } from '@/lib/gallery/bend';

gsap.registerPlugin(SplitText);

/**
 * poster 图缓存 —— 画布需要一个**能 drawImage 的**图像源。
 * 不能直接用 `<video poster>`：那张图挂在 video 元素上，`drawImage(video)` 只会拿到
 * 当前解码帧（side 卡片 `preload="none"` 时是空的），poster 本身取不出来。
 * 所以每个地址自己 new 一张 Image 存着，加载完就能画。
 */
const POSTER_CACHE = new Map<string, HTMLImageElement>();
function posterFor(url?: string): HTMLImageElement | null {
  if (!url) return null;
  let img = POSTER_CACHE.get(url);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = url;
    POSTER_CACHE.set(url, img);
  }
  return img;
}

type Props = {
  /** 片单频道 —— 由报刊亭里点的那台设备决定；不传 = 列出全部作品 */
  channel?: MediaChannel;
  onClose: () => void;
};

/**
 * 动效开关：2026-09-16 起**默认全量**（策略见 src/lib/motion-pref.ts：作者要求
 * "系统关着动画也拿满效果"）。`?motion=reduced` 可把这一页手动退回降级，方便对比。
 *
 * ⚠️ 这条逃生口是**必须**的，不是随手加的：无头/内嵌的渲染环境（包括 WorkBuddy 自带的
 * 预览面板、离屏 webview）**默认就返回 reduce** —— 表现是"整套阻尼、鱼眼、凸起全没了，
 * 滚一下直接瞬移一格"。2026-09-15 用户报「没有阻尼感 / 参考站切换时视频会凸出来」，
 * 录像逐帧量下来正是这个降级分支的特征（切换只占 1~2 帧 = 33~67ms，`--speed` 恒为 0）。
 * 加了 ?motion=full 之后，在任何环境里都能把完整动效调出来。
 */
const MOTION_REDUCED = (() => {
  try {
    return new URLSearchParams(window.location.search).get('motion') === 'reduced';
  } catch {
    return false;
  }
})();
const reduce = () => MOTION_REDUCED || prefersReduced();

/**
 * 滚轮手感参数（2026-09-15 第七轮，照用户"参考站要划 5 格才换一个"的要求定）。
 * Windows/Chrome 上一格滚轮的 deltaY = 100（`deltaMode: 0`），所以：
 *   STEP_DELTA = 100 × 5 = 500  →  推满 5 格才换一个项目
 *   BURST_MS   = 160            →  停手 160ms 算"一次推"结束，开始吸附
 * 触控板 / 平滑滚轮发的是一串小 delta，按累计量算，和鼠标格数天然等价。
 */
const WHEEL_NOTCH = 100;
const STEP_DELTA = WHEEL_NOTCH * 5;
const BURST_MS = 160;

export function MediaGalleryPage({ channel, onClose }: Props) {
  /**
   * 片单 = 属于当前频道的作品。
   * **没标 `channel` 的作品在任何频道都显示** —— 现在 AI 频道还没有片子（第二条频道），
   * 所以它先退回全部作品，免得点第二台设备开天窗；等数据补上 `channel: 'ai'` 就自动分流。
   */
  const list = useMemo(() => {
    if (!channel) return MEDIA_WORKS;
    const own = MEDIA_WORKS.filter((w) => w.channel === channel);
    if (!own.length) return MEDIA_WORKS; // 该频道还没片子 → 先列全部
    return MEDIA_WORKS.filter((w) => !w.channel || w.channel === channel);
  }, [channel]);
  const total = list.length;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [entered, setEntered] = useState(false);
  const reduced = useMemo(reduce, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** 透视层 —— 滚动时动态收紧 perspective，做出"镜头鱼眼"的挤压 */
  const vpRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  /** 每条片子居中时，wrapper 需要退到的距离（实测，因为宽高比不同没法用固定步长推算） */
  const centers = useRef<number[]>([]);
  /** 被点击卡片的屏幕矩形 —— 给展开动画当起点 */
  const flipRect = useRef<DOMRect | null>(null);
  /** 滚动状态：target = 目标停在第几条（浮点），current = 阻尼后的实际位置 */
  const sr = useRef({ current: 0, target: 0, last: 0, speed: 0 });
  const indexRef = useRef(0);
  const snapTimer = useRef(0);
  /* ---- 滚轮"手感"的三个量（2026-09-15 第七轮）----
     accRef  : 这一"推"里累计的 deltaY 零头
     baseRef : 这一"推"开始时锁定的整格位置（零头都相对它算）
     burstRef: 上一次滚轮事件的时刻，用来切分"一次推" */
  const accRef = useRef(0);
  const baseRef = useRef(0);
  const burstRef = useRef(0);

  /* ---- 圆柱面绘制（2026-09-16 第九轮）----
     卡片可见的那一层不再是 <video>，而是一块 canvas：每帧把视频帧按圆柱面投影重画一遍。
     video 仍然在 DOM 里（opacity:0）当帧源 —— 它是唯一能持续解码的地方，
     换成逐帧图片序列要多下几十 MB。 */
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  /** 每格的实际 CSS 尺寸（measure 时读一次，**绝不能放到每帧里读** —— 那是强制回流） */
  const cellSize = useRef<{ w: number; h: number }[]>([]);
  /** canvas 的后备存储倍率（DPR 封顶 2，再高只是白烧像素） */
  const dprRef = useRef(1);
  /** 每格上一帧画了什么 —— 静止的卡（源是 poster）没必要重画 */
  const drawn = useRef<
    { bend: number; apex: number; w: number; h: number; live: boolean }[]
  >([]);
  /**
   * 本帧的跨格进度，由 `apply()` 写入、`drawCards()` 读取。
   * ⚠️ 必须有这个 ref，不能让 drawCards 自己再算一遍 `|current − round(current)|`：
   *    两个 rAF 循环的**回调顺序不保证**，各自读 `sr.current` 会差一帧 ——
   *    于是 CSS 那边的 `--bulge`（转过去 / 推出去）和画布这边画的弧度对不上，
   *    实测差到 0.034（阈值 0.02）。统一从一个来源取值就永远同步。
   */
  const bulgeRef = useRef(0);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const clampIdx = (v: number) => (total <= 0 ? 0 : Math.min(total - 1, Math.max(0, v)));

  /**
   * 每条居中的距离表 + 每格画布的尺寸同步。
   * 画布的 CSS 尺寸是 100%（跟格子一样大），但**后备存储**要按 DPR 放大，否则在高分屏上
   * 整条片子是糊的（画布默认 300×150，不显式设尺寸就会被拉伸）。
   * ⚠️ 改 canvas.width 会清空画布并重置 ctx 状态 —— 所以标 -1 让下一帧无条件重画。
   */
  const measure = useCallback(() => {
    centers.current = itemRefs.current.map((el, i) =>
      el ? el.offsetLeft + el.offsetWidth / 2 : (centers.current[i] ?? 0),
    );
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dprRef.current = dpr;
    for (let i = 0; i < itemRefs.current.length; i += 1) {
      const el = itemRefs.current[i];
      const cv = canvasRefs.current[i];
      if (!el || !cv) continue;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      cellSize.current[i] = { w, h };
      const bw = Math.max(1, Math.round(w * dpr));
      const bh = Math.max(1, Math.round(h * dpr));
      if (cv.width !== bw || cv.height !== bh) {
        cv.width = bw;
        cv.height = bh;
        drawn.current[i] = { bend: -1, apex: 0, w: 0, h: 0, live: false };
      }
    }
  }, []);

  /** 在浮点位置 v 上插值出居中距离（相邻两条的 centers 之间线性插值） */
  const posAt = useCallback((v: number) => {
    const c = centers.current;
    if (!c.length) return 0;
    const f = clampIdx(Math.floor(v));
    const t = clampIdx(Math.ceil(v));
    return c[f] + (c[t] - c[f]) * (v - f);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /** 把 current / speed 落到 DOM 上（每帧调用，不进 React 渲染，避免每帧 setState） */
  const apply = useCallback(() => {
    const s = sr.current;
    if (wrapRef.current) {
      wrapRef.current.style.transform = `translate(${-posAt(s.current)}px, -50%)`;
    }
    // s.speed 已经是归一化好的 0~1（见上面的惯性循环）
    const sp = Math.min(1, Math.max(0, s.speed));
    /**
     * ⚠️ 2026-09-15 第七轮：形变的驱动量从「速度」换成「跨格进度」`--bulge`。
     *
     * 速度派生的峰值出现在**起步那一瞬**（lerp 是指数收敛，第一帧位移最大），
     * 也就是画面还贴在旧那条上的时候；而参考站录屏（30fps 逐帧）里是**走到半路最鼓、
     * 落位就回平** —— 卡片在中间鼓成一张凸面，两边随之向后退。
     * 所以另开一个量：`--bulge = |current 到最近整格的距离| × 2`
     *   · 落位静止 = 0（卡片回平）
     *   · 正卡在两条中间 = 1（鼓到最大）
     *   · 推滚轮时 target 是小数值 → current 必然离开整格 → 推的过程中就鼓起来了
     * 这才是「切换时视频会凸出来」的来源。
     * `--speed` 保留给需要「动感」的小位移（背景大字 / 标题 / 刻度尺的甩动）和高光。
     */
    const frac = Math.abs(s.current - Math.round(s.current));
    const bulge = Math.min(1, frac * 2);
    bulgeRef.current = bulge; // 与 canvas 共用的唯一来源（见 bulgeRef 注释）
    const root = rootRef.current;
    if (root) {
      root.style.setProperty('--speed', sp.toFixed(4));
      root.style.setProperty('--bulge', bulge.toFixed(4));
      root.style.setProperty('--cur', s.current.toFixed(4)); // 浮点位置 → 各层不同倍率的视差
    }
    /**
     * 鱼眼/曲线透视：跨格时把透视距离从 1900px 收到 1000px ——
     * 透视越"近"，画面边缘的压缩越强，整条片子就像隔着一枚凸透镜在看（参考站 6~12s 那段）。
     * 落位后恢复 1900px，卡片回到平整状态。
     */
    if (vpRef.current) {
      vpRef.current.style.perspective = `${Math.round(1900 - bulge * 900)}px`;
    }
    /**
     * 每张卡到"当前位置"的距离 → --off。CSS 拿它算卡片在**圆柱面**上的角度与进深
     * （离中心越远越往后倒、转得越多），整条片子看着就是一张被拱起来的曲面，
     * 而不是贴在同一平面上的一排方块。夹在 ±2.2 —— 更远的卡已经出屏，再转会翻过头。
     */
    for (let i = 0; i < itemRefs.current.length; i += 1) {
      const el = itemRefs.current[i];
      if (!el) continue;
      const off = Math.max(-2.2, Math.min(2.2, i - s.current));
      el.style.setProperty('--off', off.toFixed(3));
    }
    // 实时高亮最近的一条（只在真的变了才 setState）
    const nearest = Math.round(s.current);
    if (nearest !== indexRef.current) {
      indexRef.current = nearest;
      setIndex(nearest);
    }
  }, [posAt]);

  /**
   * 每帧把每一格重画到自己的 canvas 上 —— 这就是「顶点着色器弯曲」那一层的落点。
   *
   * 关键取舍：
   *   · **当前那条用 `<video>` 当真源**（它一直在解码，`drawImage` 就能拿到最新帧），
   *     其余格用 poster 静态图 —— 省得为了弯曲把四条片子全解码。
   *   · **静止的卡不重画**：源是 poster 时画面不变，只有形变 / 尺寸变了才值得重画；
   *     而活的视频每帧都在变，必须每帧重画。于是落位静止时每帧只有当前那条在画，
   *     一次 `drawImage`（bend<FLAT_EPS 走平面分支），代价可以忽略。
   *   · `readyState < 2` 时视频还没有可用帧，`drawImage` 会画出空白 → 必须回退 poster。
   *   · 什么都拿不到（poster 还在下）→ **这一帧什么都不做**，保留上一帧画面，
   *     否则会闪一下白（canvas 已经被 clearRect 清过了）。
   */
  const drawCards = useCallback(() => {
    const s = sr.current;
    const nearest = Math.round(s.current);
    // 用 apply() 写下的那一份，保证画布弧度与 CSS 的 --bulge 严格同步
    const bulge = bulgeRef.current;
    const dpr = dprRef.current || 1;

    for (let i = 0; i < list.length; i += 1) {
      const cv = canvasRefs.current[i];
      const size = cellSize.current[i];
      if (!cv || !size || size.w <= 0 || size.h <= 0) continue;
      const off = Math.max(-2.2, Math.min(2.2, i - s.current));
      if (Math.abs(off) > 2.6) continue; // 已经出屏，别浪费
      const p: CylinderParams = cylinderFrom(bulge, off);

      const vid = videoRefs.current[i];
      const live = i === nearest && !!vid && vid.readyState >= 2 && vid.videoWidth > 0;
      let state = drawn.current[i];
      if (!state) {
        state = { bend: -1, apex: 0, w: 0, h: 0, live: false };
        drawn.current[i] = state;
      }
      if (
        !live &&
        Math.abs(p.bend - state.bend) < 0.0015 &&
        Math.abs(p.apex - state.apex) < 0.002 &&
        state.w === size.w &&
        state.h === size.h
      ) {
        continue; // 静止的静态图 —— 上一帧已经画过，不用再画
      }

      let source: CanvasImageSource | null = null;
      let sw = 0;
      let sh = 0;
      if (live && vid) {
        source = vid;
        sw = vid.videoWidth;
        sh = vid.videoHeight;
      } else {
        const img = posterFor(list[i]?.poster);
        if (img && img.complete && img.naturalWidth > 0) {
          source = img;
          sw = img.naturalWidth;
          sh = img.naturalHeight;
        }
      }
      if (!source) continue;

      const ctx = cv.getContext('2d');
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (drawBentCard(ctx, source, sw, sh, size.w, size.h, p)) {
        state.bend = p.bend;
        state.apex = p.apex;
        state.w = size.w;
        state.h = size.h;
        state.live = live;
      }
    }
  }, [list]);

  /* ---- 画布循环 ----
     ⚠️ 已经并入下面那条**统一的帧循环**（先 apply 再 drawCards），
     这里不再单开一个 rAF：两个循环的回调顺序不受控，画布会比 `--bulge` 晚一帧
     （2026-09-16 实测夹角 0.034，描出来的弧和 CSS 转的角度对不上）。 */

  /* dev 钩子：给无头验证脚本读每一格画成什么样（off / bend / apex / 源是活的还是静态图），
     以及滚轮那台"状态机"的内部量（current / target / 棘轮锚点 base / 零头 acc）。
     ⚠️ 只读。画布的**几何**要靠探针量像素（顶边弧线），这个钩子只用来确认接线对不对。
     ⚠️ 断言滚轮阈值必须看 `base` 而不是 `current`：`current` 是 lerp 出来的、受帧率影响，
     无头下 rAF 被节流时会读到半路上的值（实测把「4 格不掉」误判成掉了一格）。 */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__mjpCards = () => ({
      scroll: {
        current: sr.current.current,
        target: sr.current.target,
        speed: sr.current.speed,
        base: baseRef.current,
        acc: accRef.current,
        index: indexRef.current,
        total,
      },
      cards: itemRefs.current.map((el, i) => ({
        index: i,
        off: el ? Math.max(-2.2, Math.min(2.2, i - sr.current.current)) : null,
        bend: drawn.current[i]?.bend ?? -1,
        apex: drawn.current[i]?.apex ?? 0,
        live: drawn.current[i]?.live ?? false,
        cw: canvasRefs.current[i]?.width ?? 0,
        ch: canvasRefs.current[i]?.height ?? 0,
      })),
    });
    return () => {
      delete w.__mjpCards;
    };
  }, [total]);

  useLayoutEffect(() => {
    measure();
    apply();
    const onResize = () => {
      measure();
      apply();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure, apply]);

  /* ---- 统一的帧循环：推进惯性 → 落 DOM（apply）→ 重画画布 ----
   *
   * ⚠️ **这三步必须在同一个 rAF 回调里按这个顺序做完**，别拆成两个循环。
   *    两个 rAF 循环都靠回调里重新 `requestAnimationFrame` 续命，回调顺序就是
   *    "注册顺序"，**不受控**；实测画布被人推进去的那一帧已经读到新位置、
   *    而 `apply()` 还没把 `--bulge` 写下去 → 描出来的弧和 CSS 转的角度差一帧
   *    （探针量到 |bend − bulge| = 0.034）。放一条循环里就没有这个缝隙。
   *
   * ⚠️ 降级（reduced）时**不再整条 early-return**：惯性不该推（不制造位移），
   *    但画面还是得画 —— 否则整页卡片全白（画布是唯一可见的那一层）。
   */
  useEffect(() => {
    if (total <= 0) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = sr.current;
      if (!reduced && total > 1) {
        s.current += (s.target - s.current) * 0.1; // 阻尼系数 0.1
        /*
         * 速度（0~1）—— 驱动视差 / 鱼眼 / 标题甩动。
         * ⚠️ 别照抄原版 `|Δ| * 0.01` 的系数：那是喂给 WebGL shader 的量级，
         *    在 CSS 里换算出来只有 0.01 出头，形变等于没有（2026-09-15 实测踩过）。
         * 这里按"一帧走了几格"归一化。**但除数不能凭感觉写**：
         *    每帧位移 = (target - current) × 0.1（阻尼系数），第一帧最多就是 **0.1 格**，
         *    所以原来写的 `delta / 0.25` 是个**永远够不到的分母** —— 峰值被死死压在 0.4 以下，
         *    再经低通只剩 0.26（2026-09-15 第五轮探针实测 maxSpeed = 0.259），
         *    形变幅度只有设计值的四分之一。改成 0.13 才对得上：单格切换峰值 ≈ 0.6。
         *    （连续快滚时 target 一次跳好几格 → delta 更大 → 打满 1.0，越快弯得越狠。）
         */
        const delta = Math.abs(s.current - s.last);
        s.last = s.current;
        s.speed += (Math.min(1, delta / 0.13) - s.speed) * 0.5;
      }
      apply(); // 先落 DOM（含 --bulge / --off / perspective）
      drawCards(); // 再按同一份 bulge 重画画布
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [apply, drawCards, reduced, total]);

  const go = useCallback(
    (dir: number) => {
      const next = clampIdx(Math.round(sr.current.target) + dir);
      sr.current.target = next;
      // 键盘 / 触摸 / 降级分支都走这里 —— 必须把滚轮的棘轮锚点一起挪过去，
      // 否则下一轮滚轮的零头会相对一个**过期的整格**去算（baseRef 是滚轮的唯一基准）
      baseRef.current = next;
      accRef.current = 0;
      indexRef.current = next;
      setIndex(next);
      if (reduced) {
        sr.current.current = next;
        apply();
      }
    },
    [apply, reduced],
  );

  /* ---- 滚轮：累计"推"的力度，推满 STEP 才走一格，松手吸附 ----
   *
   * ⚠️ 2026-09-15 第七轮重写。原来的映射是 `target += clamp(deltaY, ±100) * 0.01`，
   *    而 Windows 上一格滚轮的 deltaY 正好是 **100** —— 于是**一格 = 整数 1 = 换一个项目**，
   *    半格（50）也会被吸附成 1 格。用户的原话：「我的滚轮滑动幅度比较小就得切换下一个项目了，
   *    像参考我用力向下划 5 格才切换下一个」。
   *
   * 现在改成两段式，一次解决"太灵敏"和"没有阻尼感"两件事：
   *   ① **跟随**：位置按 `acc / 500` 的比率跟着滚轮走 —— 也就是说推满 5 格才前进一整格。
   *      推的过程中画面**会动但只动一点点**，这就是"阻尼感"的来源（有阻力、推得动但推不满会退回去）。
   *   ② **吸附**：停手 160ms（或换方向）后，把零头抹掉、吸附到最近一格。
   *      推不满半格 → 原样退回；推过一半 → 补完那一格。
   *   ③ 顺带把"凸起来"也救回来了：画面真的在动 → `--speed > 0` → 卡片才朝镜头拱出来。
   *      原来一格一瞬移，速度只在降级分支里恒为 0，那层形变永远不会出现。
   *   ④ 降级分支（reduced）不加动效，但**照样要凑满 5 格**才允许换 —— 灵敏度是交互设计，不是动画偏好。
   */
  useEffect(() => {
    if (total <= 1) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // 行 / 页模式换算成像素（多数鼠标是 0 = 像素）
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      const d = e.deltaY * unit;
      if (Math.abs(d) < 1) return;

      const now = performance.now();
      const idle = now - burstRef.current > BURST_MS;
      const flip = accRef.current !== 0 && Math.sign(d) !== Math.sign(accRef.current);
      if (idle || flip) {
        // 换了一次"推"：上一轮没推满的零头作废，画面先回到棘轮锁住的那一整格
        // （⚠️ 别写成 `round(target)` —— 那是"四舍五入"，2.5 格就会被抬成一格，又变灵敏了）
        accRef.current = 0;
        sr.current.target = clampIdx(baseRef.current);
      }
      burstRef.current = now;
      accRef.current += d;

      window.clearTimeout(snapTimer.current);
      if (reduced) {
        // 降级：不制造位移（也就不产生任何运动），只按"推满一格"来换
        if (Math.abs(accRef.current) >= STEP_DELTA) {
          const dir = accRef.current > 0 ? 1 : -1;
          accRef.current -= dir * STEP_DELTA;
          baseRef.current = clampIdx(baseRef.current + dir);
          go(dir);
        }
        return;
      }
      /*
       * **棘轮**：凑满一格就立刻在 base 上落一格、把零头留下来接着算。
       * 这一步是为了让"划满 5 格"成为**唯一的提交条件** ——
       * 如果只在松手时按 `Math.round()` 收尾，2.5 格就会被四舍五入成 1 格（实测 3 格就换走了），
       * 又变回"太灵敏"。棘轮之后：4 格 = 不换（画面推出去 0.8 格再弹回来），5 格 = 稳稳换一格，
       * 10 格 = 连换两格。多出来的零头不会被吞掉。
       */
      const steps = Math.trunc(accRef.current / STEP_DELTA);
      if (steps !== 0) {
        accRef.current -= steps * STEP_DELTA;
        baseRef.current = clampIdx(baseRef.current + steps);
      }
      const s = sr.current;
      s.target = clampIdx(baseRef.current + accRef.current / STEP_DELTA);
      snapTimer.current = window.setTimeout(() => {
        // 松手：零头一律抹掉（推不满 5 格就退回整格），落定到棘轮锁住的那一格
        const snap = clampIdx(baseRef.current);
        sr.current.target = snap;
        accRef.current = 0;
      }, BURST_MS);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.clearTimeout(snapTimer.current);
    };
  }, [go, reduced, total]);

  const touchY = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchY.current === null) return;
    const dy = touchY.current - e.changedTouches[0].clientY;
    touchY.current = null;
    if (Math.abs(dy) < 40) return;
    go(dy > 0 ? 1 : -1);
  };

  /* ---- 键盘：←/→ 切换，Esc 退出播放（没在播就关整页） ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (playing) setPlaying(false);
        else onClose();
        return;
      }
      if (playing) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, playing]);

  const openAt = useCallback((i: number, el: HTMLElement) => {
    flipRect.current = el.getBoundingClientRect();
    indexRef.current = i;
    setIndex(i);
    setPlaying(true);
  }, []);

  const current: MediaWork | undefined = list[index];

  const cls = useMemo(
    () => ['mjp', entered ? 'is-in' : '', playing ? 'is-playing' : ''].filter(Boolean).join(' '),
    [entered, playing],
  );

  return (
    <>
    <div
      ref={rootRef}
      className={cls}
      role="dialog"
      aria-modal="true"
      aria-label="视频与音乐作品"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* ---- 顶栏（播放态淡出，复刻 mattjinn 的 .navigation 行为） ---- */}
      <header className="mjp__nav">
        <button
          type="button"
          className="mjp__back"
          onClick={onClose}
          data-cursor="Back"
          data-cursor-tone="dark"
        >
          ← Back
        </button>
        {/* 顶栏标题 = 当前频道名（从哪台设备进来的）；没频道时用默认标题。
            放**右上角**（参考站也是右上角挂 Menu）——
            正中间被站内「作者模式」角标占着，放中间会被压住（2026-09-15 实测）。 */}
        <span className="mjp__nav-title">
          {channel ? CHANNEL_LABEL[channel] : MEDIA_PAGE_COPY.title}
        </span>
      </header>

      {total === 0 ? (
        <p className="mjp__empty">{MEDIA_PAGE_COPY.empty}</p>
      ) : (
        <>
          <div className="mjp__viewport" ref={vpRef} data-cursor="" data-cursor-tone="dark">
            {/* ---- 背景大字层（多层视差里的最慢一层）----
                参考站那套「music / videos / shows」的斜体衬线大字，这里当作背景字：
                随 --cur 以 **0.05×** 的速度横移（卡片是 1×），看着就是被卡片"掠过"的远景。 */}
            <div className="mjp__bgword" aria-hidden="true">
              {channel ? CHANNEL_WORD[channel] : MEDIA_PAGE_COPY.word}
            </div>
            <div className="mjp__wrapper" ref={wrapRef}>
              {list.map((w, i) => (
                <ReelItem
                  key={w.id}
                  elRef={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  canvasRef={(el) => {
                    canvasRefs.current[i] = el;
                  }}
                  videoRef={(el) => {
                    videoRefs.current[i] = el;
                  }}
                  work={w}
                  index={i}
                  isCurrent={i === index}
                  onOpen={openAt}
                />
              ))}
            </div>
          </div>

          {/* ---- 画面下方居中的信息块：标题 + 时长（+ 以后补的简介） ----
              参考站（mattjinn.com/videos/）的位置：视频条居中在偏上，**文字在它下方居中**，
              卡片本身不叠任何文字。2026-09-15 用户明确要求改成这样。
              key 用 id 强制换节点 —— 否则 SplitText 的 revert 会把上一个标题的文字写回来。 */}
          {current ? (
            <VideoInfo key={current.id} work={current} reduced={reduced} />
          ) : null}

          {/* ---- 左下角 ticker：序号 + 一列刻度线 + 序号（形态照参考站） ---- */}
          <div className="mjp__ticker" aria-hidden="true">
            <span className="mjp__ticker__num is-current">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="mjp__ticker__ticks">
              {list.map((w, i) => (
                <span key={w.id} className={`mjp__tick${i === index ? ' is-on' : ''}`} />
              ))}
            </span>
            <span className="mjp__ticker__num">{String(total).padStart(2, '0')}</span>
          </div>
        </>
      )}

      {playing && current ? (
        <Player
          work={current}
          flipFrom={flipRect.current}
          reduced={reduced}
          onClose={() => setPlaying(false)}
        />
      ) : null}
    </div>

    {/* 手绘圈注式跟随标签（Play / Back / Sound / Focus …），系统光标保留。
        ⚠️ 必须挂在 .mjp **外面**当兄弟节点：.mjp 入场是整块 opacity 0→1 + scale(1.04)，
        opacity<1 的元素会给 fixed 子元素造出包含块，挂在里面会被那层缩放锁住。
        注：这个页面原先**根本没挂 CursorLabel**（只有木马详情页挂了），
        data-cursor 标记一直是死的 —— 2026-09-15 用户说「把光标换成视频网站那样」才发现。 */}
    <CursorLabel />
    </>
  );
}

/**
 * 视频条下方的居中信息块（参考站的版式：卡片下面单独一行文字，不叠在画面上）。
 *   · 标题：display 衬线，逐字符 rotateX 翻入（SplitText）—— 参考站切视频时就是这段在翻；
 *   · 时长：同字族斜体，小一号；
 *   · 简介 `blurb`：给了才渲染（用户说「我会另外在视频下面加介绍」，先把槽位留着）。
 */
function VideoInfo({ work, reduced }: { work: MediaWork; reduced: boolean }) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    gsap.killTweensOf(el);
    if (reduced) {
      gsap.set(el, { autoAlpha: 1 });
      return;
    }
    let split: SplitText | null = null;
    try {
      // 参数照抄参考站：transformOrigin 的 z 位移 -25px 决定翻转半径，
      // 配合父级 perspective:200px 才有"立起来又拍下去"的立体感。
      split = new SplitText(el, { type: 'chars' });
      gsap.set(el, { autoAlpha: 1 });
      gsap.set(split.chars, {
        autoAlpha: 0,
        rotateX: -90,
        transformOrigin: '50% 50% -25px',
      });
      gsap.to(split.chars, {
        autoAlpha: 1,
        rotateX: 0,
        duration: 0.72,
        stagger: 0.018,
        ease: 'power3.out',
      });
    } catch {
      gsap.set(el, { autoAlpha: 1 }); // SplitText 不可用就直接显示
    }
    return () => {
      split?.revert();
    };
  }, [reduced]);

  return (
    <div className="mjp__info">
      <h2 className="mjp__info__title" ref={titleRef}>
        {work.title}
      </h2>
      {work.length ? <p className="mjp__info__len">{work.length}</p> : null}
      {work.blurb ? <p className="mjp__info__blurb">{work.blurb}</p> : null}
    </div>
  );
}

/** 列表里的一格：静音循环预览，画面上不叠任何文字 */
function ReelItem({
  elRef,
  canvasRef,
  videoRef,
  work,
  index,
  isCurrent,
  onOpen,
}: {
  elRef: (el: HTMLElement | null) => void;
  canvasRef: (el: HTMLCanvasElement | null) => void;
  videoRef: (el: HTMLVideoElement | null) => void;
  work: MediaWork;
  index: number;
  isCurrent: boolean;
  onOpen: (i: number, el: HTMLElement) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const vid = useRef<HTMLVideoElement | null>(null);

  const setVid = useCallback(
    (el: HTMLVideoElement | null) => {
      vid.current = el;
      videoRef(el);
    },
    [videoRef],
  );

  /* 只有当前这一格在播，其余全暂停 —— 四条预览同时解码太浪费。
     ⚠️ 视频现在**不可见**（opacity:0），它只是画布的帧源。所以**不能**用
     `display:none` / `visibility:hidden` 藏它 —— 那会让浏览器停掉解码，
     `drawImage` 再也拿不到新帧，卡片就死在第一帧上。 */
  useEffect(() => {
    const el = vid.current;
    if (!el) return;
    if (isCurrent) void el.play().catch(() => {});
    else el.pause();
  }, [isCurrent]);

  return (
    <article
      ref={elRef}
      className={`mjp__media${isCurrent ? ' is-current' : ''}`}
      /* 关键：格子按这条片子自己的宽高比撑开，竖版才不会被 cover 裁掉 */
      style={{ ['--ar' as string]: work.aspect ?? 16 / 9 }}
    >
      <button
        ref={btnRef}
        type="button"
        className="mjp__media-btn"
        onClick={() => onOpen(index, btnRef.current!)}
        data-cursor="Play"
        data-cursor-tone="dark"
        aria-label={`播放：${work.title}`}
      >
        {/* 可见的那一层：每帧按圆柱面投影重画的画布 ——
            拱起、两端后退、上下边成弧线都在这里（见 src/lib/gallery/bend.ts）。 */}
        <canvas ref={canvasRef} className="mjp__media-canvas" aria-hidden="true" />
        {/* 帧源：藏在画布下面（opacity:0），只负责持续解码，
            只有当前这条预取，其余等轮到它再拉 —— 否则一进页面就 4 条预览一起下，
            紧接着被 pause() 掐掉，白白浪费带宽（实测 3 条 ERR_ABORTED）。 */}
        <video
          ref={setVid}
          className="mjp__media-video"
          src={work.coverVideo ?? work.video}
          poster={work.poster}
          loop
          muted
          playsInline
          preload={isCurrent ? 'auto' : 'none'}
        />
      </button>
    </article>
  );
}

/** 全屏播放器：点画面播放/暂停 + 进度条 + 音量 + 全屏 + Credits */
function Player({
  work,
  flipFrom,
  reduced,
  onClose,
}: {
  work: MediaWork;
  flipFrom: DOMRect | null;
  reduced: boolean;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const closing = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [time, setTime] = useState('00:00');
  const [muted, setMuted] = useState(false);
  const [credits, setCredits] = useState(false);
  const [hover, setHover] = useState(false);

  /* FLIP：先贴合到卡片矩形，再撑满全屏 */
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || !flipFrom || reduced) return;
    gsap.set(el, {
      position: 'fixed',
      left: flipFrom.left,
      top: flipFrom.top,
      width: flipFrom.width,
      height: flipFrom.height,
      borderRadius: 12,
      overflow: 'hidden',
    });
    gsap.to(el, {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      borderRadius: 0,
      duration: 0.85,
      ease: 'expo.out',
      onComplete: () =>
        gsap.set(el, { clearProps: 'position,left,top,width,height,borderRadius,overflow' }),
    });
  }, [flipFrom, reduced]);

  const doClose = useCallback(() => {
    const el = rootRef.current;
    if (!el || !flipFrom || reduced || closing.current) {
      onClose();
      return;
    }
    closing.current = true;
    gsap.to(el, {
      position: 'fixed',
      left: flipFrom.left,
      top: flipFrom.top,
      width: flipFrom.width,
      height: flipFrom.height,
      borderRadius: 12,
      duration: 0.5,
      ease: 'power3.inOut',
      onComplete: onClose,
    });
  }, [flipFrom, onClose, reduced]);

  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    setTime('00:00');
    setCredits(false);
  }, [work.id]);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const onTime = useCallback(() => {
    const el = ref.current;
    if (!el || !el.duration) return;
    setProgress(el.currentTime / el.duration);
    setTime(fmt(el.currentTime));
  }, []);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !el.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    el.currentTime = ratio * el.duration;
    setProgress(ratio);
  };

  const toggleMute = () => {
    const el = ref.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const fullscreen = () => {
    const el = ref.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };

  const pcls = ['mjp__player', hover ? 'is-hover' : '', credits ? 'is-credits' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={pcls} ref={rootRef}>
      <video
        ref={ref}
        className="mjp__player-video"
        src={work.video ?? work.coverVideo}
        poster={work.poster}
        playsInline
        preload="auto"
        autoPlay
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={onTime}
        onEnded={() => setPlaying(false)}
      />

      {/* 点画面 = 播放/暂停（mattjinn 的手法） */}
      <button
        type="button"
        className="mjp__player-stage"
        onClick={toggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        data-cursor={playing ? 'Pause' : 'Play'}
        data-cursor-tone="dark"
        aria-label={playing ? '暂停' : '播放'}
      />

      {/* 顶部居中：返回（参考站写的是 Back） */}
      <button
        type="button"
        className="mjp__player-close"
        onClick={doClose}
        data-cursor="Back"
        data-cursor-tone="dark"
      >
        ← Back
      </button>

      {/* 垂直居中一行：左标题 / 中进度条 / 右图标 —— 参考站就是把控件放在画面中线上，
          而不是常见的贴底。 */}
      <div
        className="mjp__player-row"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <p className="mjp__player-title">{work.title}</p>
        <div
          className="mjp__player-progress"
          onClick={seek}
          style={{ ['--p' as string]: progress }}
          role="presentation"
        >
          <div className="mjp__player-bar">
            <span className="mjp__player-bar-fill" />
          </div>
          <span className="mjp__player-time">{time}</span>
        </div>
        <div className="mjp__player-icons">
          <button
            type="button"
            className="mjp__player-btn"
            onClick={toggleMute}
            data-cursor="Sound"
            data-cursor-tone="dark"
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            className="mjp__player-btn"
            onClick={fullscreen}
            data-cursor="Focus"
            data-cursor-tone="dark"
          >
            Full
          </button>
        </div>
      </div>

      {/* 左下角：Credits（参考站它在最左下，不在控制条里） */}
      <div
        className="mjp__player-foot"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <button
          type="button"
          className={`mjp__player-btn${credits ? ' is-on' : ''}`}
          onClick={() => setCredits((v) => !v)}
          data-cursor="Info"
          data-cursor-tone="dark"
        >
          {credits ? 'Close' : 'Credits'}
        </button>
      </div>

      {credits ? (
        <div className="mjp__player-credits">
          {work.blurb ? <p className="mjp__player-blurb">{work.blurb}</p> : null}
          {work.credits?.length ? (
            <ul className="mjp__player-creditlist">
              {work.credits.map((c) => (
                <li key={`${c.role}-${c.name}`}>
                  <span className="mjp__player-role">{c.role}</span>
                  <span className="mjp__player-name">{c.name}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default MediaGalleryPage;
