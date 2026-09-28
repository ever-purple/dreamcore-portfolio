/**
 * 「灵感收藏」的内容数据层。
 *
 * ⚠️ 下面六个数组是**种子（兜底）数据**，现在已经清空 —— 全是占位素材时看着像"做完了"，
 *    其实是假的，不如空着。真实内容请在**网站上用作者模式录入**：
 *    `npm run dev` → About Me → 灵感收藏，改完会写进 `public/insp/data.json`
 *    （刷新 / 换浏览器 / 重新构建部署都带着走，见 src/lib/contentApi.ts）。
 *
 *    想直接写代码也行：往这些数组里填即可，字段形状见下面的类型定义；
 *    但注意 `public/insp/data.json` 存在时会**整份覆盖**这里的内容。
 *
 * 图片路径沿用站点既有约定（绝对路径，与 /about/、/studio/ 一致）。
 */

/** 视觉收藏：一张图 = 一张卡 */
export type VisionItem = {
  id: string;
  src: string;
  /** 悬停 / 大图预览时显示的名字 */
  title: string;
  /** 卡片右上角的像素角标 */
  code: string;
  /**
   * 卡片高度比例。瀑布流靠它错落，改这里就能调整节奏。
   * 建议取值 4/5、1/1、3/2、2/3。
   */
  ratio: string;
  /** 有原链接时，大图预览底部会多一个「打开原链接」 */
  link?: string;
};

/** 音乐收藏：复古唱片卡 */
export type MusicItem = {
  id: string;
  /** 专辑封面。允许为空串 —— 上传歌曲时标签里可能没有内嵌图，卡片会渲染占位 */
  cover: string;
  title: string;
  /** 歌手，来自 ID3 的 TPE1 / 平台接口 */
  artist?: string;
  /** 曲风标签，会挤在一行里 */
  genre: string[];
  /**
   * 音频地址。**留空则播放键驱动「模拟时间轴」**（唱片转起来 + 进度条走动，
   * 进度条也能拖动），把 mp3 路径填进来就是真播放，同一时刻只会有一首在响。
   */
  src?: string;

  /* ---- 下面几个是「分享音乐链接」用的 ---- */

  /**
   * 音源类型。
   * · `local` —— 上传到本站的音频文件（src 是站内路径 / idb 引用），能读到真实进度；
   * · `link`  —— 只存平台链接，不落音频文件（版权与体积都更安全），
   *              播放交给平台自己的外链播放器，VIP / 付费歌曲按平台规则只放试听部分。
   * 不填时按 src 有没有值推断。
   */
  source?: 'local' | 'link';
  /** 平台标识：netease / qqmusic / spotify / apple / bilibili */
  platform?: string;
  /** 平台外链播放器地址（iframe）。有它就走平台播放器，不下载任何音频 */
  embed?: string;
  /** 原平台页面地址，卡片与 jukebox 上的「↗ 原链接」跳它 */
  link?: string;
  /** 平台侧的歌曲 id（备用，换封面/换播放器时用得上） */
  songId?: string;
};

/** AI 项目：复古软盘 / 芯片卡 */
export type ProjectItem = {
  id: string;
  cover: string;
  name: string;
  /** 一行简短 Tag，如 ['#LLM', '#Canvas']，超出会省略 */
  tags: string[];
  /** [ 查看 ] 的跳转地址；留空则按钮呈禁用态 */
  link?: string;
  /** 一句话简介（GitHub 仓库自动取 description） */
  desc?: string;
  /** 来源：`github` = 由仓库链接识别出来的；`manual` = 手填 */
  source?: 'github' | 'manual';
  /** GitHub star 数，识别出来才显示 */
  stars?: number;
};

/** AI 技能：技能卡（图标 + 名称 + 功能描述 + 链接） */
export type SkillItem = {
  id: string;
  icon: string;
  name: string;
  /** 这个 skill 能干什么，一句话描述 */
  desc?: string;
  /** 官网 / 说明文档地址，点击卡片跳转 */
  link?: string;
};

/** 链接卡片：案例（策划活动 / TVC）与知识（文章）共用 */
export type LinkItem = {
  id: string;
  title: string;
  /** 封面图。作者粘贴链接时自动识别（mock），也可之后替换 */
  cover: string;
  /** 点击卡片跳转的地址 */
  link: string;
  /** 可选的角标标签，如 ['#TVC', '#策划'] */
  tags?: string[];
};

/* ------------------------------------------------------------------ */
/* 视觉 Vision                                                         */
/* ------------------------------------------------------------------ */

export const VISION: VisionItem[] = [
  // { id: 'v1', src: '/frames-sm/0001.webp', title: '图片标题', code: 'IMG_01', ratio: '4/5' },
];

/* ------------------------------------------------------------------ */
/* 音乐 Music                                                          */
/* ------------------------------------------------------------------ */

/**
 * 分享音乐链接的条目长这样（不落音频文件，见 MusicItem.source 的注释）：
 *   { id:'m1', cover:'<平台给的封面>', title:'歌名', artist:'歌手',
 *     genre:['#Ambient'], source:'link', platform:'netease',
 *     embed:'https://music.163.com/outchain/player?type=2&id=<id>&auto=0&height=66',
 *     link:'https://music.163.com/#/song?id=<id>' }
 */
export const MUSIC: MusicItem[] = [
  // 留空：在网站上用「粘贴音乐链接」录入，自动认歌名 / 歌手 / 封面
];

/* ------------------------------------------------------------------ */
/* AI 实验室 —— 单一列表                                               */
/* 不再分「项目 / 技能」两类，AI实验室页签下就是一个列表，               */
/* 按加入时间从新到旧排（见 AboutInspiration.tsx 的 byNewest）。         */
/* ------------------------------------------------------------------ */

export const PROJECTS: ProjectItem[] = [
  // { id: 'p1', cover: '<封面>', name: '项目名', desc: '一句话简介', tags: ['#LLM'], link: 'https://github.com/owner/repo', stars: 123 },
];

/* ------------------------------------------------------------------ */
/* AI 技能 Skills                                                      */
/* ------------------------------------------------------------------ */

export const SKILLS: SkillItem[] = [
  // { id: 's1', icon: '🎨', name: 'Figma', desc: '一句话描述这个 skill 能干什么', link: 'https://figma.com' },
];

/* ------------------------------------------------------------------ */
/* 案例收集癖 Cases（别人的策划活动 / TVC，点击跳转）                    */
/* ------------------------------------------------------------------ */

export const CASES: LinkItem[] = [
  // { id: 'c1', title: '标题', cover: '<封面>', link: 'https://…', tags: ['#TVC', '#品牌'] },
];

/* ------------------------------------------------------------------ */
/* 知识疯狂输入 Knowledge（文章，点击跳转）                             */
/* ------------------------------------------------------------------ */

export const KNOWLEDGE: LinkItem[] = [
  // { id: 'k1', title: '文章标题', cover: '<封面>', link: 'https://…', tags: ['#动效'] },
];

/* ------------------------------------------------------------------ */
/* MOCK —— 这就是「云端数据」的本地替身。                               */
/* 六张表整合成一个对象，方便以后整体 fetch / PATCH；增删改只动内存里的   */
/* 这份副本（见 src/lib/contentApi.ts），不碰源数组。                   */
/* ------------------------------------------------------------------ */

export const MOCK = {
  vision: VISION,
  music: MUSIC,
  projects: PROJECTS,
  skills: SKILLS,
  cases: CASES,
  knowledge: KNOWLEDGE,
} as const;
