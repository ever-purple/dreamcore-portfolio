/**
 * 分享卡：把「转发按钮 → 拿到图片文件 → 分享 / 逐级降级」整条链路收在一处。
 *
 * ## 两个角色，别混淆（2026-09-28 用户明确纠正过）
 *   · 卡片**图上**那个 `come in` 药丸是画给**收到卡片的人**的：他点卡上的 come in
 *     进来。链接形式的卡片在微信里会渲染成 og 预览、整张预览可点 → 所以 come in
 *     是真的能点进去的，**卡片图上的文案保持 come in，别改成动作词**。
 *   · **转发**是浮层里另给的一枚按钮（`.share-card__send`），不在图上 ——
 *     图会被原样发出去，把"转发按钮"画进图里，收件人那边就会出现一个按不动的假按钮。
 *
 * ## 为什么不再直接 `navigator.share({ url })`
 * 旧实现只发链接，用户原话：「只能复制链接，把链接发给好友只是链接不是图片」。
 * 现在改成发**图片文件**（同时把链接塞进文案，两边都不落空）。
 *
 * ## 三级降级（缺一级就有整类设备用不了）
 *   ① `navigator.canShare({ files })` 为真 → `navigator.share({ files })`
 *      —— iOS Safari / 安卓 Chrome / 部分桌面 Chromium，唯一"真·分享图片"的路。
 *   ② 剪贴板写图片（`ClipboardItem`）—— 桌面 Chrome / Safari 有，白捡一级。
 *   ③ `<a download>` 下载 —— 桌面必定成功；手机视平台而定。
 *      **微信 / 小红书的内置浏览器 ①② 都不支持**（没有 `navigator.share`，
 *      `clipboard.write` 也被拦），那边唯一可行的动作是「长按图片 → 保存到相册」，
 *      所以卡片必须是可长按的 `<img>`（见 ShareCardOverlay 文件头第 2 条）。
 *
 * ## 「已取到」的缓存
 * `navigator.share` 要求**瞬时用户激活**。点下去才 `fetch` 的话，网络一慢激活就过期
 * → `NotAllowedError`。所以文件按 `src` 缓存，浮层**一打开就预热**；
 * 用户真正点按钮时只等一个微任务，激活稳稳还在。
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

export const SHARE_TITLE = '孙晨茜 作品集';
export const SHARE_TEXT = '孙晨茜 作品集 · stay for a moment';

export type ShareOutcome = 'shared' | 'copied' | 'downloaded' | 'aborted' | 'failed';

type NavigatorWithShare = Navigator & {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
};

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
  const url = URL.createObjectURL(file);
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
 * 转发这张卡。返回语义化结果，调用方据此给文案（见 ShareCardOverlay 的 hintFor）。
 * 三级降级的顺序与理由见文件头。
 *
 * ⚠️ 文案里**带上链接**：有些接收端只吃得下文字（或用户在选择器里挑了个
 *    不支持图片的目标），带上链接对方至少能点进去 —— 而那正是卡片上
 *    come in 的用法。两者一起发，谁都不落空。
 */
export async function shareCard(spec: CardSpec): Promise<ShareOutcome> {
  const file = await loadCardFile(spec);
  if (!file) return 'failed';

  const url = shareUrl();
  const caption = `${SHARE_TEXT}\n${url}`;
  const nav = navigator as NavigatorWithShare;

  if (typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    let can = false;
    try {
      can = nav.canShare({ files: [file] });
    } catch {
      can = false;
    }
    if (can) {
      try {
        /* ⚠️ 只传 files + title + text，**不要**再单独传 `url` 字段：
           iOS Safari 在 files 与 url 同时存在时会把 url 一起塞进去，
           有些接收端（小红书）会因此退化成"只拿到链接"。链接已经写在 text 里了。 */
        await nav.share({ files: [file], title: SHARE_TITLE, text: caption });
        return 'shared';
      } catch (err) {
        const name = (err as Error)?.name;
        if (name === 'AbortError') return 'aborted';
        /* NotAllowedError / TypeError / 平台自定义错误 → 继续降级，不直接判失败 */
      }
    }
  }

  /* ② 剪贴板写图片 */
  try {
    const CI = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (CI && navigator.clipboard?.write) {
      await navigator.clipboard.write([new CI({ [file.type || 'image/png']: file })]);
      return 'copied';
    }
  } catch {
    /* 大多数移动端 WebView 会在这里被拦，正常 */
  }

  /* ③ 下载 */
  return (await downloadCard(spec)) ? 'downloaded' : 'failed';
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
