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

/**
 * 全站共享的音乐播放状态。
 *
 * 让「灵感收藏 · 音乐卡」和右栏「jukebox」共用同一个播放源：
 * 卡片里点播放 → jukebox 同步显示当前曲目、转盘转起来、进度条走动；
 * jukebox 的进度条可拖动 → 反向改变播放进度。
 *
 * 现在多数曲目没有音源（src 为空），此时走「模拟时间轴」（180s），
 * 让整套交互（播放/暂停/切歌/拖动进度）先跑通；往 MUSIC 里补 src
 * 就会自动切到 <audio> 真播放。
 */

export type PlayerTrack = {
  id: string;
  title: string;
  cover: string;
  src?: string;
};

type PlayerApi = {
  track: PlayerTrack | null;
  playing: boolean;
  /** 当前进度（秒） */
  time: number;
  /** 总时长（秒） */
  duration: number;
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

const PlayerCtx = createContext<PlayerApi | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [track, setTrack] = useState<PlayerTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<PlayerTrack | null>(null);
  const durationRef = useRef(0);

  useEffect(() => {
    trackRef.current = track;
  }, [track]);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const isReal = !!track?.src;

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

  // 模拟时间轴：没有音源时让进度条也动起来
  useEffect(() => {
    if (isReal || !playing) return;
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
  }, [isReal, playing]);

  const startTrack = useCallback((m: PlayerTrack) => {
    setTrack(m);
    setTime(0);
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
      if (first) startTrack({ id: first.id, title: first.title, cover: first.cover, src: first.src });
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
      const m = list[nextIdx];
      startTrack({ id: m.id, title: m.title, cover: m.cover, src: m.src });
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
    if (el && trackRef.current?.src) {
      try {
        el.currentTime = s;
      } catch {
        /* ignore */
      }
    }
  }, []);

  const api = useMemo<PlayerApi>(
    () => ({ track, playing, time, duration, play, toggle, next, prev, seek }),
    [track, playing, time, duration, play, toggle, next, prev, seek],
  );

  return (
    <PlayerCtx.Provider value={api}>
      {children}
      <audio ref={audioRef} hidden preload="none" />
    </PlayerCtx.Provider>
  );
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerCtx);
  if (!ctx) throw new Error('usePlayer 必须在 <PlayerProvider> 内使用');
  return ctx;
}
