import { useCallback, useRef } from 'react';
import { Sparkles } from '@/components/Sparkles';
import { usePlayer } from '@/context/PlayerContext';

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

/**
 * 「灵感收藏 · jukebox」播放器（复古 neocities 风）。
 *
 * 与「灵感收藏 → 音乐」里的唱片卡共用同一个播放状态：
 * 卡片点了哪首，这里就同步显示哪首，转盘转起来、进度条走动；
 * 这里的进度条可以拖动，反过来改变播放进度。
 */
export function AboutPlayer() {
  const { track, playing, time, duration, toggle, next, prev, seek } = usePlayer();
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const ratio = duration > 0 ? Math.min(1, time / duration) : 0;

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = barRef.current;
      if (!el || duration <= 0) return;
      const rect = el.getBoundingClientRect();
      const r = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      seek(r * duration);
    },
    [duration, seek],
  );

  return (
    <section className="about-card about-player" aria-label="灵感收藏音乐播放器">
      <h3 className="about-widget-title">♪ 灵感收藏 · jukebox ♪</h3>

      <div className="about-player-body">
        <div className={`about-player-disc${playing ? ' is-spinning' : ''}`} aria-hidden="true">
          {track?.cover ? <img className="about-player-disc-cover" src={track.cover} alt="" /> : null}
          <span className="about-player-disc-hole" />
        </div>

        <div className="about-player-tracks">
          {track ? (
            <p className="about-player-now">
              <span className="about-player-now-label">NOW PLAYING</span>
              <span className="about-player-now-title">{track.title}</span>
            </p>
          ) : (
            <span className={`about-player-empty${playing ? ' is-on' : ''}`} aria-hidden="true">
              <span>♪</span>
              <span>♫</span>
              <span>♩</span>
              <span>♬</span>
              <span>♪</span>
            </span>
          )}
        </div>

        <div className={`about-player-eq${playing ? ' is-on' : ''}`} aria-hidden="true">
          <b />
          <b />
          <b />
          <b />
        </div>
      </div>

      <div className="about-player-controls">
        <button type="button" className="about-player-btn" aria-label="上一首" onClick={prev}>
          ❰
        </button>
        <button
          type="button"
          className="about-player-btn about-player-play"
          aria-label={playing ? '暂停' : '播放'}
          aria-pressed={playing}
          onClick={toggle}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="about-player-btn" aria-label="下一首" onClick={next}>
          ❱
        </button>

        <div
          ref={barRef}
          className="about-player-bar"
          role="slider"
          tabIndex={0}
          aria-label="播放进度，可拖动"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          onPointerDown={(e) => {
            draggingRef.current = true;
            // 先 seek 再尝试捕获指针：即使 setPointerCapture 不可用也不影响拖动生效
            seekFromClientX(e.clientX);
            try {
              e.currentTarget.setPointerCapture?.(e.pointerId);
            } catch {
              /* ignore */
            }
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) seekFromClientX(e.clientX);
          }}
          onPointerUp={(e) => {
            draggingRef.current = false;
            try {
              e.currentTarget.releasePointerCapture?.(e.pointerId);
            } catch {
              /* ignore */
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') seek(time + 5);
            else if (e.key === 'ArrowLeft') seek(time - 5);
          }}
        >
          <i style={{ width: `${ratio * 100}%` }} />
          <span className="about-player-knob" style={{ left: `${ratio * 100}%` }} aria-hidden="true" />
        </div>
      </div>

      <p className="about-player-time" aria-hidden="true">
        <span>{fmt(time)}</span>
        <span>{duration > 0 ? fmt(duration) : '--:--'}</span>
      </p>

      <Sparkles count={4} seed={21} />
    </section>
  );
}
