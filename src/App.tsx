import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Lenis from 'lenis';
import { LoadingScreen } from '@/components/LoadingScreen';
import { ModeSwitch } from '@/components/ModeSwitch';
import { HomeSection } from '@/sections/HomeSection';
import { StudioSection } from '@/sections/StudioSection';
import { useWindowedFrames } from '@/hooks/useWindowedFrames';
import { useAssetPreload } from '@/hooks/useAssetPreload';
import { recordEnter, wireExitFlush } from '@/lib/visitLog';
import { supportsAvif } from '@/lib/avifSupport';
import type { StudioObject } from '@/data/studio';
import 'lenis/dist/lenis.css';
import './App.css';
import gsap from 'gsap';

const TOTAL_FRAMES = 120;

/**
 * 序列帧**尺寸档**，按画布真实像素宽自适应：
 *   · 桌面 → `frames*`    （2560×1443）
 *   · 小屏 → `frames-sm*` （1440×812）
 *
 * 判据用「画布像素宽」而不是 CSS 宽，因为 canvas 尺寸是
 * `innerWidth × min(devicePixelRatio, 2)`（见 HomeSection.resizeCanvas）。
 *
 * ⚠️ 只看宽度会漏掉**手机横屏**：844×2 = 1688 会被判成大屏，于是手机去吃大屏帧集
 * —— 恰恰是最该省流量的场景。所以再压一道「短边」条件：
 * 短边 ≤ 900 的一律走小图（横竖屏都被盖住）。
 *
 * ⚠️ 反过来，短边条件**不能单独用**：13 寸视网膜本 CSS 1440×900、dpr 2 时
 * 实际要 2880px 宽，只按短边 900 判会掉进小图，清晰度白丢一档。
 * 因此两个条件是与的关系，canvasPx 上限给到 2000（够 1440 CSS × 1.4 左右）。
 *
 * 用例核对：手机竖屏 390×2=780 ✅小图 ｜ 手机横屏 844×2=1688 ✅小图 ｜
 * iPad 竖屏 1024×2=2048 ❌大图（屏幕本来大，小图会糊）｜
 * 视网膜本 1440×900@2 = 2880 ❌大图（保清晰）｜ 桌面 1920×1080 ❌大图。
 *
 * 体积沿革：
 *   2026-09-28 JPEG → WebP q88，大屏 63.1MB → 10.7MB（这是当时首屏最大的一笔）
 *   2026-09-29 WebP → AVIF q64（小屏 q56），大屏 10.69MB → **6.69MB**，小屏 3.16 → 2.60MB
 *     · 为什么是这两个数：大屏 q64 是唯一「均值与最差 1% 区域都不低于现有 WebP」的档；
 *       小屏 q56 相对现有 WebP q80 是**又小又好**。
 *     · 完整的档位/画质对照见 `scripts/frames-to-avif.py` 的文件头。
 *
 * 具体目录名 = 本变量 + `FRAME_FORMATS[format].dirSuffix`（见下）。
 */
const FRAME_SIZE_DIR = (() => {
  const canvasPx = window.innerWidth * Math.min(window.devicePixelRatio || 1, 2);
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return shortSide <= 900 && canvasPx <= 2000 ? 'frames-sm' : 'frames';
})();

/**
 * 帧序列 URL 的版本号。
 *
 * ⚠️ **改了 `public/frames*` 里的图片内容，必须把这个数字 +1。**
 *
 * 为什么需要它：`vercel.json` 给这些目录配了 `max-age=31536000, immutable`
 * —— 回访浏览器**一整年都不会再问服务器**（这正是我们要的：帧集第二次打开就是零网络）。
 * 代价是不带版本号的 URL 会让老访客永远拿到旧图。
 * 版本号进 query，URL 一变就是全新资源，老缓存自然作废，且不影响其他访问者。
 *
 * 2026-09-29 起：线上实测这些帧的响应头是 `public, max-age=0, must-revalidate`，
 * 也就是**每次打开都要回源校验 120 次**（跨境 RTT 叠加，雪上加霜）。
 *
 * =2：换 AVIF（2026-09-29）。
 */
const FRAME_VERSION = 2;

/**
 * 组装帧 URL：**尺寸档 × 编码档**两个轴。
 *
 *   尺寸档（`FRAME_SIZE_DIR`）：大屏 `frames` / 小屏 `frames-sm`
 *   编码档（本函数的参数）：AVIF 是**后缀** → `frames-avif` / `frames-sm-avif`；
 *                          WebP 是不带后缀的原目录（也就是改造前的那一套）
 *
 * 为什么编码档要做成可切换：AVIF 在 Chromium/Firefox/新版 Safari 上都支持，
 * 但**解码失败是静默的**（`onerror` 也算定案，只是那一格永远没画面）。
 * 所以必须留一套 WebP 兜底，且要有能力在运行时退回去（见 App 里的 `frameFormat`）。
 *
 * 收益（实测，120 张）：大屏 10.69MB → 6.69MB，小屏 3.16MB → 2.60MB。
 */
/**
 * 编码档 → 目录后缀 / 扩展名。
 *
 * ⚠️ **这张表必须是纯字面量**：`scripts/check-assets.mjs` 靠它校验「代码要请求的帧
 * 在 public/ 里到底存不存在」。抽成变量或拼字符串都会让那个守卫失明 ——
 * 它上一次失明的后果是**上线了一个纯黑首页**（404 被当成"加载完成"，
 * 浏览器不报错，只是帧全空）。
 */
const FRAME_FORMATS = {
  avif: { dirSuffix: '-avif', ext: 'avif' },
  webp: { dirSuffix: '', ext: 'webp' },
} as const;

const buildFrameUrls = (format: keyof typeof FRAME_FORMATS): string[] => {
  const { dirSuffix, ext } = FRAME_FORMATS[format];
  const dir = `${FRAME_SIZE_DIR}${dirSuffix}`;
  return Array.from(
    { length: TOTAL_FRAMES },
    (_, i) => `/${dir}/${String(i + 1).padStart(4, '0')}.${ext}?v=${FRAME_VERSION}`,
  );
};

/**
 * 编码档还没探测出来时用的空数组。**必须是模块级常量**：`useWindowedFrames` 的
 * effect 依赖 `urls` 的**引用**，每次渲染现造一个 `[]` 会让 effect 反复重跑。
 */
const NO_FRAME_URLS: string[] = [];

/**
 * 加载页**只等首窗**（前 `HEAD_FRAMES` 张），其余帧一律降到后台按优先级补。
 *
 * 这个值被改了三次，每一次都建立在推翻上一次的前提上，所以三次都记在这里：
 *
 *   ① 最初 wait 里塞了 5 个 GLB（合计 3.4MB，rack.glb 另算 9.1MB）。但那 6 个模型
 *      **首页一个都用不到** —— 它们只在工作室里出现，而工作室必须先滚完这 300vh 的
 *      开门动画、再点 Open 才进得去，中间有大把时间让它们在后台下完。改成 `prefetch`。
 *
 *   ② 然后 wait = 全部 120 张帧（10.7MB）。当时的理由是「useWindowedFrames 反正也要
 *      全量解码这 120 张，等它等于没多等」。**这个前提在慢网下不成立**：线上实测跨境
 *      链路只有约 430 KB/s（单帧 108KB 要 0.99s），120 张全量要 **25.3 秒**，
 *      而两个 hook 的兜底超时是 12s / 18s —— 于是门在帧只下到 60%~72% 时就开了，
 *      **缺的正好是序号末尾的「门开露黄光」**。这就是用户报的「一直转、滚不全、
 *      结尾不出画面」。
 *
 *   ③ 现在 wait = 前 `HEAD_FRAMES` 张。关键事实：**进入首页的那一刻只需要第 1 帧**。
 *      300vh 的滚动行程走完要好几秒，后面的帧完全来得及在用户滚到之前到位。
 *      首窗 8 张约 0.7MB（大屏）/ 0.22MB（小屏）→ 1~2 秒就有画面（加载页还有 3 秒
 *      最短可见时间兜着）。等待量降到原来的 1/15，进入耗时从 25 秒降到 3 秒量级。
 *
 * ⚠️ 帧的加载**不再走 useAssetPreload 的 wait 组** —— 那条路会和 useWindowedFrames
 * 拉同一批首帧，实测前 12 个网络请求里有 4 个是重复的（白占并发位与带宽）。
 * 现在只有一个帧加载器：`useWindowedFrames(frameUrls, { headCount, priorityTail })`。
 */
const HEAD_FRAMES = 8;
/**
 * 末尾优先帧数。**已归零（2026-09-29 20:xx，推翻了自己 3 小时前的改动）。**
 *
 * 原来给 16，理由是「结局帧（门开露黄光）是整个动画的高潮，提前把它拉下来，
 * 免得滚到最后没画面」。
 *
 * 现在归零，因为 HomeSection 加了「影片位置夹到已缓冲前沿」之后，这条优化**反噬**了：
 *   · 前沿 = 从第 0 帧起**连续**就绪的最深一帧；
 *   · 末窗优先让第 105-120 张抢先到位，而它们**对前沿毫无贡献**（中间 9-104 还缺着）；
 *   · 于是前沿被拖慢，而前沿才是影片能播到哪里的唯一决定因素。
 *
 * 更关键的是：**夹取之后「滚到最后没画面」在结构上不可能发生了** ——
 * 影片根本走不到第 120 帧，除非那一帧真的到了。所以这条优化连它原本要防的问题
 * 都不需要再防。现在帧严格按 1→120 顺序下，前沿**单调前进**，影片跟着匀速推进。
 *
 * （`useWindowedFrames` 仍保留 `priorityTail` 选项与 `tailQ` 队列 —— 它是个通用能力，
 * 只是首页这条链路不再需要。滚动插队 `focus` 仍在用，它保证「下一帧永远在队列最前」。）
 */
const TAIL_FRAMES = 0;

/**
 * 后台预热：进工作室才用得上的大件。不计进度、不卡加载页，且**加载页消失之后**
 * 才开始拉（App 传 `prefetchGate: entered`）—— 否则它们会在第 1 秒就跟序列帧抢带宽。
 * 2026-09-29 实测：首屏下载的 4.02MB 里有 **1.48MB** 就是这几件。
 */
const PREFETCH_MODELS: string[] = [
  `${import.meta.env.BASE_URL}about/mascot.glb`,
  `${import.meta.env.BASE_URL}newsstand/dvd.glb`,
  `${import.meta.env.BASE_URL}newsstand/dv.glb`,
  `${import.meta.env.BASE_URL}newsstand/mp3.glb`,
  `${import.meta.env.BASE_URL}newsstand/tape.glb`,
  // rack.glb 一个人 9MB（贴图转 WebP 无损后从 17.9MB 降到 9.1MB），是全套最重的一件
  `${import.meta.env.BASE_URL}newsstand/rack.glb`,
];

function App() {
  // ?studio=1 / ?about=1 / ?greenos=1 预览模式：视为已过加载页，便于直接测试
  const [entered, setEntered] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('studio') || params.has('about') || params.has('greenos') || params.has('crt');
  });
  // 转场白光：idle / on（瞬间亮）/ fading（0.4s 淡出）
  const [flash, setFlash] = useState<'idle' | 'on' | 'fading'>('idle');
  // ?studio=1 可跳过首页直接预览工作室（真实流程：滚到 90% 点 OPEN 进入）
  // ?greenos=1 / ?crt=1 是"钻进 CRT 后的 Green OS"预览，同样直接落到工作室
  const [stage, setStage] = useState<'home' | 'studio'>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('studio') || params.has('about') || params.has('greenos') || params.has('crt')) {
      return 'studio';
    }
    return window.location.hash === '#about' ? 'studio' : 'home';
  });
  /**
   * 帧的**编码档**：`null` = 还在探测，`'avif'` / `'webp'` = 已定档。
   *
   * 为什么是异步：探测 AVIF 的唯一可靠办法是**真的解一张 AVIF**。
   * 网上流传的同步写法 `canvas.toDataURL('image/avif')` 在 Chromium 上**会误判**
   * （它返回 `data:image/png`，因为 Chrome 不支持把 canvas 编成 AVIF），
   * 拿它当判据会把绝大多数 Chrome/Edge/微信用户错误地关在 AVIF 门外。
   * 详见 `src/lib/avifSupport.ts`。探测本身是解一个 315 字节的内联 AVIF，
   * 一个微任务级别，肉眼不可察。
   *
   * `null` 期间 `frameUrls` 是空数组且 `enabled: false` —— 帧**一张都不会开始下**，
   * 也**不会放行加载页**（否则会出现「帧还没开始下，首页已经露出来」）。
   */
  const [frameFormat, setFrameFormat] = useState<'avif' | 'webp' | null>(null);

  useEffect(() => {
    let alive = true;
    supportsAvif().then((ok) => {
      if (alive) setFrameFormat(ok ? 'avif' : 'webp');
    });
    return () => {
      alive = false;
    };
  }, []);

  const frameUrls = useMemo(
    () => (frameFormat ? buildFrameUrls(frameFormat) : NO_FRAME_URLS),
    [frameFormat],
  );

  // 暴露给回归探针：`document.documentElement.dataset.frameFormat` 断言走的是哪一档
  useEffect(() => {
    if (frameFormat) document.documentElement.dataset.frameFormat = frameFormat;
  }, [frameFormat]);

  // 序列帧加载：**首窗放行 + 顺序填充 + 滚动插队**（详见 useWindowedFrames 顶部说明）。
  // 仍是「全量解码常驻」（窗口式会冻帧/跳帧/黑屏），但**放行不再等全量** ——
  // 门在首窗到齐时就开，剩下 112 张按 1→120 顺序在后台补（`priorityTail: 0`，
  // 曾经是「末窗优先」，被「夹到缓冲前沿」的改动推翻了，见 TAIL_FRAMES 的注释）。
  // framesRevision 透传给绘制端：迟到的帧靠它触发补画（否则门永远不开）。
  const {
    images,
    complete: framesComplete,
    focus: focusFrame,
    revisionRef: framesRevision,
    loadedCount,
    erroredRef: framesErrored,
  } = useWindowedFrames(frameUrls, {
    headCount: HEAD_FRAMES,
    priorityTail: TAIL_FRAMES,
    enabled: frameFormat !== null,
  });

  /**
   * AVIF 兜底：选了 AVIF 却连续解不出来 → 掉回 WebP 重来一次。
   *
   * 为什么值得写这一道：**帧解码失败是不报错的**，那一格只会永远没有画面，
   * 用户看到的是「首页黑了 / 帧不出现」，而且没有任何控制台错误可查。
   * 触发场景很窄（老 Safari、被中间层改写了 content-type 的代理），
   * 但代价不对称：真踩上就是整站首屏不可用。
   *
   * 挂在 `loadedCount` 上（它变化会触发重渲染），所以不需要额外定时器。
   */
  useEffect(() => {
    if (frameFormat !== 'avif') return;
    if (loadedCount > 0 && framesErrored.current >= 3) setFrameFormat('webp');
  }, [frameFormat, loadedCount, framesErrored]);

  /**
   * 只负责**后台预热**（那 6 个 GLB），不再参与首屏的进度与放行。
   *
   * 为什么不复用它的 wait 组来等首窗：那会和 useWindowedFrames 拉**同一批**首帧。
   * 2026-09-29 实测：前 12 个网络请求里有 4 个是重复的（`1,2,3,4` 又来一遍），
   * 白占并发位、白占带宽。现在帧的加载进度与放行判据**只有一个来源** ——
   * useWindowedFrames。
   *
   * ⚠️ `prefetchGate` 的门槛被改过三次。**第二次的归因是错的，记在这里免得再犯：**
   *   ① 原来 = 「wait 组（120 张帧）跑完才开始」→ 保守但对，帧全程独占带宽。
   *   ② 我一度改成 `entered`（加载页一消失就预热），并把用户报的「中间动画断了、
   *      直接跳到门开」归因成「6 个 GLB 抢带宽」。
   *      **这个归因被 A/B 证伪了**：`_verify-load-fix.mjs G6_BLOCK="*.glb"` 前后
   *      对照，显示帧的最大落后是 54 → 52 帧、中间帧到位 36 → 37 张，**没有差别**。
   *      真正的根因是「120 张 × 89KB = 10.7MB，而用户甩完 300vh 只要 1.6 秒」，
   *      即带宽总量问题，减掉 1.5MB 的 GLB 无济于事。
   *   ③ 现在 = `entered && 帧下到 70%`。**保留它不是因为上面那个错归因**，而是因为
   *      帧集瘦身之后（见 MEMORY 里的档位表）GLB 这 1.5MB 的**相对占比**变大，
   *      而影片的推进速度已经完全由前沿决定 —— 让 GLB 排在帧后面是纯赚。
   *      代价是工作室的大模型（rack.glb 9.1MB）晚几秒起跑，而进工作室本来就要先
   *      走完整个开门动画再点 OPEN，这点延迟吃得到。
   */
  const framesMostlyLoaded = loadedCount >= Math.floor(TOTAL_FRAMES * 0.7);
  useAssetPreload({
    wait: [],
    prefetch: PREFETCH_MODELS,
    prefetchGate: entered && framesMostlyLoaded,
  });

  /** 加载页的 0→100%：首窗的完成度（useWindowedFrames 在首窗期间逐张上报） */
  const progress = Math.min(1, loadedCount / HEAD_FRAMES);

  const lenisRef = useRef<Lenis | null>(null);
  const downBlockedRef = useRef(false);

  const handleEnter = useCallback(() => {
    setEntered(true);
  }, []);

  /**
   * 访问日志埋点：落地即记一条，并装好「离开时补报停留时长」。
   *
   * 记的是「有没有面试官来看过」——靠你发出去的 `?from=xxx` 标记认人，
   * 不靠 IP（IP 只用来查城市做参考）。全程静默，访客无感。
   */
  useEffect(() => {
    recordEnter(stage);
    wireExitFlush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lenis 平滑滚动
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.15,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      // 作者机器 Windows「动画效果」是关的 → Chromium 上报 reduce，Lenis 默认会据此
      // 关闭平滑滚动（退回原生阶梯滚动＝卡顿）。与全站 FORCE_FULL_MOTION 策略一致，
      // 这里强制开启平滑，关着动效也拿满丝滑。
      respectReducedMotion: false,
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
      // 首页播放到 100% 时拦截"继续向下"，向上仍然放行
      virtualScroll: (data) => {
        // 详情页开着 → 滚轮让位给详情页自己的 Lenis（wkp-motion.ts），
        // 不然主页 lenis 会在背后把工作室页面也滚走
        if (document.querySelector('.wkp')) return false;
        if (downBlockedRef.current && data.deltaY > 0) return false;
        return true;
      },
    });
    lenisRef.current = lenis;

    // GSAP 驱动 Lenis：用 gsap.ticker 统一帧循环，滚动更顺滑、更"活"
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  // 加载页期间停止滚动，进入后恢复
  useEffect(() => {
    const lenis = lenisRef.current;
    if (!lenis) return;
    if (entered) lenis.start();
    else lenis.stop();
  }, [entered]);

  // 工作室是整屏，无需滚动
  useEffect(() => {
    const lenis = lenisRef.current;
    if (!lenis) return;
    if (stage === 'studio') lenis.stop();
    else if (entered) lenis.start();
  }, [stage, entered]);

  /**
   * 进工作室前预热背景资源：StudioLensBackground 的 `<video>` 只在 stage 切到 'studio'
   * 时才挂载，若等到点 OPEN 才加载，进门后会卡在「静帧海报 → 视频缓冲」的空窗，
   * 观感就是用户说的「背景出现得很慢」。这里在首页给循环视频 + 首帧海报预热。
   * 不卡加载页、不计入进度。
   *
   * ⚠️ 2026-09-29 修了两处，都是实测出来的（`_audit-firstload.mjs`）：
   *
   *  ① **原来同一个 2.4MB 文件会下两遍 —— 首访 12.4MB 里有 4.85MB 是它，占 39%。**
   *     因为它同时用**两套机制**拉同一个 URL：一个隐藏 `<video preload="auto">`
   *     走 Media 管线，外加一条 `<link rel="prefetch" as="video">` 走 prefetch 管线。
   *     注释里把后者写成「兜底：部分浏览器对隐藏 video 的预载优先级偏低」，
   *     但**两套是同时发出的**，谁都没拿到字节时对方就起跑了 —— 于是各下一份。
   *     实测 CDP 里就是两条记录：同 URL，type 分别是 `Media` 与 `Other`。
   *     → 只留 `<video>` 那套（它填的正是真实 `<video>` 要复用的那份缓存）。
   *
   *  ② **它和序列帧抢带宽**。`requestIdleCallback` 只等**主线程**空闲，跟网络无关，
   *     所以它在帧还在下的时候就起跑了 —— 实测 16 秒窗口里，帧下了 6.88MB、
   *     它下了 4.85MB，两者在同一根 430KB/s 的管子上抢。而在首屏这条路径上，
   *     帧才是决定推镜顺不顺的东西，工作室视频要等「滚完 300vh + 点 OPEN」才用得上。
   *     → 门槛改成 `framesMostlyLoaded`，和那 6 个 GLB 用同一把闸（帧到 70% 才放行）。
   */
  useEffect(() => {
    if (stage !== 'home' || !entered || !framesMostlyLoaded) return;
    // 省流量 / 计费网络：不预拉 2.4MB 视频，进门后照常走海报→缓冲流程
    const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const idle: (cb: () => void) => number =
      'requestIdleCallback' in window
        ? (cb) => window.requestIdleCallback(cb as IdleRequestCallback)
        : (cb) => window.setTimeout(cb, 1500);
    const handle = idle(() => {
      const base = import.meta.env.BASE_URL;
      // 海报：海报组件与 LensDistortion 的 image 同源，预热后两者都零等待
      const poster = new Image();
      poster.src = `${base}studio/studio-poster.jpg`;
      // 隐藏 video 预热 HTTP / 字节区间缓存：StudioLensBackground 里同源 <video> 秒播
      // ⚠️ 别再加 `<link rel=prefetch>` —— 见上面 ①，那会让这 2.4MB 下两遍。
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.src = `${base}studio/studio-loop.mp4`;
      v.load();
    });
    return () => {
      if ('cancelIdleCallback' in window) {
        try {
          window.cancelIdleCallback(handle);
        } catch {
          /* 尚未调度 */
        }
      }
    };
  }, [stage, entered, framesMostlyLoaded]);

  const setDownBlocked = useCallback((blocked: boolean) => {
    downBlockedRef.current = blocked;
  }, []);

  // 清掉可能残留的 #about / #studio 锚点，避免下次进入工作室时 About 自动弹出
  const clearEntryHash = useCallback(() => {
    if (window.location.hash) {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    }
  }, []);

  // 开门 → 进入工作室（iris 转场：从门心绽放的圆形过曝铺满全屏，再 0.42s 淡出）
  const handleOpen = useCallback(() => {
    clearEntryHash(); // 回到工作室必须是"干净"的工作室，不自动弹 About
    setStage('studio'); // 旧页面消失、新页面就位（被白光盖住）
    setFlash('on'); // 从门心绽放的圆形过曝（iris-in）开始
    // 先让花瓣展开到全屏（0.4s），再 0.42s 淡出露出工作室
    window.setTimeout(() => setFlash('fading'), 400);
    window.setTimeout(() => setFlash('idle'), 820);
  }, [clearEntryHash]);

  // 点击 MY STUDIO → 回到首页初始（滚动归零）
  const handleBack = useCallback(() => {
    clearEntryHash();
    // 关键：把「到底拦截向下」的标志复位。
    // downBlockedRef 住在 App 里、跨 HomeSection 挂载存活；从工作室回来时它
    // 还留着上次滚到 119 帧时置的 true，而 HomeSection 只在 atEnd **变化**时才
    // 下发复位 —— 重挂载后 atEndRef 又是 false、和它相等，于是一直没人复位，
    // 结果就是回到首页后向下滚动被永久拦截（实测 396 次滚轮 scrollY 纹丝不动）。
    downBlockedRef.current = false;
    lenisRef.current?.scrollTo(0, { immediate: true });
    window.scrollTo(0, 0);
    setStage('home');
  }, [clearEntryHash]);

  const handleSelectObject = useCallback((object: StudioObject) => {
    // 第一步仅做鼠标视差；原地浮层在下一步接入
    console.log('[studio] select object:', object.id, '→', object.target);
  }, []);

  // 底色与首页一致（近黑），避免旧页面淡出时露出酒红底而"闪一下红色"
  return (
    <div className="relative min-h-screen bg-[#0a0a0a]">
      {stage === 'home' ? (
        <>
          {!entered && (
            <LoadingScreen ready={framesComplete} progress={progress} onEnter={handleEnter} />
          )}
          <HomeSection
            images={images}
            ready={framesComplete}
            entered={entered}
            onFrameFocus={focusFrame}
            onOpen={handleOpen}
            setDownBlocked={setDownBlocked}
            framesRevision={framesRevision}
          />
        </>
      ) : (
        <StudioSection onSelectObject={handleSelectObject} onBack={handleBack} />
      )}
      {/* 转场白光（z 最高，覆盖页面切换瞬间） */}
      {flash !== 'idle' && (
        <div className={`flash-burst${flash === 'fading' ? ' is-fading' : ''}`} />
      )}

      {/*
        作者 / 访客模式徽标：常驻渲染，但它自己会判断——没解锁时什么都不显示，
        所以访客在页面上根本看不到它；另外隐藏入口（连按 5 次 M）也要在加载页
        期间就能用，所以这里不能挂在 entered 后面。
      */}
      <ModeSwitch />
    </div>
  );
}

export default App;
