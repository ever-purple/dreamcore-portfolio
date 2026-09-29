/**
 * 「粘贴链接 → 自动识别标题 / 封面」的**服务端**实现。
 *
 * 为什么不在浏览器里直接抓：目标页几乎都不给 CORS 头，浏览器 fetch 会被拦，
 * 只能依赖 microlink / allorigins 这类公开代理（有额度、会挂、国内时快时慢）。
 * 本地 `vite dev` 有 Node 进程，服务端抓就没有同源限制，成功率接近 100%，
 * 而且能顺手做平台特化（网易云 / QQ 音乐 / GitHub 官方 API 比 og 标签准得多）。
 *
 * 只在 dev 下被 `studio-writer.ts` 挂到 `/__studio/link-meta`；生产构建不含此文件。
 */

export type LinkMeta = {
  /** 规范化后的最终地址（跟随跳转后的） */
  url: string;
  title: string;
  cover: string;
  desc?: string;
  site?: string;
  /** 平台标识：netease / qqmusic / spotify / apple / github / bilibili / web */
  platform?: string;
  /** 可 iframe 嵌入的播放器地址（音乐类才有） */
  embed?: string;
  /** 平台结构化信息：歌手、仓库 topics、星级等 */
  extra?: Record<string, unknown>;
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
/**
 * 单次抓取上限。整条链最多串三次（平台接口 → 直连 og → microlink），
 * 所以别设太大 —— 9s 会让"网络不通"的链接卡上近半分钟。
 */
const TIMEOUT = 7000;

async function timedFetch(url: string, init: RequestInit = {}, ms = TIMEOUT): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      // 默认跟随跳转；调用方显式传 redirect 时以调用方为准
      // （跟随短链要手动逐跳，见 followShortLink，所以这里不能写死 'follow'）
      redirect: 'follow',
      ...init,
      signal: ctl.signal,
      headers: { 'user-agent': UA, accept: '*/*', ...(init.headers ?? {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 跟随短链，拿到「真正落地的那一跳」以及中间走过的全部地址。
 *
 * 为什么必须手动逐跳（redirect:'manual'）而不是让 fetch 自动跟：
 *   · 需要知道**每一跳**的地址 —— 有的平台把 id 放在中间那一跳，最后一跳反而是
 *     前端路由（`#/song?id=…`，`#` 后面不进 HTTP 请求，但字符串里还在，能抠）；
 *   · 自动跟随拿到的 res.url 只有终点，中间信息就丢了。
 *
 * 网易云分享短链 `https://163cn.tv/bhr5rXOI` 就是这个情况：短链本身不含 song id，
 * 302 之后才是 `y.music.163.com/m/song?id=1968217744&…`。不跟随就没 id，
 * 网易云官方接口调不了，只能退到抓 og 标签 —— 结果把短码 "bhr5rXOI" 当成了歌名。
 */
async function followShortLink(
  url: string,
  maxHops = 5,
  ms = TIMEOUT,
): Promise<{ finalUrl: string; chain: string[] }> {
  const chain = [url];
  let cur = url;
  for (let i = 0; i < maxHops; i += 1) {
    let res: Response;
    try {
      res = await timedFetch(cur, { redirect: 'manual' }, ms);
    } catch {
      break; // 网络不通 / 超时：就把已经走到的这一跳当终点
    }
    const loc = res.headers.get('location');
    if (!loc || res.status < 300 || res.status >= 400) break;
    let next: string;
    try {
      next = new URL(loc, cur).href;
    } catch {
      break;
    }
    if (next === cur || chain.includes(next)) break; // 自环 / 来回跳，防死循环
    chain.push(next);
    cur = next;
  }
  return { finalUrl: cur, chain };
}

/* ------------------------------------------------------------------ */
/* HTML 解析                                                          */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#34': '"',
  mdash: '—',
  hellip: '…',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const key = body.toLowerCase();
    return ENTITIES[key] ?? whole;
  });
}

/** 按声明的 charset 把字节解成字符串（国内不少老站还是 gb18030 / gbk）。 */
function decodeBody(buf: ArrayBuffer, html: string): string {
  const m = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(html.slice(0, 4096));
  const charset = (m?.[1] ?? 'utf-8').toLowerCase();
  if (charset === 'utf-8' || charset === 'utf8') return new TextDecoder('utf-8').decode(buf);
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

function metaContent(html: string, prop: string): string | undefined {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 属性顺序两种都见：content 在前 / property 在前
  const patterns = [
    new RegExp(`<meta[^>]*?(?:property|name)\\s*=\\s*["']${esc}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]*?content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${esc}["'][^>]*>`, 'i'),
  ];
  const first = patterns[0].exec(html);
  if (first) {
    const c = /content\s*=\s*["']([^"']*)["']/i.exec(first[0]);
    if (c) return decodeEntities(c[1]).trim();
  }
  const second = patterns[1].exec(html);
  if (second) return decodeEntities(second[1]).trim();
  return undefined;
}

function absoluteUrl(maybe: string, base: string): string | undefined {
  if (!maybe) return undefined;
  const v = decodeEntities(maybe).trim();
  if (!v) return undefined;
  if (v.startsWith('//')) return `https:${v}`;
  try {
    return new URL(v, base).href;
  } catch {
    return undefined;
  }
}

/**
 * 图片地址统一升到 https。
 * 站点自己是 https，cover 若还是 http 会被浏览器当混合内容直接拦掉 —— 表现就是
 * 「识别出来了但封面一直转圈/空白」。
 */
function httpsify(url: string): string {
  return url.replace(/^http:\/\//i, 'https://');
}

/** 给图片地址挂缩放参数（网易云 / QQ音乐都认 `param=WxH` 这类参数）。 */
function withSize(url: string, size: string): string {
  if (!url) return '';
  return `${url}${url.includes('?') ? '&' : '?'}param=${size}`;
}

/** 通用：抓 HTML 抠 og / twitter / title */
async function genericMeta(url: string): Promise<LinkMeta> {
  const res = await timedFetch(url);
  const buf = await res.arrayBuffer();
  const raw = new TextDecoder('utf-8').decode(buf);
  const html = decodeBody(buf, raw);
  const finalUrl = res.url || url;

  const title =
    metaContent(html, 'og:title') ??
    metaContent(html, 'twitter:title') ??
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ??
    '';

  const cover = httpsify(
    absoluteUrl(
      metaContent(html, 'og:image') ??
        metaContent(html, 'og:image:url') ??
        metaContent(html, 'twitter:image') ??
        metaContent(html, 'twitter:image:src') ??
        '',
      finalUrl,
    ) ?? '',
  );

  const desc = metaContent(html, 'og:description') ?? metaContent(html, 'description') ?? '';
  const site = metaContent(html, 'og:site_name') ?? hostOf(finalUrl);

  return {
    url: finalUrl,
    title: decodeEntities(title).trim(),
    cover,
    desc: decodeEntities(desc).trim() || undefined,
    site,
    platform: platformOf(finalUrl),
  };
}

/* ------------------------------------------------------------------ */
/* 平台识别                                                            */
/* ------------------------------------------------------------------ */

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || 'link';
  }
}

function platformOf(url: string): string | undefined {
  const h = hostOf(url);
  if (/music\.163\.com|163cn\.tv/.test(h)) return 'netease';
  if (/y\.qq\.com|c\.y\.qq\.com|i\.y\.qq\.com/.test(h)) return 'qqmusic';
  if (/spotify\.com/.test(h)) return 'spotify';
  if (/music\.apple\.com/.test(h)) return 'apple';
  if (/github\.com/.test(h)) return 'github';
  if (/bilibili\.com|b23\.tv/.test(h)) return 'bilibili';
  if (/xiaohongshu\.com|xhslink\.com/.test(h)) return 'xhs';
  return undefined;
}

/* ------------------------------------------------------------------ */
/* 网易云音乐                                                          */
/* ------------------------------------------------------------------ */

/** 从任意形态的网易云链接里抠 song id（#/song?id= / ?id= / /song/123） */
function neteaseSongId(url: string): string | undefined {
  // `[?&#]` 前缀锚定参数名边界，免得误吃 `playerUIModeId=` 这种以 Id 结尾的别的参数
  const byQuery = /[?&#]id=(\d{1,20})/.exec(url);
  if (byQuery) return byQuery[1];
  const byPath = /\/song\/(\d{1,20})/.exec(url);
  return byPath?.[1];
}

/**
 * 找出这首歌的 song id：链接里直接带就用现成的；
 * 不带（`163cn.tv/xxxxx` 这类分享短链）就先跟随跳转，再从**每一跳**里找。
 */
async function neteaseSongIdResolved(url: string, ms = TIMEOUT): Promise<string | undefined> {
  const direct = neteaseSongId(url);
  if (direct) return direct;
  const { chain } = await followShortLink(url, 5, ms);
  for (const hop of chain) {
    const id = neteaseSongId(hop);
    if (id) return id;
  }
  return undefined;
}

/**
 * 网易云的歌词（LRC，每行带 `[mm:ss.xx]` 时间轴）。
 *
 * ⚠️ 只能在服务端通道里调：这个接口和 `song/detail` 一样**不带 `access-control-*` 头**，
 * 浏览器直连会被 CORS 拦掉 —— 也就是说纯静态托管（GitHub Pages）上拿不到，
 * 那种环境只能靠作者在卡片里手填歌词。
 * 拿不到就返回空串，绝不拖累整次识别。
 */
async function neteaseLyric(id: string, ms: number): Promise<string> {
  try {
    const api = `https://music.163.com/api/song/lyric?os=pc&id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`;
    const res = await timedFetch(
      api,
      { headers: { referer: 'https://music.163.com/', accept: 'application/json' } },
      ms,
    );
    if (!res.ok) return '';
    const j = (await res.json()) as { lrc?: { lyric?: string } };
    return (j.lrc?.lyric ?? '').trim();
  } catch {
    return '';
  }
}

async function neteaseMeta(url: string, ms = TIMEOUT): Promise<LinkMeta | null> {
  const id = await neteaseSongIdResolved(url, ms);
  if (!id) return null;
  try {
    // ⚠️ ids 必须是「纯数字数组」`[123]`，写成 `[{"id":123}]` 会被回一个 code:400
    const api = `https://music.163.com/api/song/detail?ids=${encodeURIComponent(`[${id}]`)}`;
    const res = await timedFetch(
      api,
      { headers: { referer: 'https://music.163.com/', accept: 'application/json' } },
      ms,
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      songs?: Array<{
        name?: string;
        artists?: Array<{ name?: string }>;
        album?: { name?: string; picUrl?: string };
      }>;
    };
    const song = j.songs?.[0];
    if (!song) return null;
    const artist = (song.artists ?? []).map((a) => a.name).filter(Boolean).join(' / ');
    const cover = withSize(httpsify(song.album?.picUrl ?? ''), '500y500');
    return {
      url: `https://music.163.com/#/song?id=${id}`,
      title: song.name || '',
      cover,
      desc: artist ? `歌手：${artist}` : undefined,
      site: '网易云音乐',
      platform: 'netease',
      // 官方外链播放器：VIP / 付费歌曲在站外只能听到可试听的那一段，行为与官方一致
      embed: `https://music.163.com/outchain/player?type=2&id=${id}&auto=0&height=66`,
      extra: {
        artist: artist || undefined,
        album: song.album?.name,
        songId: id,
        // 歌词是该接口顺手能拿到的（LRC 带时间轴），拿不到就留空 ——
        // 空了也不影响识别成功，作者可以在卡片里手填
        lyric: (await neteaseLyric(id, 3000)) || undefined,
      },
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* QQ 音乐                                                             */
/* ------------------------------------------------------------------ */

/** songmid 形如 001abcDE 或 003xxx；也可能在 query 里 */
function qqSongMid(url: string): string | undefined {
  const byQuery = /[?&]songmid=([0-9a-zA-Z]{6,40})/.exec(url);
  if (byQuery) return byQuery[1];
  const byPath = /songDetail\/([0-9a-zA-Z]{6,40})/.exec(url);
  if (byPath) return byPath[1];
  const tail = /\/([0-9a-zA-Z]{10,40})\.html/.exec(url);
  return tail?.[1];
}

async function qqMusicMeta(url: string): Promise<LinkMeta | null> {
  const mid = qqSongMid(url);
  if (!mid) return null;
  try {
    const api = `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=${mid}&format=json&platform=yqq`;
    const res = await timedFetch(api, { headers: { referer: 'https://y.qq.com/' } });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      data?: Array<{ name?: string; singer?: Array<{ name?: string }>; album?: { mid?: string; name?: string } }>;
    };
    const song = j.data?.[0];
    if (!song) return null;
    const artist = (song.singer ?? []).map((s) => s.name).filter(Boolean).join(' / ');
    const albumMid = song.album?.mid;
    return {
      url: `https://y.qq.com/n/ryqq/songDetail/${mid}`,
      title: song.name || '',
      cover: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg` : '',
      desc: artist ? `歌手：${artist}` : undefined,
      site: 'QQ音乐',
      platform: 'qqmusic',
      embed: `https://i.y.qq.com/v8/playsong.html?songmid=${mid}&source=yqq&new=1`,
      extra: { artist: artist || undefined, album: song.album?.name, songMid: mid },
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Spotify                                                             */
/* ------------------------------------------------------------------ */

async function spotifyMeta(url: string): Promise<LinkMeta | null> {
  const m = /\/track\/([A-Za-z0-9]{10,40})/.exec(url);
  const id = m?.[1];
  try {
    const oembed = await timedFetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
      { headers: { accept: 'application/json' } },
    );
    if (oembed.ok) {
      const j = (await oembed.json()) as { title?: string; thumbnail_url?: string };
      if (j.title || j.thumbnail_url) {
        return {
          url,
          title: j.title ?? '',
          cover: j.thumbnail_url ?? '',
          site: 'Spotify',
          platform: 'spotify',
          embed: id ? `https://open.spotify.com/embed/track/${id}` : undefined,
          extra: { songId: id },
        };
      }
    }
  } catch {
    /* 掉到下面 */
  }
  return id
    ? {
        url,
        title: '',
        cover: '',
        site: 'Spotify',
        platform: 'spotify',
        embed: `https://open.spotify.com/embed/track/${id}`,
        extra: { songId: id },
      }
    : null;
}

/* ------------------------------------------------------------------ */
/* Apple Music                                                         */
/* ------------------------------------------------------------------ */

function appleMeta(url: string): LinkMeta | null {
  if (!/music\.apple\.com/.test(url)) return null;
  const embed = url.replace(/^https:\/\/(?:geo\.)?music\.apple\.com/, 'https://embed.music.apple.com');
  return {
    url,
    title: '',
    cover: '',
    site: 'Apple Music',
    platform: 'apple',
    embed,
  };
}

/* ------------------------------------------------------------------ */
/* GitHub 仓库（AI 项目多是开源仓库，比 og 标签准）                        */
/* ------------------------------------------------------------------ */

function githubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)github\.com$/.test(u.hostname)) return null;
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length < 2) return null;
    const [owner, repo] = segs;
    if (!owner || !repo) return null;
    // 排除 github.com/topics / github.com/features 这类非仓库路径
    const reserved = new Set(['topics', 'features', 'sponsors', 'about', 'pricing', 'search', 'marketplace', 'explore', 'collections', 'trending', 'notifications', 'new', 'login', 'settings', 'orgs', 'apps', 'users', 'events']);
    if (reserved.has(owner.toLowerCase())) return null;
    return { owner, repo: repo.replace(/\.git$/i, '') };
  } catch {
    return null;
  }
}

/**
 * `api.github.com` 偶尔不通（网络策略 / 未登录限流），这时退回抓仓库页 HTML：
 * 仓库页的 `<title>` 形如「GitHub - owner/repo: 简介」，og:description 与 topic 标签
 * 也都在，够填满一张卡片，只是拿不到 star 数。
 */
async function githubHtmlMeta(full: string): Promise<LinkMeta | null> {
  try {
    const res = await timedFetch(`https://github.com/${full}`);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const html = decodeBody(buf, new TextDecoder('utf-8').decode(buf));
    const pageTitle = decodeEntities(
      /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '',
    );
    // 「GitHub - owner/repo: 简介」→ 取冒号后面那段
    const desc = pageTitle.includes(':') ? pageTitle.slice(pageTitle.indexOf(':') + 1).trim() : '';
    const og = metaContent(html, 'og:image') ?? metaContent(html, 'og:description');
    const topics: string[] = [];
    const re = /<a[^>]+class="[^"]*topic-tag[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && topics.length < 4) {
      const t = m[1].replace(/<[^>]+>/g, '').trim();
      if (t && !topics.includes(t)) topics.push(`#${t}`);
    }
    const ogDesc = metaContent(html, 'og:description') ?? '';
    return {
      url: `https://github.com/${full}`,
      title: full.split('/')[1] ?? full,
      cover: og && og.startsWith('http') ? og : `https://opengraph.githubassets.com/1/${full}`,
      desc: desc || ogDesc || undefined,
      site: 'GitHub',
      platform: 'github',
      extra: { topics, fullName: full, owner: full.split('/')[0] },
    };
  } catch {
    return null;
  }
}

export async function githubRepoMeta(url: string): Promise<LinkMeta | null> {
  const hit = githubRepo(url);
  if (!hit) return null;
  const { owner, repo } = hit;
  const full = `${owner}/${repo}`;
  try {
    const res = await timedFetch(`https://api.github.com/repos/${full}`, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (res.ok) {
      const j = (await res.json()) as {
        name?: string;
        description?: string | null;
        topics?: string[];
        stargazers_count?: number;
        language?: string | null;
        homepage?: string | null;
        html_url?: string;
        owner?: { login?: string; avatar_url?: string };
        fork?: boolean;
        parent?: { full_name?: string };
      };
      const topics = (j.topics ?? []).slice(0, 4).map((t) => `#${t}`);
      return {
        url: j.html_url ?? `https://github.com/${full}`,
        title: j.name ?? repo,
        // GitHub 官方 social preview：仓库没自定义封面时也能出一张像样的卡
        cover: `https://opengraph.githubassets.com/1/${full}`,
        desc: j.description ?? undefined,
        site: 'GitHub',
        platform: 'github',
        extra: {
          stars: j.stargazers_count ?? 0,
          language: j.language ?? undefined,
          topics,
          homepage: j.homepage || undefined,
          fullName: full,
          owner: j.owner?.login ?? owner,
          avatar: j.owner?.avatar_url,
          isFork: !!j.fork,
          source: j.parent?.full_name,
        },
      };
    }
  } catch {
    /* 掉到下面 */
  }
  const html = await githubHtmlMeta(full);
  if (html) return html;
  return {
    url: `https://github.com/${full}`,
    title: repo,
    cover: `https://opengraph.githubassets.com/1/${full}`,
    site: 'GitHub',
    platform: 'github',
  };
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

/** 传进来的可能是「music.163.com/#/song?id=1」这种没协议的，先补 https。 */
export function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/**
 * 最后一道：让 microlink 代抓。它自己有浏览器集群，
 * 目标站直连不通（比如某些网络下 github.com 握手超时）时仍然能拿到 title / image。
 */
async function microlinkMeta(url: string): Promise<LinkMeta | null> {
  try {
    const res = await timedFetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      data?: { title?: string; description?: string; image?: { url?: string }; logo?: { url?: string } };
    };
    const d = j.data;
    const cover = httpsify(d?.image?.url || d?.logo?.url || '');
    const title = (d?.title || '').trim();
    if (!title && !cover) return null;
    return {
      url,
      title,
      cover,
      desc: d?.description || undefined,
      site: hostOf(url),
      platform: platformOf(url),
    };
  } catch {
    return null;
  }
}

export async function resolveLinkMeta(rawUrl: string): Promise<LinkMeta> {
  const url = normalizeUrl(rawUrl);
  const platform = platformOf(url);

  // 1) 平台特化：网易云 / QQ 音乐 / Spotify / GitHub 的官方接口比 og 标签准得多
  const specialized: Record<string, () => Promise<LinkMeta | null>> = {
    netease: () => neteaseMeta(url),
    qqmusic: () => qqMusicMeta(url),
    spotify: () => spotifyMeta(url),
    github: () => githubRepoMeta(url),
  };
  const fn = platform ? specialized[platform] : undefined;
  if (fn) {
    const got = await fn();
    if (got && (got.title || got.cover)) {
      if (platform === 'apple' && !got.embed) {
        const apple = appleMeta(url);
        if (apple) got.embed = apple.embed;
      }
      return got;
    }
  }

  // 2) 直连目标页抠 og 标签
  let generic: LinkMeta | null = null;
  try {
    generic = await genericMeta(url);
  } catch {
    /* 直连不通，掉到 3 */
  }
  if (!generic || (!generic.title && !generic.cover)) {
    // 3) microlink 代抓
    const viaProxy = await microlinkMeta(url);
    if (viaProxy) generic = viaProxy;
  }
  if (!generic) generic = { url, title: '', cover: '', site: hostOf(url), platform };

  // Apple Music：og 拿不到播放器，自己拼一个 embed 域的子页面
  if (platform === 'apple' && !generic.embed) {
    const apple = appleMeta(url);
    if (apple) return { ...generic, embed: apple.embed, site: 'Apple Music' };
  }
  return generic;
}
