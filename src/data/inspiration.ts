/**
 * 「灵感收藏」的内容数据层。
 *
 * ⚠️ 现在填的都是**占位素材**：图片一律复用站点已有的房间帧 / 海报 / 图案，
 *    文案是示例条目，目的是先把版式跑起来、能看清卡片流的效果。
 *    换真实内容时只改这里的字段，组件与样式一行都不用动。
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
  /** 歌手，来自 ID3 的 TPE1 */
  artist?: string;
  /** 曲风标签，会挤在一行里 */
  genre: string[];
  /**
   * 音频地址。**留空则播放键驱动「模拟时间轴」**（唱片转起来 + 进度条走动，
   * 进度条也能拖动），把 mp3 路径填进来就是真播放，同一时刻只会有一首在响。
   */
  src?: string;
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
  { id: 'v1', src: '/frames/0001.jpg', title: '开场：走廊尽头的光', code: 'IMG_01', ratio: '4/5' },
  { id: 'v2', src: '/frames/0026.jpg', title: '窗棂与灰尘', code: 'IMG_02', ratio: '3/2' },
  { id: 'v3', src: '/frames/0051.jpg', title: '旧沙发的绿色', code: 'IMG_03', ratio: '1/1' },
  { id: 'v4', src: '/frames/0076.jpg', title: '磁带机特写', code: 'IMG_04', ratio: '4/5' },
  { id: 'v5', src: '/frames/0101.jpg', title: '夜里的显示器', code: 'IMG_05', ratio: '2/3' },
  { id: 'v6', src: '/frames/0120.jpg', title: '收尾：门口回头', code: 'IMG_06', ratio: '3/2' },
  { id: 'v7', src: '/about/banner-visual.jpeg', title: '横版视觉草稿', code: 'IMG_07', ratio: '3/2' },
  { id: 'v8', src: '/about/bg-pattern.webp', title: '底纹图案取样', code: 'IMG_08', ratio: '1/1' },
];

/* ------------------------------------------------------------------ */
/* 音乐 Music                                                          */
/* ------------------------------------------------------------------ */

export const MUSIC: MusicItem[] = [
  {
    id: 'm1',
    cover: '/studio/studio-poster.jpg',
    title: 'Room Loop',
    artist: 'sunchenxi',
    genre: ['#Ambient', '#Dreamcore'],
  },
  {
    id: 'm2',
    // 注意：封面会被裁进 4:3 的框里，超宽图（比如 5067×753 的 banner）进来只会剩一条，
    // 看着像"图裂了"。所以 demo 数据统一用普通比例的图；四张也刻意错开，避免撞图。
    cover: '/about/avatar.webp',
    title: 'Mint Static',
    artist: 'mint tape club',
    genre: ['#Lo-fi', '#City Pop'],
  },
  {
    id: 'm3',
    // bg-pattern 是极浅的薄荷点阵，裁进封面框里几乎全白，看着像图裂 —— 换成有内容的帧
    cover: '/frames/0119.jpg',
    title: 'Green Noise',
    artist: 'greenroom',
    genre: ['#Vaporwave'],
  },
  {
    id: 'm4',
    cover: '/frames/0038.jpg',
    title: 'Late Tape',
    artist: 'tape ghost',
    genre: ['#Bedroom Pop', '#Synth'],
  },
];

/* ------------------------------------------------------------------ */
/* AI 项目 Projects                                                    */
/* ------------------------------------------------------------------ */

export const PROJECTS: ProjectItem[] = [
  {
    id: 'p1',
    cover: '/about/banner-visual.jpeg',
    name: '个人作品集站点',
    tags: ['#React', '#Three.js', '#R3F'],
    link: 'https://37b3c69eaeb24342bd25c282ad856c2d.app.workbuddy.link',
  },
  {
    id: 'p2',
    cover: '/frames/0064.jpg',
    name: '情绪板生成器',
    tags: ['#LLM', '#Canvas'],
  },
  {
    id: 'p3',
    cover: '/frames/0089.jpg',
    name: '社群梗图工坊',
    tags: ['#Vision', '#UGC'],
  },
  {
    id: 'p4',
    cover: '/frames/0051.jpg',
    name: '像素排版实验',
    tags: ['#CSS', '#PixelFont'],
  },
];

/* ------------------------------------------------------------------ */
/* AI 技能 Skills                                                      */
/* ------------------------------------------------------------------ */

export const SKILLS: SkillItem[] = [
  { id: 's1', icon: '🎨', name: 'Figma', desc: '界面与组件稿设计，做可交互原型', link: 'https://figma.com' },
  { id: 's2', icon: '🖌️', name: 'Photoshop', desc: '修图 / 合成 / 视觉氛围调色', link: 'https://adobe.com/products/photoshop' },
  { id: 's3', icon: '🎬', name: 'Premiere', desc: '视频剪辑与节奏卡点', link: 'https://adobe.com/products/premiere' },
  { id: 's4', icon: '🌀', name: 'Midjourney', desc: '文生图，出概念场景与情绪板', link: 'https://midjourney.com' },
  { id: 's5', icon: '🧪', name: 'Stable Diffusion', desc: '本地图生图 / 控制网，精修风格', link: 'https://stability.ai' },
  { id: 's6', icon: '🤖', name: 'ChatGPT', desc: '文案、脚本、代码与头脑风暴', link: 'https://chatgpt.com' },
  { id: 's7', icon: '🪄', name: 'Claude', desc: '长文写作、代码重构与审查', link: 'https://claude.ai' },
  { id: 's8', icon: '🎞️', name: 'Runway', desc: '图生视频 / 视频风格化特效', link: 'https://runwayml.com' },
  { id: 's9', icon: '🖼️', name: 'Canva', desc: '快速排版海报与社媒图', link: 'https://canva.com' },
  { id: 's10', icon: '📝', name: 'Notion', desc: '项目文档、素材库与进度看板', link: 'https://notion.so' },
  { id: 's11', icon: '✂️', name: '剪映', desc: '短视频剪辑、字幕与配乐', link: 'https://capcut.cn' },
  { id: 's12', icon: '🎧', name: 'Audition', desc: '音频降噪、混音与音效处理', link: 'https://adobe.com/products/audition' },
];

/* ------------------------------------------------------------------ */
/* 案例收集癖 Cases（别人的策划活动 / TVC，点击跳转）                    */
/* ------------------------------------------------------------------ */

export const CASES: LinkItem[] = [
  {
    id: 'c1',
    title: 'Brand TVC · 城市夜行',
    cover: '/frames/0001.jpg',
    link: 'https://www.adsoftheworld.com/',
    tags: ['#TVC', '#品牌'],
  },
  {
    id: 'c2',
    title: '线下快闪 · 绿色市集',
    cover: '/frames/0026.jpg',
    link: 'https://www.behance.net/',
    tags: ['#策划', '#活动'],
  },
  {
    id: 'c3',
    title: '互动装置 · 回声墙',
    cover: '/frames/0076.jpg',
    link: 'https://www.digitaling.com/',
    tags: ['#装置', '#交互'],
  },
  {
    id: 'c4',
    title: '社媒 Campaign · 一块绿',
    cover: '/about/banner-visual.jpeg',
    link: 'https://www.socialbeta.com/',
    tags: ['#Campaign'],
  },
];

/* ------------------------------------------------------------------ */
/* 知识疯狂输入 Knowledge（文章，点击跳转）                             */
/* ------------------------------------------------------------------ */

export const KNOWLEDGE: LinkItem[] = [
  {
    id: 'k1',
    title: '写给设计师的动效十二原则',
    cover: '/about/bg-pattern.webp',
    link: 'https://www.interaction-design.org/',
    tags: ['#动效'],
  },
  {
    id: 'k2',
    title: 'Retro Web 与个人主页复兴',
    cover: '/frames/0038.jpg',
    link: 'https://neocities.org/',
    tags: ['#Web'],
  },
  {
    id: 'k3',
    title: '从 0 搭一条 AI 工作流',
    cover: '/frames/0101.jpg',
    link: 'https://www.notion.so/',
    tags: ['#AI'],
  },
  {
    id: 'k4',
    title: '排版里的呼吸感：留白讲稿',
    cover: '/about/banner-sticker.png',
    link: 'https://www.smashingmagazine.com/',
    tags: ['#排版'],
  },
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
