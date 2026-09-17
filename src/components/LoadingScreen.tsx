import { useEffect, useRef, useState } from 'react';
import { EASE } from '@/lib/ease';
import gsap from 'gsap';

interface LoadingScreenProps {
  /** 序列帧是否预加载完成（与 0→100% 计时相互独立） */
  ready: boolean;
  onEnter: () => void;
}

const DURATION = 3000; // 0% -> 100% 严格控制在 3 秒内

export function LoadingScreen({ ready, onEnter }: LoadingScreenProps) {
  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [visible, setVisible] = useState(true);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);

  // 纯时间驱动的进度：0 -> 100% 在 3 秒内匀速走完
  useEffect(() => {
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const value = Math.min(100, (elapsed / DURATION) * 100);
      setPct(value);
      if (elapsed < DURATION) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setPct(100);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // 进度到 100% 且素材就绪后开始淡出
  useEffect(() => {
    if (pct >= 100 && ready && !leaving) {
      setLeaving(true);
    }
  }, [pct, ready, leaving]);

  // 淡出结束后进入首页
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      setVisible(false);
      onEnter();
    }, 900);
    return () => clearTimeout(timer);
  }, [leaving, onEnter]);

  // 加载数字轻微"呼吸"——让静止的加载页也有生命感
  useEffect(() => {
    if (!counterRef.current) return;
    const tween = gsap.to(counterRef.current, {
      scale: 1.06,
      duration: 2.4,
      ease: EASE.io,
      yoyo: true,
      repeat: -1,
      transformOrigin: 'center',
    });
    return () => { tween.kill(); };
  }, []);

  // 离场：放大 + 模糊 + 淡出（dreamcore 的"呼出"转场），替代原 CSS opacity 过渡
  useEffect(() => {
    if (!leaving || !rootRef.current) return;
    gsap.to(rootRef.current, {
      scale: 1.08,
      filter: 'blur(12px)',
      opacity: 0,
      duration: 0.9,
      ease: EASE.io,
    });
  }, [leaving]);

  if (!visible) return null;

  const shown = Math.round(pct);

  return (
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[100] bg-wine ${leaving ? 'pointer-events-none' : ''}`}
    >
      <span ref={counterRef} className="font-body font-bold text-8xl md:text-9xl text-cream tabular-nums absolute bottom-8 right-8">
        {shown}%
      </span>
    </div>
  );
}
