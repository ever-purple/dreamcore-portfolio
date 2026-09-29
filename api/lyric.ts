/**
 * 网易云歌词代理 —— 播放器实时拉歌词，**不落任何本地 / 云端存储**。
 *
 * 为什么需要它：浏览器直连 music.163.com/api/song/lyric 会被 CORS 拦掉，
 * 所以由这个服务端函数（Vercel Serverless，零 npm 依赖）去抓，再原样回给前端。
 * 前端每次播放网易云歌曲时调一次 `/api/lyric?id=<歌曲id>`，歌词随播随取。
 *
 *   GET /api/lyric?id=<neteaseSongId>
 *        → 200 { ok:true, lrc:'[00:00.00] ...', tlyric:'...' }
 *        → 200 { ok:true, lrc:'', tlyric:'' }      （纯音乐 / 无词）
 *        → 200 { ok:false, reason:'bad-id'|'fetch-failed'|'no-lyric' }
 *
 * 复用 api/insp.ts 的「Vercel 最小类型 + 内联实现」约定（跨文件 import 在部分
 * 构建管线下解析不到，所以不拆公共模块）。
 */

/* ---------------- Vercel 最小类型 ---------------- */
type VercelRequest = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
  url?: string;
};
type VercelResponse = {
  status(code: number): VercelResponse;
  setHeader(key: string, value: string): void;
  json(body: unknown): void;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 歌词每周变不了几次，让 Vercel 边缘帮我们缓存一天，省得每次都回源网易云
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, reason: 'method-not-allowed' });
    return;
  }

  const rawId = Array.isArray(req.query?.id) ? req.query?.id[0] : req.query?.id;
  const id = (rawId ?? '').toString().trim();
  if (!/^\d{3,}$/.test(id)) {
    res.status(400).json({ ok: false, reason: 'bad-id' });
    return;
  }

  try {
    const api =
      `https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=1`;
    const r = await fetch(api, {
      headers: {
        // 网易云对非浏览器 UA / 无 Referer 的请求会直接挡，带上才给歌词
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Referer: 'https://music.163.com/',
      },
      // 服务端之间无 CORS，但兜底别让它卡死
      signal: AbortSignal.timeout(8000),
    });

    if (!r.ok) {
      res.status(200).json({ ok: false, reason: 'fetch-failed', http: r.status });
      return;
    }

    const j = (await r.json()) as {
      code?: number;
      lrc?: { lyric?: string };
      tlyric?: { lyric?: string };
    };

    // 部分歌曲（纯音乐 / 还没收集到歌词）code 仍是 200，但 lrc 为空
    const lrc = (j.lrc?.lyric ?? '').trim();
    const tlyric = (j.tlyric?.lyric ?? '').trim();

    if (!lrc && !tlyric) {
      res.status(200).json({ ok: true, lrc: '', tlyric: '' });
      return;
    }

    res.status(200).json({ ok: true, lrc, tlyric });
  } catch {
    res.status(200).json({ ok: false, reason: 'fetch-failed' });
  }
}
