import { useEffect, useRef, useState } from 'react';

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
    }, 800);
    return () => clearTimeout(timer);
  }, [leaving, onEnter]);

  if (!visible) return null;

  const shown = Math.round(pct);

  return (
    <div
      className={`fixed inset-0 z-[100] bg-wine transition-opacity duration-700 ease-out ${
        leaving ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <span className="font-body font-bold text-8xl md:text-9xl text-cream tabular-nums absolute bottom-8 right-8">
        {shown}%
      </span>
    </div>
  );
}
