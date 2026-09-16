import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

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

// 帧过渡平滑系数：越大越跟手，越小越"滑"。14 ≈ 70ms 时间常数，
// 配合下面的 1-exp(-k·dt) 做帧率无关的指数跟随，丝滑且不拖影。
const SMOOTH_K = 14;

// 站点级单例：铃声音频在整个会话内常驻，组件卸载后也能播完，保证用户一定听到
let sharedBell: HTMLAudioElement | null = null;
function getBell(): HTMLAudioElement {
  if (!sharedBell) {
    sharedBell = new Audio('/bell.mp3');
    sharedBell.preload = 'auto';
  }
  return sharedBell;
}

export function HomeSection({ images, complete, entered, onOpen, setDownBlocked }: HomeSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const targetProgressRef = useRef(0);
  const displayedRef = useRef(0);
  const lastTsRef = useRef(0);
  const dimsRef = useRef({ width: 0, height: 0, dpr: 1 });
  const atEndRef = useRef(false);
  const wasAtThresholdRef = useRef(false);
  const bellRef = useRef<HTMLAudioElement | null>(null);
  const portfolioRef = useRef<HTMLDivElement>(null);
  const openBtnRef = useRef<HTMLButtonElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const portfolioLineRef = useRef<HTMLSpanElement>(null);

  const [showOpen, setShowOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Prepare the bell sound (played on OPEN click — a guaranteed user gesture)
  useEffect(() => {
    bellRef.current = getBell();
  }, []);

  // cover-fit 矩形：基于画布尺寸与单帧宽高比
  const getRect = (img: HTMLImageElement) => {
    const { width, height } = dimsRef.current;
    const canvasAspect = width / height;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    let drawW: number, drawH: number, drawX: number, drawY: number;
    if (imgAspect > canvasAspect) {
      drawH = height;
      drawW = height * imgAspect;
      drawX = (width - drawW) / 2;
      drawY = 0;
    } else {
      drawW = width;
      drawH = width / imgAspect;
      drawX = 0;
      drawY = (height - drawH) / 2;
    }
    return { drawW, drawH, drawX, drawY };
  };

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

    drawCrossfade(displayedRef.current);
  };

  // 帧间溶解绘制：相邻两帧按小数权重叠加，消灭逐帧硬切的阶梯感
  const drawCrossfade = (progress: number) => {
    const canvas = canvasRef.current;
    if (!canvas || images.length === 0) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const N = images.length - 1;
    const f = Math.max(0, Math.min(N, progress * N));
    const i0 = Math.floor(f);
    const i1 = Math.min(N, i0 + 1);
    const t = f - i0;
    const img0 = images[i0];
    if (!img0 || img0.naturalWidth === 0) return;

    const { dpr } = dimsRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (t < 0.001) {
      const r = getRect(img0);
      ctx.globalAlpha = 1;
      ctx.drawImage(img0, r.drawX, r.drawY, r.drawW, r.drawH);
      return;
    }

    const img1 = images[i1];
    const r0 = getRect(img0);
    ctx.globalAlpha = 1;
    ctx.drawImage(img0, r0.drawX, r0.drawY, r0.drawW, r0.drawH);
    if (img1 && img1.naturalWidth > 0) {
      const r1 = getRect(img1);
      ctx.globalAlpha = t;
      ctx.drawImage(img1, r1.drawX, r1.drawY, r1.drawW, r1.drawH);
    }
    ctx.globalAlpha = 1;
  };

  // 滚动驱动：逻辑用原始进度（响应即时），视觉用帧率无关指数平滑（丝滑）
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
      el.style.transform = `translateY(${(p - 0.5) * -28}px)`;

      // 遮罩上滑揭示
      const line = portfolioLineRef.current;
      if (line) line.classList.toggle('is-revealed', o > 0.02);
    };

    const tick = (now: number) => {
      const dt = lastTsRef.current ? Math.min((now - lastTsRef.current) / 1000, 0.05) : 0.016;
      lastTsRef.current = now;
      const raw = computeProgress();
      targetProgressRef.current = raw;

      updatePortfolio(raw);

      const targetFrame = Math.floor(raw * (TOTAL_FRAMES - 1));
      const atEnd = targetFrame >= TOTAL_FRAMES - 1;
      if (atEnd !== atEndRef.current) {
        atEndRef.current = atEnd;
        setDownBlocked(atEnd);
      }

      // OPEN button appears at 90% (the bell now rings on OPEN click, see handleOpen)
      const atThreshold = targetFrame >= THRESHOLD_FRAME;
      if (atThreshold && !wasAtThresholdRef.current) {
        setShowOpen(true);
      } else if (!atThreshold && wasAtThresholdRef.current) {
        setShowOpen(false);
      }
      wasAtThresholdRef.current = atThreshold;

      // 帧率无关指数平滑：displayed 跟随 raw，但每帧只走 1-exp(-k·dt) 的比例，
      // 任何帧率下观感一致，且不会因掉帧而阶跃。
      const prev = displayedRef.current;
      displayedRef.current += (raw - prev) * (1 - Math.exp(-SMOOTH_K * dt));
      if (Math.abs(displayedRef.current - prev) > 1e-4) {
        drawCrossfade(displayedRef.current);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    // Blocking further DOWN scrolling at 100% is handled by Lenis (virtualScroll hook)

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    displayedRef.current = computeProgress();
    drawCrossfade(displayedRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(rafRef.current);
    };
  }, [entered, complete, images, setDownBlocked]);

  // 待机呼吸：房间在静止时也缓慢缩放，像在"呼吸"，消除死板感
  useEffect(() => {
    if (!entered || !complete || !canvasRef.current) return;
    const tween = gsap.to(canvasRef.current, {
      scale: 1.02,
      duration: 6,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
      transformOrigin: 'center center',
    });
    return () => { tween.kill(); };
  }, [entered, complete]);

  // OPEN 按钮：GSAP 弹性入场 + 磁吸跟随
  useEffect(() => {
    if (!showOpen) return;
    const btn = openBtnRef.current;
    const inner = innerRef.current;
    if (!btn || !inner) return;

    // 用 GSAP 接管 transform 来居中，替代 Tailwind 的 -translate
    gsap.set(btn, { xPercent: -50, yPercent: -50 });
    const enter = gsap.fromTo(
      btn,
      { opacity: 0, scale: 0.85 },
      { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.6)' },
    );

    const onMove = (e: MouseEvent) => {
      const r = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist < 180) {
        gsap.to(btn, { x: dx * 0.3, y: dy * 0.3, duration: 0.4, ease: 'power2.out' });
      } else {
        gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: 'power2.out' });
      }
    };
    const onLeave = () => gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: 'power2.out' });

    inner.addEventListener('mousemove', onMove);
    inner.addEventListener('mouseleave', onLeave);
    return () => {
      enter.kill();
      inner.removeEventListener('mousemove', onMove);
      inner.removeEventListener('mouseleave', onLeave);
    };
  }, [showOpen]);

  const handleOpen = () => {
    // 点击 OPEN 是用户手势，播放铃声一定被允许
    const a = bellRef.current;
    if (a) {
      a.currentTime = 0;
      a.play().catch(() => {});
    }
    // 旧页面先淡出（300ms），快消失时由 App 的 flash 白光接手
    setLeaving(true);
    window.setTimeout(onOpen, 350);
  };

  return (
    <section id="home" ref={containerRef} className="relative h-[300vh]">
      <div
        ref={innerRef}
        className={`sticky top-0 h-screen w-full overflow-hidden bg-[#0a0a0a] transition-opacity duration-300 ${
          leaving ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ willChange: 'transform', transform: 'translateZ(0)' }}
          aria-label="Scroll-driven room animation"
        />

        {/* Dark vignette overlay */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.4)_100%)]" />

        {/* "Portfolio" — 遮罩上滑揭示 + 淡入，10% 进场、90% 前离场 */}
        <div
          ref={portfolioRef}
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          style={{ opacity: 0 }}
        >
          <span className="reveal-mask" style={{ fontSize: '16vw' }}>
            <span
              ref={portfolioLineRef}
              className="reveal-line font-jheri text-[#76F0CA] leading-[1.15] select-none whitespace-nowrap"
            >
              Portfolio
            </span>
          </span>
        </div>

        {/* OPEN button at the center of the door (appears at 90%) */}
        {showOpen && (
          <button
            ref={openBtnRef}
            onClick={handleOpen}
            className="absolute left-1/2 top-1/2 z-20 flex items-center justify-center px-10 py-4 border border-cream/70 bg-black/30 backdrop-blur-sm text-cream font-body text-base tracking-[0.5em] uppercase transition-colors duration-500 hover:bg-cream hover:text-wine"
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
