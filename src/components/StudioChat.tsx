import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * My Studio 左下角的系统 AI HUD（SYSTEM_AGENT）——「无底色悬浮」版。
 *
 * 视觉：去掉黑底盒子、去掉边框、隐去滚动条，文字直接浮在 3D 空气里。
 * 样式全部走 .hud-* 类（注入 <style>）。
 *
 * 接口：统一走 fetchAIReply()。AI_CONFIG.useRealAPI=false 时走本地语义知识库
 * (LOCAL_KNOWLEDGE)；部署上线连 API 时把 useRealAPI 改为 true，并填好
 * apiEndpoint / apiKey / model 即可。
 *
 * ⚠️ 安全提示：前端直连大模型会把 apiKey 暴露在浏览器里。正式上线建议把
 * fetchAIReply 的 B 模式改成请求「你自己的后端 / 云函数」，由后端持有 key 再转发。
 */

// ==========================================
// 1. 配置中心：API 切换开关与 Key 预留
// ==========================================
const AI_CONFIG = {
  // 🔴 关键开关：当前 false（本地 Mock）；部署上线连 API 时改成 true 即可！
  useRealAPI: false,
  // 替换为你届时部署的 API 接口地址（OpenAI 兼容格式）
  apiEndpoint: 'https://api.openai.com/v1/chat/completions',
  // 届时填写你的 API Key（建议改走自有后端中转，勿前端直连暴露）
  apiKey: 'YOUR_API_KEY_HERE',
  // 届时调用的模型名称
  model: 'gpt-4o-mini',
};

// ==========================================
// 2. 本地 Mock 逻辑（useRealAPI=false 时生效）
// ==========================================
const LOCAL_KNOWLEDGE: Record<
  string,
  { keywords: string[]; responses: string[] }
> = {
  // 维度一：关于空间主人（Milly / 孙晨茜）
  owner: {
    keywords: ['谁', '主人', '作者', '名字', 'milly', '孙晨茜', '身份', '履历'],
    responses: [
      '空间主人叫 Milly（孙晨茜），一位沉迷于把品牌营销、AI 视觉与 Web 交互揉在一起的数字创作者。',
      '检测到访客意图：关于空间主人。她是这里的主理人，善于用逻辑思考策划项目，用视觉搭建叙事空间。',
      '这里是 Milly 的精神工作室。她把自己的策划案、实习思考和 AI 实验都投影成了房间里的实体。',
    ],
  },
  // 维度二：关于旋转木马（重点项目）
  carousel: {
    keywords: ['木马', '旋转木马', '项目', '作品', '策划', '香氛', '观夏', '米莉'],
    responses: [
      '旋转木马承载着她的核心策划案。比如《观夏》夏季营销、神州租车提案，以及《米莉的入沪奇遇》。不妨去转转它？',
      '那是记忆齿轮驱动的【项目展台】。上面挂着用逻辑与创意构建的营销策划，点击它就能进入细节。',
      '想看作品？旋转木马上有她最核心的项目展示，包含完整的营销策略与视觉提案。',
    ],
  },
  // 维度三：关于复古电脑（个人介绍 / About Me）
  computer: {
    keywords: ['电脑', 'pc', 'win95', '硬件', '系统', '屏幕', '复古', '关于我', '终端', '思维'],
    responses: [
      '那台旧电脑是主人的思维终端。里面记录着她的专业背景、能力模型和 Win95 风格的个人展示。',
      '左侧书桌上的 CRT 显示器连接着她的知识库，去开机看看，能解锁她的完整履历。',
    ],
  },
  // 维度四：关于书架 / 实习 / 思考
  shelf: {
    keywords: ['书架', '实习', '足迹', '笔记', '日记', '思考', '实验室', 'ai'],
    responses: [
      '书架上摆放着【实习足迹】与 Creative Lab。记录着她在北京、上海等地实操项目时的沉淀与 AI 视觉实验。',
      '那是她的思考抽屉。里面有她写过的营销 Hook、社交媒体预热策略，以及各种手稿。',
    ],
  },
  // 维度五：暗号 / 隐藏彩蛋
  easterEgg: {
    keywords: ['彩蛋', '秘密', '穿越', '房间', '遗忘', '乐园', '你好', 'hi', 'hello'],
    responses: [
      '你好，穿越者。这里是一个远离喧嚣的数字游乐园，所有时间都在此刻凝固了。',
      '你注意到了光影里的颗粒感吗？这个房间正以 60FPS 维持着主人的记忆微缩场景。',
      '提示：试试点击房间里发光的物体，它们会带你跳转到不同的维度。',
    ],
  },
};

function getLocalMockReply(input: string): string {
  const text = input.toLowerCase().trim();
  for (const cat in LOCAL_KNOWLEDGE) {
    if (LOCAL_KNOWLEDGE[cat].keywords.some((kw) => text.includes(kw))) {
      const res = LOCAL_KNOWLEDGE[cat].responses;
      return res[Math.floor(Math.random() * res.length)];
    }
  }
  return "空间系统正在解析你的疑问... 尝试询问'主人的作品'或'左侧的复古电脑'，我会为你检索线索。";
}

// ==========================================
// 3. 统一请求适配器（核心：无论是否连 API，UI 只调这个）
// ==========================================
export async function fetchAIReply(userInput: string): Promise<string> {
  // A 模式：尚未部署 API，走本地假接口
  if (!AI_CONFIG.useRealAPI) {
    // 模拟网络延迟 300ms，让体验更逼真
    await new Promise((resolve) => setTimeout(resolve, 300));
    return getLocalMockReply(userInput);
  }

  // B 模式：上线连 API（届时直接生效）
  try {
    const response = await fetch(AI_CONFIG.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AI_CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [
          {
            role: 'system',
            content:
              '你现在是运行在 3D 复古工作室里的【空间守卫系统 AI】。提问者是一位穿越者，你的职责是引导他了解空间主人 Milly 的作品（旋转木马）和思维终端（复古电脑）。语气冷静温和，控制在 100 字以内。',
          },
          { role: 'user', content: userInput },
        ],
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    // 若你的后端返回格式不同，改这里即可（此处按 OpenAI 兼容格式解析）
    return (data as { choices?: { message?: { content?: string } }[] }).choices?.[0]
      ?.message?.content ?? '【系统信号微弱】未能解析深度记忆网关的回响。';
  } catch (error) {
    console.error('API Fetch Error:', error);
    return '[系统信号微弱] 无法连接到深度记忆网关，请稍后再试。';
  }
}

// ==========================================
// UI 部分（React 版，等价于原 document.getElementById 绑定）
// ==========================================
type Msg = { id: number; role: 'system' | 'user' | 'agent'; text: string };

const INTRO = [
  '检测到异次元访客接入...',
  '你似乎不小心闯入了这间私人工作区。',
  '若对空间主人（Milly）感到好奇，可随时向我询问。',
].join('\n');

let nextId = 2;

export function StudioChat({ hidden = false }: { hidden?: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([
    { id: 0, role: 'system', text: INTRO },
  ]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  const send = async () => {
    const text = draft.trim();
    if (!text || thinking) return;
    const uid = nextId++;
    setMessages((m) => [...m, { id: uid, role: 'user', text }]);
    setDraft('');
    setThinking(true);
    try {
      const reply = await fetchAIReply(text);
      const aid = nextId++;
      setMessages((m) => [...m, { id: aid, role: 'agent', text: reply }]);
    } finally {
      setThinking(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div
      className="system-hud-container"
      style={{
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : 'auto',
        transition: 'opacity 0.3s ease',
      }}
      data-cursor-tone="dark"
      aria-hidden={hidden}
    >
      {/* 顶部状态提示：极简泛光字 */}
      <div className="hud-status">
        <span className="hud-dot" />
        <span>[ SYSTEM_NOTICE // 空间连接已建立 ]</span>
      </div>

      {/* 消息对话显示区：无背景、隐藏生硬滚动条 */}
      <div className="hud-chat-body" ref={logRef}>
        {messages.map((m) => (
          <p
            key={m.id}
            className={m.role === 'user' ? 'hud-msg-user' : 'hud-msg-system'}
          >
            {'> '}
            {m.text}
          </p>
        ))}
        {thinking && <p className="hud-msg-system">{'> 正在检索空间记忆数据库...'}</p>}
      </div>

      {/* 底部输入框：仅用一条极细虚线 */}
      <div className="hud-input-wrapper">
        <span className="hud-prompt">{'>'}</span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="向系统询问主人的线索..."
        />
      </div>

      <style>{`
.system-hud-container {
  position: absolute;
  bottom: 28px;
  left: 28px;
  width: 310px;
  z-index: 100;
  font-family: 'Courier New', Courier, monospace;
  pointer-events: auto;
}
.hud-status {
  font-size: 10px;
  letter-spacing: 1.5px;
  color: #ffb74d;
  text-shadow: 0 0 8px rgba(255, 183, 77, 0.6);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.hud-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  background: #ffb74d;
  border-radius: 50%;
  box-shadow: 0 0 8px #ffb74d;
  animation: hud-blink 1.5s infinite;
}
.hud-chat-body {
  max-height: 140px;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.6;
  color: #fff8f0;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9), 0 0 12px rgba(0, 0, 0, 0.7);
  padding-right: 4px;
  scrollbar-width: none;
}
.hud-chat-body::-webkit-scrollbar { width: 3px; }
.hud-chat-body::-webkit-scrollbar-thumb {
  background: rgba(255, 200, 150, 0.3);
  border-radius: 2px;
}
.hud-msg-user { color: #a0a0a0; margin-top: 6px; }
.hud-msg-system { color: #ffe0b2; margin-top: 4px; }
.hud-input-wrapper {
  margin-top: 10px;
  display: flex;
  align-items: center;
  border-bottom: 1px dashed rgba(255, 220, 180, 0.4);
  padding-bottom: 4px;
}
.hud-prompt {
  color: #ffb74d;
  font-size: 13px;
  margin-right: 6px;
  font-weight: bold;
  text-shadow: 0 0 8px rgba(255, 183, 77, 0.5);
}
.hud-input-wrapper input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: #ffffff;
  font-size: 12px;
  font-family: inherit;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
}
.hud-input-wrapper input::placeholder {
  color: rgba(255, 230, 200, 0.4);
}
@keyframes hud-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
      `}</style>
    </div>
  );
}
