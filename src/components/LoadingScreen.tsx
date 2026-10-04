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
const MIN_VISIBLE = 1400;

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

const DREAM_LOGS = [
  { at: 0, code: '00', text: '梦境入口校准中……' },
  { at: 16, code: '01', text: '现实坐标正在远离。' },
  { at: 34, code: '02', text: '正在读取视觉档案。' },
  { at: 52, code: '03', text: '正在进入 2003 年的夏天。' },
  { at: 70, code: '04', text: '检测到云层、窗帘与金鱼。' },
  { at: 86, code: '05', text: '请保管好你的记忆。' },
  { at: 97, code: '06', text: "欢迎进入 Sun Chenxi's Portfolio。" },
] as const;

type DreamLog = (typeof DREAM_LOGS)[number];

function SystemLog({ log, numbered = true }: { log: DreamLog; numbered?: boolean }) {
  return (
    <div
      key={log.code}
      className="dream-system-log mx-auto mt-5 flex max-w-[480px] items-start justify-center gap-3 text-center text-[11px] leading-[1.65] tracking-[.08em] text-[#faf6e8]/80"
      style={{ fontFamily: "'Zpix', 'Noto Serif SC', ui-monospace, monospace" }}
    >
      {numbered ? <span className="shrink-0 text-[#7ee8c7]">[SYS.{log.code}]</span> : null}
      <span>{log.text}</span>
    </div>
  );
}

function RiftVisual({ progress, log }: { progress: number; log: DreamLog }) {
  return (
    <div className="w-[82vw] max-w-[560px]" aria-hidden="true">
      <div className="relative mx-auto h-[300px] w-[190px] overflow-hidden">
        <i className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-[#7ee8c7]/25" />
        <i className="dream-loader-rift-ghost dream-loader-rift-ghost--a" />
        <i className="dream-loader-rift-ghost dream-loader-rift-ghost--b" />
        <i className="dream-loader-rift-slice" style={{ top: '24%', animationDelay: '-.7s' }} />
        <i className="dream-loader-rift-slice" style={{ top: '61%', animationDelay: '-1.8s' }} />
        <i className="dream-loader-rift-slice" style={{ top: '82%', animationDelay: '-2.6s' }} />
        {Array.from({ length: 9 }, (_, index) => {
          const top = ((index * 14 - progress * 1.18) % 126 + 126) % 126 - 13;
          return (
            <i
              key={index}
              className="dream-loader-rift-pixel"
              style={{
                top: `${top}%`,
                marginLeft: `${(index % 3 - 1) * 3}px`,
                animationDelay: `${index * -.17}s`,
                opacity: top < 0 || top > 100 ? 0 : 1,
              }}
            >
              <b
                aria-hidden="true"
                style={{
                  animationDelay: `${index * -.19}s`,
                  animationDuration: `${.92 + (index % 4) * .14}s`,
                }}
              />
            </i>
          );
        })}
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 bg-[#0a0a0a] px-3 text-[#7ee8c7]">
          <i className="h-px w-4 bg-[#7ee8c7]" />
          <strong
            className="text-sm font-normal tabular-nums tracking-[.16em]"
            style={{ fontFamily: "'Zpix', ui-monospace, monospace" }}
          >
            {Math.round(progress).toString().padStart(3, '0')}
          </strong>
          <i className="h-px w-4 bg-[#7ee8c7]" />
        </div>
      </div>
      <div className="mt-10">
        <SystemLog log={log} />
      </div>
    </div>
  );
}

export function LoadingScreen({ ready, progress, onEnter }: LoadingScreenProps) {
  const [previewMode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('loading-simple') || params.has('loading-style');
  });
  const [shown, setShown] = useState(0); // 屏幕上显示的百分比
  const [leaving, setLeaving] = useState(false);
  const [visible, setVisible] = useState(true);
  const [tick, setTick] = useState(0);
  const [startDt] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * 进度每帧重算（不靠 effect 缓存）：真实下载量 与 时间爬升 取较大值。
   * 这样即使首窗帧因慢网一张没下来，数字也会从 0 平滑爬到 ~99%，不会冻屏。
   */
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const creep = Math.min(0.99, (Date.now() - startDt) / CREEP_MS);
      const target = (ready && !previewMode
        ? 1
        : Math.max(creep, previewMode ? 0 : Math.min(0.995, progress))) * 100;
      setShown((s) => {
        const next = s + (target - s) * 0.16;
        return Math.abs(target - next) < 0.4 ? target : next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [previewMode, progress, ready, startDt]);

  // 进度到 100% 且素材到齐、也过了最短可见时间，才开始淡出
  useEffect(() => {
    if (!previewMode && ready && shown >= 99.5 && !leaving && Date.now() - startDt >= MIN_VISIBLE) {
      setLeaving(true);
    }
  }, [previewMode, ready, shown, leaving, tick, startDt]);

  // tick 只负责在最短可见时间到点后，把上面那个判断再跑一次
  useEffect(() => {
    const t = window.setTimeout(() => setTick((v) => v + 1), MIN_VISIBLE);
    return () => window.clearTimeout(t);
  }, []);

  // 完成后只做一次短淡出，避免加载层本身成为第二段转场。
  useEffect(() => {
    if (!leaving) return;
    if (!rootRef.current) return;
    const tween = gsap.to(rootRef.current, {
      opacity: 0,
      duration: 0.28,
      ease: EASE.io,
      onComplete: () => {
        setVisible(false);
        onEnter();
      },
    });
    return () => { tween.kill(); };
  }, [leaving, onEnter]);

  if (!visible) return null;

  const roundedProgress = Math.round(shown);
  const currentLog = [...DREAM_LOGS].reverse().find((item) => roundedProgress >= item.at) ?? DREAM_LOGS[0];

  return (
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[10000] flex items-center justify-center bg-transparent text-[#faf6e8] ${leaving ? 'pointer-events-none' : ''}`}
      aria-label={`页面正在加载，${roundedProgress}%：${currentLog.text}`}
    >
      <RiftVisual progress={shown} log={currentLog} />
    </div>
  );
}
