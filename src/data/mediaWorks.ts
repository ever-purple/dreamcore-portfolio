/**
 * 报刊亭「第一排」—— 顶层三件设备（DVD 机 / DV 机 / MP3）对应的作品集。
 *
 * 规则（2026-09-15 定稿）：
 *   · 点第一排任意一件设备都进**同一个列表页**，不是每台设备一个页面。
 *   · 页面形态参考 mattjinn.com/videos/ —— 全屏视频播放 + 点击展开播放器。
 *   · 类别是「视频 / 音乐」两类：视频走全屏播放，音乐走音频播放。
 *
 * 现在只搭框架，内容是空的 —— 之后往 `MEDIA_WORKS` 里填条目即可。
 */

/** 片单频道 —— 对应报刊亭第一排的三件设备（2026-09-15 用户规划） */
export type MediaChannel = 'landscape' | 'ai' | 'portrait';

/**
 * 设备序号 → 频道。报刊亭第一排点第 1/2/3 件设备，分别进这三个片单：
 *   0 DVD 机 → 横屏映像　1 DV 机 → AI 影像　2 MP3 → 竖屏短片
 * 三条频道共用同一个列表页组件，只是过滤条件不同。
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
  /**
   * 封面预览视频（循环、静音、自动播放）—— mattjinn 的做法：
   * 列表里每张卡片本身就是一段静音循环视频，悬停/进入视口即播。
   * 留空则只显示 poster 图。
   */
  coverVideo?: string;
  /** 封面静态图（coverVideo 加载前 / 不支持时兜底） */
  poster?: string;
  /** 点击后播放的完整视频（有声音） */
  video?: string;
  /** 音乐作品：音频文件地址 */
  audio?: string;
  /** 一句话简介，列表中显示在标题下 */
  blurb?: string;
  /** 制作名单（mattjinn 的 Credits 区），形如 [{ role, name }] */
  credits?: { role: string; name: string }[];
};

/**
 * 作品列表 —— KSI 实习项目的四条片子（2026-09-15 填入）。
 *
 * 素材已压好在 `public/media/`，每条三个文件：
 *   `<slug>.mp4`          完整版（1080 长边 / CRF 26 / 带音频）
 *   `<slug>-preview.mp4`  列表预览（540 长边 / CRF 32 / **无音轨**，静音循环用）
 *   `<slug>.jpg`          封面图
 * 生成脚本：`scripts/media-compress.py`（换片子时改里面的 JOBS 列表再跑一遍）。
 *
 * ⚠️ 原始素材是 HEVC + 共 333MB，压完只有 29MB；**别把原片拷进 public/**。
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
    coverVideo: `${M}qixi-preview.mp4`,
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
    coverVideo: `${M}yike-1020-preview.mp4`,
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
    coverVideo: `${M}yike-0814-preview.mp4`,
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
    coverVideo: `${M}sanlitun-preview.mp4`,
    poster: `${M}sanlitun.jpg`,
    video: `${M}sanlitun.mp4`,
  },
];

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
