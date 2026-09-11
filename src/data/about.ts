export type AboutNavItem = {
  id: string;
  /** 中文名（导航主文案） */
  label: string;
  /** 英文小注 */
  en: string;
};

/**
 * About 页左侧导航 —— 单一数据源。
 * 右侧内容区尚未开始，点击仅切换高亮状态；后续接内容时按 id 挂载。
 */
export const aboutNav: AboutNavItem[] = [
  { id: 'intro', label: '自我介绍', en: 'introduction' },
  { id: 'vision', label: '职业愿景', en: 'career vision' },
  { id: 'inspiration', label: '灵感收藏', en: 'inspiration' },
  { id: 'guestbook', label: '留言板', en: 'guestbook' },
];
