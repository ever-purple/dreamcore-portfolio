import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getCollection } from '@/lib/contentApi';
import type { MusicItem } from '@/data/inspiration';

/**
 * 全站共享的音乐播放状态。
 *
 * 让「灵感收藏 · 音乐卡」和右栏「jukebox」共用同一个播放源：
 * 卡片里点播放 → jukebox 同步显示当前曲目、转盘转起来、进度条走动；
 * jukebox 的进度条可拖动 → 反向改变播放进度。
 *
 * 三种音源，按优先级自动挑：
 *   1. `embed` —— 平台外链播放器（网易云 / Spotify…）。**不下载任何音频文件**，
 *      版权与体积都最安全；VIP / 付费歌曲由平台自己决定能放多少 —— 站外本就只能
 *      听到试听片段，行为与官方一致。代价是读不到进度，jukebox 显示"外链播放中"。
 *   2. `src`   —— 本站自己的音频文件（作者上传的），走 <audio>，进度/时长都真实。
 *   3. 都没有  —— 「模拟时间轴」（180s），让整套交互（播放/暂停/切歌/拖动）先跑通。
 */

export type PlayerTrack = {
  id: string;
  title: string;
  cover: string;
  /** 本站音频文件地址（作者上传的） */
  src?: string;
  /** 平台外链播放器地址（iframe），优先于 src */
  embed?: string;
  /** 原平台页面地址（外链播放时给个「去原站听」的出口） */
  link?: string;
  /** 平台标识，界面上显示「网易云音乐」之类的来源 */
  platform?: string;
};

type PlayerApi = {
  track: PlayerTrack | null;
  playing: boolean;
  /** 当前进度（秒） */
  time: number;
  /** 总时长（秒） */
  duration: number;
  /** 当前这首是不是走平台外链播放（是的话进度条不可控） */
  external: boolean;
  /** 点某一首：同一首则切换播放/暂停，否则从 0 开始播 */
  play: (t: PlayerTrack) => void;
  /** 无曲目时播第一首；有曲目时切换播放/暂停 */
  toggle: () => void;
  next: () => void;
  prev: () => void;
  /** 跳到第 seconds 秒 */
  seek: (seconds: number) => void;
};

const FAKE_DURATION = 180; // 无音源时的模拟时长（秒）

/** 平台名 → 界面上显示的来源标签 */
const PLATFORM_LABEL: Record<string, string> = {
  netease: '网易云音乐',
  qqmusic: 'QQ音乐',
  spotify: 'Spotify',
  apple: 'Apple Music',
  bilibili: '哔哩哔哩',
  xhs: '小红书',
};

export function platformLabel(p?: string): string {
  return (p && PLATFORM_LABEL[p]) || '';
}

/** 收藏里的音乐 → 播放器曲目。外链（embed）优先于本站文件（src）。 */
export function toTrack(m: MusicItem): PlayerTrack {
  return {
    id: m.id,
    title: m.title,
    cover: m.cover,
    src: m.src,
    embed: m.embed,
    link: m.link,
    platform: m.platform,
  };
}

/** 把外链播放器地址改成「一加载就播」。各平台参数名不一样，按需拼。 */
export function autoPlayUrl(embed: string): string {
  try {
    const u = new URL(embed);
    if (u.hostname.includes('music.163.com')) u.searchParams.set('auto', '1');
    else if (u.hostname.includes('spotify.com')) u.searchParams.set('autoplay', '1');
    return u.toString();
  } catch {
    return embed;
  }
}

const PlayerCtx = createContext<PlayerApi | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [track, setTrack] = useState<PlayerTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** 外链播放器（iframe）。不能 display:none —— 有的浏览器会直接不加载/静音。 */
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const trackRef = useRef<PlayerTrack | null>(null);
  const durationRef = useRef(0);

  useEffect(() => {
    trackRef.current = track;
  }, [track]);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const isReal = !!track?.src;
  const isExternal = !!track?.embed;

  // 外链播放：播放时把 iframe 指向平台的播放器，暂停就摘掉 src（等于停下）
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    if (!isExternal || !playing) {
      el.removeAttribute('src');
      return;
    }
    const next = autoPlayUrl(track!.embed!);
    // 换歌时即便地址一样也要重新加载，否则平台会接着上一首播
    if (el.getAttribute('src') === next) el.contentWindow?.location.replace(next);
    else el.setAttribute('src', next);
  }, [track, playing, isExternal]);

  // 真音源：把状态同步到 <audio>
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!isReal) {
      el.pause();
      return;
    }
    if (el.getAttribute('src') !== track!.src) el.setAttribute('src', track!.src!);
    if (playing) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }, [track, playing, isReal]);

  // 真音源：音频事件回写进度
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !isReal) return;
    const onTime = () => setTime(el.currentTime);
    const onDur = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onEnd = () => setPlaying(false);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onDur);
    el.addEventListener('durationchange', onDur);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onDur);
      el.removeEventListener('durationchange', onDur);
      el.removeEventListener('ended', onEnd);
    };
  }, [isReal]);

  // 模拟时间轴：既没本站音源也没外链时，让进度条也动起来
  useEffect(() => {
    if (isReal || isExternal || !playing) return;
    if (durationRef.current !== FAKE_DURATION) setDuration(FAKE_DURATION);
    const timer = window.setInterval(() => {
      setTime((prev) => {
        if (prev + 0.25 >= FAKE_DURATION) {
          setPlaying(false);
          return FAKE_DURATION;
        }
        return prev + 0.25;
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [isReal, isExternal, playing]);

  const startTrack = useCallback((m: PlayerTrack) => {
    setTrack(m);
    setTime(0);
    // 外链播放读不到时长，进度条会切成"外链"状态；本站文件等 loadedmetadata 填真实值
    setDuration(m.src ? 0 : FAKE_DURATION);
    setPlaying(true);
  }, []);

  const play = useCallback(
    (t: PlayerTrack) => {
      const cur = trackRef.current;
      if (cur?.id === t.id) {
        setPlaying((p) => !p);
        return;
      }
      startTrack(t);
    },
    [startTrack],
  );

  const toggle = useCallback(() => {
    if (!trackRef.current) {
      const list = getCollection('music');
      const first = list[0];
      if (first) startTrack(toTrack(first));
      return;
    }
    setPlaying((p) => !p);
  }, [startTrack]);

  const step = useCallback(
    (dir: 1 | -1) => {
      const list = getCollection('music');
      if (!list.length) return;
      const cur = trackRef.current;
      const idx = cur ? list.findIndex((m) => m.id === cur.id) : -1;
      const nextIdx = idx === -1 ? 0 : (idx + dir + list.length) % list.length;
      startTrack(toTrack(list[nextIdx]));
    },
    [startTrack],
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  const seek = useCallback((seconds: number) => {
    const d = durationRef.current || FAKE_DURATION;
    const s = Math.max(0, Math.min(d, seconds));
    setTime(s);
    const el = audioRef.current;
    // 外链播放由平台自己控制进度，这里拖不动 —— 只更新显示位置
    if (el && trackRef.current?.src && !trackRef.current?.embed) {
      try {
        el.currentTime = s;
      } catch {
        /* ignore */
      }
    }
  }, []);

  const api = useMemo<PlayerApi>(
    () => ({
      track,
      playing,
      time,
      duration,
      external: isExternal,
      play,
      toggle,
      next,
      prev,
      seek,
    }),
    [track, playing, time, duration, isExternal, play, toggle, next, prev, seek],
  );

  return (
    <PlayerCtx.Provider value={api}>
      {children}
      <audio ref={audioRef} hidden preload="none" />
      {/*
        外链播放器：网易云 / Spotify 这类平台只给 iframe 播放器，音频由它们自己放。
        用 1×1 + 透明而不是 display:none —— 隐藏的 iframe 在部分浏览器里会被判定为
        "不可见"而静音或直接不加载。视觉上由 jukebox 显示曲目与状态。
      */}
      <iframe
        ref={frameRef}
        className="about-player-embed"
        title="外链音乐播放器"
        aria-hidden="true"
        tabIndex={-1}
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="no-referrer"
      />
    </PlayerCtx.Provider>
  );
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerCtx);
  if (!ctx) throw new Error('usePlayer 必须在 <PlayerProvider> 内使用');
  return ctx;
}
