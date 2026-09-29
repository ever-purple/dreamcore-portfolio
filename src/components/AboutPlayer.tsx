import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from '@/components/Sparkles';
import { platformLabel, usePlayer, usePlayerClock } from '@/context/PlayerContext';

/* ------------------------------------------------------------------ */
/* 歌词                                                                */
/* ------------------------------------------------------------------ */

type LyricLine = { t: number; text: string };

/** 行首的时间标签 `[mm:ss.xx]`。多个标签（一句唱两遍）只取第一个 */
const LRC_TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const LRC_STRIP = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g;

/**
 * 解析歌词。两种输入都吃：
 * · LRC —— 行首带 `[mm:ss.xx]`，逐句跟着播放进度高亮并滚动；
 * · 纯文本 —— 一行一句，整块显示（t = -1 表示没有时间点）。
 * 顺手丢掉空行，免得面板里夹一堆空白。
 */
function parseLyrics(raw: string): LyricLine[] {
  if (!raw || !raw.trim()) return [];
  const out: LyricLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.replace(LRC_STRIP, '').trim();
    if (!text) continue;
    const m = LRC_TIME.exec(line);
    if (!m) {
      out.push({ t: -1, text });
      continue;
    }
    const min = Number(m[1]);
    const sec = Number(m[2]);
    const frac = m[3] ? Number(m[3]) / (m[3].length === 3 ? 1000 : 100) : 0;
    out.push({ t: min * 60 + sec + frac, text });
  }
  return out;
}

/** 播放器下方的歌词：跟着进度高亮当前句并把它滚到中间；没有时间轴的就整块显示 */
function LyricsPanel({
  lyrics,
  time,
  loading,
  empty,
}: {
  lyrics: string;
  time: number;
  /** 正在向 /api/lyric 拉取 */
  loading?: boolean;
  /** 拉到了，但歌曲是纯音乐 / 无词 */
  empty?: boolean;
}) {
  if (loading) {
    return (
      <div className="about-player-lyrics is-loading" aria-label="歌词">
        <p className="about-player-lyric">歌词加载中…</p>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="about-player-lyrics is-empty" aria-label="歌词">
        <p className="about-player-lyric">🎵 纯音乐，请欣赏</p>
      </div>
    );
  }

  const lines = useMemo(() => parseLyrics(lyrics), [lyrics]);
  const boxRef = useRef<HTMLDivElement>(null);
  const timed = useMemo(() => lines.some((l) => l.t >= 0), [lines]);

  const current = useMemo(() => {
    if (!timed) return -1;
    let hit = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].t < 0) continue;
      if (lines[i].t <= time) hit = i;
      else break;
    }
    return hit;
  }, [lines, timed, time]);

  // 当前句滚到可视区中间。用 scrollTo 而不是 scrollIntoView ——
  // 后者会把整个 About 浮层一起滚，访客正在看的内容会被顶走
  useEffect(() => {
    const box = boxRef.current;
    if (!box || current < 0) return;
    const el = box.querySelector<HTMLElement>(`[data-line="${current}"]`);
    if (!el) return;
    const top = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [current]);

  if (!lines.length) return null;

  return (
    <div
      className={`about-player-lyrics${timed ? ' is-timed' : ''}`}
      ref={boxRef}
      aria-label="歌词"
    >
      {lines.map((l, i) => (
        <p
          key={i}
          data-line={i}
          className={`about-player-lyric${i === current ? ' is-current' : ''}`}
        >
          {l.text}
        </p>
      ))}
    </div>
  );
}

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
  const { track, playing, everPlayed, time, duration, external, toggle, next, prev, seek } =
    usePlayer();
  const { buffering } = usePlayerClock();
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  /**
   * 网易云歌词：**随播随取，不存任何本地 / 云端存储**。
   *
   * 网易云歌曲带 `songId`，播放时由服务端函数 `/api/lyric` 实时去网易云抓 LRC，
   * 抓回来直接喂给 LyricsPanel。非网易云歌曲（或没 id）就退回条目自带的歌词
   * （作者手填 / 历史残留）。拉取失败也安全回退，绝不让面板崩。
   */
  const [lyric, setLyric] = useState<{ status: 'idle' | 'loading' | 'empty' | 'ready'; text: string }>(
    { status: 'idle', text: '' },
  );
  useEffect(() => {
    if (track?.platform !== 'netease' || !track?.songId) {
      setLyric({ status: 'idle', text: track?.lyrics ?? '' });
      return;
    }
    let cancelled = false;
    setLyric({ status: 'loading', text: '' });
    fetch(`/api/lyric?id=${encodeURIComponent(track.songId)}`, { cache: 'force-cache' })
      .then((r) => r.json())
      .then((j: { ok?: boolean; lrc?: string; tlyric?: string }) => {
        if (cancelled) return;
        const lrc = (j && (j.lrc || j.tlyric)) || '';
        setLyric({ status: lrc ? 'ready' : 'empty', text: lrc });
      })
      .catch(() => {
        if (cancelled) return;
        setLyric({ status: 'idle', text: track?.lyrics ?? '' });
      });
    return () => {
      cancelled = true;
    };
  }, [track?.id, track?.platform, track?.songId, track?.lyrics]);

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
          className={`about-player-btn about-player-play${
            track && !everPlayed && !playing ? ' is-hint' : ''
          }`}
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

      <LyricsPanel
        lyrics={lyric.text}
        time={time}
        loading={lyric.status === 'loading'}
        empty={lyric.status === 'empty'}
      />

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
