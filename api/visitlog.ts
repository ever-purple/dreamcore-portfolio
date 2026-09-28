/**
 * 访问日志 ——「谁来过、从哪条链接来、看了什么、待了多久」
 * （Vercel Serverless + Upstash Redis，零 npm 依赖）
 *
 *  POST /api/visitlog
 *      记一条访问。body 三种形态，同一个 visitId 会合并成一条：
 *        { visitId, from, ref, path, device }        进入时建一条
 *        { visitId, sections: [...], dwell }          切栏目 / 离开时补写
 *      · from  —— 你在简历/邮件里发的 `?from=xxx公司` 标记（**最可靠的身份线索**）
 *      · dwell —— 停留秒数（前端在离开/切后台时补报）
 *      · 地区  —— 只存**城市级归属地**，不存完整 IP（见下面 resolveGeo 的说明）
 *
 *  GET  /api/visitlog?key=<ADMIN_KEY>
 *      读日志列表（最新在前），只有你自己能看。
 *
 * ⚠️ 共享代码（Redis 客户端 / 口令校验）直接内联在本文件里，不要拆回 ./_lib：
 *    Vercel 对 /api 下的函数按文件独立转译，跨文件 import 在部分构建管线下
 *    解析不到（实测导致 FUNCTION_INVOCATION_FAILED，且无日志）。
 *    要改公共逻辑请 visit / guestbook / admin / visitlog 四个文件同步改。
 *
 * ⚠️ 关于隐私：IP 地址在中国《个人信息保护法》下属于个人信息。
 *    这里只把 IP 用于**查城市归属地**，落库的是城市名（如「上海」），
 *    完整 IP 不写进 Redis。日志另外有 30 天 TTL 自动过期。
 */

/* ---------------- Vercel 最小类型（@vercel/node 不在项目依赖里，就地声明） ---------------- */
type VercelRequest = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status(code: number): VercelResponse;
  setHeader(key: string, value: string): void;
  json(body: unknown): void;
  send(body: string): void;
};

/* ---------------- Upstash Redis（REST 直连，无 SDK） ---------------- */
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
/** 后台口令：Vercel 环境变量 ADMIN_KEY */
const ADMIN_KEY = process.env.ADMIN_KEY || '';

const storageReady = () => Boolean(KV_URL && KV_TOKEN);

/** 调一条 Redis 命令。args 形如 ['lpush', 'dc:vl', '{...}'] */
async function redis(...args: string[]): Promise<unknown> {
  const cmdPath = args.map(encodeURIComponent).join('/');
  const r = await fetch(`${KV_URL}/${cmdPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!r.ok) throw new Error(`upstash ${r.status}`);
  const j = (await r.json()) as { result?: unknown };
  return j.result;
}

/** 判断请求方是否持有效后台口令（支持 ?key= 或 x-admin-key 头） */
function hasAdminKey(req: {
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}): boolean {
  if (!ADMIN_KEY) return false;
  const q = req.query?.key;
  const h = req.headers?.['x-admin-key'];
  const given = Array.isArray(q) ? q[0] : q;
  const givenH = Array.isArray(h) ? h[0] : h;
  return given === ADMIN_KEY || givenH === ADMIN_KEY;
}

/* ---------------- 归属地解析 ---------------- */

/**
 * 从请求头里取出访客 IP（Vercel 会填 x-forwarded-for / x-real-ip）。
 * 只用于查归属地，不落库。
 */
function clientIp(req: VercelRequest): string {
  const xff = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  const first = (raw || '').split(',')[0].trim();
  if (first) return first;
  const real = req.headers?.['x-real-ip'];
  return (Array.isArray(real) ? real[0] : real) || '';
}

const PRIVATE_IP =
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;

/**
 * 查城市级归属地。**失败一律返回空串，绝不让它拖垮主流程。**
 *
 * 用 ip-api.com 免费版（无需 key、45 次/分钟、仅 http 可用），
 * 拿 regionName / city 拼一个「省 · 市」。查不到就是空 —— 后台会显示「—」。
 *
 * 小提醒：免费 IP 库对中国 IP 的归属地**常有偏差**，这里的结果只当参考，
 * 不要拿它当「是不是某公司」的铁证。真正可靠的是 from 标记。
 */
async function resolveGeo(ip: string): Promise<string> {
  if (!ip || PRIVATE_IP.test(ip)) return '';
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city&lang=zh-CN`,
      { signal: ctl.signal },
    ).finally(() => clearTimeout(timer));
    if (!r.ok) return '';
    const j = (await r.json()) as {
      status?: string;
      country?: string;
      regionName?: string;
      city?: string;
    };
    if (j.status !== 'success') return '';
    const parts = [j.regionName, j.city].filter(Boolean);
    const city = [...new Set(parts)].join(' · ');
    return city || j.country || '';
  } catch {
    return '';
  }
}

/* ---------------- 接口本体 ---------------- */

type VisitLog = {
  id: string;
  /** 进入时间 */
  ts: number;
  /** `?from=` 来源标记（简历/邮件里你发的那个） */
  from: string;
  /** 站外来路 hostname（面试官从招聘网站点进来的话能看到） */
  ref: string;
  /** 落地路径（含 query 之外的部分） */
  path: string;
  /** 城市级归属地，空串 = 没查到 */
  geo: string;
  /** 设备类型：mobile / tablet / desktop */
  device: string;
  /** 浏览器 + 系统，粗粒度 */
  ua: string;
  /** 看过的栏目 id 列表（顺序即浏览顺序） */
  sections: string[];
  /** 关键动作，如 ['简历下载'] —— 比「来过」强得多的意向信号 */
  events: string[];
  /** 最后活跃时间 */
  last: number;
  /** 停留秒数（前端离开时补报；没补报就是最后活跃 - 进入） */
  dwell: number;
};

const VL_KEY = 'dc:vl'; // list：最新在前
const MAX_KEEP = 500;
/** 30 天自动过期，不用人工清理（也符合「不留太久」的隐私取向） */
const TTL_SEC = 60 * 60 * 24 * 30;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => Number(v ?? 0) || 0;

/** 截断 + 去控制字符，防脏数据撑爆存储 */
function clean(v: unknown, max: number): string {
  return str(v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

/** 粗粒度判断设备：不给后台看完整 UA，只给一个够用的分类 */
function deviceOf(ua: string): string {
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** 浏览器 / 系统粗判，后台列表里显示成「Chrome · macOS」这样 */
function uaLabel(ua: string): string {
  const os = /iPhone|iPad|iPod/i.test(ua)
    ? 'iOS'
    : /Android/i.test(ua)
      ? 'Android'
      : /Mac OS X/i.test(ua)
        ? 'macOS'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Linux/i.test(ua)
            ? 'Linux'
            : '';
  const br = /Edg\//i.test(ua)
    ? 'Edge'
    : /MicroMessenger/i.test(ua)
      ? '微信'
      : /QQBrowser/i.test(ua)
        ? 'QQ浏览器'
        : /OPR\//i.test(ua)
          ? 'Opera'
          : /Chrome\//i.test(ua)
            ? 'Chrome'
            : /Safari\//i.test(ua)
              ? 'Safari'
              : /Firefox\//i.test(ua)
                ? 'Firefox'
                : '';
  return [br, os].filter(Boolean).join(' · ');
}

/** 读整个日志列表 */
async function readLogs(): Promise<VisitLog[]> {
  const r = await redis('lrange', VL_KEY, '0', String(MAX_KEEP - 1));
  if (!Array.isArray(r)) return [];
  return r
    .map((item) => {
      try {
        const o = JSON.parse(str(item)) as Partial<VisitLog>;
        return { ...o, id: str(o.id) } as VisitLog;
      } catch {
        return null;
      }
    })
    .filter((e): e is VisitLog => e !== null);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!storageReady()) {
    res.status(503).json({ ok: false, reason: 'storage-not-configured' });
    return;
  }

  try {
    /* ---------- 读日志（后台口令） ---------- */
    if (req.method === 'GET') {
      if (!hasAdminKey(req)) {
        res.status(401).json({ ok: false, reason: 'unauthorized' });
        return;
      }
      const logs = await readLogs();
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, logs, total: logs.length });
      return;
    }

    /* ---------- 写一条（公开，访客自己的浏览器发） ---------- */
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, reason: 'method-not-allowed' });
      return;
    }

    const body = ((typeof req.body === 'string' ? safeJson(req.body) : req.body) ?? {}) as Record<
      string,
      unknown
    >;

    const visitId = clean(body.visitId, 40);
    if (!visitId) {
      res.status(400).json({ ok: false, reason: 'no-visit-id' });
      return;
    }

    const ua = str(req.headers?.['user-agent']);

    /* 增量补写：切栏目 / 离开时只更新已有那条，不再插新记录 */
    const sections = Array.isArray(body.sections)
      ? body.sections.map((s) => clean(s, 20)).filter(Boolean).slice(0, 12)
      : null;
    const events = Array.isArray(body.events)
      ? body.events.map((s) => clean(s, 20)).filter(Boolean).slice(0, 12)
      : null;
    const dwell = body.dwell === undefined ? null : Math.max(0, Math.round(num(body.dwell)));
    const isPatch = sections !== null || events !== null || dwell !== null;

    if (isPatch) {
      // 补写请求一般是「刚进入的那一条」，所以从最新往前找很快就命中；
      // 全量扫最多 500 条，代价可接受，换掉一整套索引维护逻辑。
      const all = await readLogs();
      const idx = all.findIndex((e) => e.id === visitId);
      if (idx >= 0) {
        const merged: VisitLog = {
          ...all[idx],
          sections: sections ?? all[idx].sections ?? [],
          events: events ?? all[idx].events ?? [],
          dwell: dwell ?? all[idx].dwell,
          last: Date.now(),
        };
        // 同位置原地替换，不打乱「最新在前」的顺序
        await redis('lset', VL_KEY, String(idx), JSON.stringify(merged));
        res.status(200).json({ ok: true, patched: true });
        return;
      }
      /* 找不到原记录（比如列表被裁掉了）：当作新记录落一条，别丢数据 */
    }

    const entry: VisitLog = {
      id: visitId,
      ts: Date.now(),
      from: clean(body.from, 60),
      ref: clean(body.ref, 100),
      path: clean(body.path, 120) || '/',
      geo: '',
      device: deviceOf(ua),
      ua: uaLabel(ua),
      sections: sections ?? [],
      events: events ?? [],
      last: Date.now(),
      dwell: dwell ?? 0,
    };

    /* 归属地先查 —— 查得到就跟这条一起落，省一次读改写；查不到就是空串。
       2.5s 超时兜底，不会让访客等太久。 */
    entry.geo = await resolveGeo(clientIp(req)).catch(() => '');

    await redis('lpush', VL_KEY, JSON.stringify(entry));
    await redis('ltrim', VL_KEY, '0', String(MAX_KEEP - 1));
    // 首次 expire 给整个 list 设 TTL；后续每次写入都会刷新，等于「30 天没新访问才清」
    await redis('expire', VL_KEY, String(TTL_SEC));

    res.status(200).json({ ok: true, id: visitId });
  } catch (err) {
    console.error('[visitlog]', err);
    res.status(502).json({ ok: false, reason: 'storage-error' });
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}
