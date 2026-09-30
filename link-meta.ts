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
  if (/gequbao\.(com|net)/.test(h)) return 'gequbao';
  return undefined;
}

/* ------------------------------------------------------------------ */
/* 按歌名搜歌（网易云公开搜索接口）                                     */
/* ------------------------------------------------------------------ */

/**
 * 搜索结果的一条。**只取元数据**（歌名 / 歌手 / 专辑 / 封面 / 时长 / song id），不取音频。
 */
export type SongHit = {
  title: string;
  artist: string;
  album?: string;
  cover: string;
  /** 毫秒；拿不到就是 0 */
  duration: number;
  songId: string;
  /**
   * yinyueku 换直链用的签名（与 songId 一一对应、恒定）。
   * 有它就能在「播放时」换一条能绕过 VIP 限制的 320kbps 直链 ——
   * 详见 resolveNeteaseStream 的注释。拿不到就是 undefined（走官方直链/上传音频）。
   */
  streamSign?: string;
};

/**
 * 为什么需要「按歌名搜」这条路：
 *
 * 有些来源站（歌曲宝 gequbao.com）整站在 Cloudflare 的机器人防护后面 —— 服务端
 * 一抓就是 403 或 "Just a moment..."，**实测 5 条通道全被拦**：直连 403、
 * r.jina.ai 拿回验证页、allorigins 522、corsproxy 403、microlink 400，
 * 连真浏览器（无头）也停在「请稍候…」。也就是说「粘贴链接自动识别歌名」这条路
 * 对这种站点**从根上不成立**，不是部署没生效。
 *
 * 但作者本来就知道自己听的是哪首歌 —— 所以退一步：**让作者填一次歌名**，
 * 我们用网易云的公开搜索接口把 歌手 / 专辑 / 封面 / 时长 全补齐（这些是元数据，
 * 不是音频本体）。音频由作者自己上传已下载的文件，站内不重分发任何来源站的资源，
 * 也不显示任何来源站的名字。
 *
 * ⚠️ 这个接口和 `song/detail`、`song/lyric` 一样**不带 `access-control-*` 头**，
 * 只能走服务端通道（`/api/link-meta?q=` 或 dev 的 `/__studio/link-meta?q=`），
 * 浏览器直连会被 CORS 拦掉。
 */
/**
 * 给搜索结果补上 yinyueku 换址签名 `streamSign`（只补前几条，失败静默）。
 *
 * 为什么在这里补：sign 只能通过「按歌名搜 yinyueku」拿到，而搜歌结果里正好有歌名。
 * 补上之后，作者点选某一首存卡时就能把 sign 一起存下来，以后播放就能随时换 VIP 直链。
 * 拿不到不影响搜索 —— streamSign 是可选字段，没有就走官方直链 / 上传音频。
 *
 * ⚠️ 只补前 2 条：sign 是按歌名一对一搜的，一次一条，补多了会把搜索拖慢几秒。
 *    （作者绝大多数时候点的就是第一条；第二条作备选。）
 */
async function withStreamSigns(hits: SongHit[], ms: number): Promise<SongHit[]> {
  if (!hits.length) return hits;
  const head = hits.slice(0, 2);
  // yinyueku 这个站响应偏慢（实测单次 3.5s+），单独放宽到 6s，别用搜索本身那 3.5s 去卡它
  const signs = await Promise.all(
    head.map((h) =>
      fetchNeteaseSign(h.title, Math.max(ms, 6000)).catch(() => undefined),
    ),
  );
  return hits.map((h, i) => {
    const s = i < signs.length ? signs[i] : undefined;
    return s ? { ...h, streamSign: s } : h;
  });
}

export async function searchSongs(query: string, limit = 6, ms = TIMEOUT): Promise<SongHit[]> {
  const q = query.trim();
  if (!q) return [];
  const cap = Math.max(1, Math.min(limit, 12));
  const headers = { referer: 'https://music.163.com/', accept: 'application/json' };

  // ① cloudsearch/pc（新接口）：**返回自带封面 `al.picUrl`** —— 搜索结果列表里能直接显示
  //    专辑图，作者一眼就能认出是哪一版。排序实测与旧接口完全一致。
  try {
    const res = await timedFetch(
      'https://music.163.com/api/cloudsearch/pc',
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ s: q, type: '1', limit: String(cap), offset: '0' }).toString(),
      },
      ms,
    );
    if (res.ok) {
      const j = (await res.json()) as {
        result?: {
          songs?: Array<{
            id?: number;
            name?: string;
            dt?: number;
            ar?: Array<{ name?: string }>;
            al?: { name?: string; picUrl?: string };
          }>;
        };
      };
      const out: SongHit[] = [];
      for (const s of j.result?.songs ?? []) {
        const id = s.id ? String(s.id) : '';
        const title = (s.name ?? '').trim();
        if (!id || !title) continue;
        out.push({
          title,
          artist: (s.ar ?? []).map((a) => a.name).filter(Boolean).join(' / '),
          album: s.al?.name || undefined,
          cover: withSize(httpsify(s.al?.picUrl ?? ''), '500y500'),
          duration: Number(s.dt) || 0,
          songId: id,
        });
      }
      if (out.length) return await withStreamSigns(out, ms);
    }
  } catch {
    /* 掉到旧接口 */
  }

  // ② search/get（旧接口，兜底）：字段名不一样（artists / album / duration），
  //    而且 `album` 里常常**只有 picId 没有 picUrl**（封面得靠后面的单曲详情补）。
  try {
    const api =
      `https://music.163.com/api/search/get?s=${encodeURIComponent(q)}` +
      `&type=1&limit=${cap}&offset=0`;
    const res = await timedFetch(api, { headers }, ms);
    if (!res.ok) return [];
    const j = (await res.json()) as {
      result?: {
        songs?: Array<{
          id?: number;
          name?: string;
          duration?: number;
          artists?: Array<{ name?: string }>;
          album?: { name?: string; picUrl?: string };
        }>;
      };
    };
    const out: SongHit[] = [];
    for (const s of j.result?.songs ?? []) {
      const id = s.id ? String(s.id) : '';
      const title = (s.name ?? '').trim();
      if (!id || !title) continue;
      out.push({
        title,
        artist: (s.artists ?? []).map((a) => a.name).filter(Boolean).join(' / '),
        album: s.album?.name || undefined,
        cover: withSize(httpsify(s.album?.picUrl ?? ''), '500y500'),
        duration: Number(s.duration) || 0,
        songId: id,
      });
    }
    return await withStreamSigns(out, ms);
  } catch {
    return [];
  }
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

/**
 * 拿一条**能直接播放**的网易云音频地址（320kbps 真音频）。
 *
 * 为什么需要它：网易云自己的公开直链 `music.163.com/song/media/outer/url?id=xxx.mp3`
 * 对**免费歌**能 302 到 CDN，但对 **VIP / 版权歌会 302 到一页 HTML**（实测周杰伦《晴天》
 * 186016、Monica《Believing In Me》17229930 都是这样）→ `<audio>` 拿到 HTML 直接报 error，
 * 表现就是「点了播放没声音」。
 *
 * 兜底：`yinyueku.cn`（开源 MKOnlineMusicPlayer）的 `api.php` 能绕过 VIP 限制，用
 * `types=url&id=<id>&source=netease&sign=<sign>` 换回真实的 m801.music.126.net 直链。
 * ⚠️ 这条直链带**时效签名**（几分钟到几小时失效），所以**只能播放时现换**，绝不能
 *    存进数据库当永久音源 —— 这就是为什么走 `/api/link-meta?neteaseId=` 而不是存卡里。
 *
 * ⚠️ sign 的来历：它跟 songId 一一对应、恒定不变，但**只能通过 `types=search` 按歌名
 *    搜到**（按 id 搜返回空、api.php 源码不公开算不出）。所以搜歌存卡那一步要顺手把
 *    sign 存进 SongHit.streamSign，播放时再带着 songId + sign 来这里现换直链。
 *
 * 返回 `{ url, source }`：source 记下「官方直链」还是「第三方换址」，仅用于日志/排查，
 * 不展示给用户（界面上不出现来源站名字）。
 */
export async function resolveNeteaseStream(
  songId: string,
  sign?: string,
  ms = TIMEOUT,
): Promise<{ url: string; source: 'netease' | 'yinyueku' } | null> {
  const id = songId.trim();
  if (!/^\d+$/.test(id)) return null;

  // ① 先试网易云官方直链：免费歌这条路就够了，省一次第三方往返
  try {
    const direct = `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
    const res = await timedFetch(direct, { redirect: 'manual' }, ms);
    // 官方直链对可播的歌会 302 到 m*.music.126.net；对 VIP/版权歌会 302 到 /404 页面。
    // 用「落点是不是音频 CDN」判断，比跟着 302 走到头再读 content-type 更省事。
    const loc = res.headers.get('location') ?? '';
    if (/\.(mp3|m4a|flac)(\?|$)/i.test(loc)) {
      return { url: direct, source: 'netease' };
    }
  } catch {
    /* 掉到第三方换址 */
  }

  // ② yinyueku 换址（必须带 sign，否则回「签名错误」）
  if (!sign) return null;
  try {
    const ures = await timedFetch(
      'http://www.yinyueku.cn/api.php',
      {
        method: 'POST',
        headers: {
          'user-agent': UA,
          'content-type': 'application/x-www-form-urlencoded',
          accept: '*/*',
        },
        body: new URLSearchParams({ types: 'url', id, source: 'netease', sign }).toString(),
      },
      ms,
    );
    if (!ures.ok) return null;
    const uj = (await ures.json().catch(() => null)) as { url?: string } | null;
    const u = uj?.url;
    if (!u || u === 'err') return null;
    // 只收音频 CDN 地址，别把任何页面/垃圾字符串当音源
    if (!/^https?:\/\/[^/]+.*\.(mp3|m4a|flac)(\?|$)/i.test(u)) return null;
    return { url: u, source: 'yinyueku' };
  } catch {
    return null;
  }
}

/**
 * 去 yinyueku 按歌名搜一首网易云歌，把它的换址签名 `sign` 拿回来。
 * 用于「搜歌存卡」那一步：sign 恒定、跟 songId 绑定，存进卡里以后播放时就能
 * 随时换 VIP 直链（不用再存会过期的音频地址）。
 * 拿不到就返回 undefined —— 调用方按「没有 VIP 兜底」处理，不影响正常搜歌。
 */
export async function fetchNeteaseSign(title: string, ms = TIMEOUT): Promise<string | undefined> {
  const q = title.trim();
  if (!q) return undefined;
  try {
    const api = `http://www.yinyueku.cn/api.php?types=search&source=netease&count=1&name=${encodeURIComponent(q)}`;
    const res = await timedFetch(api, { headers: { 'user-agent': UA, accept: '*/*' } }, ms);
    if (!res.ok) return undefined;
    const arr = (await res.json().catch(() => [])) as Array<{ name?: string; sign?: string }>;
    const first = arr?.[0];
    // 只认「歌名对得上」的结果，避免同名翻唱串了 sign
    return first && first.name === q ? first.sign : undefined;
  } catch {
    return undefined;
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
 * 歌曲宝（gequbao.com）：一个把「网易云放不出的 VIP / 版权歌」免费外放的站点。
 * 这里只借它的**页面元数据**（歌名 / 歌手 / 封面 / 歌词），而且**刻意不暴露来源**：
 *   · 不写 `site`、不存 `link`、不存 `embed` —— 站内绝不出现「歌曲宝」字样，也不跳回原站；
 *   · 音频一律不扒：它的播放依赖加密 `play_id` + 交互验证码（`/api/verify-kami`），
 *     服务端拿不到直链，且这属于未经授权的分发，不应再转到本站重分发。
 *     要真有声音，由作者在卡片里「上传自己已下载的音频」（见 MusicLinkAddForm 的「上传音频」）。
 *
 * ⚠️ 生产环境现实：gequbao 整站在 Cloudflare 后面，服务端（含 Vercel 与各公共代理）
 *    一抓就被拦成 "Just a moment..." 验证页 —— 这时 `window.appData` 不在响应里，
 *    我们返回**干净的空结果**（platform:'gequbao' 但 title/cover 全空），让上层把它当
 *    「识别被拦截」处理，而不是掉到通用解析去吐一屏 "Just a moment..." 乱码。
 *    代码逻辑本身是对的（本地不被拦时能正常解析），只是线上大概率过不了 Cloudflare。
 *
 * ⚠️ 2026-09-30 实测收口（别再来回试了）：**5 条通道全部拿不到页面**
 *      · 我本机直连 `www.gequbao.com/music/2089469` → **403**
 *      · `r.jina.ai` → 200，但内容是 "Performing security verification" 验证页
 *      · `api.allorigins.win/raw` → **522**  · `corsproxy.io` → **403**
 *      · `api.microlink.io` → **400**（它自己就拒了）
 *      · 真浏览器（无头 Edge）打开 → 停在标题「请稍候…」，12s 后仍未过挑战、无 appData
 *    所以「粘贴链接 → 自动识别歌名」对这个站**从根上不成立**。
 *    替代路径 = `searchSongs()`：作者填一次歌名，元数据从网易云公开搜索补齐，
 *    音频由作者上传自己的文件。见 searchSongs 的注释。
 *
 * 真能解析到时，只回 歌名 / 歌手 / 封面 / 歌词，album 留空（页面不暴露专辑）。
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
    // Cloudflare 验证页 / 其它非歌曲页：没有 appData → 干净拦截标记，别掉通用解析
    if (!appData) {
      return { url, title: '', cover: '', platform: 'gequbao' };
    }
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
      // 不写 site：站内绝不出现「歌曲宝」字样
      platform: 'gequbao',
      // 无外链、无 iframe 播放器：音频由作者上传自己的文件，不在站内重分发 gequbao 的资源
      extra: {
        artist: artist || undefined,
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

  // 歌曲宝单独处理：它在 Cloudflare 后面，服务端（含 Vercel 与各公共代理）基本抓不到
  // 真实页面，gequbaoMeta 会返回「干净拦截标记」（platform:'gequbao' 但 title/cover 全空）。
  // 这里直接返回，绝不掉到下面的通用解析去吐一屏 "Just a moment..." 乱码。
  if (platform === 'gequbao') {
    const got = await gequbaoMeta(url);
    return got ?? { url, title: '', cover: '', platform: 'gequbao' };
  }

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
