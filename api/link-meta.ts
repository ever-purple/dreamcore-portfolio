/**
 * 「粘贴链接 → 自动识别标题 / 封面 / 播放器」的**线上**通道（Vercel Serverless，零依赖）。
 *
 *   GET /api/link-meta?url=<绝对地址>
 *        → 200 { ok: true,  meta: { url, title, cover, desc?, site?, platform?, embed?, extra? } }
 *        → 200 { ok: false, reason: 'no-meta' }   识别不出内容，前端继续走它自己的回退链
 *        → 400 { ok: false, reason: 'bad-url' }
 *
 * 为什么需要它：
 *   本地 `vite dev` 有一条同名通道（/__studio/link-meta，挂在 studio-writer.ts 上），
 *   它跑在 Node 里、没有同源限制，还能调平台官方接口。线上没有这条通道，前端只能靠
 *   microlink / allorigins 两个公开代理抓 og 标签 —— 对「分享短链」基本无能为力：
 *   `https://163cn.tv/bhr5rXOI` 抓回来只有一个短码，于是歌名被填成 "Bhr5rXOI"、
 *   封面空白、也拿不到外链播放器（点播放自然没声音）。
 *   有了这个函数，线上也能走平台官方接口，识别能力与本地 dev 对齐。
 *
 * ⚠️ BEGIN / END 标记之间的那段是从根目录 `link-meta.ts` **自动同步**来的
 *    （`node scripts/sync-link-meta.mjs`，已挂在 npm run build 最前面）。
 *    原因见 api/visit.ts 顶部：Vercel 对 /api 下的函数按文件独立转译，跨文件
 *    import 在部分管线下解析不到且无日志，所以这里把共享实现内联成单文件。
 *    **要改识别逻辑请改根目录 `link-meta.ts`**，不要手改这一段的副本。
 */

// @@LINK-META-CORE:BEGIN@@
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
  /** 平台标识：netease / qqmusic / spotify / apple / github / bilibili / xhs / gequbao / web */
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

/**
 * 还原「JS 字符串字面量」里的转义 —— 只用于解析 gequbao 那种
 * `window.appData = JSON.parse('<payload>')` 里嵌的 <payload>。
 *
 * 这种 payload 是双层编码：先是 JS 字符串字面量（浏览器跑 `JSON.parse('…')`
 * 时先按 JS 规则解一层），再是 JSON（JSON.parse 再解一层）。
 * 比如 `\\\/` 在 JS 层变成 `\/`、JSON 层才变成 `/`。这里只负责「JS 层」这一步，
 * 解完就是合法 JSON，再 JSON.parse 一次即可。
 *
 * 只放行数据，不执行任何代码（正则替换，无 eval），所以拿恶意页面进来也只会
 * 解析出一个普通对象，不会跑任何逻辑。
 */
function jsUnescape(text: string): string {
  return text
    // 先处理 \uXXXX（歌曲宝把双引号也写成 \u0022），避免和下面的 . 通配冲突
    .replace(/\\u([0-9a-fA-F]{4})/g, (_whole, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    // 再处理其它单字符转义：\\ \/ \" \' \n \t \r \b \f \\0 等
    .replace(/\\(.)/g, (_whole, c: string) => {
      switch (c) {
        case 'n':
          return '\n';
        case 't':
          return '\t';
        case 'r':
          return '\r';
        case 'b':
          return '\b';
        case 'f':
          return '\f';
        case '0':
          return '\0';
        default:
          return c; // \\→\ 、\/→/ 、“→" 、'→' 都落到这里
      }
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
  if (/gequbao\.com/.test(h)) return 'gequbao';
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
/* 歌曲宝 gequbao.com                                                  */
/* ------------------------------------------------------------------ */

/**
 * 歌曲宝：把「网易云放不出的 VIP / 版权歌」「能试听整首的外链歌」等，
 * 以一个普通的歌曲页（/m/歌id 或 /music/歌id）对外提供。
 *
 * 页面是服务端直出的 HTML，关键数据全在 `window.appData = JSON.parse('<payload>')` 里：
 *   · mp3_title / mp3_author / mp3_cover / mp3_duration
 *   · lrc（歌词）单独在 `<lrc id="content-lrc">…</lrc>` 这块
 *
 * ⚠️ 重要限制（决定这个平台「能识别到什么」）：
 *   1. **没有专辑名** —— gequbao 的 appData 只给作者与封面 URL，不暴露专辑字符串，
 *      所以 `album` 这里一律留空（网易云 / QQ 那种会带专辑名的平台走各自的接口）；
 *   2. **没有可嵌入 / 可直连的音频** —— 它的「播放」依赖一个加密 `play_id` 令牌，
 *      要带浏览器会话 + 验证码（`/api/verify-kami`、`/api/captcha`）才换得到真实地址，
 *      服务端直抓会被拦，且换回来的 CDN 多半也不给 CORS。所以这里**不**试图扒音频直链，
 *      只把 `link` 指向歌曲宝页面，由「去歌曲宝听 ↗」承载实际播放；
 *      站内这一侧则用「模拟时间轴 + 歌词滚动」把听感补全（见 MusicItem 的 src 留空约定）。
 *
 * 这样「粘贴歌曲宝链接」就能自动认出 歌名 / 歌手 / 封面 / 歌词，VIP 歌也能进了收藏，
 * 点击后歌词照着 LRC 时间轴一句句高亮 —— 跟用户要的「识别专辑、歌手、歌名、歌词」对齐
 * （专辑这一项 gequbao 本身没有，已在上面说明）。
 */
async function gequbaoMeta(url: string): Promise<LinkMeta | null> {
  try {
    const res = await timedFetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const raw = new TextDecoder('utf-8').decode(buf);
    const html = decodeBody(buf, raw);

    // 1) 抠 window.appData 的 payload（JSON 被包在 JS 字符串字面量里，双层编码）
    const appData = /window\.appData\s*=\s*JSON\.parse\(\s*'([\s\S]*?)'\s*\)/i.exec(html);
    if (!appData) return null;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(jsUnescape(appData[1])) as Record<string, unknown>;
    } catch {
      return null;
    }

    const title = String(data.mp3_title ?? '').trim();
    const artist = String(data.mp3_author ?? '').trim();
    const cover = httpsify(String(data.mp3_cover ?? ''));
    if (!title && !cover) return null;

    // 2) 歌词：页面用 `<div class="content-lrc" id="content-lrc">…</div>` 装 LRC，
    //    行与行之间是 <br />（LRC 每行带 [mm:ss.xx] 时间轴，原样保留，交给 jukebox 高亮）。
    //    按 id 而不是标签名匹配，避免页面哪天把 div 换成 pre/lrc 就失灵。
    const lrcHit = /<[a-z0-9]+[^>]*id="content-lrc"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i.exec(html);
    let lyric = '';
    if (lrcHit) {
      lyric = decodeEntities(lrcHit[1])
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim();
    }

    return {
      url,
      title,
      cover,
      desc: artist ? `歌手：${artist}` : undefined,
      site: '歌曲宝',
      platform: 'gequbao',
      // 无 iframe 播放器、无直链：播放交给「去歌曲宝听」原链接
      extra: {
        artist: artist || undefined,
        // gequbao 页面不暴露专辑名，留空（网易云 / QQ 会因各自接口带上 album）
        album: undefined,
        lyric: lyric || undefined,
      },
    };
  } catch {
    return null;
  }
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
    gequbao: () => gequbaoMeta(url),
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
// @@LINK-META-CORE:END@@

/* ---------------- Vercel 最小类型（@vercel/node 不在依赖里，就地声明） ---------------- */
type VercelRequest = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status(code: number): VercelResponse;
  setHeader(key: string, value: string): void;
  json(body: unknown): void;
  send(body: string): void;
};

/** 地址长度上限（正常分享链接远不会这么长，超了直接判为异常输入）。 */
const MAX_URL = 2048;

/**
 * 总时长闸门。Vercel 的函数有执行上限（默认 10s），
 * 识别链里最坏会串好几次外网请求 —— 与其被平台掐成 500，不如自己提前返回。
 */
const DEADLINE = 7000;

/**
 * 只允许「公网 http(s)」目标：这个接口本质是「服务端替你抓任意地址」，
 * 不设防就成了内网探测工具（SSRF）。私有网段 / 本机 / 内网域名一律拒掉。
 */
function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host.indexOf('.') < 0) return false; // 裸主机名（含 localhost）一律拒
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return false;
  if (/^(127|10)\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false;
  if (host === '0.0.0.0' || host === '::1' || /^(fc|fd|fe80)/.test(host)) return false;
  return true;
}

/** 给识别过程套一层总时长上限；超时返回 null（调用方按「没识别出来」处理）。 */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const gate = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([p.catch(() => null), gate]).finally(() => clearTimeout(timer)) as Promise<T | null>;
}

/* ---------------- 接口本体 ---------------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, reason: 'method-not-allowed' });
    return;
  }

  const q = req.query?.url;
  const raw = Array.isArray(q) ? q[0] : q;
  const input = typeof raw === 'string' ? raw.trim() : '';
  if (!input || input.length > MAX_URL) {
    res.status(400).json({ ok: false, reason: 'bad-url' });
    return;
  }
  const target = normalizeUrl(input);
  if (!isPublicHttpUrl(target)) {
    res.status(400).json({ ok: false, reason: 'bad-url' });
    return;
  }

  try {
    const meta = await withDeadline(resolveLinkMeta(target), DEADLINE);
    if (!meta || (!meta.title && !meta.cover && !meta.embed)) {
      // 200 而不是 4xx：这不是错误，只是「这条链接没识别出东西」，前端要能照常静默降级
      res.status(200).json({ ok: false, reason: 'no-meta' });
      return;
    }
    // 识别结果基本不变，让 CDN 缓存一整天，顺带挡掉重复抓取
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ ok: true, meta });
  } catch (err) {
    console.error('[link-meta]', err);
    res.status(502).json({ ok: false, reason: 'resolve-failed' });
  }
}
