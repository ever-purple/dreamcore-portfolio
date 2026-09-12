/**
 * 策划案（挂在木马上的那些相框）—— 单一数据源。
 *
 * 木马上的 6 个槽位既是"展示位"也是"提交位"：
 * · `WORKS` 是初始种子内容（前几条复用灵感收藏里的真实案例）；
 * · 用户点空槽位提交的项目存在 IndexedDB，打开时覆盖种子内容。
 *
 * 展示模式：淘汰笨重完整 PDF 查看器，改用「精简高光图 + 结构化文案」。
 * 每个项目用一组自由结构的 sections（背景 / 洞察策略 / 执行 / 物料 / 角色 / 亮点…），
 * 不同项目可以用不同的结构。
 */

/** 一个吊点挂几个相框：single = 1 个，double = 2 个（上下叠挂）。 */
export type HangSlot = 'single' | 'double';

/**
 * 木马吊点排布 —— 改这一行就能改容量，不用动 3D 代码。
 * 现在是「单-双-单-双」= 4 个吊点 / 6 个相框。
 */
export const HANG_PATTERN: HangSlot[] = ['single', 'double', 'single', 'double'];

/** 相框总数（由 HANG_PATTERN 推导，不要手改）。 */
export const FRAME_COUNT = HANG_PATTERN.reduce(
  (n, slot) => n + (slot === 'double' ? 2 : 1),
  0,
);

/** 一段结构化文案：标题 + 正文（正文用 \n\n 分段）。 */
export type ProjectSection = {
  key: string;
  heading: string;
  body: string;
};

export type PlanCase = {
  id: string;
  /** 档案编号，详情面板与相框上显示，如 PLAN_01 */
  code: string;
  title: string;
  /** 项目角色，如「策划 / 内容 / 视觉叙事」 */
  role?: string;
  client?: string;
  year?: string;
  /** 高光图；null = 空相框（画"待提交"占位卡） */
  cover: string | null;
  /** 可选完整 PDF（asset 路径或 blob:），仅作「下载完整 PDF」用，不再内嵌查看器 */
  pdf?: string | null;
  /** 高光图取 PDF 的第几页（默认 1） */
  highlightPage?: number;
  /** 一句话摘要；空字符串 = 待补充 */
  summary: string;
  tags?: string[];
  /** 结构化展示文案；不同项目可用不同结构 */
  sections?: ProjectSection[];
  /** 可选外链（如已公开发布） */
  link?: string;
};

/**
 * 6 个槽位的初始内容。
 * PLAN_01 是完整样板（新国潮香氛品牌「观夏」夏季营销「隙月」），其余复用灵感收藏里的真实案例。
 */
export const WORKS: PlanCase[] = [
  {
    id: 'w1',
    code: 'PLAN_01',
    title: '新国潮香氛「观夏」· 夏季营销「隙月」',
    role: '策略 / 内容 / 视觉叙事 统筹',
    client: '观夏 To Summer',
    year: '2026',
    cover: null,
    // 高光图取 deck 封面页；完整 PDF 仅作下载
    pdf: `${import.meta.env.BASE_URL}works/guanxia-summer.pdf`,
    highlightPage: 1,
    summary:
      '把苏州园林「月洞门」转译为「不破不立」的当代情绪哲学，用 SIPS 模型重构观夏夏季品销体系。',
    tags: ['#整合营销', '#香氛', '#情绪价值', '#国潮'],
    sections: [
      {
        key: 'background',
        heading: '项目背景',
        body:
          '观夏作为东方美学香氛代表，夏季限定长期陷在同质化与「低性价比」争议里：渠道单一（以公众号为主）、对 Z 世代的毕业焦虑与都市压力回应不足、缺乏破圈。\n\n本策划以夏季限定产品为对象，用「隙月」主题重构一套从文化符号到情绪价值的品销体系。',
      },
      {
        key: 'insight',
        heading: '核心洞察 / 策略',
        body:
          'Z 世代「理性悦己」：79.43% 认为香水首要作用是愉悦自己，77.85% 相信香气能情绪疗愈。\n\n以日本电通 SIPS 模型（共鸣—确认—参与—分享扩散）为骨架，把「月洞门」转译为「拥抱不完美」的哲学，拆成「寻隙—破隙—归真」三段式情绪叙事，覆盖预热、爆发、长尾三期。',
      },
      {
        key: 'execution',
        heading: '项目执行',
        body:
          '预热·寻隙（6.25–7.5）：话题 #我们的奥德赛时期、三行寻隙诗征集、「心事寄存处」线下快闪。\n\n爆发·破隙（7.6–7.20）：苏州拙政园「隙月围谈」沙龙、播客《青年日记》、观夏 × 阿那亚联名主题套房。\n\n长尾·归真（7.21–8.25）：上海观夏闲庭东方美学艺术展（四展区）、观夏 × naze naze「织月闻香」非遗联名。',
      },
      {
        key: 'deliverables',
        heading: '项目物料 / 产出',
        body:
          '三款核心产品（未寄信 / 刺 / 至简之水）、《隙月》电子诗集与《Nosepaper·隙月特辑》、四展区沉浸艺术展、H5「映月鉴」、纪录片短片《织月》、naze naze 联名礼盒。',
      },
      {
        key: 'role',
        heading: '项目角色',
        body:
          '从市场与问卷调研（N=316）出发做受众与产品情绪价值重构，独立完成 SIPS 全链路活动策划、跨界与在地文化资源对接。',
      },
      {
        key: 'outcome',
        heading: '活动亮点 / 成果',
        body:
          '目标：品牌声量 +20%、夏季销量 +25%、Z 世代占比 40%+。\n\n非遗活化：与 naze naze 联名，每售一件捐 50 元织女培训基金，把消费变成青年情绪关怀与非遗传承。',
      },
    ],
    link: 'https://www.tosummer.com/',
  },
  {
    id: 'w2',
    code: 'PLAN_02',
    title: 'Brand TVC · 城市夜行',
    cover: '/frames/0001.jpg',
    summary: '一支把城市夜色拍成流动香气的品牌片。',
    tags: ['#TVC', '#品牌'],
    link: 'https://www.adsoftheworld.com/',
    sections: [
      {
        key: 'highlight',
        heading: '项目亮点',
        body: '以夜行者的视角串联品牌五感，用光影代替台词，把「香气」翻译成可观看的都市夜景。',
      },
    ],
  },
  {
    id: 'w3',
    code: 'PLAN_03',
    title: '线下快闪 · 绿色市集',
    cover: '/frames/0026.jpg',
    summary: '把品牌主张搬进周末市集的沉浸式快闪。',
    tags: ['#策划', '#活动'],
    link: 'https://www.behance.net/',
    sections: [
      {
        key: 'highlight',
        heading: '项目亮点',
        body: '用可触摸、可带走的物料把「可持续」做成一次具体的周末体验，而不是一句口号。',
      },
    ],
  },
  {
    id: 'w4',
    code: 'PLAN_04',
    title: '互动装置 · 回声墙',
    cover: '/about/banner-visual.jpeg',
    summary: '一面会回应你的声音的装置。',
    tags: ['#装置', '#交互'],
    link: 'https://www.digitaling.com/',
    sections: [
      {
        key: 'highlight',
        heading: '项目亮点',
        body: '观众的声音被实时转译成视觉与香气，让「回声」成为可收藏的记忆。',
      },
    ],
  },
  {
    id: 'w5',
    code: 'PLAN_05',
    title: '待提交项目',
    cover: null,
    summary: '',
  },
  {
    id: 'w6',
    code: 'PLAN_06',
    title: '待提交项目',
    cover: null,
    summary: '',
  },
];

/** 运行时状态：种子内容 + 本机提交内容合并后的结果。 */
export type ProjectState = {
  slot: number;
  code: string;
  title: string;
  role?: string;
  client?: string;
  year?: string;
  summary: string;
  /** 空格分隔，如 "#TVC #品牌" */
  tags: string;
  /** 高光图地址（种子是站内路径 / data:，提交的是 blob: 地址） */
  cover: string | null;
  /** 完整 PDF 地址（asset / blob），仅下载用 */
  pdf: string | null;
  pdfName: string;
  /** 高光图取 PDF 的第几页（默认 1） */
  highlightPage?: number;
  /** 结构化展示文案 */
  sections: ProjectSection[];
  link?: string;
  /** 已提交过内容 */
  filled: boolean;
};

export function seedProjects(): ProjectState[] {
  return WORKS.slice(0, FRAME_COUNT).map((w, i) => ({
    slot: i,
    code: w.code,
    title: w.title,
    role: w.role,
    client: w.client,
    year: w.year,
    summary: w.summary,
    tags: (w.tags ?? []).join(' '),
    cover: w.cover,
    pdf: w.pdf ?? null,
    pdfName: '',
    highlightPage: w.highlightPage,
    sections: w.sections ?? [],
    link: w.link,
    filled: Boolean(w.cover || w.summary || (w.sections?.length ?? 0) || w.pdf),
  }));
}
