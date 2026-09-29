/**
 * 项目详情页（WorkProjectPage）的文案 —— 单一数据源，**方便逐个项目填写**。
 *
 * 为什么单开一个文件、而不是塞进 works.ts：
 * 右栏是「编辑型版式」（超大标题 / 大字宣言 / 三步流程 / 团队），这些不属于
 * 木马槽位本身的元数据；混进 works.ts 会让提交表单和本地存储都得跟着改。
 * 这里按 `code` 挂载：**没写条目的项目自动走精简版**（只用 works 里的 summary + sections），
 * 所以你可以一个一个慢慢补，中间任何时刻页面都是完整的。
 *
 * 打样条目：PLAN_01（观夏「隙月」），内容全部取自它自己的 sections，没有另编。
 */

/** 三步流程里的一步 */
export type WorkPageStep = {
  /** 序号，留空按 01 / 02 / 03 自动排 */
  no?: string;
  title: string;
  body: string;
  /** 这一步的配图（可多张，卡片内纵向排）；不写就没有图 */
  images?: string[];
};

/** 右栏的一屏正文：左小标签 + 右段落（可带图） */
export type WorkPageCol = {
  /** 列标题，如平台名「服务号」 */
  title: string;
  /** 这一列里的图（纵向堆叠） */
  images: string[];
};

/** 区块里的一段音频（如音乐参考：前半蓝调 / 后半灵魂乐） */
export type WorkPageAudio = {
  /** 音频标题，如「前半段 · 蓝调」 */
  title: string;
  /** 音频文件地址（站内 /works/... 路径） */
  src: string;
};

export type WorkPageBlock = {
  /** 左侧小标签；留空则用对应 section 的 heading */
  label?: string;
  /** 段落，\n\n 分段；留空则用对应 section 的 body */
  body?: string;
  /** 这一屏的图片（可多张，纵向铺满内容宽）；不写就没有图 */
  images?: string[];
  /** 配图排布：stack=满宽单列(默认)；grid2=双排两列；hcols=横向滚动多列（需配 cols） */
  layout?: 'stack' | 'grid2' | 'hcols';
  /** layout==='hcols' 时：每一列是一组图（如各平台），横向滚动展示（底部滚动条） */
  cols?: WorkPageCol[];
  /** 区块正文下方挂一个外链（如新片场视频）；渲染成「观看视频 ↗」按钮 */
  link?: string;
  /** 区块内嵌视频（iframe URL，如新片场播放页）；配封面图 + 播放键，点击后页面内播放 */
  video?: string;
  /** 区块内嵌音频列表（原生播放器，自带播放键） */
  audio?: WorkPageAudio[];
};

export type WorkPageTeam = {
  name: string;
  role: string;
  avatar?: string;
};

export type WorkPageCopy = {
  /** 首屏压在图片上的超大标题（要短、有力量，参考站是 FORM FOLLOWS FEELING 这种） */
  heroLine?: string;
  /** 首屏标题下的一行小字 */
  heroNote?: string;
  /** 深色带上的大字宣言（整屏间奏，参考站 THE PARTICULARS OF EACH PROJECT…） */
  statement?: string;
  /**
   * 覆盖 / 补充 sections 的每一屏：**按 section 的 key 取**，不再按下标。
   *
   * 为什么改成 key（2026-09-14）：以前是 `blocks[i]` 跟 `sections[i]` 对齐，
   * 而 sections 会被站内作者模式的保存动作整份覆盖（见 `works.local.ts`）——
   * 用户在编辑器里增删一节，后面所有屏的配图就整体错位一格，而且不报错，
   * 只是图文对不上。按 key 之后顺序和条数怎么变都不会串。
   *
   * 所以这里可以放心保留当前不存在的 key（比如 role / collab）：
   * 站内哪天把那两节加回来，配图会自动挂上。
   */
  blocks?: Record<string, WorkPageBlock>;
  /** 三步流程（留空则不渲染这一屏） */
  steps?: WorkPageStep[];
  /** 三步流程区的大标题；留空用「三步」 */
  stepsTitle?: string;
  /** 三步流程进左栏目录：设置后目录末尾多一项（值为目录名），三步区参与高亮/跳转。
      不设置则三步区不进目录（观夏保持原样）。2026-09-15 为神州租车「创意作业」加。 */
  stepsToc?: string;
  /** 页脚团队（留空则不渲染这一屏） */
  team?: WorkPageTeam[];
  /** 左栏顶部的项目自述；留空则用 project.summary */
  intro?: string;
  /** 左栏自述上方的小标题（渲染成粗体）；留空则只渲染段落 */
  introTitle?: string;
};

/** 观夏 deck 导出的配图目录；文件名里的 P 编号 = 策划案页码 */
const GX = `${import.meta.env.BASE_URL}works/guanxia/`;

export const WORK_PAGES: Record<string, WorkPageCopy> = {
  /* ============================================================
     PLAN_01 · 新国潮香氛「观夏」夏季营销「隙月」 —— 正文各屏配图齐全
     （板块条数以 works.local.ts 覆盖表里的 sections 为准，别再按 6 节写死）
     ============================================================ */
  PLAN_01: {
    heroLine: '不破不立，月有隙才照得进光',
    heroNote: '观夏 To Summer · 夏季限定「隙月」整合营销',
    statement:
      '把苏州园林的「月洞门」转译成一套当代情绪哲学：接受不完美，才装得下自己。',
    // 左栏自述：小标题粗体 + 一段总述。
    // 2026-09-14 按用户要求，由「项目背景 + 市场分析长文」换成「项目概述 + 全案总述」
    // —— 左栏这段是整案提要，与正文第 1 节「项目背景」分工不同，别再合并。
    introTitle: '项目概述',
    intro:
      '观夏「隙月」夏季营销以苏州园林「月洞门」为创意原点，借「寻隙—破隙—归真」三阶段情绪路径，将夏季限定香氛转译为当代青年的情绪解决方案，完成从话题引爆、用户共创到线下策展的品牌价值闭环。',
    // 正文各屏与 sections 按 **key** 对齐（见 WorkPageCopy.blocks 的注释）。
    // label / body 全部留空 ⇒ 直接沿用 section 原文（改文案只动 works.ts 一处），
    // 这里只管配图。
    // 注意：sections 的实际条数以 works.local.ts 的覆盖表为准 —— 当前站内只有 4 节
    // （background / insight / message / highlight），role 与 collab 是预留给以后加回来的。
    blocks: {
      // 项目背景 —— deck「一、市场分析」四页
      // P6 市场动向 / P7 消费者洞察 / P8 产品定位 / P9 SWOT
      // 2026-09-15 用户要求：双排
      background: {
        images: [`${GX}p06-market.webp`, `${GX}p07-consumer.webp`, `${GX}p08-product.webp`, `${GX}p09-swot.webp`],
        layout: 'grid2',
      },
      // 创意洞察（站内原「项目洞察及策略」）—— P3 创意来源·月洞门 / P11 主题推导 / P12 Road Map
      insight: {
        images: [`${GX}p03-overview.webp`, `${GX}p11-theme.webp`, `${GX}p12-roadmap.webp`],
      },
      // Key message —— P2 前言 / P29 结尾页
      // 2026-09-15 用户要求：双排
      message: {
        images: [`${GX}p02-preface.webp`, `${GX}p29-ending.webp`],
        layout: 'grid2',
      },
      // 项目亮点 —— 2026-09-14 按用户要求删掉配图（原 P3/P11 与「创意洞察」那屏重复）。
      // 留空数组即可：组件端 `images.length ? … : null` 连图区节点都不渲染。
      highlight: {
        images: [],
      },
      // 以下两节的配图先留着：站内目前把这两节删掉了（渲染不到），
      // 但 key 已就位 —— 哪天在编辑器里加回来，配图会自动挂上，不会再错位。
      // 项目角色 —— P30 附录调查问卷（N=316 的数据底座）
      role: {
        images: [`${GX}p30-questionnaire.webp`],
      },
      // 观夏 × naze naze「织月闻香」—— P21 联名页 / P25 创意设计执行·长尾期
      collab: {
        images: [`${GX}p21-nazenaze.webp`, `${GX}p25-tail.webp`],
      },
    },
    // 三步流程 —— 直接取自 PLAN_01「项目执行」里的「寻隙—破隙—归真」，
    // 每一步挂上 deck「三、营销策略」里对应的那几页（点图可放大）。
    stepsTitle: '三步 · 从文化符号到情绪价值',
    steps: [
      {
        no: '01',
        title: '预热 · 寻隙',
        body: '6.25–7.5　话题 #我们的奥德赛时期、三行寻隙诗征集、「心事寄存处」线下快闪。',
        images: [
          `${import.meta.env.BASE_URL}works/guanxia/p14-rainy-season-w1600.webp`,
          `${import.meta.env.BASE_URL}works/guanxia/p15-poem-w1600.webp`,
          `${import.meta.env.BASE_URL}works/guanxia/p16-letter-w1600.webp`,
        ],
      },
      {
        no: '02',
        title: '爆发 · 破隙',
        body: '7.6–7.20　苏州拙政园「隙月围谈」沙龙、播客《青年日记》、观夏 × 阿那亚联名主题套房。',
        images: [
          `${import.meta.env.BASE_URL}works/guanxia/p17-roundtable-w1600.jpg`,
          `${import.meta.env.BASE_URL}works/guanxia/p18-podcast-w1600.jpg`,
          `${import.meta.env.BASE_URL}works/guanxia/p19-aranya-w1600.webp`,
        ],
      },
      {
        no: '03',
        title: '长尾 · 归真',
        body: '7.21–8.25　上海观夏闲庭东方美学艺术展（四展区）、观夏 × naze naze「织月闻香」非遗联名。',
        images: [
          `${import.meta.env.BASE_URL}works/guanxia/p20-exhibition-w1600.webp`,
          `${import.meta.env.BASE_URL}works/guanxia/p21-nazenaze-w1600.jpg`,
        ],
      },
    ],
    // Team 那一屏 2026-09-14 按用户要求删除（原来是三个「（待填）」占位，
    // 未填写时展示出来像没做完）。想恢复就把 team 数组填回来即可 —— 组件里的渲染逻辑还在。
    team: [],
  },

  /* ============================================================
     PLAN_02 · 神州租车新媒体代运营 —— 2025–2026 年度自媒体代运营招标
     （版式与观夏一致：超大标题 + 宣言带 + 正文配图 + 三步流程）
     ============================================================ */
  PLAN_02: {
    heroLine: '自由出发，自在神州',
    statement: '让 social 有价值：不 social、缺存在感，就把参与感做出来。',
    introTitle: '项目概述',
    intro:
      '神州租车各平台运营「不 social、缺乏存在感」。本案以「内容营销 3H」重塑参与感、以「Studio 化」重构内容生产流程，针对全平台提出运营策略及改进方向，最终让 social 为生意服务。',
    blocks: {
      // 项目背景：删掉旧的第一张图，换成 P7/P9/P15/P16，双排（2×2）摆放
      background: {
        images: [
          `${import.meta.env.BASE_URL}works/shenzhou/p07-w1600.webp`,
          `${import.meta.env.BASE_URL}works/shenzhou/p09-w1600.jpg`,
          `${import.meta.env.BASE_URL}works/shenzhou/p15-w1600.webp`,
          `${import.meta.env.BASE_URL}works/shenzhou/p16-w1600.jpg`,
        ],
        layout: 'grid2',
      },
      // 核心策略：旧图全删，换成 P19/P20，双排摆放
      insight: {
        images: [
          `${import.meta.env.BASE_URL}works/shenzhou/p19-w1600.jpg`,
          `${import.meta.env.BASE_URL}works/shenzhou/p20-w1600.jpg`,
        ],
        layout: 'grid2',
      },
      // 全平台规划：旧图全删，换成五列（各平台一栏）横向滚动，底部滚动条
      highlight: {
        layout: 'hcols',
        cols: [
          {
            title: '服务号',
            images: [
              `${import.meta.env.BASE_URL}works/shenzhou/p27-w1600.webp`,
              `${import.meta.env.BASE_URL}works/shenzhou/p28-w1600.jpg`,
              `${import.meta.env.BASE_URL}works/shenzhou/p29-w1600.jpg`,
            ],
          },
          {
            title: '订阅号',
            images: [
              `${import.meta.env.BASE_URL}works/shenzhou/p36-w1600.jpg`,
              `${import.meta.env.BASE_URL}works/shenzhou/p38-w1600.jpg`,
              `${import.meta.env.BASE_URL}works/shenzhou/p40-w1600.jpg`,
              `${import.meta.env.BASE_URL}works/shenzhou/p41-w1600.jpg`,
            ],
          },
          {
            title: '微博',
            images: [
              `${import.meta.env.BASE_URL}works/shenzhou/p51-w1600.jpg`,
              `${import.meta.env.BASE_URL}works/shenzhou/p55-w1600.jpg`,
              `${import.meta.env.BASE_URL}works/shenzhou/p56-w1600.jpg`,
              `${import.meta.env.BASE_URL}works/shenzhou/p57-w1600.jpg`,
            ],
          },
          {
            title: '小红书 & 短视频',
            images: [
              `${import.meta.env.BASE_URL}works/shenzhou/p59-w1600.webp`,
              `${import.meta.env.BASE_URL}works/shenzhou/p60-w1600.jpg`,
              `${import.meta.env.BASE_URL}works/shenzhou/p62-w1600.jpg`,
              `${import.meta.env.BASE_URL}works/shenzhou/p63-w1600.jpg`,
            ],
          },
        ],
      },
    },
    // 2026-09-15 按用户要求：创意作业改用三步版式呈现，原「三步 · 把存在感做出来」整节删除
    stepsTitle: '创意作业 · 把节点做成梗',
    // 左栏目录里仍显示「创意作业」（三步区参与目录跳转/高亮）
    stepsToc: '创意作业',
    steps: [
      {
        no: '01',
        title: '老乡车队',
        body: 'CNY「老乡车队」借春运返乡情绪，把品牌编进团圆叙事。',
        images: [`${import.meta.env.BASE_URL}works/shenzhou/p70-w1600.jpg`],
      },
      {
        no: '02',
        title: '十一 · 伴手礼集市',
        body: '十一把线下场景变成可打卡的内容现场，伴手礼让用户把神州带回家。',
        images: [
          `${import.meta.env.BASE_URL}works/shenzhou/p75-w1600.jpg`,
          `${import.meta.env.BASE_URL}works/shenzhou/p76-w1600.jpg`,
          `${import.meta.env.BASE_URL}works/shenzhou/p77-w1600.jpg`,
        ],
      },
      {
        no: '03',
        title: '苏超借势',
        body: '苏超爆火期间以「州」字玩梗借势，接住全民话题的流量。',
        images: [
          `${import.meta.env.BASE_URL}works/shenzhou/p81-w1600.jpg`,
          `${import.meta.env.BASE_URL}works/shenzhou/p82-w1600.webp`,
          `${import.meta.env.BASE_URL}works/shenzhou/p83-w1600.jpg`,
          `${import.meta.env.BASE_URL}works/shenzhou/p84-w1600.webp`,
        ],
      },
    ],
    team: [],
  },

  /* ============================================================
     PLAN_03 · 赤尾品牌策划案 —— 润 TA 细无声
     ============================================================ */
  PLAN_03: {
    heroLine: '润 TA 细无声',
    statement: '春有约，丝雨润，万物生：让含蓄的、无声的爱被看见。',
    introTitle: '项目概述',
    intro:
      '从赤尾避孕套产品出发，突出硬核产品力，推动两性健康在高校群体的健康发展。借节气节点，利用中华文化与产品水润特性撑起主题「润 TA 细无声」，传递品牌关怀两性健康的价值观。',
    blocks: {
      // 2026-09-15 用户要求：项目背景图片全删
      background: {
        images: [],
      },
      // 项目洞察：删第一张（p06-product），换成 P5 消费者洞察；第二张 p08 主题推导保留
      // 2026-09-15 用户要求：双排摆放
      insight: {
        images: [
          `${import.meta.env.BASE_URL}works/chiwei/p05-consumer-w1600.webp`,
          `${import.meta.env.BASE_URL}works/chiwei/p08-theme-w1600.jpg`,
        ],
        layout: 'grid2',
      },
      // 项目亮点：图片全删
      message: {
        images: [],
      },
      highlight: {
        images: [`${import.meta.env.BASE_URL}works/chiwei/p10-roadmap-w1600.webp`],
      },
      role: {
        images: [
          `${import.meta.env.BASE_URL}works/chiwei/p19-tree-w1600.webp`,
        ],
      },
    },
    stepsTitle: '三阶段 · 从相知到相伴',
    steps: [
      {
        no: '01',
        title: '春有约 · 相识',
        body: '立春 2.4–2.11：以相识为契机提供社交途径，认识懂生活懂你的人，一起约定过春天。',
        // 2026-09-15 用户要求：春有约换成 P11-12
        images: [
          `${import.meta.env.BASE_URL}works/chiwei/p11-spring-w1600.webp`,
          `${import.meta.env.BASE_URL}works/chiwei/p12-dinglingling-w1600.webp`,
        ],
      },
      {
        no: '02',
        title: '丝雨润 · 相恋',
        body: '雨水 2.12–2.19：以相恋为情感输出点，通过情侣间默默无闻的爱，输出品牌默默陪伴与产品「润」的特点。',
        // 2026-09-15 用户要求：丝雨润换成 P13-15
        images: [
          `${import.meta.env.BASE_URL}works/chiwei/p13-rain-w1600.webp`,
          `${import.meta.env.BASE_URL}works/chiwei/p14-gorun-w1600.webp`,
          `${import.meta.env.BASE_URL}works/chiwei/p15-kol-w1600.jpg`,
        ],
      },
      {
        no: '03',
        title: '万物生 · 相伴',
        body: '春分 3.1–3.16：以相伴为情感依托，通过系列活动促进情侣感情，把「润」与爱情密切联系。',
        // 2026-09-15 用户要求：万物生换成 P16-17
        images: [
          `${import.meta.env.BASE_URL}works/chiwei/p16-grow-w1600.jpg`,
          `${import.meta.env.BASE_URL}works/chiwei/p17-rainstill-w1600.webp`,
        ],
      },
    ],
    team: [],
  },

  /* ============================================================
     PLAN_04 · 快克品牌 TVC —— 感冒药病毒式微电影
     ============================================================ */
  PLAN_04: {
    heroLine: '感冒，去他的吧',
    statement: '感冒，去他的吧！难过，去他的吧！吃粒快克，好好睡一觉。',
    introTitle: '项目概述',
    intro:
      '以快克牌感冒胶囊产品为核心拍摄产品 TVC，突出「感冒，用快克就是快」的核心卖点，并将感冒场景与产品形成强捆绑、传递情感价值，调性活力、阳光、乐观。',
    blocks: {
      // 2026-09-15 用户要求：删掉第一部分图片
      background: {
        images: [],
      },
      // 产品与受众洞察：双排
      insight: {
        images: [
          `${import.meta.env.BASE_URL}works/kuaike/p03-insight-w1600.jpg`,
          `${import.meta.env.BASE_URL}works/kuaike/p04-audience-w1600.jpg`,
        ],
        layout: 'grid2',
      },
      message: {
        images: [`${import.meta.env.BASE_URL}works/kuaike/p05-keymsg-w1600.jpg`],
      },
      // 2026-09-15 用户要求：创意脚本 → 影片调性，删原脚本图，换 P14，内嵌新片场视频
      highlight: {
        images: [`${import.meta.env.BASE_URL}works/kuaike/p14-tone-w1600.jpg`],
        video: 'https://www.xinpianchang.com/a13167165?from=ArticleList',
      },
      // 2026-09-15 用户要求：新增音乐参考（P18 背景图 + 两段音乐播放器）
      music: {
        images: [`${import.meta.env.BASE_URL}works/kuaike/p18-music-w1600.jpg`],
        audio: [
          { title: '前半段 · 蓝调', src: `${import.meta.env.BASE_URL}works/kuaike/media4.mp3` },
          { title: '后半段 · 灵魂乐', src: `${import.meta.env.BASE_URL}works/kuaike/media5.mp3` },
        ],
      },
      role: {
        images: [
          `${import.meta.env.BASE_URL}works/kuaike/p16-color-w1600.jpg`,
          `${import.meta.env.BASE_URL}works/kuaike/p19-style-w1600.jpg`,
          `${import.meta.env.BASE_URL}works/kuaike/p28-storyboard-w1600.webp`,
        ],
      },
    },
    stepsTitle: '病毒广告脚本',
    stepsToc: '病毒广告脚本',
    steps: [
      {
        no: '01',
        title: 'PART 1 失恋',
        body: '失恋就像得了一场重感冒，让人头痛欲裂、无法呼吸。SUPER：这个不行就下一个。',
        // 2026-09-15 用户要求：图换成 P6-8
        images: [
          `${import.meta.env.BASE_URL}works/kuaike/p06-script1a-w1600.webp`,
          `${import.meta.env.BASE_URL}works/kuaike/p07-script1b-w1600.webp`,
          `${import.meta.env.BASE_URL}works/kuaike/p08-script1c-w1600.webp`,
        ],
      },
      {
        no: '02',
        title: 'PART 2 应酬',
        body: '不想去的酒局，偏偏撞上重感冒。SUPER：爱你所爱拒你所恶，锅我背了你放肆去 high。',
        // 2026-09-15 用户要求：图换成 P9-11
        images: [
          `${import.meta.env.BASE_URL}works/kuaike/p09-script2a-w1600.webp`,
          `${import.meta.env.BASE_URL}works/kuaike/p10-script2b-w1600.webp`,
          `${import.meta.env.BASE_URL}works/kuaike/p11-script2c-w1600.webp`,
        ],
      },
      {
        no: '03',
        title: 'PART 3 面试',
        body: '面试前一晚突然重感冒。SUPER：事到如今先睡一觉，明天才能活力满满。',
        // 2026-09-15 用户要求：图换成 P12-13
        images: [
          `${import.meta.env.BASE_URL}works/kuaike/p12-script3a-w1600.webp`,
          `${import.meta.env.BASE_URL}works/kuaike/p13-script3b-w1600.webp`,
        ],
      },
    ],
    team: [],
  },
};
