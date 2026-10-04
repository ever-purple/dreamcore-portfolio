import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * My Studio 左下角的系统 AI HUD（SYSTEM_AGENT）——「无底色悬浮」版。
 *
 * 视觉：去掉黑底盒子、去掉边框、隐去滚动条，文字直接浮在 3D 空气里。
 * 样式全部走 .hud-* 类（注入 <style>）。
 *
 * 接口：统一走 fetchAIReply() 请求站内 /api/chat，由后端安全持有硅基流动 Key。
 * 后端尚未配置或暂时不可用时，会自动退回本地语义知识库，网站不会失效。
 */

// ==========================================
// 2. 本地 Mock 逻辑（useRealAPI=false 时生效）
// ==========================================
const LOCAL_KNOWLEDGE: Record<
  string,
  { keywords: string[]; responses: string[] }
> = {
  // 维度一：关于空间主人
  owner: {
    keywords: ['谁', '主人', '作者', '身份', '履历', '经历', '能力', '关于我'],
    responses: [
      '空间主人具备品牌营销、内容策划、新媒体运营、文案与视频制作经验。进入思维终端，可以查看更完整的能力与经历档案。',
      '系统记录显示：空间主人曾参与品牌新媒体、整合营销、内容生产与活动传播，并持续尝试 AI 视觉与网页交互创作。',
    ],
  },
  // 维度二：关于旋转木马（重点项目）
  carousel: {
    keywords: ['木马', '旋转木马', '项目', '作品', '策划', '香氛', '观夏', '神州', '赤尾', '快克'],
    responses: [
      '项目档案收录了观夏「隙月」、神州租车新媒体代运营、赤尾品牌策划与快克品牌 TVC，可查看背景、洞察、执行和项目角色。',
      '那是由记忆齿轮驱动的项目展台。点击策划案封面，可以进入完整的策略与执行档案。',
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
      '书架与日记保存着实习足迹、内容笔记、灵感收藏和 AI 视觉实验，可以继续打开房间里的发光物件查看。',
      '这里保存着策划、视频、品牌文案与创作实验。系统只会依据工作室已经收录的档案回答。',
    ],
  },
  // 维度五：暗号 / 隐藏彩蛋
  easterEgg: {
    keywords: ['彩蛋', '秘密', '穿越', '房间', '遗忘', '乐园', '你好', 'hi', 'hello'],
    responses: [
      '欢迎，访客。时间停在 2003 年的夏天，这间工作室保存着经历、作品与尚未褪色的创作档案。',
      '系统提示：点击房间里发光的物体，可以进入不同的作品与记忆区域。',
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
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: userInput }),
      signal: AbortSignal.timeout(17_000),
    });

    const data = (await response.json()) as { ok?: boolean; reply?: string; reason?: string };
    if (response.status === 429) return '[SYS.LIMIT] 访问频率过高，请稍后再向空间系统提问。';
    if (response.ok && data.ok && data.reply) return data.reply;
    return getLocalMockReply(userInput);
  } catch (error) {
    console.error('API Fetch Error:', error);
    return getLocalMockReply(userInput);
  }
}

// ==========================================
// UI 部分（React 版，等价于原 document.getElementById 绑定）
// ==========================================
type Msg = { id: number; role: 'system' | 'user' | 'agent'; text: string };

const INTRO =
  'You have arrived. 这里是 2003 年的夏天，在这间遗落的梦核工作室里，如果你想了解空间主人的经历、作品或创作档案，请直接向我提问。';

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
