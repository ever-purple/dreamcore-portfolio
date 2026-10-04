/**
 * L.I.S.A. 作品集问答 —— 服务端中转硅基流动，API Key 不会下发到浏览器。
 *
 * 环境变量：
 *   SILICONFLOW_API_KEY=sk-...
 *   SILICONFLOW_MODEL=Qwen/Qwen2.5-7B-Instruct（可选）
 */
type VercelRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status(code: number): VercelResponse;
  setHeader(key: string, value: string): void;
  json(body: unknown): void;
};

const API_KEY = process.env.SILICONFLOW_API_KEY || '';
const MODEL = process.env.SILICONFLOW_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
const ENDPOINT = 'https://api.siliconflow.cn/v1/chat/completions';
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const CHAT_LOG_KEY = 'dc:chat';
const CHAT_LOG_LIMIT = 100;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;
const visitors = new Map<string, { startedAt: number; count: number }>();

type KnowledgeEntry = {
  id: string;
  title: string;
  keywords: string[];
  content: string;
};

/**
 * L.I.S.A. 的网站知识库。内容由当前网站的公开数据整理而来；不要在这里加入
 * 简历未公开信息、推测结果或尚未上线的项目。模型每次只会收到检索得分最高的条目。
 */
const KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'profile',
    title: '空间主人 · 专业概览',
    keywords: ['主人', '关于', '专业', '能力', '方向', '求职', '擅长', '介绍', '广告学'],
    content:
      '广告学专业，拥有四段整合营销、品牌内容与新媒体运营相关实习经历。核心能力包括整合营销、品牌内容、新媒体运营、达人投放、数据复盘与 AI 提效。求职方向聚焦整合营销、品牌内容与新媒体运营。',
  },
  {
    id: 'experience-xinbai',
    title: '经历 · 北京新白文化 / 袖珍世界',
    keywords: ['新白', '袖珍世界', '达人', '小红书', '投放', 'roi', '2026', '实习'],
    content:
      '2026.01–04，市场部实习生。参与品牌新媒体矩阵、达人合作、节点活动和本地生活投放；推进 54 位带货达人分级合作与文案跟进，运营小红书素人矩阵并使用 AI 批量剪辑和制作封面，参与妇女节、上海新店开业等节点策划，复盘 CTR、成交额与 ROI。',
  },
  {
    id: 'experience-xingxingxing',
    title: '经历 · 北京行行行广告',
    keywords: ['行行行', '快手', '神州', '整合营销', '热榜', '18.41', '2025', '实习'],
    content:
      '2025.07–08，整合营销部实习生，同时参与快手电商节点营销与神州租车品牌自媒体代运营。为“老铁降温季”规划热点并跟进榜单和营销号，话题曝光 18.41 亿+、累计上榜 39 个、最高 TOP1；完成神州租车四平台竞品调研与运营策略提案。',
  },
  {
    id: 'experience-kexing',
    title: '经历 · 北京氪星创服',
    keywords: ['氪星', '科创', '视频号', '公众号', '短视频', '活动', '2024', '实习'],
    content:
      '2024.07–09，品牌市场部实习生。负责多平台内容与短视频生产，参与视频号、公众号内容规划与运维，完成科创主题短视频的策划、拍摄协作与剪辑，并参与大型活动的前期传播、现场执行和内容回收。',
  },
  {
    id: 'experience-chunshanli',
    title: '经历 · 春山里',
    keywords: ['春山里', '抖音', '脚本', '拍摄', '后期', '运营', '2023', '实习'],
    content:
      '2023.07–09，新媒体运营实习生。参与抖音账号运营、短视频制作和日常传播文案输出；协助选题与内容排期，参与脚本、拍摄和后期制作，并根据账号反馈调整内容表达。',
  },
  {
    id: 'plan-guanxia',
    title: '策划案 · 观夏「隙月」夏季营销',
    keywords: ['观夏', '隙月', '香氛', '月洞门', 'sips', '苏州', '问卷', '316'],
    content:
      '以苏州园林月洞门为创意原点，用“不破不立”回应 Z 世代理性悦己，以 SIPS 模型搭建“寻隙—破隙—归真”三阶段传播。规划电子诗集、沉浸展、H5、纪录片与跨界礼盒。基于 316 份问卷完成全链路方案；角色为调研、策略、内容、视觉叙事与资源整合统筹。方案目标不等于真实上线结果。',
  },
  {
    id: 'plan-shenzhou',
    title: '策划案 · 神州租车新媒体代运营',
    keywords: ['神州租车', '代运营', '3h', 'hero', 'hub', 'help', '微博', '小红书'],
    content:
      '针对各平台“不 social、缺存在感”，用 HERO / HUB / HELP 内容模型与 Studio 化流程重构微信、微博、小红书和短视频运营。完成竞品研究、平台定位、内容栏目、热点借势与提案视觉整理；角色为 Research、短视频与小红书策划、借势创意和 PPT 美化。方案创意与平台调性获得甲方书面好评。',
  },
  {
    id: 'plan-kuaishou',
    title: '策划案 · 快手电商「老铁降温季」',
    keywords: ['快手电商', '老铁降温季', '高温', '热搜', '冲榜', '达人', '18.41', '39'],
    content:
      '把高温情绪、老铁语境与降温商品连接为传播抓手，规划 26 个热点，执行 15+ 热榜冲榜、概念图与海报，并跟进热搜词、营销号、达人 brief、传播日报和户外反馈。结果为曝光 18.41 亿+、累计上榜 39 个、最高 TOP1。',
  },
  {
    id: 'plan-chiwei',
    title: '策划案 · 赤尾「润 TA 细无声」',
    keywords: ['赤尾', '润ta', '润 ta', '节气', '立春', '雨水', '春分', '两性'],
    content:
      '从产品“润”的特点出发，借《春夜喜雨》与节气文化建立国货表达，面向高校情侣设计“春有约、丝雨润、万物生”三阶段传播。角色为主题创意推导、活动策划与 PPT 美化。该项目为完整策划方案，网站未提供上线后的量化传播数据。',
  },
  {
    id: 'plan-kuaike',
    title: '策划案 · 快克品牌 TVC',
    keywords: ['快克', 'tvc', '感冒', '病毒广告', '失恋', '应酬', '面试'],
    content:
      '围绕“感冒，用快克就是快”，以失恋、应酬、面试三个场景连接身体恢复与情绪急救。前半用阴郁蓝调表现低落，递药后切换灵魂乐与冷幽默。角色为影片调性、音乐参考与剪辑参考；网站记录业内 TVC 导演对逻辑与审美的正向评价。',
  },
  {
    id: 'videos',
    title: '创作档案 · 视频作品',
    keywords: ['视频', '横屏', '竖屏', 'ai影像', '短片', '拍摄', '剪辑', '片子'],
    content:
      '视频分为横屏映像、AI 影像、竖屏短片。现有条目包括：七夕活动花絮、外交官·照片背后的故事、春山里·介绍、春山里·暑假、蝴蝶振翅、摆脱巴掌的秘诀；AI 影像《明天也一起回家吧》；竖屏《翼氪计划·香港实习生》《翼氪计划·8月14日》。',
  },
  {
    id: 'copywriting',
    title: '创作档案 · 品牌文案',
    keywords: ['文案', 'copywriting', '营养快线', '银鹭', '郁美净', '茶之韵', '品牌故事'],
    content:
      '文案档案收录四组：营养快线短文案，以“碰撞”连接夏日记忆与果汁牛奶；银鹭植物豆奶短文案，以“破壁”回应乳糖不耐受；郁美净长文案，以气味唤醒四季与童年记忆；茶之韵品牌故事，以起源、探索、交流、回归讲述高山有机茶与山野。',
  },
  {
    id: 'site-navigation',
    title: '工作室导览',
    keywords: ['怎么', '哪里', '导航', '房间', '工作室', '电脑', '书架', '木马', '报刊亭', '日记'],
    content:
      '复古电脑进入 About Me；笔记本进入实习日记与思考过程；旋转木马进入策划项目；报刊亭进入视频、文案和创作档案。访客也可通过导航前往关于我、策划项目、文案与视频、联系方式和简历。',
  },
  {
    id: 'contact',
    title: '联系方式与简历',
    keywords: ['联系', '邮箱', '合作', '简历', '招聘', '应聘'],
    content:
      '网站联系方式页面公开邮箱为 1952200284@qq.com，并提供市场营销策划方向的简历下载。需要进一步沟通时，请引导访客前往联系方式页面。',
  },
  {
    id: 'world',
    title: 'L.I.S.A. 与世界观',
    keywords: ['你是谁', '这里', '世界', '异世界', '梦核', '夏天', '系统', 'lisa'],
    content:
      '这里是 2003 年的夏天，和一间遗落的梦核工作室。L.I.S.A. 是工作室的异世界系统，负责读取房间中保存的经历、作品、灵感与创作档案，并为误入此处的访客导航。',
  },
];

function retrieveKnowledge(question: string, limit = 4): KnowledgeEntry[] {
  const normalized = question.toLowerCase().replace(/\s+/g, '');
  const scored = KNOWLEDGE.map((entry, index) => {
    let score = 0;
    for (const keyword of entry.keywords) {
      const key = keyword.toLowerCase().replace(/\s+/g, '');
      if (normalized.includes(key)) score += Math.max(3, key.length * 2);
    }
    for (const char of new Set(normalized)) {
      if (char.trim() && entry.title.toLowerCase().includes(char)) score += 0.15;
    }
    return { entry, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const matched = scored.filter((item) => item.score >= 3).slice(0, limit).map((item) => item.entry);
  return matched.length ? matched : [KNOWLEDGE[0], KNOWLEDGE[12], KNOWLEDGE[14]];
}

const SYSTEM_PROMPT = `【世界观】
你不是普通聊天助手，而是梦核异世界工作室中的系统 L.I.S.A.。访客刚刚脱离现实，步入 2003 年的夏天；时间像旧录像一样停在这间遗落的工作室里。你负责读取房间中已经保存的档案，为访客导览。

【工作室现有档案】
1. About Me / 思维终端：空间主人的专业方向是品牌营销策划、内容创意、新媒体运营、文案、视频制作与 AI 视觉实验。
2. 经历档案：北京新白文化、北京行行行广告、北京氪星创服、春山里；涉及达人合作、小红书矩阵、节点营销、整合营销、品牌自媒体运营、短视频与活动传播。
3. 策划作品：观夏「隙月」夏季营销、神州租车新媒体代运营、赤尾「润 TA 细无声」品牌策划、快克品牌 TVC。详情页记录项目背景、洞察、策略、执行和个人角色。
4. 视频档案：横屏、竖屏与 AI 三类视频作品。
5. 文案档案：按品牌整理的文案作品；只能介绍网页中实际列出的品牌和内容。
6. 其他区域：灵感收藏、创作实验、书架与日记、联系方式。

【回答规则】
1. 所有事实必须来自以上设定及访客问题中已经给出的信息。禁止编造未收录的公司、数据、奖项、学历、客户评价、岗位或项目结果。
2. 不使用“Milly”或“米莉”称呼空间主人，也不要主动播报姓名；统一称“空间主人”。
3. 回答围绕网站现有的经历、能力、策划案、视频、文案、灵感收藏、创作实验、网站导览和联系方式。若问题超出范围，只说“这部分资料暂未收录”，再引导访客查询已有档案。
4. 保持异世界系统口吻：冷静、轻微梦核感，但面向招聘方时以清楚、专业、可信为先，不说空泛抒情话。
5. 中文为主，每次约 60–100 个汉字，最多 120 个汉字；不用 Markdown 标题、项目符号或多段长文。`;

function bodyObject(body: unknown): Record<string, unknown> {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function clientId(req: VercelRequest): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (value || 'unknown').split(',')[0].trim().slice(0, 80);
}

function allowed(id: string): boolean {
  const now = Date.now();
  const current = visitors.get(id);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    visitors.set(id, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_PER_WINDOW;
}

async function redis(...args: string[]): Promise<unknown> {
  if (!KV_URL || !KV_TOKEN) return null;
  const path = args.map(encodeURIComponent).join('/');
  const response = await fetch(`${KV_URL}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!response.ok) throw new Error(`upstash-${response.status}`);
  const data = (await response.json()) as { result?: unknown };
  return data.result;
}

async function saveChat(question: string, reply: string, source: 'qwen' | 'fallback' | 'error') {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    const entry = JSON.stringify({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      question,
      reply,
      source,
      ts: Date.now(),
    });
    await redis('lpush', CHAT_LOG_KEY, entry);
    await redis('ltrim', CHAT_LOG_KEY, '0', String(CHAT_LOG_LIMIT - 1));
  } catch (error) {
    console.error('[chat:log]', error);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method-not-allowed' });
    return;
  }
  const question = String(bodyObject(req.body).message || '').trim().slice(0, 240);
  if (!question) {
    res.status(400).json({ ok: false, reason: 'empty-message' });
    return;
  }
  if (!API_KEY) {
    await saveChat(question, '使用本地知识库回答（大模型尚未配置）', 'fallback');
    res.status(503).json({ ok: false, reason: 'ai-not-configured' });
    return;
  }
  if (!allowed(clientId(req))) {
    res.status(429).json({ ok: false, reason: 'rate-limited' });
    return;
  }

  try {
    const references = retrieveKnowledge(question)
      .map((entry) => `【${entry.title}】\n${entry.content}`)
      .join('\n\n');
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'system',
            content: `以下是本次问题从网站知识库中检索到的原始档案。回答只能使用这些档案中的事实：\n\n${references}`,
          },
          { role: 'user', content: question },
        ],
        temperature: 0.45,
        max_tokens: 180,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) throw new Error(`siliconflow-${response.status}`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = data.choices?.[0]?.message?.content?.trim().slice(0, 360);
    if (!reply) throw new Error('empty-ai-reply');
    await saveChat(question, reply, 'qwen');
    res.status(200).json({ ok: true, reply });
  } catch (error) {
    console.error('[chat]', error);
    await saveChat(question, '模型连接失败，前端已切换本地知识库回答', 'error');
    res.status(502).json({ ok: false, reason: 'ai-unavailable' });
  }
}
