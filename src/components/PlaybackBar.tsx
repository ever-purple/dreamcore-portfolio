import { useRef } from 'react';

export function PlaybackBar({
  playing,
  live,
  progress,
  timeText,
  length,
  onToggle,
  onSeek,
}: {
  playing: boolean;
  /** 是否已进入完整版（playing 或 paused）—— 未进入时进度条弱化，点了是"开播" */
  live: boolean;
  progress: number;
  timeText: string;
  length?: string;
  onToggle: () => void;
  onSeek: (ratio: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  /** 按住拖动：pointermove 期间连续 seek，不触发文本选择 */
  const dragging = useRef(false);

  const seekFromEvent = (clientX: number) => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    onSeek((clientX - r.left) / r.width);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromEvent(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) seekFromEvent(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div className={`mjp__ctrl${live ? ' is-live' : ''}`}>
      <button
        type="button"
        className="mjp__ctrl-btn"
        onClick={onToggle}
        data-cursor={playing ? 'Pause' : 'Play'}
        data-cursor-tone="light"
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <rect x="3.5" y="2.5" width="3.2" height="11" rx="1" fill="currentColor" />
            <rect x="9.3" y="2.5" width="3.2" height="11" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M4.5 2.6 L13 8 L4.5 13.4 Z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div
        ref={barRef}
        className="mjp__ctrl-track"
        style={{ ['--p' as string]: progress }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="slider"
        tabIndex={0}
        onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? progress + .05 : event.key === 'ArrowLeft' ? progress - .05 : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : null;
          if (next !== null) { event.preventDefault(); onSeek(Math.max(0, Math.min(1, next))); }
        }}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span className="mjp__ctrl-rail" />
        <span className="mjp__ctrl-fill" />
        <span className="mjp__ctrl-knob" />
      </div>
      <span className="mjp__ctrl-time">
        {timeText}
        {length ? <em> / {length}</em> : null}
      </span>
    </div>
  );
}
