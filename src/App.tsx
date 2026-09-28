import { useCallback, useEffect, useRef, useState } from 'react';
import Lenis from 'lenis';
import { LoadingScreen } from '@/components/LoadingScreen';
import { ModeSwitch } from '@/components/ModeSwitch';
import { HomeSection } from '@/sections/HomeSection';
import { StudioSection } from '@/sections/StudioSection';
import { useWindowedFrames } from '@/hooks/useWindowedFrames';
import { useAssetPreload } from '@/hooks/useAssetPreload';
import type { StudioObject } from '@/data/studio';
import 'lenis/dist/lenis.css';
import './App.css';
import gsap from 'gsap';

const TOTAL_FRAMES = 120;
const frameUrls = Array.from(
  { length: TOTAL_FRAMES },
  (_, i) => `/frames/${String(i + 1).padStart(4, '0')}.jpg`,
);

/**
 * 模型预热：进工作室才用得上的大件，先默默下进缓存，不计进进度条、也不卡加载页。
 * rack.glb 一个人 9MB（贴图转 WebP 无损后从 17.9MB 降到 9.1MB），是全套最重的一件，
 * 绝不能让它等在加载页里 —— 首页压根用不到它。
 * 省流量模式 / 2G/3G 下会自动跳过预热（见 useAssetPreload 的 worthPrefetching）。
 */
const PREFETCH_MODELS: string[] = [`${import.meta.env.BASE_URL}newsstand/rack.glb`];

const WAIT_ASSETS = [
  ...frameUrls, // 全部序列帧 = 首页本体
  `${import.meta.env.BASE_URL}about/mascot.glb`,
  `${import.meta.env.BASE_URL}newsstand/dvd.glb`,
  `${import.meta.env.BASE_URL}newsstand/dv.glb`,
  `${import.meta.env.BASE_URL}newsstand/mp3.glb`,
  `${import.meta.env.BASE_URL}newsstand/tape.glb`,
];

/** 同时最多下 8 个：120 张帧一起发会把带宽打满，关键资源反而被挤到后面 */
const PRELOAD_CONCURRENCY = 8;

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
  // 序列帧回到「全量加载」：120 张全部解码常驻，滚到哪一帧就有哪一帧
  // （窗口式会冻帧/跳帧/黑屏，详见 useWindowedFrames 顶部说明）。
  // 加载页本来就等了这 120 张，所以这里不增加额外等待。
  const { images, complete: framesComplete, focus: focusFrame } = useWindowedFrames(frameUrls);

  /** 加载页的 0→100%：已下完的资源 / 该下的总数，纯真实值 */
  const { done, total, ready: assetsReady } = useAssetPreload({
    wait: WAIT_ASSETS,
    prefetch: PREFETCH_MODELS,
    concurrency: PRELOAD_CONCURRENCY,
  });
  const progress = total > 0 ? done / total : 1;

  const lenisRef = useRef<Lenis | null>(null);
  const downBlockedRef = useRef(false);

  const handleEnter = useCallback(() => {
    setEntered(true);
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
            <LoadingScreen
              ready={assetsReady && framesComplete}
              progress={progress}
              onEnter={handleEnter}
            />
          )}
          <HomeSection
            images={images}
            ready={framesComplete}
            entered={entered}
            onFrameFocus={focusFrame}
            onOpen={handleOpen}
            setDownBlocked={setDownBlocked}
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
