import { useCallback, useEffect, useRef, useState } from 'react';
import Lenis from 'lenis';
import { LoadingScreen } from '@/components/LoadingScreen';
import { ModeSwitch } from '@/components/ModeSwitch';
import { HomeSection } from '@/sections/HomeSection';
import { StudioSection } from '@/sections/StudioSection';
import { useImagePreloader } from '@/hooks/useImagePreloader';
import type { StudioObject } from '@/data/studio';
import 'lenis/dist/lenis.css';
import './App.css';

const TOTAL_FRAMES = 120;
const frameUrls = Array.from(
  { length: TOTAL_FRAMES },
  (_, i) => `/frames/${String(i + 1).padStart(4, '0')}.jpg`,
);

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
  const { complete, images } = useImagePreloader(frameUrls, true);

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
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
      // 首页播放到 100% 时拦截"继续向下"，向上仍然放行
      virtualScroll: (data) => {
        if (downBlockedRef.current && data.deltaY > 0) return false;
        return true;
      },
    });
    lenisRef.current = lenis;

    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
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

  // 开门 → 进入工作室（白光过曝转场：旧页面快消失时闪一帧 90% 白光，再 0.4s 淡出）
  const handleOpen = useCallback(() => {
    clearEntryHash(); // 回到工作室必须是"干净"的工作室，不自动弹 About
    setFlash('on'); // 瞬间全屏 90% 白光
    setStage('studio'); // 旧页面消失、新页面就位（被白光盖住）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setFlash('fading')); // 下一帧开始 0.4s 平滑淡出
    });
    window.setTimeout(() => setFlash('idle'), 480);
  }, [clearEntryHash]);

  // 点击 MY STUDIO → 回到首页初始（滚动归零）
  const handleBack = useCallback(() => {
    clearEntryHash();
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
          {!entered && <LoadingScreen ready={complete} onEnter={handleEnter} />}
          <HomeSection
            images={images}
            complete={complete}
            entered={entered}
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

      {/* 作者 / 访客模式切换徽标：进入站点后常驻，全站唯一开关 */}
      {entered && <ModeSwitch />}

      {/* 全局胶片颗粒叠层 */}
      <div className="noise-overlay" />
    </div>
  );
}

export default App;
