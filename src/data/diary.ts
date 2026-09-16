/**
 * 实习日记（2026-09-16）—— 工作室笔记本物件的翻页本内容。
 *
 * 结构：封面（组件内画）+ 五篇日记（按时间倒序，最新在最前）。
 * 交互是「翻页」（绕左书脊 rotateY），所以一篇日记 = 一页，不做长滚动。
 *
 * 字体分工（改文案前必读）：
 *  · `title / org / role / date / chips` 走 NanoOldSongA（display 宋体）
 *    —— ⚠️ 这些字段的中文字必须收进子集：scripts/subset-nanooldsong.py
 *    已经按字段名收集本文件，**新增字段名要记得去脚本里补 pattern 并重跑**。
 *  · `titleEn` / 页码 / 进度胶囊走 Caveat（手写英文）。
 *  · `body` 正文走站点正文字体（Noto Sans SC），不进子集。
 *
 * 配图占位：全部复用站内已有图（works 策划案内页 / media 视频封面），
 * 作者之后直接换 `src` 即可，尺寸不限（拍立得框会按 4/5 裁）。
 */

export type DiaryPhoto = {
  src: string;
  /** 拍立得下方的手写小字（Caveat），可空 */
  caption?: string;
  /** 照片微旋转（deg），不传就按序号取默认摆动 */
  rot?: number;
};

export type DiaryEntry = {
  id: string;
  /** 纸带标签上的时间（NanoOldSongA），例：'26.01 – 04' */
  date: string;
  /** 纸带标签上的公司（NanoOldSongA） */
  org: string;
  /** 岗位 chip（NanoOldSongA） */
  role: string;
  /** 手写编号标题（NanoOldSongA，短句） */
  title: string;
  /** 标题下的英文手写注（Caveat） */
  titleEn: string;
  /** 正文段落（正文字体，一页 2~3 段） */
  body: string[];
  photos: DiaryPhoto[];
  /** 纸片 chips（NanoOldSongA） */
  chips: string[];
  /** 涂鸦款式，页面按它摆一支手绘 scribble */
  doodle: 'black' | 'blue' | 'yellow' | 'loop';
  /** 进行中：本篇用虚线「待续」样式（仿参考站没收集完的 note） */
  current?: boolean;
};

export const DIARY_ENTRIES: DiaryEntry[] = [
  {
    id: 'ksi-hk',
    date: '2026 · 进行中',
    org: 'KSI 翼氪计划',
    role: '视频与内容',
    title: '在香港的第三个月',
    titleEn: 'To be continued…',
    body: [
      '这一页先留一半。翼氪计划的四条片子刚剪完，从三里屯到七夕节，每一条都在学着把「品牌想说的话」翻译成「用户想看的内容」。',
      '香港的节奏很快，快到来不及写长日记。等这一站结束，回来把这里补满。',
    ],
    photos: [
      { src: '/media/yike-1020.jpg', caption: 'on air', rot: -2.4 },
      { src: '/media/sanlitun.jpg', caption: 'sanlitun', rot: 1.8 },
    ],
    chips: ['短视频全链路', '多平台运维'],
    doodle: 'yellow',
    current: true,
  },
  {
    id: 'xinbai',
    date: '26.01 – 04',
    org: '北京新白文化',
    role: '市场部',
    title: '矩阵账号的日常',
    titleEn: 'Daily posting, daily learning',
    body: [
      '在新白文化的四个月，每天睁开眼第一件事是看后台数据。矩阵账号像一群性格不同的孩子：有的吃内容、有的吃投放、有的只吃热点。',
      '学会了三件事：达人对接要提前留缓冲、投放分析要看趋势不要看单点、AI 提效是给流程减负而不是替你思考。',
    ],
    photos: [
      { src: '/works/kuaike/p03-insight-w640.jpg', caption: 'insight', rot: 2.2 },
      { src: '/works/kuaike/p02-brief-w640.jpg', caption: 'brief', rot: -1.6 },
    ],
    chips: ['矩阵账号', '投放分析', '达人对接'],
    doodle: 'black',
  },
  {
    id: 'hanghanghang',
    date: '25.07 – 08',
    org: '北京行行行广告',
    role: '整合营销',
    title: '亿级曝光是怎么炼成的',
    titleEn: 'Make it loud, make it right',
    body: [
      '服务快手和神州租车的那两个月，第一次离「亿级曝光」这么近。方案改到第十一版才明白：大客户的 brief 里每个字都有预算。',
      '整合营销就是把一颗火花铺成一片草原——线上话题、线下物料、达人矩阵，缺一角都会漏气。',
    ],
    photos: [
      { src: '/works/shenzhou/p01-cover-w640.jpg', caption: 'campaign', rot: -2.0 },
      { src: '/works/shenzhou/p17-challenge-w640.jpg', caption: 'challenge', rot: 2.6 },
    ],
    chips: ['整合营销', '快手', '神州租车'],
    doodle: 'blue',
  },
  {
    id: 'kexing',
    date: '24.07 – 09',
    org: '北京氪星创服',
    role: '品牌市场部',
    title: '第一次把项目送上热搜',
    titleEn: 'My first trending topic',
    body: [
      '氪星的夏天属于大型项目传播：排期表贴满墙，物料组凌晨还在对版本。短视频和多平台运维听上去琐碎，拼起来才是传播的全貌。',
      '热搜掉下来的那一刻，整个办公室安静了半秒，然后所有人都在笑。那个半秒我记到现在。',
    ],
    photos: [
      { src: '/works/chiwei/p01-cover-w640.jpg', caption: 'kick-off', rot: 1.9 },
      { src: '/works/chiwei/p10-roadmap-w640.jpg', caption: 'roadmap', rot: -2.2 },
    ],
    chips: ['短视频', '大型项目传播'],
    doodle: 'loop',
  },
  {
    id: 'eden',
    date: '23.07 – 09',
    org: '天津伊甸园',
    role: '新媒体运营',
    title: '从零开始的新媒体',
    titleEn: 'Where it all began',
    body: [
      '第一段实习，在天津。一个人包下账号的选题、文案、拍摄和剪辑， cutoff 前夜在工位上逐帧调字幕。',
      '那时候什么都不会，什么都敢试。回头看，日记本的第一页就是在这里写下的。',
    ],
    photos: [
      { src: '/works/guanxia/p02-preface-w640.jpg', caption: 'day one', rot: -2.6 },
      { src: '/works/guanxia/p03-overview-w640.jpg', caption: 'overview', rot: 1.5 },
    ],
    chips: ['短视频', '文案'],
    doodle: 'black',
  },
];

/** 封面副题（Caveat 手写英文） */
export const DIARY_COVER_EN = 'Internship Diary';
