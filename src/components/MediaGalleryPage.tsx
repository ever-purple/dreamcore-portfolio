import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EASE } from '@/lib/ease';
import gsap from 'gsap';
import { CursorLabel } from '@/components/CursorLabel';
import { PageDecor } from '@/components/PageDecor';
import { StudioChrome } from '@/components/StudioChrome';
import { useEscape } from '@/lib/escape-stack';
import {
  CHANNEL_LABEL,
  CHANNEL_WORD,
  MEDIA_PAGE_COPY,
  orderedWorks,
  startIndexFor,
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
 *   ⑥ **标题逐字符 3D 翻转**：**标题由 React 拆成逐字符 `<span>`**，从 rotateX(**+90**) 依次翻入
 *      （transformOrigin 50% 50% -10px + perspective 200px）；切视频时旧标题挂到一层"幽灵"
 *      翻去 -90，新标题同时翻入 —— 方向照参考站 activate / deactivate。
 *      ⚠️ 别改回 GSAP SplitText，理由见 VideoInfo 顶部那段。
 *   ⑦ **原地播放（2026-09-21）**：不再有全屏播放器/FLIP 放大 —— 点当前卡就地播完整版
 *      （带声音），再点暂停；换卡自动退回静音循环预览。控件（播放/暂停 + 进度条 + 时间）
 *      挂在视频正下方（PlaybackBar）。
 *   ⑧ **循环片单（2026-09-21）**：三个设备入口共用同一份片单（横屏 → AI → 竖屏），
 *      渲染三份做成无缝循环，越过头尾继续滑；频道只决定进门定位在第几条。
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

/** 播放状态机：idle = 静音预览循环 / playing = 完整版 / paused = 停在完整版当前帧 */
type PlayState = 'idle' | 'playing' | 'paused';

type Props = {
  /** 进入入口的频道 —— **只决定初始定位**（DVD→第一条横屏 / DV→第一条 AI / MP3→第一条竖屏），
      不再过滤列表：三个入口看到的是同一份全量循环片单（2026-09-21）。 */
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

/** 秒 → mm:ss（进度条时间显示用） */
const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function MediaGalleryPage({ channel, onClose }: Props) {
  /**
   * 片单 = 属于当前频道的作品。
   * **没标 `channel` 的作品在任何频道都显示** —— 现在 AI 频道还没有片子（第二条频道），
   * 所以它先退回全部作品，免得点第二台设备开天窗；等数据补上 `channel: 'ai'` 就自动分流。
   */
  /** 全量循环片单（横屏 → AI → 竖屏）。频道**只决定起点**，不再过滤（2026-09-21）。 */
  const list = useMemo(() => orderedWorks(), []);
  const total = list.length;
  /**
   * 循环画廊：把片单渲染**三份**（前 / 中 / 后），绝对下标 a ∈ [0, 3n)。
   * 落位后由 apply() 把位置整体平移回中间那份 —— 三份布局逐像素相同，
   * 平移一个周期画面不变，肉眼看到的就是一条首尾相接的循环片。
   */
  const copies = 3;
  const nodes = total * copies;
  /** 进门位置：DVD→第一条横屏 / DV→第一条 AI(没有就落插入点) / MP3→第一条竖屏 */
  const startIndex = useMemo(() => startIndexFor(channel), [channel]);
  /** 逻辑下标（0..n-1：信息块 / 刻度尺用） */
  const [index, setIndex] = useState(startIndex);
  /** 绝对下标（0..3n-1：哪一格在屏幕中间 / 哪一格在播） */
  const [absIndex, setAbsIndex] = useState(startIndex + total);
  /**
   * 播放状态机（2026-09-21）：
   *   idle    → 静音循环预览（进门默认）
   *   playing → 播完整版（带声音）
   *   paused  → **停在完整版的当前帧**（换回来的还是同一个 src，所以只是 el.pause()）
   * ⚠️ 暂停**不能**退回预览：那会把已经看到的时间线丢掉，画面还会继续动 ——
   *    用户说的"暂停"就是定格。只有换片才回 idle。
   */
  const [playState, setPlayState] = useState<PlayState>('idle');
  /** playState 的镜像 —— togglePlay 要用"上一个状态"决定要不要从头播，
      而 setState 的更新函数里读不到它（闭包里的 playState 是旧值） */
  const playStateRef = useRef<PlayState>('idle');
  playStateRef.current = playState;
  const [progress, setProgress] = useState(0);
  const [timeText, setTimeText] = useState('00:00');
  const [entered, setEntered] = useState(false);
  const reduced = useMemo(reduce, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** 透视层 —— 滚动时动态收紧 perspective，做出"镜头鱼眼"的挤压 */
  const vpRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  /** 每条片子居中时，wrapper 需要退到的距离（实测，因为宽高比不同没法用固定步长推算） */
  const centers = useRef<number[]>([]);
  /**
   * 滚动状态：target / current 都是**绝对下标**（浮点，可越出 [n,2n) 由 apply() 回中）。
   * 初始就站在进门位置对应的中间副本上，这样第一帧就是用户该看到的那条片子。
   */
  const sr = useRef({ current: startIndex + total, target: startIndex + total, last: startIndex + total, speed: 0 });
  /** 最近一次落位的绝对下标（兼作 setState 去重） */
  const indexRef = useRef(startIndex + total);
  const snapTimer = useRef(0);
  /* ---- 滚轮"手感"的三个量（2026-09-15 第七轮）----
     accRef  : 这一"推"里累计的 deltaY 零头
     baseRef : 这一"推"开始时锁定的整格位置（零头都相对它算）
     burstRef: 上一次滚轮事件的时刻，用来切分"一次推" */
  const accRef = useRef(0);
  /**
   * 棘轮锚点 —— **必须和 `sr` 的初始位置一致**（2026-09-21 修）。
   * 它原来是 `useRef(0)`，而 `sr.current/target` 从 `startIndex + total` 起步（进门那条所在格）；
   * 于是**第一次滚轮**会走 `target = baseRef.current` 这支，把 target 从 8 拉回 0 ——
   * 整条片子瞬移到第一份副本、再由 apply() 的回中平移 +8 拉回来，
   * 表现为「第一次滚动就跳了好几条 / 刻度尺数字乱掉」（实测 current 8 → 15.28、index 8 → 15）。
   * ⚠️ 以后改进门定位逻辑时，这两个初值必须一起改。
   */
  const baseRef = useRef(startIndex + total);
  const burstRef = useRef(0);
  /**
   * 这一"推"是否已经换过条（2026-09-21 用户：「滚动容易跳过视频，划多」）。
   * 换过之后，同一推里再来的滚轮增量（包括触控板惯性那长串小 delta）**全部吞掉**，
   * 直到松手 160ms（BURST_MS）或反向拨才开新的一推 —— 一次手势 = 至多换一条，
   * 这正是参考站录屏里的节奏（9 秒的录制从头到尾只从 01 切到 02）。
   */
  const committedRef = useRef(false);

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
  /**
   * 左下角 ticker 中间那格标尺的 canvas（2026-09-21 照参考站实现）。
   * 参考站它是一把 96×12 的**滚动标尺**（`<canvas class="videos__ticker__canvas">`），
   * 不是"每格一条的进度刻度"；绘制逻辑见 `drawTicker()`。
   */
  const tickRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  /** 绝对下标夹到 [0, nodes) —— posAt 取相邻格用（三份副本都在数组里） */
  const clampNode = (v: number) => (nodes <= 0 ? 0 : Math.min(nodes - 1, Math.max(0, v)));
  /** 绝对下标 → 逻辑下标（0..n-1） */
  const logical = (a: number) => (total <= 0 ? 0 : ((Math.round(a) % total) + total) % total);

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
    const f = clampNode(Math.floor(v));
    const t = clampNode(Math.ceil(v));
    return c[f] + (c[t] - c[f]) * (v - f);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /** 把 current / speed 落到 DOM 上（每帧调用，不进 React 渲染，避免每帧 setState） */
  const apply = useCallback(() => {
    const s = sr.current;
    /**
     * 循环回中：落位绝对下标一旦漂出中间那份 [n, 2n)，把 current/target/棘轮锚点
     * 整体平移一份的距离。三份副本的 centers 逐格相同（布局完全一样），
     * 平移一个周期画面逐像素不变 —— 用户只看到"循环"，看不到接缝。
     */
    let near = Math.round(s.current);
    if (nodes > 0 && (near < total || near >= 2 * total)) {
      const shift = near < total ? total : -total;
      s.current += shift;
      s.target += shift;
      baseRef.current += shift;
      indexRef.current += shift;
      near += shift;
    }
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
     * ⚠️ 2026-09-21：这里原来还有一发"鱼眼"—— `perspective = 1900 - bulge*900`，
     * 配合 CSS 那张卡朝观众推 72px，效果是**整张卡随滚动放大一下**（约 +8%）。
     * 用户指出不对（「像一张幕布一样，除了凸起来的地方其他地方的边缘会向里收」）：
     * 参考站的相机是固定的，它没有这种整体缩放；"凸"完全是顶点着色器的屏幕空间场，
     * 表现为局部顶出去 + 其余边缘往里收。所以这里不再改 perspective，
     * 形变全部交给 canvas 的圆柱面绘制（bend.ts）。perspective 由 CSS 静态给定。
     */
    /**
     * 每张卡到"当前位置"的距离 → --off。CSS 拿它算卡片在**圆柱面**上的角度与进深
     * （离中心越远越往后倒、转得越多），整条片子看着就是一张被拱起来的曲面，
     * 而不是贴在同一平面上的一排方块。夹在 ±2.2 —— 更远的卡已经出屏，再转会翻过头。
     */
    /**
     * 斜向错位的**屏幕空间公式**（2026-09-21 照参考站源码改，替换原来的 `--off × --mjp-stagger`）。
     *
     * 参考站视频页媒体 mesh 的 `updatePosition()` 里写着：
     *     this.mesh.position.x = …
     *     const r = map(this.mesh.position.x, -e, e, 0.1 * area.y, -0.1 * area.y);
     *     this.mesh.position.y = r;
     * 也就是「卡片中心离屏幕中轴多远，就上/下偏多少」，**到屏幕边缘时正好 ±10% 视口高**，
     * 中间线性。换到 CSS 就是对每格写一个像素位移：
     *     --shift = 0.2 · vh · dx / vw      （dx = 卡片中心 − 视口中心，px；正值向下）
     *   · 左邻 dx < 0 → --shift 为负 → 抬起来 ✓（与参考站同向）
     *   · 落位静止时当前格 dx≈0 → 0，卡片正对观众 ✓
     *
     * ⚠️ **别改回 `--off × --mjp-stagger`**（每格固定 0.232×卡高）：
     *    形状是一回事，但那是个**常量斜率**，而参考站是**随屏幕位置线性**的；
     *    两者只在"恰好一整格"处相等。而且那个 0.232 是从 1280 宽的录屏上量的，
     *    在 1920×1000 下比参考站小约 7%（我们要的是 tan 斜率 0.2·vh/vw = 0.104，
     *    它给的是 0.232/(1.778+0.78) = 0.091）。改成公式后，斜度自动随视口走。
     */
    const vw = vpRef.current?.clientWidth || window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const curPos = posAt(s.current);
    for (let i = 0; i < itemRefs.current.length; i += 1) {
      const el = itemRefs.current[i];
      if (!el) continue;
      const off = Math.max(-2.2, Math.min(2.2, i - s.current));
      el.style.setProperty('--off', off.toFixed(3));
      // 斜向错位（见上）：卡片中心相对视口中心的像素位移 → 上下偏移
      const dx = (centers.current[i] ?? 0) - curPos;
      el.style.setProperty('--shift', ((0.2 * vh * dx) / vw).toFixed(2) + 'px');
      /**
       * **只露左边，藏右边（2026-09-21 用户：「只显示左边的视频，右边的不要出现」）**。
       * 参考站静止时只有**左侧**露出上一条的一条边，右侧是全空的；
       * 但我们的片单横竖版宽度不一样，纯靠间距调不出来（竖版居中时右邻会探出一大截），
       * 所以改成**滚动联动**：右侧卡片（off > 0.12）静止时藏掉，滚动一半再淡入。
       *   · bell  ：中心钟形 —— 用来做"静止时当前格 1 / 邻格 0.34"这个剖面；
       *   · hideR ：右侧隐藏系数，off 越大越藏；
       *   · settle：**"是不是静止"的门**（落定 1 / 在飞 0），见下面 ⚠️；
       * opacity 每帧在这里算好直接写 inline —— CSS 那边**不再**挂 opacity / transition
       *（transition 会追着每帧的值跑，变成半秒的滞后拖影，见 index.css 的 .mjp__media 注释）。
       * 隐掉时顺手 pointer-events:none —— 看不见的按钮不能还能点。
       *
       * ⚠️ 2026-09-21 修正（用户：「滚动过渡时影片不要变白」）：上一版把剖面直接按 `|off|` 算，
       *    漏了 **|off| 在过渡途中本来就会离开 0** —— 条子刚走半格，原来"当前那条"的 off
       *    就变成 −0.5，钟形算出 0.5，于是**正在飞的那两张一起掉到 ~0.67 透明度**；
       *    半透明压在**白底**上就是"影片变白"（过渡截图里整幅画面发灰发白，就是这么来的）。
       *    本质上 `|off|` 混淆了两件事：「静止时邻格的固定偏移（±1，该压暗）」和
       *    「过渡中当前格的**临时**偏移（0→±0.5，不该压暗）」。
       *    修法：整层压暗/隐藏挂在 `settle` 门上 ——
       *      · settle=1（落定）→ 完全按静止剖面（当前 1 / 左邻 0.34 / 右邻藏）；
       *      · settle=0（在飞）→ **所有卡一律不透明**，画面全程满色，不再被白底冲淡。
       *    过渡只在**最后 15% 行程**（bulge<0.3）里把"即将退成邻格"那张收回 0.34 ——
       *    也就是"退到边上才暗下来"，而不是"一动就白"；而那张此时已经被移出视口大半，
       *    1920 下只露 ~33px，看不出收的过程。
       * ⚠️ bell 给 |off|<0.15 一段平台（而不是直接从 0 往下掉）：落定的当前卡 off 是个
       *    浮点小数（实测 9.991 → off=−0.009），没有平台的话它自己就先被扣掉几个百分点。
       */
      const bell = Math.max(0, 1 - Math.max(0, Math.abs(off) - 0.15) * 3);
      const rest = 0.34 + 0.66 * bell;
      const hideR = off > 0.12 ? Math.min(1, (off - 0.12) * 8) : 0;
      const settle = Math.max(0, Math.min(1, 1 - bulge / 0.3));
      const o = 1 - (1 - rest * (1 - hideR)) * settle;
      el.style.opacity = o.toFixed(3);
      el.style.pointerEvents = o < 0.05 ? 'none' : '';
    }
    // 实时高亮最近的一条（只在真的变了才 setState）
    const nearest = near;
    if (nearest !== indexRef.current) {
      indexRef.current = nearest;
      setAbsIndex(nearest);
      setIndex(logical(nearest));
      // 换片子 → 回到静音预览循环、进度归零
      setPlayState('idle');
      setProgress(0);
      setTimeText('00:00');
    }
  }, [posAt]);   // eslint-disable-line react-hooks/exhaustive-deps

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
    /**
     * **屏幕空间的弯曲场（2026-09-21，扒参考站着色器拿到的真值）**。
     * 参考站（mattjinn.com/videos）的顶点着色器是：
     *     vec2 screen = (ndc.xy/ndc.w)*0.5+0.5;              // 顶点在**视口**里的归一化位置
     *     float speed = uSpeed*0.01;
     *     pos.z += mix(0.0, parabola(screen.x, 3.0), speed);  // parabola(x,k)=pow(4x(1-x),k)
     *     pos.z += mix(0.0, parabola(screen.y, 1.0), speed);
     * 也就是说**弯曲是屏幕空间的场、峰值钉在视口正中**，不是"每张卡各自鼓一个桶"：
     *   · 卡片跨过屏幕中心 → 它最鼓；
     *   · 卡片在边上（比如只露一条边的那张）→ 几乎不弯 —— 实测参考站静止时
     *     卡片顶边 sag 只有 3px（平的），过渡中才鼓到 39~73px（≈卡片高的 13%）。
     * 我们这边没有逐顶点的着色器，就在**每张卡**上近似这个场：用卡片最靠近屏幕中心
     * 的那条边（跨过中心就用中心）代入 parabola(x,3) 当作这张卡的 bend 系数。
     * 于是两次相邻卡的内缘同时落在峰值区 → 两张画布**一起朝观众鼓出来**，
     * 就是用户说的"两块视频画布之间被拉扯过来"的感觉。
     * ⚠️ 下限 0.08 是留一点微弯 —— 全场归零的话边上那张会成硬直的刀片边，反而突兀。
     */
    const curPos = posAt(s.current);
    const vw = vpRef.current?.clientWidth || window.innerWidth || 1;
    const fieldAt = (x: number) => {
      const t = Math.max(0, Math.min(1, x));
      return Math.pow(4 * t * (1 - t), 3);
    };

    for (let i = 0; i < nodes; i += 1) {
      const cv = canvasRefs.current[i];
      const size = cellSize.current[i];
      if (!cv || !size || size.w <= 0 || size.h <= 0) continue;
      const off = Math.max(-2.2, Math.min(2.2, i - s.current));
      if (Math.abs(off) > 2.6) continue; // 已经出屏，别浪费
      // 屏幕空间弯曲场（见上）：卡片最靠近视口中心的那条边决定它的弯曲强度
      const cxFrac = 0.5 + (centers.current[i] - curPos) / vw;
      const halfWFrac = size.w / 2 / vw;
      const xField = Math.abs(cxFrac - 0.5) <= halfWFrac
        ? 0.5
        : off > 0
          ? cxFrac - halfWFrac
          : cxFrac + halfWFrac;
      const prox = Math.max(0.08, fieldAt(xField));
      const p: CylinderParams = cylinderFrom(bulge * prox, off);

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
        const img = posterFor(list[i % total]?.poster);
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
  }, [list, posAt]);   // eslint-disable-line react-hooks/exhaustive-deps -- nodes/total 由 list 派生且恒定

  /**
   * 左下角 ticker 中间那把标尺 —— **逐行照抄参考站**（bundle.js 里 `[data-ticker]` 组件的 onLoop）：
   *
   *     onScroll(t){ this.value = 75e-5 * t }                       // 滚一格 → value += 0.00075
   *     onLoop(){
   *       this.timeline.progress(this.value % .5 + .5)               // 相位：0.5~1
   *       const {height:t, width:e} = this.element                   // 备用存储 24 / 192
   *       this.context.clearRect(0,0,e,t); this.context.fillStyle='black'
   *       const i = e/2                                              // 96
   *       for(let n=0;n<18;n++){
   *         const r = 16*n - this.progress
   *         const s = r < i ? map(r,0,i,0,t) : map(r,i,e,t,0)        // 三角剖面：中间最高
   *         this.context.fillRect(r, t/2-s/2, 1, s)
   *         this.context.globalAlpha = r < i ? map(r,0,i,0,1) : map(r,i,e,1,0)
   *       }
   *     }
   *   （那个 `timeline.to(this,{progress:32})` 的时长是 gsap 默认 0.5s，所以
   *     timelineProgress 0.5→1 对应 `progress` 16→32。）
   *
   * **一句话**：18 条 16px 间距的竖刻度，高度与透明度都是"两端 0 / 正中拉满"的三角剖面，
   * 整把标尺随滚动推一个很小的相位。它**不表示第几条** —— 序号由两侧数字负责
   * （参考站同一份代码里 `elements.length.innerHTML = '0'+(index+1)` 就是在写左边那个数）。
   *
   * ⚠️ 我们原来是 `list.map()` 出 N 条 `<span class="mjp__tick">`、把当前那条点亮拉长，
   *    那是"进度刻度"、不是标尺 —— 参考站没有这个形态。塔形标尺 + 两侧数字才是它。
   * ⚠️ 颜色用 `--mjp-ink`（参考站硬编码 'black'；本站的"墨"是 #31261c，硬黑会跳出调色板）。
   */
  const drawTicker = useCallback(() => {
    const cv = tickRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const w = cv.width;   // 192（备用存储，固定 2×）
    const h = cv.height;  // 24
    const map = (v: number, a: number, b: number, c: number, d: number) =>
      c + ((v - a) / (b - a)) * (d - c);
    // 相位：照抄 `32 * (value % 0.5 + 0.5)`，value = 0.00075 × 滚动位置（单位：格）
    const value = sr.current.current * 0.00075;
    const progress = 32 * ((value % 0.5) + 0.5);
    const mid = w / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(cv).color || '#000';
    for (let n = 0; n < 18; n += 1) {
      const r = 16 * n - progress;
      const bar = r < mid ? map(r, 0, mid, 0, h) : map(r, mid, w, h, 0);
      ctx.globalAlpha = r < mid ? map(r, 0, mid, 0, 1) : map(r, mid, w, 1, 0);
      ctx.fillRect(r, h / 2 - bar / 2, 1, bar);
    }
    ctx.globalAlpha = 1;
  }, []);

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
    drawTicker(); // 标尺不靠 rAF 也能先画上（total<=1 时帧循环会 early-return）
    const onResize = () => {
      measure();
      apply();
      drawTicker();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure, apply, drawTicker]);

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
      apply(); // 先落 DOM（含 --bulge / --off / shift）
      drawCards(); // 再按同一份 bulge 重画画布
      drawTicker(); // 左下角标尺（相位跟着当前格位置走）
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [apply, drawCards, drawTicker, reduced, total]);

  /** 滑到某个绝对下标（不设边界 —— 循环片单，apply() 会把落位回中到中间副本） */
  const goTo = useCallback(
    (next: number) => {
      sr.current.target = next;
      // 键盘 / 触摸 / 降级分支都走这里 —— 必须把滚轮的棘轮锚点一起挪过去，
      // 否则下一轮滚轮的零头会相对一个**过期的整格**去算（baseRef 是滚轮的唯一基准）
      baseRef.current = next;
      accRef.current = 0;
      indexRef.current = next;
      setAbsIndex(next);
      setIndex(logical(next));
      setPlayState('idle');
      setProgress(0);
      setTimeText('00:00');
      if (reduced) {
        sr.current.current = next;
        apply();
      }
    },
    [apply, reduced],   // eslint-disable-line react-hooks/exhaustive-deps
  );

  const go = useCallback((dir: number) => goTo(Math.round(sr.current.target) + dir), [goTo]);

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
        committedRef.current = false;
        sr.current.target = baseRef.current;
      }
      burstRef.current = now;
      // 这一推已经换过条：剩下的增量（惯性滚轮的长尾）一律吞掉，不再累积零头
      if (committedRef.current) return;
      accRef.current += d;

      window.clearTimeout(snapTimer.current);
      if (reduced) {
        // 降级：不制造位移（也就不产生任何运动），只按"推满一格"来换；同一推同样只换一条
        if (Math.abs(accRef.current) >= STEP_DELTA) {
          const dir = accRef.current > 0 ? 1 : -1;
          accRef.current = 0;
          baseRef.current += dir;
          committedRef.current = true;
          go(dir);
        }
        return;
      }
      /*
       * **棘轮（2026-09-21 收紧）**：凑满一格就立刻在 base 上落一格。
       * ⚠️ 原来"10 格 = 连换两格"的规则删掉了 —— 用户实测反馈「容易跳过视频，划多」；
       *    现在一次推最多提交一格，多余的零头直接作废（不是留给下一格），
       *    连滚再快也只能一条一条来。想要连着换，松手再滚 —— 和参考站一致。
       * 循环片单：base/target **不设边界**，越过首尾继续走，落位后由 apply() 回中。
       */
      const steps = Math.trunc(accRef.current / STEP_DELTA);
      if (steps !== 0) {
        const dir = steps > 0 ? 1 : -1;
        accRef.current = 0;
        baseRef.current += dir;
        committedRef.current = true;
      }
      const s = sr.current;
      s.target = baseRef.current + accRef.current / STEP_DELTA;
      snapTimer.current = window.setTimeout(() => {
        // 松手：零头一律抹掉（推不满 5 格就退回整格），落定到棘轮锁住的那一格
        sr.current.target = baseRef.current;
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

  /* ---- Esc：原地播放中先停播，没在播就退回书架 ----
     走全站统一的 Esc 栈（@/lib/escape-stack）：这一页盖在书架之上，
     只有"栈"能保证一次按键只关最上面那层（旧版两页会一起关）。 */
  useEscape(() => {
    if (playState !== 'idle') setPlayState('idle');
    else onClose();
  });

  /* ---- 键盘：←/→ 切换（非播放态）。这不是 Esc，照旧挂在普通监听上。 ---- */
  useEffect(() => {
    if (playState !== 'idle') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, playState]);

  /**
   * 播放/暂停（2026-09-21）：
   *   idle → playing（**从头开始**）／ playing → paused（停在当帧）／ paused → playing（接着播）。
   *
   * ⚠️ idle 进入播放时要把时间线拨回 0 —— 现在静音循环和正式播放是**同一个文件**，
   *    点播放时预览可能已经循环到任意位置了，不归零就会从半截开始（2026-09-21 用户反馈）。
   *    从 paused 恢复则**不**归零，否则"暂停一下再继续"会跳回片头。
   */
  const togglePlay = useCallback(() => {
    const prev = playStateRef.current;
    if (prev === 'playing') {
      playStateRef.current = 'paused';
      setPlayState('paused');
      return;
    }
    if (prev === 'idle') {
      const el = videoRefs.current[indexRef.current];
      if (el) {
        try {
          el.currentTime = 0;
        } catch {
          /* 还没加载出可 seek 的范围（readyState 0）就忽略 —— 反正它本来就从 0 起播 */
        }
      }
      setProgress(0);
      setTimeText('00:00');
    }
    playStateRef.current = 'playing';
    setPlayState('playing');
  }, []);

  /**
   * 进度条落点 → 跳时间线。
   * idle 时点进度条 = 当作"开播"（这时还没有完整版可跳），playing / paused 才真的 seek。
   */
  const seekTo = useCallback(
    (ratio: number) => {
      const el = videoRefs.current[indexRef.current];
      if (!el || !el.duration) return;
      const r = Math.min(1, Math.max(0, ratio));
      el.currentTime = Math.min(el.duration - 0.05, r * el.duration);
      setProgress(r);
      setTimeText(fmt(el.currentTime));
    },
    [],
  );

  /** 完整版 playing / paused 期间的时间回报（预览不回报，见 ReelItem）——只认当前那条 */
  const onMediaTime = useCallback((a: number, t: number, d: number) => {
    if (a !== indexRef.current || !(d > 0)) return;
    setProgress(Math.min(1, t / d));
    setTimeText(fmt(t));
  }, []);

  /** 完整版播完 → 退回静音预览循环 */
  const onMediaEnded = useCallback(() => {
    setPlayState('idle');
    setProgress(0);
    setTimeText('00:00');
  }, []);

  const current: MediaWork | undefined = list[index];

  const cls = useMemo(
    () => ['mjp', entered ? 'is-in' : ''].filter(Boolean).join(' '),
    [entered],
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
      {/* ---- 背景装饰（2026-09-17 / 用户第 1 条"美化子页面"）----
          点阵花朵 / 星 / 花体字母 / 散点，全部 z-index:-1 → 压在纸色之上、内容之下，
          **物理上不可能盖住卡片与标题**（见 index.css 的 .pdecor 段）。
          这页卡片在 44% 高度横贯整屏，所以构图刻意只走"上带 + 下带"两条饰带。 */}
      <PageDecor variant="mjp" />
      {/* 右下角原来那簇「烟花花 + 珠串椭圆」在 2026-09-17 第二轮被删，改成**淡紫 ASCII 彼岸花**。
          ⚠️ 彼岸花现在挂在 PageDecor 的 mjp 变体里（`b('lycoris', …)`），不再往这页手写组件：
             2026-09-17 晚另一个会话把「删掉这种风格」误读成删彼岸花，顺手删了这里的专用组件
             和 `.ascii-lycoris` 类 —— 用户随后澄清要删的不是这个。并进 PageDecor 之后，
             定位/浓度/窄屏规则和全站装饰共用一套，不会再出现"组件在、CSS 没了"这种半截状态。 */}

      {/* ---- 统一外壳（第一档改造 ①）----
          原来是 [← Back] …… [频道名] 两栏。现在左上那枚返回换成全站通用的
          「返回书架」（位置/字族/悬停手感和工作室那枚一模一样），频道名进外壳右侧、
          紧挨着 MENU —— 于是整条顶栏读起来和工作室完全同一套。
          频道名原本挂在右上角（参考站也是右上挂 Menu），挪进外壳后位置基本不变
          （正中间被站内「作者模式」角标占着，不能放中）。
          播放态整块淡出：原来 .navigation 就是这么处理的，别挡着画面。 */}
      <StudioChrome
        label="Return to Archive"
        onBack={onClose}
        /* ⚠️ 2026-09-16 第四轮（现行 = 整页白底，见 index.css 的 .mjp）：
           本页底色走了 白 → 深巧克力 → 薄荷 → 白 四轮，tone **每轮都要跟着翻**。
           tone 的语义是"为哪种底设计"：
             'light' = 深底 → 奶白字 + 投影；'dark' = 浅底 → 墨色字、去投影。
           现在是 #ffffff 白底 → 仍是 'dark'。
           ⚠️ 这一格**从薄荷轮起就没动过**（薄荷与白都是浅底，同一套墨色字照样立得住），
              白底上唯一的差别是"墨字压白"比"墨字压薄荷"对比更强 —— 只会更清楚，不用调。
           若改成 'light'，"Return to Archive" / Menu 会变成奶白字 + 黑影，白底上直接消失。 */
        tone="dark"
        className="mjp-chrome"
        extra={
          <span className="mjp__nav-title">
            {channel ? CHANNEL_LABEL[channel] : MEDIA_PAGE_COPY.title}
          </span>
        }
      />

      {total === 0 ? (
        <p className="mjp__empty">{MEDIA_PAGE_COPY.empty}</p>
      ) : (
        <>
          {/* data-cursor-tone="light"：视口底 = 白（浅底）→ 光标标签走墨色。
              从第三轮（薄荷）沿用到第四轮（白），都是浅底 → 不用改；
              别改成 "dark"（那是深底用的白色标签，白底上直接看不见）。 */}
          <div className="mjp__viewport" ref={vpRef} data-cursor="" data-cursor-tone="light">
            {/* ---- 背景大字层（多层视差里的最慢一层）----
                参考站那套「music / videos / shows」的斜体衬线大字，这里当作背景字：
                随 --cur 以 **0.05×** 的速度横移（卡片是 1×），看着就是被卡片"掠过"的远景。 */}
            <div className="mjp__bgword" aria-hidden="true">
              {channel ? CHANNEL_WORD[channel] : MEDIA_PAGE_COPY.word}
            </div>
            <div className="mjp__wrapper" ref={wrapRef}>
              {Array.from({ length: copies }, (_, c) =>
                list.map((w, i) => {
                  const a = c * total + i;
                  const isActive = a === absIndex;
                  return (
                    <ReelItem
                      key={`${c}-${w.id}`}
                      elRef={(el) => {
                        itemRefs.current[a] = el;
                      }}
                      canvasRef={(el) => {
                        canvasRefs.current[a] = el;
                      }}
                      videoRef={(el) => {
                        videoRefs.current[a] = el;
                      }}
                      work={w}
                      absIndex={a}
                      active={isActive}
                      /* 只有屏幕中间那一格跟随播放状态，其余永远在预览态 */
                      playState={isActive ? playState : 'idle'}
                      onToggle={togglePlay}
                      onGoTo={goTo}
                      onTime={onMediaTime}
                      onEnded={onMediaEnded}
                    />
                  );
                }),
              )}
            </div>
          </div>

          {/* ---- 画面下方：控制条（紧贴视频下沿） + 标题/时长 ----
              2026-09-21：播放不再放大成全屏 —— 原地播，控制条就挂在视频正下方。 */}
          {current ? (
            <>
              <PlaybackBar
                playing={playState === 'playing'}
                live={playState !== 'idle'}
                progress={progress}
                timeText={timeText}
                length={current.length}
                onToggle={togglePlay}
                onSeek={playState === 'idle' ? togglePlay : seekTo}
              />
              {/* ⚠️ VideoInfo **不能**加 `key={current.id}`（2026-09-21 踩过，两次）：
                  ① 加 key → React 每次换片都重新挂载 → 内部 `lastTitle` / `ghost` 全被重置
                     → 出场分支的 `changing` 恒为 false → 幽灵标题永远不出现，旧标题是
                     "啪"地消失、不是翻走（入场照常动，所以极难发现）。
                  ② 但**不加 key 的前提是标题必须由 React 渲染**：原来用 GSAP SplitText
                     拆字，它会直接改写 h2 里的 DOM（文本节点 → spans），React 下一次
                     diff 时对不上，**标题干脆不更新**（实测切到第 10 条，标题还停在第 9 条）。
                  所以现在改成 React 渲染逐字符 span（见 TitleChars），两边都成立。 */}
              <VideoInfo work={current} reduced={reduced} />
            </>
          ) : null}

          {/* ---- 左下角 ticker：序号 + 一列刻度线 + 序号（形态照参考站） ---- */}
          <div className="mjp__ticker" aria-hidden="true">
            <span className="mjp__ticker__num is-current">
              {String(index + 1).padStart(2, '0')}
            </span>
            {/* 中间那格 = 96×12 的**滚动标尺** canvas（2026-09-21 照参考站实现）。
                ⚠️ 参考站这里不是"每格一条的进度刻度"，而是一把固定 96×12 的标尺：
                   18 条 16px 间距的刻度，高度与透明度都按"中间高、两端渐隐"的三角剖面画；
                   `progress` 由滚动位置推一个极小的相位（视频页只有 2 条，几乎看不出来）。
                   绘制见 MediaGalleryPage 的 drawTicker()。
                备用存储固定 2×（192×24）—— 参考站也是硬编码 2×，不是 dpr。 */}
            <canvas
              ref={tickRef}
              className="mjp__ticker__canvas"
              width={192}
              height={24}
              aria-hidden="true"
            />
            <span className="mjp__ticker__num">{String(total).padStart(2, '0')}</span>
          </div>
        </>
      )}

      {/* 2026-09-21：全屏播放器（FLIP 放大）已删 —— 播放就地在卡片上进行，
          控件见下方 PlaybackBar；不再需要 is-playing 态盖层。 */}
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
 * 把标题拆成**逐字符 `<span>`**，交给 React 渲染；GSAP 只负责给这些 span 设 transform / opacity。
 *
 * ⚠️ 2026-09-21 从 GSAP SplitText 换成这个，根源是 SplitText 和 React 抢同一个 DOM：
 *    它把 h2 里的文本节点**直接换成**自己的 spans，而 React 并不知道；下一次 title 变化时
 *    React 拿旧 fiber 去 diff 已经面目全非的 DOM，更新不上去 —— 症状是**标题永远停在第一条**
 *    （实测切到第 10 条，标题还是第 9 条的字）。之前靠 `key={current.id}` 每次重新挂载绕开，
 *    但那又让"幽灵标题出场"整段变成死代码（实例一换，lastTitle / ghost 全被重置）。
 *    逐字符 span 一次解决这两件事，而且少一个插件依赖。
 * ⚠️ 空格要写成 `\u00A0`：`display:inline-block` 的 span 里的普通空格会被折叠掉，标题会挤成一坨。
 */
function TitleChars({ text }: { text: string }) {
  return (
    <>
      {Array.from(text).map((ch, i) => (
        <span key={i} className="mjp__info__char">{ch === ' ' ? '\u00A0' : ch}</span>
      ))}
    </>
  );
}

/**
 * 视频条下方的居中信息块（参考站的版式：卡片下面单独一行文字，不叠在画面上）。
 *   · 标题：display 衬线，逐字符 rotateX 翻入 —— 参考站切视频时就是这段在翻；
 *   · 时长：同字族斜体，小一号；
 *   · 简介 `blurb`：给了才渲染（用户说「我会另外在视频下面加介绍」，先把槽位留着）。
 */
function VideoInfo({ work, reduced }: { work: MediaWork; reduced: boolean }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const ghostRef = useRef<HTMLHeadingElement>(null);
  /** 上一条标题（出场用）：换片子时把旧标题复制到一层"幽灵"上翻走再卸载 */
  const [ghost, setGhost] = useState<{ text: string; key: number } | null>(null);
  const lastTitle = useRef(work.title);

  /**
   * 入场（照参考站 activate）：
   *   fromTo(chars, {autoAlpha:0, rotateX:90, transformOrigin:'50% 50% -10px'},
   *               {autoAlpha:1, rotateX:0, duration:1, ease:'power4.out', stagger:.01})
   * 注意是 **+90 → 0**（从屏幕下方翻上来），不是 -90 —— 我们原来写的是 -90，方向反了。
   * 缓动写 `EASE.world` 而不是字面量 `'power4.out'`：参考站的 power4.out 就是本站
   * `--ease-world`（0.22, 1, 0.36, 1）那条曲线，js 侧只能用 token（见 src/lib/ease.ts）。
   * ⚠️ 用 useLayoutEffect 不是 useEffect：逐字符 span 是被 React **原地改文字**的，
   *    useEffect 在 paint 之后才跑，会先闪一帧"新标题已摆正"再翻；layout 阶段跑掉这个闪。
   */
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const chars = el.querySelectorAll<HTMLElement>('.mjp__info__char');
    gsap.killTweensOf(chars);
    const changing = lastTitle.current !== work.title;
    if (changing) {
      const prev = lastTitle.current;
      lastTitle.current = work.title;
      setGhost({ text: prev, key: Date.now() });   // 旧标题挂到幽灵层，走出场动画
    }
    gsap.set(el, { autoAlpha: 1 });
    if (reduced) {
      gsap.set(chars, { autoAlpha: 1, rotateX: 0 });
      return;
    }
    gsap.fromTo(
      chars,
      { autoAlpha: 0, rotateX: 90, transformOrigin: '50% 50% -10px' },
      { autoAlpha: 1, rotateX: 0, duration: 1, stagger: 0.01, ease: EASE.world },
    );
  }, [work.title, reduced]);

  /** 出场（照参考站 deactivate）：chars 到 rotateX:-90 + 淡出，1s / EASE.world / stagger .01 */
  useLayoutEffect(() => {
    const el = ghostRef.current;
    if (!ghost || !el) return;
    const chars = el.querySelectorAll<HTMLElement>('.mjp__info__char');
    if (reduced) {
      const t = window.setTimeout(() => setGhost(null), 0);
      return () => window.clearTimeout(t);
    }
    gsap.set(el, { autoAlpha: 1 });
    gsap.to(chars, {
      autoAlpha: 0,
      rotateX: -90,
      transformOrigin: '50% 50% -10px',
      duration: 1,
      stagger: 0.01,
      ease: EASE.world,
      onComplete: () => setGhost(null),
    });
    const timer = window.setTimeout(() => setGhost(null), 1600); // 兜底：动画没回调也要卸掉
    return () => {
      window.clearTimeout(timer);
      gsap.killTweensOf(chars);
    };
  }, [ghost, reduced]);

  return (
    <div className="mjp__info">
      {/* 幽灵层：上一版标题，绝对定位盖在同一位置（CSS 见 .mjp__info__title--ghost），只负责翻走。
          ⚠️ 必须带 `key={ghost.key}`：不带的话 React 会**复用同一个 h2 节点**，
             上一轮动画把它留在 rotateX:-90 / opacity:0 的状态，新一轮再往 -90 动画就等于没动 ——
             表现是"第二次换片时旧标题不翻"。换 key 强制重新挂载，字符回到 0 位再翻走。 */}
      {ghost ? (
        <h2 key={ghost.key} className="mjp__info__title mjp__info__title--ghost" ref={ghostRef} aria-hidden="true">
          <TitleChars text={ghost.text} />
        </h2>
      ) : null}
      <h2 className="mjp__info__title" ref={titleRef}>
        <TitleChars text={work.title} />
      </h2>
      {work.length ? <p className="mjp__info__len">{work.length}</p> : null}
      {work.blurb ? <p className="mjp__info__blurb">{work.blurb}</p> : null}
    </div>
  );
}

/**
 * 列表里的一格。
 *
 * 2026-09-21 起这格**自己就是播放器**（全屏播放器已删）：
 *   · 非当前格 → 暂停（多条同时解码太浪费）；
 *   · 当前格 idle → **静音循环播完整版**（不再有那条低码率预览文件）；
 *   · 当前格 playing → 解除静音、不循环；
 *   · 当前格 paused → el.pause()，画面定格在当帧；
 *   · 侧卡被点 → 不播放，先滑到它（onGoTo）。
 * ⚠️ 全程**同一个 src**：切换播放态只动 muted/loop/paused，不换源 ——
 *    换 src 会触发重新加载（旧版因此每次点播放都要重新缓冲一遍）。
 *    这也是"取消 -preview.mp4"之后画质不再打折的前提。
 * 画面仍然由父级的画布按圆柱面投影重画 —— video 只是藏在下面的帧源，
 * 所以"原地播放"对弯曲/鱼眼那些动效零改动。
 */
function ReelItem({
  elRef,
  canvasRef,
  videoRef,
  work,
  absIndex,
  active,
  playState,
  onToggle,
  onGoTo,
  onTime,
  onEnded,
}: {
  elRef: (el: HTMLElement | null) => void;
  canvasRef: (el: HTMLCanvasElement | null) => void;
  videoRef: (el: HTMLVideoElement | null) => void;
  work: MediaWork;
  /** 绝对下标（三份副本里这是第几格） */
  absIndex: number;
  /** 是否是屏幕中间那一格（绝对下标匹配 —— 同一条片子有三份，只有中间那份能播） */
  active: boolean;
  /** 播放状态；**只对 active 的格子生效**（传入时侧卡一律得到 'idle'） */
  playState: PlayState;
  onToggle: () => void;
  onGoTo: (absIndex: number) => void;
  /** 完整版播放中的时间回报（秒 / 总时长秒）—— 预览不回报 */
  onTime: (absIndex: number, time: number, duration: number) => void;
  onEnded: () => void;
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

  /** 只有一个文件：列表里循环的是它，正式播放的也是它（见数据文件的画质整改说明） */
  const src = work.video ?? '';

  /**
   * 播放调度（全程同一个 src，只动 muted / loop / paused）：
   *   · 非当前格 → 暂停（多条同时解码太浪费）；
   *   · idle → 静音循环，一直在播（停了画布就拿不到新帧，卡片会死在第一帧）；
   *   · playing → 解除静音继续播；
   *   · paused → el.pause() 定格在当帧（src 不变，进度自然保住）。
   * ⚠️ 视频不可见（opacity:0，见 CSS），**不能** display:none / visibility:hidden ——
   *    那会让浏览器停掉解码，drawImage 再也拿不到新帧。
   */
  useEffect(() => {
    const el = vid.current;
    if (!el) return;
    if (!active) {
      el.pause();
      return;
    }
    if (playState === 'paused') {
      el.pause();
      return;
    }
    void el.play().catch(() => {});
  }, [active, playState, src]);

  return (
    <article
      ref={elRef}
      /* is-live 已随播放徽标一起删（2026-09-21）—— 卡片上不再有"是否在完整播放"的样式分支，
         播放态只体现在 .mjp__ctrl 上（进度条 / 暂停键）。 */
      className={`mjp__media${active ? ' is-current' : ''}`}
      /* 关键：格子按这条片子自己的宽高比撑开，竖版才不会被 cover 裁掉 */
      style={{ ['--ar' as string]: work.aspect ?? 16 / 9 }}
    >
      <button
        ref={btnRef}
        type="button"
        className="mjp__media-btn"
        onClick={() => (active ? onToggle() : onGoTo(absIndex))}
        data-cursor={active ? (playState === 'playing' ? 'Pause' : 'Play') : undefined}
        /* 卡片浮在白底上 → 浅底 → 墨色光标标签（同 .mjp__viewport） */
        data-cursor-tone="light"
        aria-label={
          active ? (playState === 'playing' ? `暂停：${work.title}` : `播放：${work.title}`) : `查看：${work.title}`
        }
      >
        {/* 可见的那一层：每帧按圆柱面投影重画的画布 ——
            拱起、两端后退、上下边成弧线都在这里（见 src/lib/gallery/bend.ts）。 */}
        <canvas ref={canvasRef} className="mjp__media-canvas" aria-hidden="true" />
        {/* ⚠️ 这里原来有一枚 hover 播放徽标（圆形底 + 三角），2026-09-21 用户否掉：
            「不要这个播放键」—— 参考站封面在 hover 时**只有画面放大**（`uv=scale(uv,0.1*uHover)`），
            那个 /play.png 是混在**贴图**里的、且非常淡，不是一枚浮在画面上的实心按钮。
            别再往回加：要提示可播，靠光标标签（data-cursor="Play"）就够。 */}
        {/* 帧源：藏在画布下面（opacity:0）。只有当前格 preload="auto"，
            其余等轮到它再拉 —— 否则一进页面十几条副本一起下，白白浪费带宽。 */}
        <video
          ref={setVid}
          className="mjp__media-video"
          src={src}
          poster={work.poster}
          loop={playState === 'idle'}
          muted={playState === 'idle'}
          playsInline
          preload={active ? 'auto' : 'none'}
          onTimeUpdate={() => {
            const el = vid.current;
            if (playState !== 'idle' && el && el.duration > 0) onTime(absIndex, el.currentTime, el.duration);
          }}
          onEnded={onEnded}
        />
      </button>
    </article>
  );
}

/**
 * 视频正下方的控制条（2026-09-21 新增，替代全屏播放器）：
 *   [播放/暂停] [进度条（可点可拖定位）] [时间]
 * 只挂一条，跟随当前格 —— 内容随 progress 每帧变，但节点不换（别加 key=work.id，
 * 拖动到一半切片子会闪）。窄屏时宽度收到和卡片近似的带宽。
 */
function PlaybackBar({
  playing,
  live,
  progress,
  timeText,
  length,
  onToggle,
  onSeek,
}: {
  playing: boolean;
  /** 是否已进入完整版（playing 或 paused）—— 未进入时进度条弱化，点了是"开播" */
  live: boolean;
  progress: number;
  timeText: string;
  length?: string;
  onToggle: () => void;
  onSeek: (ratio: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  /** 按住拖动：pointermove 期间连续 seek，不触发文本选择 */
  const dragging = useRef(false);

  const seekFromEvent = (clientX: number) => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    onSeek((clientX - r.left) / r.width);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromEvent(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) seekFromEvent(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div className={`mjp__ctrl${live ? ' is-live' : ''}`}>
      <button
        type="button"
        className="mjp__ctrl-btn"
        onClick={onToggle}
        data-cursor={playing ? 'Pause' : 'Play'}
        data-cursor-tone="light"
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <rect x="3.5" y="2.5" width="3.2" height="11" rx="1" fill="currentColor" />
            <rect x="9.3" y="2.5" width="3.2" height="11" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M4.5 2.6 L13 8 L4.5 13.4 Z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div
        ref={barRef}
        className="mjp__ctrl-track"
        style={{ ['--p' as string]: progress }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span className="mjp__ctrl-rail" />
        <span className="mjp__ctrl-fill" />
        <span className="mjp__ctrl-knob" />
      </div>
      <span className="mjp__ctrl-time">
        {timeText}
        {length ? <em> / {length}</em> : null}
      </span>
    </div>
  );
}

export default MediaGalleryPage;
