/**
 * 分享卡：网页分享与图片保存是两条独立路径。
 *
 * ## 两个角色，别混淆（2026-09-28 用户明确纠正过）
 *   · 卡片**图上**那个 `come in` 药丸是画给**收到卡片的人**的：他点卡上的 come in
 *     进来。链接形式的卡片在微信里会渲染成 og 预览、整张预览可点 → 所以 come in
 *     是真的能点进去的，**卡片图上的文案保持 come in，别改成动作词**。
 *   · **分享网站**发送 URL，让微信、飞书、X 抓取 OG 图，整张预览都能点击。
 *   · **保存图片**动态叠加当前网址的二维码，普通图片也能扫码进入。
 *
 * ## 「已取到」的缓存
 * 卡片文件按 `src` 缓存，浮层打开时预热；保存时只额外生成二维码和合成图片。
 */

export type CardSpec = {
  src: string;
  /** 分享出去时的文件名（微信 / 小红书都按它显示） */
  file: string;
  w: number;
  h: number;
};

/**
 * 横版 1200×630（og:image 的 1.91:1）—— 宽屏用。
 * 来源：`_ogcard/_compose_card_wide_v12.py`（在隔壁工作区
 * `2026-09-26-20-09-02/`，它是这张图的唯一出处；改图要去那边改再拷回来）。
 */
export const CARD_WIDE: CardSpec = {
  src: '/og/card-share-wide.png',
  file: '孙晨茜作品集-分享卡.png',
  w: 1200,
  h: 630,
};

/**
 * 竖版 1080×1440（3:4）—— 窄屏用。来源：`_ogcard/_compose_card_tall_v1.py`。
 *
 * 为什么窄屏要换图：横版塞进手机浮层里只有一条扁条（390px 宽 → 高 205px），
 * 卡片上的 come in 缩到看不清；竖版同样宽度下高 520px，而且发出去当图片看、
 * 发到小红书，竖版都比横版合适。
 */
export const CARD_TALL: CardSpec = {
  src: '/og/card-share-tall.png',
  file: '孙晨茜作品集-分享卡.png',
  w: 1080,
  h: 1440,
};

/** 屏宽小于它就换竖版（和 index.css 里联系方式那批 `@media (max-width: 720px)` 同一条线） */
export const NARROW_MAX = 720;

export const pickCard = (narrow: boolean): CardSpec => (narrow ? CARD_TALL : CARD_WIDE);

export type ShareOutcome = 'shared' | 'copied' | 'downloaded' | 'aborted' | 'failed';

/**
 * 全站的**调试 / 预览**参数（都是给自己测试用的，见各自的 `URLSearchParams` 调用）。
 * 分享出去的链接必须把它们摘掉 —— 最要紧的是 `admin`：带着它分享，
 * 收件人一点开就变成作者模式了。`from` / `utm_source` 是埋点标记，**要留着**
 * （那是「谁介绍来的」）。
 */
const DEBUG_PARAMS = [
  'admin',
  'studio',
  'about',
  'greenos',
  'crt',
  'direct',
  'works',
  'newsstand',
  'lab',
  'media',
  'diary',
  'copy',
  'channel',
  'contact',
  'contactv',
  'quick',
  'choice',
  'lensreveal',
  'roompar',
  'motion',
  'nscam',
  'nsrot',
  'nsgeo',
  'nsfit',
  'wkp',
];

/** 该分享出去的干净网址（摘掉调试参数，保留埋点标记） */
export function shareUrl(): string {
  try {
    const u = new URL(window.location.href);
    for (const k of DEBUG_PARAMS) u.searchParams.delete(k);
    /* 全摘空了就把 `?` 也去掉，别留一个光秃秃的问号 */
    if ([...u.searchParams.keys()].length === 0) u.search = '';
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
      u.protocol = 'https:';
      u.hostname = 'portfolio-ten-blush-61.vercel.app';
      /* URL.hostname 不会自动清掉原来的开发端口，必须显式归零。 */
      u.port = '';
      u.pathname = '/';
    }
    return u.toString();
  } catch {
    return window.location.href;
  }
}

/** 已取到的卡片文件，按 src 缓存（见文件头「已取到的缓存」） */
const fileCache = new Map<string, Promise<File | null>>();

/**
 * 取卡片文件。同一个 src 只会 fetch 一次；
 * **失败不缓存**（否则一次网络抖动会让整场会话都取不到图）。
 */
export function loadCardFile(spec: CardSpec): Promise<File | null> {
  const hit = fileCache.get(spec.src);
  if (hit) return hit;
  const p = (async (): Promise<File | null> => {
    try {
      const res = await fetch(spec.src, { cache: 'force-cache' });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (typeof File !== 'function') return null;
      return new File([blob], spec.file, { type: blob.type || 'image/png' });
    } catch {
      return null;
    }
  })();
  fileCache.set(spec.src, p);
  void p.then((f) => {
    if (!f) fileCache.delete(spec.src);
  });
  return p;
}

/** 触发下载。返回是否真的点到了链接（浏览器拒绝下载时也无从得知，一律当成功） */
export async function downloadCard(spec: CardSpec): Promise<boolean> {
  const file = await loadCardFile(spec);
  if (!file) return false;
  let url = '';
  try {
    const [{ default: QRCode }, bitmap] = await Promise.all([
      import('qrcode'),
      createImageBitmap(file),
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = spec.w;
    canvas.height = spec.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0, spec.w, spec.h);
    bitmap.close();

    const qrSize = Math.round(Math.min(spec.w, spec.h) * 0.18);
    const pad = Math.round(qrSize * 0.12);
    const tile = qrSize + pad * 2;
    const x = spec.w - tile - Math.round(spec.w * 0.025);
    const y = spec.h - tile - Math.round(spec.h * 0.04);
    ctx.fillStyle = 'rgba(243, 238, 227, 0.96)';
    ctx.beginPath();
    ctx.roundRect(x, y, tile, tile, Math.round(tile * 0.08));
    ctx.fill();

    const qr = document.createElement('canvas');
    await QRCode.toCanvas(qr, shareUrl(), {
      width: qrSize,
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#4d2d23', light: '#f3eee3' },
    });
    ctx.drawImage(qr, x + pad, y + pad, qrSize, qrSize);
    const output = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!output) return false;
    url = URL.createObjectURL(output);
  } catch {
    /* 较旧浏览器不支持 canvas 合成时，仍允许保存原图。 */
    url = URL.createObjectURL(file);
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = spec.file;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* 立刻 revoke 会让部分浏览器取消这次下载，留 10s */
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

/**
 * 分享网页 URL。平台抓取 index.html 的 OG 信息后显示卡片，整张预览可点击；
 * 不支持 Web Share API 时退回复制链接。
 */
export async function shareCard(_spec: CardSpec): Promise<ShareOutcome> {
  const url = shareUrl();
  /* 不弹系统分享面板：复制公开网址，粘贴进聊天后由平台生成 OG 卡片。 */
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    window.prompt('复制此链接分享：', url);
    return 'failed';
  }
}

/** 复制干净链接（浮层里的次级动作）。复制的是 `shareUrl()`，不是 `location.href`。 */
export async function copyLink(): Promise<boolean> {
  const url = shareUrl();
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    window.prompt('复制此链接分享：', url);
    return false;
  }
}

/**
 * 内置浏览器（微信 / 小红书 / 微博 / QQ）。
 * 这些 WebView 既不支持 `navigator.share`，也拦 `clipboard.write` ——
 * 所以在这些环境里"点转发"注定只能落到下载或长按保存，
 * 前端据此**把"长按图片保存"当主提示**，而不是等失败之后再补救。
 */
export function isInAppBrowser(): boolean {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return /MicroMessenger|XHS|xiaohongshu|Weibo|QQ\//i.test(ua);
}

/** 粗指针（手机 / 平板）—— 只用来决定提示里要不要提"长按保存" */
export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
