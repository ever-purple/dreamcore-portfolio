import { useCallback, useEffect, useRef, useState } from 'react';
import Lenis from 'lenis';
import { LoadingScreen } from '@/components/LoadingScreen';
import { ModeSwitch } from '@/components/ModeSwitch';
import { HomeSection } from '@/sections/HomeSection';
import { StudioSection } from '@/sections/StudioSection';
import { useWindowedFrames } from '@/hooks/useWindowedFrames';
import { useAssetPreload } from '@/hooks/useAssetPreload';
import { recordEnter, wireExitFlush } from '@/lib/visitLog';
import type { StudioObject } from '@/data/studio';
import 'lenis/dist/lenis.css';
import './App.css';
import gsap from 'gsap';

const TOTAL_FRAMES = 120;

/**
 * 序列帧目录**按画布真实像素宽自适应**：
 *   · 桌面 → `public/frames`    （2560×1443，WebP q88，10.7MB）
 *   · 小屏 → `public/frames-sm` （1440×812， WebP q80， 3.2MB）
 *
 * 判据用「画布像素宽」而不是 CSS 宽，因为 canvas 尺寸是
 * `innerWidth × min(devicePixelRatio, 2)`（见 HomeSection.resizeCanvas）。
 *
 * ⚠️ 只看宽度会漏掉**手机横屏**：844×2 = 1688 会被判成大屏，于是手机去吃 10.7MB
 * 的桌面帧集 —— 恰恰是最该省流量的场景。所以再压一道「短边」条件：
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
 * 2026-09-28 从 JPEG 换 WebP：`public/frames` 原来 63.1MB（120 张 2560×1443），
 * 是全站首屏最大的一笔。WebP q88 后 10.7MB（−83%），实测 PSNR 45.7dB（>40 即视觉无损）。
 */
const FRAME_DIR = (() => {
  const canvasPx = window.innerWidth * Math.min(window.devicePixelRatio || 1, 2);
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return shortSide <= 900 && canvasPx <= 2000 ? 'frames-sm' : 'frames';
})();

/**
 * 帧序列 URL 的版本号。
 *
 * ⚠️ **改了 `public/frames` 或 `public/frames-sm` 里的图片内容，必须把这个数字 +1。**
 *
 * 为什么需要它：`vercel.json` 给这两个目录配了 `max-age=31536000, immutable`
 * —— 回访浏览器**一整年都不会再问服务器**（这正是我们要的：10.69MB 的帧集
 * 第二次打开就是零网络）。代价是不带版本号的 URL 会让老访客永远拿到旧图。
 * 版本号进 query，URL 一变就是全新资源，老缓存自然作废，且不影响其他访问者。
 *
 * 2026-09-29 起：线上实测这些帧的响应头是 `public, max-age=0, must-revalidate`，
 * 也就是**每次打开都要回源校验 120 次**（跨境 RTT 叠加，雪上加霜）。
 */
const FRAME_VERSION = 1;

const frameUrls = Array.from(
  { length: TOTAL_FRAMES },
  (_, i) => `/${FRAME_DIR}/${String(i + 1).padStart(4, '0')}.webp?v=${FRAME_VERSION}`,
);

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
 * 末尾优先帧数。滚动到 90% 才出现 OPEN、到 100% 才是「门开露黄光」的结局帧，
 * 它是整个滚动动画的高潮 —— 把这 16 张提到队首，就不会出现「滚到最后没画面」。
 * 必须与 useWindowedFrames 的 priorityTail 语义一致（>= 119 - 108 + 1 覆盖阈值帧）。
 */
const TAIL_FRAMES = 16;

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
  // 序列帧加载：**首窗放行 + 末窗优先 + 滚动插队**（详见 useWindowedFrames 顶部说明）。
  // 仍是「全量解码常驻」（窗口式会冻帧/跳帧/黑屏），但**放行不再等全量** ——
  // 门在首窗到齐时就开，剩下 112 张按 末窗 → 其余 的优先级在后台补。
  // framesRevision 透传给绘制端：迟到的帧靠它触发补画（否则门永远不开）。
  const {
    images,
    complete: framesComplete,
    focus: focusFrame,
    revisionRef: framesRevision,
    loadedCount,
  } = useWindowedFrames(frameUrls, { headCount: HEAD_FRAMES, priorityTail: TAIL_FRAMES });

  /**
   * 只负责**后台预热**（那 6 个 GLB），不再参与首屏的进度与放行。
   *
   * 为什么不复用它的 wait 组来等首窗：那会和 useWindowedFrames 拉**同一批**首帧。
   * 2026-09-29 实测：前 12 个网络请求里有 4 个是重复的（`1,2,3,4` 又来一遍），
   * 白占并发位、白占带宽。现在帧的加载进度与放行判据**只有一个来源** ——
   * useWindowedFrames。
   *
   * `prefetchGate: entered` = 加载页消失之后才预热。否则预热组会在第 1 秒就起跑，
   * 跟剩下的 112 张帧抢带宽 —— 实测首屏下载的 4.02MB 里 **1.48MB 是这些 GLB**，
   * 而它们首页一个都用不到（只在工作室里出现）。
   */
  useAssetPreload({ wait: [], prefetch: PREFETCH_MODELS, prefetchGate: entered });

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

  // 进工作室前预热背景资源：StudioLensBackground 的 <video> 只在 stage 切到 'studio'
  // 时才挂载，若等到点 OPEN 才加载，进门后会卡在「静帧海报 → 视频缓冲」的空窗，
  // 观感就是用户说的「背景出现得很慢」。这里在首页 idle 时把循环视频 + 首帧海报
  // 先拉进缓存，进门即播、镜头水波揭示立刻就位。
  // 不卡加载页、不计入进度，且只在真·首页 + 已进场后做，绝不抢占首页关键资源。
  useEffect(() => {
    if (stage !== 'home' || !entered) return;
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
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.src = `${base}studio/studio-loop.mp4`;
      v.load();
      // 兜底：prefetch link，部分浏览器对隐藏 video 的预载优先级偏低
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'video';
      link.type = 'video/mp4';
      link.href = `${base}studio/studio-loop.mp4`;
      document.head.appendChild(link);
      window.setTimeout(() => {
        try {
          document.head.removeChild(link);
        } catch {
          /* 已移除 */
        }
      }, 10000);
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
  }, [stage, entered]);

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
