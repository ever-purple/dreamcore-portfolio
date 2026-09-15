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

import { WORK_OVERRIDES, type WorkOverride } from './works.local';

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
    // 封面：deck 的 P1，用 pymupdf 按 4 倍导出成 2880×2160 的实体图。
    // 原先 cover 为 null，靠 pdf-cover.ts 现场渲染 —— 那边只渲 440×520，
    // 拉到详情页首屏（约 1065×792 CSS）自然糊。有了实体图就不再走现场渲染。
    cover: `${import.meta.env.BASE_URL}works/guanxia/p01-cover.jpg`,
    // 不再对外提供完整 PDF（2026-09-14 按用户要求）：
    // 详情页的下载入口已移除，public/ 里也不再放这个文件，避免被直接抓 URL。
    // 置 null 而不是删掉字段，是为了让「有 PDF 时用 PDF 首页兜底封面」那条逻辑
    // （WorksCarousel → pdf-cover.ts）走空分支，不影响本项目的 jpg 实体封面。
    pdf: null,
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
        heading: '项目洞察及策略',
        body:
          'Z 世代「理性悦己」：79.43% 认为香水首要作用是愉悦自己，77.85% 相信香气能情绪疗愈。以日本电通 SIPS 模型（共鸣—确认—参与—分享扩散）为骨架，把苏州园林的「月洞门」转译为「拥抱不完美」的当代哲学。\n\n创意来源：观夏取名于苏州留园，苏州的在地文脉深深影响品牌调性。「月洞门」作为苏州园林中的标志性建筑，常象征圆满、和谐；其后那条通往未知方向的石板路，被转译为「光之入口」，与当代人的情绪轨迹相统一。\n\n策略内核：不破不立。「隙」是打破完美形态的勇气，是连接未知世界的起点 —— 没有「隙」，「月」只是一个封闭的圆；有了「隙」，「月」才成为一扇通往无限可能的门。\n\n由此拆成「寻隙—破隙—归真」三段式情绪叙事，覆盖预热、爆发、长尾三期，并把三款夏季限定转化为当代青年的情绪解决方案。',
      },
      {
        key: 'message',
        heading: 'Key message',
        body:
          '月缺为隙，心光为引。\n\n我是隙，亦是月；是未圆的圆满，是不完美的完美。在呼吸之间，见天地初见时的模样。',
      },
      {
        key: 'highlight',
        heading: '项目亮点',
        body:
          '月洞门建筑意象 ＋ 苏州园林在地文脉 ＝ 东方哲学 ＋ 情绪疗愈。\n\n一句品牌诗 ＋ 三阶段情绪路径 ＝ 一场从「寻隙」到「归真」的自我观照之旅。\n\n产品落点：三款夏季限定 ——「未寄信」愈见自我 ·「刺」重塑内核 ·「至简之水」国潮寻真，一一对应 Z 世代的三种情绪。\n\n产出落点：三款核心产品、《隙月》电子诗集与《Nosepaper·隙月特辑》、四展区沉浸艺术展、H5「映月鉴」、纪录片短片《织月》、观夏 × naze naze 联名礼盒。\n\n目标：品牌声量 +20%、夏季销量 +25%、Z 世代占比 40%+。',
      },
      {
        key: 'role',
        heading: '项目角色',
        body:
          '从市场与问卷调研（N=316）出发做受众与产品情绪价值重构，独立完成 SIPS 全链路活动策划、跨界与在地文化资源对接。\n\n问卷覆盖 Z 世代与年轻职场人的用香习惯、情绪动机与内容偏好，是「隙月」从洞察到落地的数据底座。',
      },
      {
        key: 'collab',
        heading: '观夏 × naze naze「织月闻香」',
        body:
          'naze naze 是中国首个深耕独龙族织造技艺的社会企业，与 700+ 位少数民族织女建立公平贸易合作；单件织品需历经 12 道手工工序，耗时 7–15 天。\n\n联名产出：「织月闻香」限定礼盒、隙月香囊、水波收纳系列（耳机包 / 托特包），以及纪录片短片《织月》—— 以双线叙事平行呈现独龙江织女染纱织布与调香师采香制香的过程。\n\n非遗活化：每售出 1 件联名产品捐赠 50 元至织女培训基金，助力少数民族手工艺传承与可持续发展，把一次消费变成青年情绪关怀与非遗传承。',
      },
    ],
    link: 'https://www.tosummer.com/',
  },
  {
    id: 'w2',
    code: 'PLAN_02',
    title: '神州租车 · 新媒体代运营',
    role: 'Research / 创意协作 / PPT 美化',
    client: '神州租车',
    year: '2025',
    cover: `${import.meta.env.BASE_URL}works/shenzhou/p01-cover.jpg`,
    pdf: null,
    highlightPage: 1,
    summary:
      '以「内容营销 3H」重塑参与感、以「Studio 化」重构内容生产流程，把神州租车各平台从「不 social、缺存在感」找回来。',
    tags: ['#新媒体代运营', '#内容营销', '#社交传播', '#整合营销'],
    sections: [
      {
        key: 'background',
        heading: '项目背景',
        body:
          '品牌需要乙方基于自身及竞品的运营策略和特点，重新明确每个平台的账号定位，针对全平台提出运营策略及改进方向。\n\n神州租车各平台运营不 social、缺乏存在感：对标最好的品牌会发现差距——它们有大量原生 UGC 支持口碑自传播，同时具备大众感知、频繁亮相、形象鲜活、朋友扎堆四个共性。本案以「内容营销 3H」重塑参与感、以「Studio 化」重构内容生产流程，最终让 social 为生意服务。',
      },
      {
        key: 'insight',
        heading: '核心策略',
        body:
          '内容营销 3H 塑造参与感：以 HERO / HUB / HELP 三层模型，把「存在感」拆成可执行的动作，沉淀为「策略一页纸」。\n\nHERO｜品牌是谁、信奉什么：创造可持续品牌资产、带强烈品牌 DNA；IP 化项目放大（「神州山海·此生必驾」IP 强化 ＋ 其他赛马 IP）。\n\nHUB｜品牌关我啥事：带神州租车进入更大流量池、形成强用户圈子塑造竞争壁垒；热点借势、BD 强化、内容兴趣扩圈、老带新。\n\nHELP｜解决选择障碍：梳理有感的业务内容与互动支持；深入用户做有用、深入业务做绑定，沉淀业务向内容。',
      },
      {
        key: 'highlight',
        heading: '全平台规划',
        body:
          '微信服务号｜业务导向，激活粉丝价值：新增粉丝运营工具《在出发》，打卡照片墙、经纬度攻略、出行工具箱。\n\n微信订阅号｜内容拉新主阵地：新栏目《神友志》《秘境之旅·中国国家地理路书》，杂志风改版；内容 / BD / 媒介 / 用户自传播四重拉新。\n\n微博｜运营要调整改变：文案说人话、抖机灵、放任务，经营品牌圈 / 娱乐圈 / 萌宠圈关系。\n\n小红书｜简化优化，潮流带你说话：官方内容极简化，永远挂上高频搜索话题。\n\n短视频类｜调动用户讲故事：假期解压出逃、一人自驾路书教程；《老司机指北》改为系列化视频。',
      },
    ],
  },
  {
    id: 'w3',
    code: 'PLAN_03',
    title: '赤尾 · 品牌策划案',
    role: '主题创意推导 / 活动策划 / PPT 美化',
    client: '赤尾',
    year: '2025',
    cover: `${import.meta.env.BASE_URL}works/chiwei/p01-cover.jpg`,
    pdf: null,
    highlightPage: 1,
    summary:
      '从赤尾避孕套产品出发，借节气节点与中华文化撑起「润 TA 细无声」，推动两性健康在高校群体健康发展、打造国货品牌形象。',
    tags: ['#品牌策划', '#节气营销', '#国货', '#整合营销'],
    sections: [
      {
        key: 'background',
        heading: '项目背景',
        body:
          '从赤尾避孕套产品出发，突出硬核产品力概念，推动两性健康在高校群体的健康发展，打造国产品牌形象。\n\n品牌追求国货形象，产品特点为「润」且可以表达爱意——借助节气节点，利用中华文化与产品水润特性撑起主题「润 TA 细无声」，通过活动向用户提供表达爱意的通道，让含蓄的、无声的爱被看见。',
      },
      {
        key: 'insight',
        heading: '项目洞察及策略',
        body:
          '市场洞察：宏观环境向好——国家推动两性健康发展、避孕套市场不断扩大（2022 年情趣用品市场规模达 1685.3 亿元）、社会观念转变、技术迭代与电商渠道增长。\n\n消费者洞察：锁定 18–22 岁学生情侣与 23–35 岁成熟情侣两类人群；需通过线上线下整合营销树立国货形象、建立年轻人的品牌忠诚度。\n\n产品洞察：赤尾主打玻尿酸润滑与「防脱滑」专利，卖点多元、性价比高；短板是品牌形象不突出、营销渠道固化。\n\n主题推导：取自杜甫《春夜喜雨》「随风潜入夜，润物细无声」——以韵律诗作为中国文化符号，强化赤尾国货品牌形象。',
      },
      {
        key: 'message',
        heading: '项目亮点',
        body:
          '中国诗句 ＋ 节气 ＝ 国货 ＋ 水润爱意。\n\n立春 · 雨水 · 春分 → 相识 · 相知 · 相恋。',
      },
      {
        key: 'highlight',
        heading: '三阶段传播',
        body:
          '春有约（立春 · 相识 · 2.4–2.11）：以相识为契机提供社交途径，认识懂生活懂你的人，一起约定过春天，树立年轻化品牌形象。\n\n丝雨润（雨水 · 相恋 · 2.12–2.19）：以相恋为情感输出点，通过情侣间默默无闻的爱，输出品牌默默陪伴与产品「润」的特点。\n\n万物生（春分 · 相伴 · 3.1–3.16）：以相伴为情感依托，通过系列活动促进情侣感情，把「润」与爱情密切联系。',
      },
      {
        key: 'role',
        heading: '项目角色',
        body:
          '协助主题创意推导、活动策划、PPT 美化。',
      },
    ],
  },
  {
    id: 'w4',
    code: 'PLAN_04',
    title: '快克 · 品牌 TVC',
    role: '影片调性把控 / 音乐参考 / 剪辑参考',
    client: '快克',
    year: '2025',
    cover: `${import.meta.env.BASE_URL}works/kuaike/p01-cover.jpg`,
    pdf: null,
    highlightPage: 1,
    summary:
      '以快克牌感冒胶囊为核心拍摄产品 TVC，突出「感冒，用快克就是快」，用失恋、应酬、面试三个场景传递情绪与健康的双重治愈。',
    tags: ['#TVC', '#病毒广告', '#微电影', '#品牌'],
    sections: [
      {
        key: 'background',
        heading: 'Brief 提炼',
        body:
          '任务目标：以快克牌感冒胶囊产品为核心，通过拍摄产品 TVC 突出核心卖点、并把感冒场景与产品形成强捆绑，传递情感价值。\n\n调性：活力、阳光、乐观。制作考量：1–3 分钟内融入产品使用场景，兼顾卖点与情感价值。',
      },
      {
        key: 'insight',
        heading: '产品与受众洞察',
        body:
          '产品洞察：快克是行业内首个创制出复方氨酚烷胺胶囊处方的感冒药；核心竞争优势在于能快速、有效地治疗感冒，让患者迅速恢复状态。\n\n受众洞察：身体上「恢复健康」，情绪上「状态急救」与「舒缓情绪」——明天要参加重要场合、前一天却感冒，吃了这粒快克好好睡一觉，第二天还你活力满满好状态。',
      },
      {
        key: 'message',
        heading: 'Key message',
        body:
          '感冒，去他的吧！难过，去他的吧！\n\n快克不仅快速治疗感冒，也为因感冒而沮丧、焦虑的人们提供一剂「心灵治愈的药方」——等到第二天天光大亮，又能重拾勇气，去做更好的自己。',
      },
      {
        key: 'highlight',
        heading: '影片调性',
        body:
          '本影片通过病毒广告的表现形式，利用失恋、应酬、面试三个场景凸显快克治愈「快」的特征，与用户建立情感共鸣。每个场景由负面情绪引发感冒到被治愈，达到温暖、阳光、积极的氛围效果。',
      },
      {
        key: 'music',
        heading: '音乐参考',
        body:
          '前半段被坏情绪和感冒裹挟，采用阴郁沉闷的蓝调音乐；后半段递感冒药片段采用灵魂乐，具有冷幽默的感觉，增强记忆点。',
      },
      {
        key: 'role',
        heading: '项目角色',
        body:
          '影片调性把控、音乐参考、剪辑参考。\n\n业内 TVC 导演评价为逻辑结构完整、审美到位，有成熟商业质感。',
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

/** 把种子条目 + （可选的）覆盖合成运行时状态。 */
function toState(w: PlanCase, i: number, override?: WorkOverride): ProjectState {
  const p: PlanCase = override
    ? { ...w, ...override, sections: override.sections ?? w.sections }
    : w;
  return {
    slot: i,
    code: p.code,
    title: p.title,
    role: p.role,
    client: p.client,
    year: p.year,
    summary: p.summary,
    tags: (p.tags ?? []).join(' '),
    cover: p.cover,
    pdf: p.pdf ?? null,
    pdfName: override?.pdfName ?? '',
    highlightPage: p.highlightPage,
    sections: p.sections ?? [],
    link: p.link,
    filled: Boolean(p.cover || p.summary || (p.sections?.length ?? 0) || p.pdf),
  };
}

/**
 * 运行时读到的内容 = 手写种子 `WORKS` ⊕ 覆盖表。
 *
 * 合并规则：覆盖表里出现过的字段以覆盖表为准，没出现过的沿用种子；
 * `sections` 做整体替换（编辑器里就是整块编辑的，不做逐段合并，语义更清楚）。
 *
 * `overrides` 默认用模块常量 `WORK_OVERRIDES`。组件里要传"会话内累积的那一份"——
 * 因为刚保存完时模块常量还是旧的（得等 HMR 重载才刷新），
 * 只认模块常量的话，存完关掉浮层再打开就看不到自己刚写的内容。
 */
export function seedProjects(
  overrides: Record<string, WorkOverride> = WORK_OVERRIDES,
): ProjectState[] {
  return WORKS.slice(0, FRAME_COUNT).map((w, i) => toState(w, i, overrides[String(i)]));
}

/** 该槽位的**原始**种子（不带任何覆盖）—— 「清空槽位」后用来立刻还原界面。 */
export function rawSeedProject(slot: number): ProjectState {
  const w = WORKS[slot];
  return w ? toState(w, slot) : seedProjects()[slot];
}

/** 该槽位在给定覆盖表里有没有被改过（用来决定「代码」和「浏览器」谁说了算）。 */
export function hasDiskOverride(
  slot: number,
  overrides: Record<string, WorkOverride> = WORK_OVERRIDES,
): boolean {
  return Boolean(overrides[String(slot)]);
}
