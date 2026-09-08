import { useEffect, useRef, useState } from 'react';

interface HomeSectionProps {
  images: HTMLImageElement[];
  complete: boolean;
  entered: boolean;
  onOpen: () => void;
  setDownBlocked: (blocked: boolean) => void;
}

const TOTAL_FRAMES = 120;
// OPEN / bell trigger at 90% scroll progress
const THRESHOLD_FRAME = Math.floor(0.9 * (TOTAL_FRAMES - 1)); // 107

export function HomeSection({ images, complete, entered, onOpen, setDownBlocked }: HomeSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const targetFrameRef = useRef(0);
  const currentFrameRef = useRef(-1);
  const dimsRef = useRef({ width: 0, height: 0, dpr: 1 });
  const atEndRef = useRef(false);
  const wasAtThresholdRef = useRef(false);
  const bellRef = useRef<HTMLAudioElement | null>(null);
  const portfolioRef = useRef<HTMLDivElement>(null);

  const [showOpen, setShowOpen] = useState(false);

  // Prepare the bell sound
  useEffect(() => {
    const audio = new Audio('/bell.mp3');
    audio.preload = 'auto';
    bellRef.current = audio;
    return () => {
      bellRef.current = null;
    };
  }, []);

  // Resize canvas to match viewport at device pixel ratio
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;

    if (dimsRef.current.width === width && dimsRef.current.height === height && dimsRef.current.dpr === dpr) return;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    dimsRef.current = { width, height, dpr };

    drawFrame(currentFrameRef.current);
  };

  // Draw a single frame to the canvas using cover-fit
  const drawFrame = (frameIndex: number) => {
    const canvas = canvasRef.current;
    if (!canvas || frameIndex < 0 || frameIndex >= images.length) return;

    const img = images[frameIndex];
    if (!img || img.naturalWidth === 0) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const { width, height, dpr } = dimsRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const canvasAspect = width / height;
    const imgAspect = img.naturalWidth / img.naturalHeight;

    let drawW = width;
    let drawH = height;
    let drawX = 0;
    let drawY = 0;

    if (imgAspect > canvasAspect) {
      drawH = height;
      drawW = height * imgAspect;
      drawX = (width - drawW) / 2;
    } else {
      drawW = width;
      drawH = width / imgAspect;
      drawY = (height - drawH) / 2;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  };

  // Scroll-driven frame mapping + 90% OPEN/bell + 100% end-lock
  useEffect(() => {
    if (!entered || !complete || !containerRef.current) return;

    const container = containerRef.current;

    const computeProgress = () => {
      const rect = container.getBoundingClientRect();
      const maxScroll = rect.height - window.innerHeight;
      const raw = maxScroll > 0 ? -rect.top / maxScroll : 0;
      return Math.max(0, Math.min(1, raw));
    };

    // "Portfolio" fades in at 10%, fully out before OPEN appears (90%)
    const updatePortfolio = (p: number) => {
      const el = portfolioRef.current;
      if (!el) return;
      const IN_START = 0.10, IN_END = 0.22;
      const OUT_START = 0.80, OUT_END = 0.88;
      let o = 0;
      if (p <= IN_START || p >= OUT_END) o = 0;
      else if (p >= IN_END && p <= OUT_START) o = 1;
      else if (p < IN_END) o = (p - IN_START) / (IN_END - IN_START);
      else o = 1 - (p - OUT_START) / (OUT_END - OUT_START);
      el.style.opacity = String(Math.max(0, Math.min(1, o)));
    };

    const handleScroll = () => {
      const clamped = computeProgress();
      targetFrameRef.current = Math.floor(clamped * (TOTAL_FRAMES - 1));
      updatePortfolio(clamped);
      const atEnd = targetFrameRef.current >= TOTAL_FRAMES - 1;
      if (atEnd !== atEndRef.current) {
        atEndRef.current = atEnd;
        setDownBlocked(atEnd);
      }

      // OPEN + bell whenever we (re)arrive at the 90% frame
      const atThreshold = targetFrameRef.current >= THRESHOLD_FRAME;
      if (atThreshold && !wasAtThresholdRef.current) {
        setShowOpen(true);
        bellRef.current?.play().catch(() => {});
      } else if (!atThreshold && wasAtThresholdRef.current) {
        setShowOpen(false);
      }
      wasAtThresholdRef.current = atThreshold;
    };

    // Blocking further DOWN scrolling at 100% is handled by Lenis (virtualScroll hook)

    const tick = () => {
      if (targetFrameRef.current !== currentFrameRef.current) {
        currentFrameRef.current = targetFrameRef.current;
        drawFrame(currentFrameRef.current);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    handleScroll();

    if (images.length > 0 && images[0]?.complete) {
      drawFrame(0);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(rafRef.current);
    };
  }, [entered, complete, images, setDownBlocked]);

  // Redraw whenever images array becomes fully populated
  useEffect(() => {
    if (complete && images.length === TOTAL_FRAMES) {
      resizeCanvas();
      drawFrame(currentFrameRef.current >= 0 ? currentFrameRef.current : 0);
    }
  }, [complete, images]);

  const handleOpen = () => {
    onOpen();
  };

  return (
    <section id="home" ref={containerRef} className="relative h-[300vh]">
      <div className="sticky top-0 h-screen w-full overflow-hidden bg-[#0a0a0a]">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ willChange: 'transform', transform: 'translateZ(0)' }}
          aria-label="Scroll-driven room animation"
        />

        {/* Dark vignette overlay */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.4)_100%)]" />

        {/* "Portfolio" — fades in at 10%, fully out before OPEN (90%) */}
        <div
          ref={portfolioRef}
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          style={{ opacity: 0 }}
        >
          <span className="font-jheri text-[#76F0CA] leading-none select-none whitespace-nowrap" style={{ fontSize: '16vw' }}>
            Portfolio
          </span>
        </div>

        {/* OPEN button at the center of the door (appears at 90%) */}
        {showOpen && (
          <button
            onClick={handleOpen}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex items-center justify-center px-10 py-4 border border-cream/70 bg-black/30 backdrop-blur-sm text-cream font-body text-base tracking-[0.5em] uppercase transition-all duration-500 animate-[fadeScale_0.6s_ease-out] hover:bg-cream hover:text-wine"
          >
            OPEN
          </button>
        )}

        {/* Scroll indicator (hidden once OPEN appears) */}
        {!showOpen && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 text-cream/60">
            <span className="text-[9px] tracking-[0.35em] uppercase font-body">Scroll</span>
            <span className="w-px h-10 bg-cream/40 animate-pulse" />
          </div>
        )}
      </div>
    </section>
  );
}
