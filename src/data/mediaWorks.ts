/**
 * 报刊亭「第一排」—— 顶层三件设备（DVD 机 / DV 机 / MP3）对应的作品集。
 *
 * 规则（2026-09-21 修订，替代 09-15 的「每台设备一个频道片单」）：
 *   · 点第一排任意一件设备都进**同一个列表页**，看到**全部**片子；
 *   · 片单按 横屏 → AI → 竖屏 排列、首尾循环，设备只决定进门时定位在第几条；
 *   · 播放不放大 —— 就在列表页原地播，视频下方有进度条可以播放/暂停/拖动。
 *
 * 现在只搭框架，内容是空的 —— 之后往 `MEDIA_WORKS` 里填条目即可。
 */

/** 片单频道 —— 对应报刊亭第一排的三件设备（2026-09-15 用户规划） */
export type MediaChannel = 'landscape' | 'ai' | 'portrait';

/**
 * 设备序号 → 频道。报刊亭第一排点第 1/2/3 件设备（2026-09-21 规则反转）：
 *   0 DVD 机 → 从第一条横屏起步　1 DV 机 → 从第一条 AI 影像起步　2 MP3 → 从第一条竖屏起步
 * **三个入口进的是同一份片单**（横屏 → AI → 竖屏 排成一列，首尾相接循环），
 * 频道只决定初始定位在第几条，不再过滤列表。
 */
export const CHANNEL_BY_DEVICE: MediaChannel[] = ['landscape', 'ai', 'portrait'];

/** 频道的中文名，给列表页顶栏显示用 */
export const CHANNEL_LABEL: Record<MediaChannel, string> = {
  landscape: '横屏映像',
  ai: 'AI 影像',
  portrait: '竖屏短片',
};

/**
 * 频道的大字排版（列表页背景那层巨型字）。
 * 参考站首页就是「music / videos / shows / about」几个斜体衬线大字在那里慢慢位移，
 * 这里把它搬成视频页的背景层：**永远小写**（参考站也是小写），位移比卡片慢一个量级。
 */
export const CHANNEL_WORD: Record<MediaChannel, string> = {
  landscape: 'videos',
  ai: 'ai films',
  portrait: 'vertical',
};

/** 一件媒体作品 */
export type MediaWork = {
  /** 稳定 id，用于 React key 与 URL 定位（如 'over-and-over'） */
  id: string;
  /** 标题，如「over and over」 */
  title: string;
  /** 时长文案，如 '02:04'；留空则不显示 */
  length?: string;
  /** 年份，如 '2025' */
  year?: string;
  /** 类别 */
  kind: 'video' | 'music';
  /**
   * 画面比例（宽 ÷ 高）。**非必填但强烈建议填** —— 列表格子按各自的宽高比撑开，
   * 竖版片子才能完整显示；不填则按 16:9 兜底，9:16 的竖视频会被裁掉大半。
   */
  aspect?: number;
  /**
   * 归属频道 —— 决定这条出现在哪台设备的片单里。
   * 留空 = 任何频道都显示（视频还没攒够时，三条频道会都看到同一批，等填了就自动分流）。
   */
  channel?: MediaChannel;
  /** 封面静态图（视频加载前 / 不支持时兜底） */
  poster?: string;
  /**
   * 视频本体 —— **只有一个文件，没有单独的"低码率预览"**。
   * 2026-09-21：列表里循环播放的就是这一条（静音），点播放只是解除静音、不再换源。
   * 以前另有 `-preview.mp4`（960 长边 + CRF 26），它是页面发糊的元凶之一，已取消。
   */
  video?: string;
  /** 音乐作品：音频文件地址 */
  audio?: string;
  /** 一句话简介，列表中显示在标题下 */
  blurb?: string;
  /** 制作名单（mattjinn 的 Credits 区），形如 [{ role, name }] */
  credits?: { role: string; name: string }[];
};

/**
 * 作品列表 —— KSI 实习项目的四条片子 + 一条 AI 影像 + 春山里三条（2026-09-21 补）。
 *
 * 素材在 `public/media/`，每条两个文件：
 *   `<slug>.mp4`  正片（前五条走压缩流水线；春山里三条是**原片直拷**，见各自条目注释）
 *   `<slug>.jpg`  封面图（前五条 1280 长边 / 春山里三条 1600 长边）
 * 压缩脚本：`scripts/media-compress.py`（换片子时改里面的 JOBS 列表再跑一遍；
 * 但「不压缩」的片子别进那个脚本，直接 cp）。
 *
 * ⚠️ 2026-09-21 画质整改：**没有** `-preview.mp4` 了。旧版那条"960 长边 + CRF 26"
 *    的静音预览是页面发糊的元凶（横版只有 540p，而画布背板要 1712px）。
 *    现在列表里循环播放的就是完整版本身（静音），点播放只是解除静音、不换源。
 * ⚠️ 原始素材是 HEVC + 共 500MB 上下；**别把原片拷进 public/**。
 * ⚠️ 改这里的中文标题后必须重跑 `scripts/subset-nanooldsong.py`，否则缺字回退系统字体。
 */
const M = `${import.meta.env.BASE_URL}media/`;

export const MEDIA_WORKS: MediaWork[] = [
  {
    id: 'qixi',
    title: '七夕活动花絮',
    length: '00:56',
    kind: 'video',
    aspect: 16 / 9,
    channel: 'landscape',
    poster: `${M}qixi.jpg`,
    video: `${M}qixi.mp4`,
  },
  {
    id: 'yike-1020',
    title: '翼氪计划 · 香港实习生',
    length: '01:09',
    kind: 'video',
    aspect: 1020 / 1920, // 竖版
    channel: 'portrait',
    poster: `${M}yike-1020.jpg`,
    video: `${M}yike-1020.mp4`,
  },
  {
    id: 'yike-0814',
    title: '翼氪计划 · 8月14日',
    length: '01:15',
    kind: 'video',
    aspect: 1360 / 2560, // 竖版
    channel: 'portrait',
    poster: `${M}yike-0814.jpg`,
    video: `${M}yike-0814.mp4`,
  },
  {
    id: 'sanlitun',
    title: '外交官 · 照片背后的故事',
    length: '00:40',
    kind: 'video',
    aspect: 16 / 9,
    channel: 'landscape',
    poster: `${M}sanlitun.jpg`,
    video: `${M}sanlitun.mp4`,
  },
  {
    // AI 影像频道第一条（2026-09-21）。原标题就是文件名「明天也一起回家吧」。
    id: 'going-home',
    title: '明天也一起回家吧',
    length: '01:44',
    kind: 'video',
    aspect: 3874 / 2160, // 源片 3874x2160，略宽于 16:9
    channel: 'ai',
    poster: `${M}going-home.jpg`,
    video: `${M}going-home.mp4`,
  },
  /* ---- 春山里三条（2026-09-21 补，**原片直拷、未压缩**）----
   * 用户要求「横屏视频加上去，不压缩」→ 直接 `cp` 原文件到 public/media/，
   * 没走 scripts/media-compress.py（那条流水线会重编码）。所以这三条的码率/分辨率
   * 就是源片本身：蝴蝶振翅 1920×1080@9.7Mbps（76MB）、另两条 1280×720@1.7Mbps。
   * 封面仍是抽帧 + 1600 长边 q3（静止图，不影响视频画质）。
   * ⚠️ 蝴蝶振翅 76MB 是全场最重的单个文件，首屏那格的 preload=auto 会先拉它；
   *    若以后嫌加载慢，要么压缩它、要么把它移出「横屏入口的第一条」。 */
  {
    id: 'chunshanli-intro',
    title: '春山里 · 介绍',
    length: '01:01',
    kind: 'video',
    aspect: 16 / 9,
    channel: 'landscape',
    poster: `${M}chunshanli-intro.jpg`,
    video: `${M}chunshanli-intro.mp4`,
  },
  {
    id: 'chunshanli-summer',
    title: '春山里 · 暑假',
    length: '01:02',
    kind: 'video',
    aspect: 16 / 9,
    channel: 'landscape',
    poster: `${M}chunshanli-summer.jpg`,
    video: `${M}chunshanli-summer.mp4`,
  },
  {
    id: 'butterfly',
    title: '蝴蝶振翅',
    length: '01:01',
    kind: 'video',
    aspect: 16 / 9,
    channel: 'landscape',
    poster: `${M}butterfly.jpg`,
    video: `${M}butterfly.mp4`,
  },
  {
    // 2026-09-21 补，**原片直拷、未压缩**（源 1920×1080@8.7Mbps / 74.7MB）。
    id: 'hbn',
    title: '摆脱巴掌的秘诀',
    length: '01:07',
    kind: 'video',
    aspect: 16 / 9,
    channel: 'landscape',
    poster: `${M}hbn.jpg`,
    video: `${M}hbn.mp4`,
  },
];

/* ---- 全量片单与入口起点（2026-09-21）----
 * 三个设备入口共用**同一条片单**：横屏 → AI → 竖屏 依次排开、首尾相接成一个环。
 * 频道不再过滤列表，只决定「进门时站在环上的哪个位置」：
 *   · 有该频道的片子 → 定位到**第一条**那个频道的片子（横屏入口 → 第一条横屏）；
 *   · 该频道还没有片子（比如 AI）→ 定位到它**应该出现的位置**（横屏全走完后的第一条），
 *     现在就是第一条竖屏 —— 等补了 channel:'ai' 的数据会自动精准定位。
 */
/** 频道在循环片单里的先后顺序 */
export const CHANNEL_ORDER: MediaChannel[] = ['landscape', 'ai', 'portrait'];

const channelRank = (c: MediaChannel | undefined) => {
  const i = c ? CHANNEL_ORDER.indexOf(c) : -1;
  return i === -1 ? CHANNEL_ORDER.length : i;
};

/** 全量片单：按 横屏 → AI → 竖屏 稳定排序（同频道保持数据里的先后） */
export function orderedWorks(): MediaWork[] {
  return [...MEDIA_WORKS].sort((a, b) => channelRank(a.channel) - channelRank(b.channel));
}

/** 从某台设备（频道）进入时，初始应该定位到的下标 */
export function startIndexFor(channel?: MediaChannel): number {
  const list = orderedWorks();
  if (!channel) return 0;
  const exact = list.findIndex((w) => w.channel === channel);
  if (exact !== -1) return exact;
  // 该频道还没有片子 → 落在它语义上的插入点（前面频道全走完的位置）
  const rank = channelRank(channel);
  return list.filter((w) => channelRank(w.channel) < rank).length;
}

/** 页面标题 / 副标（列表页顶部大字） */
export const MEDIA_PAGE_COPY = {
  /** 主标题 */
  title: 'Videos & Music',
  /** 背景大字（没有频道时的兜底；有频道走 CHANNEL_WORD）。
      必须短 —— 21vw 的字号下，超过 8 个字符就会被视口两边切掉半个字，很脏。 */
  word: 'videos',
  /** 副标 / 说明，留空则不显示 */
  subtitle: '',
  /** 空列表时的占位文案 */
  empty: '内容整理中 —— 这里是视频与音乐作品。',
};
