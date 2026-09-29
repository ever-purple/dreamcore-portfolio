import { useCallback, useRef } from 'react';
import { Sparkles } from '@/components/Sparkles';
import { platformLabel, usePlayer, usePlayerClock } from '@/context/PlayerContext';

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
  const { track, playing, time, duration, external, toggle, next, prev, seek } = usePlayer();
  const { buffering } = usePlayerClock();
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const ratio = duration > 0 ? Math.min(1, time / duration) : 0;
  const from = platformLabel(track?.platform);
  /** 外链播放器不受我们控制，它自己缓冲不归我们显示 */
  const stalling = buffering && playing && !external;

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
    <section
      className={`about-card about-player${stalling ? ' is-buffering' : ''}`}
      aria-label="灵感收藏音乐播放器"
    >
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
              {from ? <span className="about-player-now-from">来自 {from}</span> : null}
              {external ? (
                <span className="about-player-now-tag" title="由平台外链播放器播放，本站不存储音频文件">
                  外链播放
                </span>
              ) : null}
              {external && track.link ? (
                <a
                  className="about-player-now-link"
                  href={track.link}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  ↗ 去原站听完整版
                </a>
              ) : null}
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
          className={`about-player-bar${external ? ' is-external' : ''}`}
          role="slider"
          tabIndex={external ? -1 : 0}
          aria-disabled={external || undefined}
          aria-busy={stalling || undefined}
          aria-label={external ? '外链播放，进度由平台控制' : '播放进度，可拖动'}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          onPointerDown={(e) => {
            if (external) return;
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
          {external ? (
            <i className="about-player-bar-external" />
          ) : (
            <i style={{ width: `${ratio * 100}%` }} />
          )}
          {external ? null : (
            <span className="about-player-knob" style={{ left: `${ratio * 100}%` }} aria-hidden="true" />
          )}
        </div>
      </div>

      <p className="about-player-time" aria-hidden="true">
        {external ? (
          <span className="about-player-time-external">♪ 平台外链播放中</span>
        ) : (
          <>
            <span>{fmt(time)}</span>
            {stalling ? (
              <span className="about-player-time-buffering">♪ 缓冲中…</span>
            ) : (
              <span>{duration > 0 ? fmt(duration) : '--:--'}</span>
            )}
          </>
        )}
      </p>

      <Sparkles count={4} seed={21} />
    </section>
  );
}
