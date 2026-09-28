/**
 * 联系方式 —— 全站唯一数据源。
 *
 * StudioContactPanel（工作室底部联系方式面板）从这里读。
 * 以后要改邮箱 / 补社交账号链接，只改这一个文件，别再去翻组件。
 *
 * ⚠️ 待填项（上线前补，填好即生效，不用改任何代码逻辑）：
 *   · socials[].url —— 现在都是空串。空串时那一项**不渲染成链接**，
 *     只显示名字（和现在一样）；填了 URL 就自动变成可点击的外链。
 */

export type SocialLink = {
  /** 显示名（联系方式面板 Follow 那一栏的大字） */
  label: string;
  /** 主页地址。空串 = 还没填 → 只显示名字，不渲染成链接 */
  url: string;
};

export const CONTACT = {
  /** Contacts 那一栏：联系邮箱 */
  email: '1952200284@qq.com',

  /** Follow 那一栏：社交账号。想加平台就往数组里加一条 */
  socials: [
    { label: '小红书', url: '' }, // TODO(用户): 填小红书主页链接，如 https://www.xiaohongshu.com/user/profile/xxxx
    { label: '抖音', url: '' }, // TODO(用户): 填抖音主页链接
  ] satisfies SocialLink[],
};

/** 简历文件路径。PDF 用原文件名放在 public/ 下（public/孙晨茜简历-市场营销策划岗.pdf），
 *  下载时也保留这个原名，不再强制改名成 resume.pdf */
export const RESUME_URL = '/孙晨茜简历-市场营销策划岗.pdf';
/** 下载时给浏览器看的文件名（与文件原名保持一致） */
export const RESUME_FILENAME = '孙晨茜简历-市场营销策划岗.pdf';
