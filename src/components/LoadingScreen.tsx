import { useEffect, useRef, useState } from 'react';
import { EASE } from '@/lib/ease';
import gsap from 'gsap';

interface LoadingScreenProps {
  /**
   * 首页首窗帧是否就绪，或是否命中慢网兜底。
   * 首窗就绪即可淡出，其余序列帧在首页后台顺序加载。
   */
  ready: boolean;
  /** 真实加载进度 0~1，由 App 按「已下载资源 / 应下载资源」算出来 */
  progress: number;
  onEnter: () => void;
}

/**
 * 最短可见时间 = 3 秒。
 *   3 秒内就下完 → 进度照样停在屏幕上走满 3 秒（不闪一下就过去）
 *   超过 3 秒     → 按真实速度走，下完就走，不额外拖时间
 * 所以实际停留时间 = max(3 秒, 真实加载耗时)，最短 3 秒。
 */
const MIN_VISIBLE = 3000;

/**
 * 时间爬升基线（ms）。与 App 的 `ENTER_MAX_WAIT`（15000ms 硬上限）**同一条时间轴**：
 * 数字约在第 12s 爬到 ~99%，第 15s 撞上硬上限 → 跳 100% 放行（慢网兜底）。
 *
 * 为什么需要它：进度本应随「真实下载量」走，但慢网/丢包时序列帧可能一张都下不下来
 * —— 若只看真实进度，数字会**永远冻在 0%**，用户以为网站挂了（原话「一直在转圈」）。
 * 用「时间爬升」兜底，数字始终在动，观感是「正在加载」而不是「卡死」。
 * 取真实进度与时间爬升的**较大值** —— 所以网速正常时，数字由真实进度主导，
 * 爬升只是「最坏情况也不冻屏」的下限。
 */
const CREEP_MS = 12000;

export function LoadingScreen({ ready, progress, onEnter }: LoadingScreenProps) {
  const [shown, setShown] = useState(0); // 屏幕上显示的百分比
  const [leaving, setLeaving] = useState(false);
  const [visible, setVisible] = useState(true);
  const [tick, setTick] = useState(0);
  const [startDt] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);

  /**
   * 进度每帧重算（不靠 effect 缓存）：真实下载量 与 时间爬升 取较大值。
   * 这样即使首窗帧因慢网一张没下来，数字也会从 0 平滑爬到 ~99%，不会冻屏。
   */
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const creep = Math.min(0.99, (Date.now() - startDt) / CREEP_MS);
      const target = (ready ? 1 : Math.max(creep, Math.min(0.995, progress))) * 100;
      setShown((s) => {
        const next = s + (target - s) * 0.16;
        return Math.abs(target - next) < 0.4 ? target : next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [progress, ready, startDt]);

  // 进度到 100% 且素材到齐、也过了最短可见时间，才开始淡出
  useEffect(() => {
    if (ready && shown >= 99.5 && !leaving && Date.now() - startDt >= MIN_VISIBLE) {
      setLeaving(true);
    }
  }, [ready, shown, leaving, tick, startDt]);

  // tick 只负责在最短可见时间到点后，把上面那个判断再跑一次
  useEffect(() => {
    const t = window.setTimeout(() => setTick((v) => v + 1), MIN_VISIBLE);
    return () => window.clearTimeout(t);
  }, []);

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
    return () => {
      tween.kill();
    };
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

  return (
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[100] bg-wine ${leaving ? 'pointer-events-none' : ''}`}
    >
      <span
        ref={counterRef}
        className="font-body font-bold text-8xl md:text-9xl text-cream tabular-nums absolute bottom-8 right-8"
      >
        {Math.round(shown)}%
      </span>
    </div>
  );
}
