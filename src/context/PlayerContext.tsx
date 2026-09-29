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
import { getCollection, hydrate } from '@/lib/contentApi';
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
  /** 平台侧歌曲 id（网易云用，播放时实时去 /api/lyric 拉歌词用） */
  songId?: string;
  /** 歌词（LRC 带时间轴，或纯文本） */
  lyrics?: string;
};

/**
 * 「操控」部分：只在换歌 / 播放暂停时变。**不含进度**。
 *
 * 单独拆出来是因为进度每秒变约 4 次（timeupdate）。如果进度和它放在同一个
 * context 里，整个音乐网格会跟着每秒白重渲染 4 次 —— 而那些卡片只用得上
 * 「当前是哪首、在不在播」。拆开后它们就彻底不参与进度更新了。
 */
type PlayerTransport = {
  track: PlayerTrack | null;
  playing: boolean;
  /** 当前这首是不是走平台外链播放（是的话进度条不可控） */
  external: boolean;
  /**
   * 访客有没有按过播放键。
   * 没按过时播放键给个呼吸光 —— 光秃秃的 ▶ 不会让人意识到"这里能放音乐"。
   */
  everPlayed: boolean;
  /** 点某一首：同一首则切换播放/暂停，否则从 0 开始播 */
  play: (t: PlayerTrack) => void;
  /** 无曲目时播第一首；有曲目时切换播放/暂停 */
  toggle: () => void;
  next: () => void;
  prev: () => void;
  /** 跳到第 seconds 秒 */
  seek: (seconds: number) => void;
  /**
   * 站内直链取不到音频 —— VIP / 版权是最常见的原因。
   *
   * 网易云的公开直链 `outer/url?id=x.mp3` 对 VIP 专享（fee=1）与无版权歌曲会
   * **302 跳到 music.163.com/404**（实测：周杰伦《晴天》186016、Monica《Believing In Me》
   * 17229930 都是这样），`<audio>` 拿到一页 HTML，直接报错。
   *
   * 置这个位是为了让界面把「为什么点了没声」写出来：直链一失败就静默停下，
   * 访客只会以为网站坏了。
   */
  blocked: boolean;
};

/** 「走时」部分：进度 / 时长 / 是否正在缓冲。每秒都在变。 */
type PlayerClock = {
  /** 当前进度（秒） */
  time: number;
  /** 总时长（秒） */
  duration: number;
  /**
   * 音频正在等数据（缓冲）。
   *
   * 为什么要有这个：网易云直链偶尔会断流，表现为「声音停住 → 过一会儿自己接着放」。
   * 以前界面没有任何提示，看起来就像网站卡死了 —— 其实只是音频在重新拉流。
   * 亮这个状态，用户就知道是网络在缓冲，不是页面挂了。
   */
  buffering: boolean;
};

type PlayerApi = PlayerTransport & PlayerClock;

const FAKE_DURATION = 180; // 无音源时的模拟时长（秒）

/** 平台名 → 界面上显示的来源标签 */
const PLATFORM_LABEL: Record<string, string> = {
  netease: '网易云音乐',
  qqmusic: 'QQ音乐',
  spotify: 'Spotify',
  apple: 'Apple Music',
  bilibili: '哔哩哔哩',
  xhs: '小红书',
  gequbao: '歌曲宝',
};

export function platformLabel(p?: string): string {
  return (p && PLATFORM_LABEL[p]) || '';
}

/** 从网易云的各类地址里抠歌曲 id：专属 id 字段 / 外链播放器 / 歌曲页 / 移动端页都认 */
function neteaseSongIdOf(m: MusicItem): string {
  if (m.songId && /^\d+$/.test(m.songId.trim())) return m.songId.trim();
  for (const p of [m.embed ?? '', m.link ?? '']) {
    const hit = /[?&]id=(\d{3,})/.exec(p);
    if (hit) return hit[1];
  }
  return '';
}

/**
 * 网易云的直链音频地址。
 *
 * 注意存的是 `outer/url?id=xxx.mp3` 这一层（它只是个 302 转发），
 * **不是**302 之后那个 CDN 地址 —— 后者带时效签名，隔一会儿就失效了。
 * 让浏览器每次现跳一次，才能长期有效。
 */
function neteaseDirectUrl(id: string): string {
  return id ? `https://music.163.com/song/media/outer/url?id=${id}.mp3` : '';
}

/**
 * 收藏里的音乐 → 播放器曲目。
 *
 * 音源优先级：本站文件（src）> 网易云直链（现推）> 平台外链播放器（embed）。
 * 网易云这一档是运行时推出来的，所以**以前存的老条目不用重新编辑** ——
 * 只要条目里有歌曲 id 或外链地址，点播放就自动拿到能拖进度条的真音频。
 * 直链要是被版权 / VIP / 防盗链挡了，PlayerProvider 会自动退回 embed。
 */
export function toTrack(m: MusicItem): PlayerTrack {
  const looksNetease =
    m.platform === 'netease' || /music\.163\.com/.test(`${m.embed ?? ''} ${m.link ?? ''}`);
  const src =
    m.src || (looksNetease ? neteaseDirectUrl(neteaseSongIdOf(m)) || undefined : undefined);
  return {
    id: m.id,
    title: m.title,
    cover: m.cover,
    src,
    embed: m.embed,
    link: m.link,
    platform: m.platform,
    // songId：优先用条目里存的；老条目没存就去 embed / link 里抠一个。
    // 播放时实时拉歌词（/api/lyric）全指着它 —— 缺了歌词就出不来。
    songId: neteaseSongIdOf(m) || undefined,
    lyrics: m.lyrics,
  };
}

/** 收藏里的第一首（用于打开页面时先把唱片摆上转盘，不播） */
function firstTrack(): PlayerTrack | null {
  const list = getCollection('music');
  return list.length ? toTrack(list[0]) : null;
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

const TransportCtx = createContext<PlayerTransport | null>(null);
const ClockCtx = createContext<PlayerClock | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [track, setTrack] = useState<PlayerTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const bufferingRef = useRef(false);
  const [everPlayed, setEverPlayed] = useState(false);
  /**
   * 直链（本站 `<audio>`）这一路放不出来时置位 —— VIP / 版权 / 防盗链都可能让它失败，
   * 这时退回平台外链播放器，不至于一声不响地"点了没反应"。
   * 用 ref + state 两份：ref 给回调里同步读，state 用来触发重渲染。
   */
  const [audioFailed, setAudioFailed] = useState(false);
  const audioFailedRef = useRef(false);

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

  // 有可直连的音频地址就走本站 <audio>：暂停后再播从暂停处继续、进度条也能拖。
  // 只有「没有直链、只有平台播放器」时才走 iframe —— 那是跨域的，
  // 我们既读不到它的进度也控制不了它，暂停只能靠卸载 iframe，再播自然就从头开始。
  const isReal = !!track?.src && !audioFailed;
  const isExternal = !isReal && !!track?.embed;

  /**
   * 打开页面时先把第一首**摆上转盘，但不播**。
   *
   * 两个作用：播放器不会空着（空转盘看不出这块是干嘛的），
   * 也顺带告诉访客「这里是可以放音乐的」—— 摆着封面和歌名，配上一闪一闪的播放键。
   * 不播是关键：自动放歌会吓人一跳，而且浏览器本来也不允许没交互就出声。
   *
   * 要等 hydrate 完 —— 收藏可能是异步从云端 / 项目文件来的，
   * 直接读会读到还没装好的空列表。
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrate().catch(() => {});
      if (cancelled) return;
      setTrack((cur) => cur ?? firstTrack());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    // 直链放不出来（VIP / 版权 / 防盗链）：
    //   ① 有平台播放器 → 退回它（isExternal 跟着亮起来）；
    //   ② 没有 → 只能老实停下。
    // 两种情况都把 blocked 置位，界面会写明原因，不会「点了没反应」。
    const onErr = () => {
      if (audioFailedRef.current) return; // error 会连着来几遍，置一次就够
      audioFailedRef.current = true;
      setAudioFailed(true);
      if (!trackRef.current?.embed) setPlaying(false);
    };

    /* ---- 缓冲状态：让「声音停住」这件事在界面上看得出来 ----
     *
     * 为什么不在这里「自动重新 load() 一次」把卡流救回来：load() 会丢掉已经缓冲好的
     * 数据，如果只是网速慢（而不是连接死了），重取反而把缓冲清零、更卡。
     * 浏览器自己本来就会重试并接着放 —— 我们要做的是别让它看起来像网站卡死，
     * 而不是替浏览器做它已经在做的事。
     *
     * 判定分两路，因为光靠事件不够用（实测：网速被压到低于码率时，播放头明显卡住，
     * 但 `waiting` 根本没触发、readyState 还停在 3，只看事件会一直显示「正常播放」）：
     *   ① 事件：waiting / loadstart 立刻亮，playing / canplay / seeked 立刻灭；
     *   ② 看门狗：每秒量一次播放头实际走了多少。真在播就该接近实时，
     *      走得明显慢 → 就是在缓冲。
     */
    const markBuffering = (v: boolean) => {
      if (bufferingRef.current === v) return;
      bufferingRef.current = v;
      setBuffering(v);
    };
    const onWaiting = () => markBuffering(true);
    const onLoadStart = () => markBuffering(true);
    const onSeeking = () => markBuffering(true);
    const onPlaying = () => markBuffering(false);
    const onCanPlay = () => markBuffering(false);
    const onSeeked = () => markBuffering(false);
    const onPause = () => markBuffering(false);

    let lastT = el.currentTime;
    let lastAt = performance.now();
    const watch = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - lastAt) / 1000;
      const moved = el.currentTime - lastT;
      lastT = el.currentTime;
      lastAt = now;
      if (el.paused || dt <= 0) return;
      // 拖进度会让播放头跳变（moved 很大），不会误判成卡住
      markBuffering(moved < dt * 0.6);
    }, 1000);

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onDur);
    el.addEventListener('durationchange', onDur);
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onErr);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('loadstart', onLoadStart);
    el.addEventListener('seeking', onSeeking);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('seeked', onSeeked);
    el.addEventListener('pause', onPause);
    return () => {
      window.clearInterval(watch);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onDur);
      el.removeEventListener('durationchange', onDur);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('error', onErr);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('loadstart', onLoadStart);
      el.removeEventListener('seeking', onSeeking);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('seeked', onSeeked);
      el.removeEventListener('pause', onPause);
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
    setEverPlayed(true);
    // 外链播放读不到时长，进度条会切成"外链"状态；本站文件等 loadedmetadata 填真实值
    setDuration(m.src ? 0 : FAKE_DURATION);
    // 换歌 = 重新给直链一次机会（上一首失败不代表这首也失败）
    audioFailedRef.current = false;
    setAudioFailed(false);
    bufferingRef.current = false;
    setBuffering(false);
    setPlaying(true);
  }, []);

  const play = useCallback(
    (t: PlayerTrack) => {
      const cur = trackRef.current;
      // 同一首 = 切换播放/暂停。
      // 但「预摆在转盘上、还没真播过」的那首不算 —— 那要走 startTrack：
      // 进度归零，播放键上的提示也跟着撤掉
      if (cur?.id === t.id && everPlayed) {
        setPlaying((p) => !p);
        return;
      }
      startTrack(t);
    },
    [everPlayed, startTrack],
  );

  const toggle = useCallback(() => {
    const cur = trackRef.current;
    if (!cur) {
      const first = firstTrack();
      if (first) startTrack(first);
      return;
    }
    // 直链已失败、又没有平台播放器可退：再按一次播放就当成「重试」。
    // 不能直接 setPlaying(true) —— 那会点亮那条「模拟时间轴」，变成进度条在走却没声音，更迷惑。
    if (audioFailedRef.current && !cur.embed) {
      startTrack(cur);
      return;
    }
    if (!everPlayed) {
      startTrack(cur);
      return;
    }
    setPlaying((p) => !p);
  }, [everPlayed, startTrack]);

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
    // 只有本站 <audio> 这一路能真正 seek；外链播放器由平台自己控制，拖不动
    if (el && trackRef.current?.src && !audioFailedRef.current) {
      try {
        el.currentTime = s;
      } catch {
        /* ignore */
      }
    }
  }, []);

  /** 操控：与进度无关，进度每秒变 4 次也不会带动这里重算 */
  const transport = useMemo<PlayerTransport>(
    () => ({
      track,
      playing,
      everPlayed,
      external: isExternal,
      // 直链失败 → 界面把原因（VIP / 版权）写出来，见 AboutPlayer 的 .about-player-blocked
      blocked: audioFailed,
      play,
      toggle,
      next,
      prev,
      seek,
    }),
    [track, playing, everPlayed, isExternal, audioFailed, play, toggle, next, prev, seek],
  );
  /** 走时：进度 / 时长 / 缓冲。只有真正要画进度的组件才订阅它 */
  const clock = useMemo<PlayerClock>(
    () => ({ time, duration, buffering }),
    [time, duration, buffering],
  );

  return (
    <TransportCtx.Provider value={transport}>
      <ClockCtx.Provider value={clock}>
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
      </ClockCtx.Provider>
    </TransportCtx.Provider>
  );
}

/** 只要「放什么 / 在不在播 / 怎么切歌」时用它 —— 不会因为进度更新而重渲染 */
export function usePlayerTransport(): PlayerTransport {
  const ctx = useContext(TransportCtx);
  if (!ctx) throw new Error('usePlayerTransport 必须在 <PlayerProvider> 内使用');
  return ctx;
}

/** 只要「进度 / 时长 / 缓冲状态」时用它 */
export function usePlayerClock(): PlayerClock {
  const ctx = useContext(ClockCtx);
  if (!ctx) throw new Error('usePlayerClock 必须在 <PlayerProvider> 内使用');
  return ctx;
}

/** 播控 + 进度全都要（jukebox 那种） */
export function usePlayer(): PlayerApi {
  const t = usePlayerTransport();
  const c = usePlayerClock();
  return useMemo(() => ({ ...t, ...c }), [t, c]);
}
