import { useCallback, useEffect, useRef, useState } from 'react';
import Lenis from 'lenis';
import { LoadingScreen } from '@/components/LoadingScreen';
import { HomeSection } from '@/sections/HomeSection';
import { useImagePreloader } from '@/hooks/useImagePreloader';
import 'lenis/dist/lenis.css';
import './App.css';

const TOTAL_FRAMES = 120;
const frameUrls = Array.from(
  { length: TOTAL_FRAMES },
  (_, i) => `/frames/${String(i + 1).padStart(4, '0')}.jpg`,
);

function App() {
  const [entered, setEntered] = useState(false);
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
      // 首页播放到 100% 时拦截“继续向下”，向上仍然放行
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

  const setDownBlocked = useCallback((blocked: boolean) => {
    downBlockedRef.current = blocked;
  }, []);

  // 本仓库仅包含「加载页 + 首页」。OPEN 之后的房间内容在完整项目（app/）中。
  const handleOpen = useCallback(() => {}, []);

  return (
    <div className="relative min-h-screen bg-wine">
      <LoadingScreen ready={complete} onEnter={handleEnter} />
      <HomeSection
        images={images}
        complete={complete}
        entered={entered}
        onOpen={handleOpen}
        setDownBlocked={setDownBlocked}
      />
      {/* 全局胶片颗粒叠层 */}
      <div className="noise-overlay" />
    </div>
  );
}

export default App;
