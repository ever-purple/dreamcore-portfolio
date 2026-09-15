/**
 * 报刊亭「第二排」—— 下层三本书对应的作品集：文案 + AI 项目。
 *
 * 规则（2026-09-15 定稿）：
 *   · 点第二排任意一本书也进**同一个列表页**。
 *   · 形态是**文字卡片列表**（不是视频播放）—— 用户明确：文案/AI 项目不用
 *     mattjinn 的视频播放器，改成卡片列表（标题 + 简介 + 标签）。
 *
 * 现在只搭框架，内容是空的 —— 之后往 `COPY_PROJECTS` 里填条目即可。
 */

/** 一个文案 / AI 项目 */
export type CopyProject = {
  /** 稳定 id，用于 React key */
  id: string;
  /** 项目名 */
  title: string;
  /** 类别：文案 / AI 项目 */
  category: 'copy' | 'ai';
  /** 一句话简介 */
  blurb: string;
  /** 年份，如 '2025' */
  year?: string;
  /** 标签，如 ['#品牌文案', '#小红书'] */
  tags?: string[];
  /** 封面图（可选；没有则显示纯文字卡片） */
  cover?: string;
  /** 详情外链（可选，如站外作品链接） */
  link?: string;
};

/**
 * 项目列表。**当前为空** —— 先跑通框架，内容由用户后续填。
 */
export const COPY_PROJECTS: CopyProject[] = [
  // 例：
  // {
  //   id: 'sample',
  //   title: '示例项目',
  //   category: 'copy',
  //   blurb: '一句话简介',
  //   year: '2025',
  //   tags: ['#文案'],
  // },
];

/** 页面标题 / 副标 */
export const COPY_PAGE_COPY = {
  title: 'COPYWRITING & AI',
  subtitle: '',
  empty: '内容整理中 —— 这里是文案与 AI 项目。',
};

/** 分类筛选器的选项（列表为空时也展示框架） */
export const COPY_FILTERS: { key: 'all' | 'copy' | 'ai'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'copy', label: '文案' },
  { key: 'ai', label: 'AI 项目' },
];
