import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { fetchAIReply } from './StudioChat';

/**
 * My Studio 最上层（top:62% / left:5%）的 L.I.S.A. 风格对话 HUD：
 * 打字机逐字吐字（55ms/字）+ 末尾闪烁光标 █；打字完成后渐显快捷胶囊按钮，
 * 点击即向系统提问，无需手动打字。无边框无背景，纯文字 + 暖光贴合的悬浮按钮。
 *
 * 回复统一走 StudioChat 里导出的 fetchAIReply（useRealAPI=false 走本地语义知识库，
 * 部署连 API 时改 AI_CONFIG.useRealAPI=true 并重新构建即可）。
 */

// 快捷预设按钮
const QUICK_PILLS = ['关于空间主人', '探索旋转木马', '查看思维终端'];

const INTRO =
  'You have arrived. 你似乎不小心闯入了这间私人工作区。如果你对这个空间的主人（Milly）感到好奇，可以随时向我询问。';

export function LisaHud({ hidden = false }: { hidden?: boolean }) {
  const [typed, setTyped] = useState('');
  const [pillsVisible, setPillsVisible] = useState(false);
  const [draft, setDraft] = useState('');
  const timerRef = useRef<number | null>(null);
  const reqId = useRef(0);
  // 打字音效：每 2~3 字触发一次极轻白噪音短促声
  const audioCtxRef = useRef<AudioContext | null>(null);
  const soundCounter = useRef(0);
  const nextSoundAt = useRef(2 + Math.floor(Math.random() * 2));

  // 打字音效：极短白噪音（~10ms）经快速淡入淡出，音量极低
  const ensureAudio = () => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (Ctx) audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') void ctx.resume();
    return ctx;
  };
  const playKeySound = () => {
    const ctx = ensureAudio();
    if (!ctx) return;
    const dur = 0.01; // ~10ms
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let n = 0; n < len; n++) data[n] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(gain).connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + dur);
  };

  // 逐字打字函数（55ms/字），结束后渐显快捷按钮
  const playTypewriter = (text: string) => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    setTyped('');
    setPillsVisible(false);
    soundCounter.current = 0;
    nextSoundAt.current = 2 + Math.floor(Math.random() * 2);
    let i = 0;
    timerRef.current = window.setInterval(() => {
      if (i < text.length) {
        setTyped(text.slice(0, i + 1));
        i++;
        // 每 2~3 字随机触发一次极轻打字音效
        soundCounter.current += 1;
        if (soundCounter.current >= nextSoundAt.current) {
          soundCounter.current = 0;
          nextSoundAt.current = 2 + Math.floor(Math.random() * 2);
          playKeySound();
        }
      } else {
        window.clearInterval(timerRef.current!);
        timerRef.current = null;
        setPillsVisible(true);
      }
    }, 55);
  };

  // 开场白：挂载后自动播放
  useEffect(() => {
    playTypewriter(INTRO);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 提问：清空 → 取回复 → 打字机呈现（reqId 防止连点竞态）
  const ask = async (raw: string) => {
    ensureAudio(); // 用户手势内解锁音频上下文
    const q = raw.trim();
    if (!q) return;
    const id = ++reqId.current;
    setDraft('');
    setPillsVisible(false);
    setTyped('');
    const reply = await fetchAIReply(q);
    if (id !== reqId.current) return; // 已被更新的请求取代
    playTypewriter(reply);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void ask(draft);
    }
  };

  return (
    <div
      className="lisa-hud-container"
      style={{
        opacity: hidden ? 0 : 1,
        transition: 'opacity 0.3s ease',
      }}
      data-cursor-tone="dark"
      aria-hidden={hidden}
    >
      <div className="hud-tag">
        <span className="status-dot" />
        <span className="tag-text">SYSTEM_NOTICE // 空间连接已建立</span>
      </div>

      <div className="typed-box">
        <span>{typed}</span>
        <span className="blinking-cursor">█</span>
      </div>

      <div
        className="quick-pills"
        style={{
          opacity: pillsVisible ? 1 : 0,
          pointerEvents: pillsVisible ? 'auto' : 'none',
        }}
      >
        {QUICK_PILLS.map((p) => (
          <button key={p} type="button" onClick={() => void ask(p)}>
            {p}
          </button>
        ))}
      </div>

      <div className="hud-input-row">
        <span className="prompt-symbol">{'>'}</span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入对话或点击上方按钮..."
        />
      </div>

      <style>{`
.lisa-hud-container {
  position: absolute;
  top: 62%;
  left: 5%;
  width: 360px;
  z-index: 100;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
  color: #fff8f0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  pointer-events: auto;

  /* ==========================================================================
     随联系方式上浮"从下到上"淡出（2026-09-17 / 用户第 2 条需求）
     --------------------------------------------------------------------------
     用户：「这个对话框随着联系方式滚动要从下到上渐渐消失，在滚动到 6 格的时候完全消失」。
     这一层是 z 100、巧克力纸是 z 45 —— HUD 一直**压在纸上**，
     所以必须让它自己消失，不能指望纸把它盖住。

     主量是 --contact-p（联系面板的**主体**进度，0..1，一共 12 格）：
         --lisa-fade = clamp(0, p * 2, 1)      → p=0 全在、p=0.5（正好 6 格）全没了
     然后两件事同时做：
       ① **遮罩从下往上吃**（主效果）：linear-gradient(to top, ...) 里
          "透明段"的边界从 -12% 一路爬到 100% —— 底部先没、顶部最后没，
          这就是"从下到上渐渐消失"本身；两端各留 12% 的过渡带，是"渐渐"的来源。
          ⚠️ 起点取 -12% 而不是 0%：fade=0 时透明段整个落在盒子下沿之外，
             元素才是**完全原样**的（取 0% 的话底部会常年挂着一道淡边）。
       ② **整体再往上飘 26px**：纯遮罩像"被擦掉"，配一点位移才读得出"它退场了"。
     为什么不去 JS 里改 opacity：渐变遮罩是**逐像素**的，JS 做不到
     （改 opacity 只会整体变淡，看不出"从下到上"）。
     ⚠️ 这个变量是 StudioContactPanel 额外写到 .studio-scope 上的（那是 HUD 的父级）。
        面板自己身上那份写不进这里 —— CSS 变量只往下继承，兄弟之间没有通路。
     ========================================================================== */
  --lisa-fade: min(1, max(0, calc(var(--contact-p, 0) * 2)));
  transform: translate3d(0, calc(var(--lisa-fade) * -26px), 0);
  -webkit-mask-image: linear-gradient(
    to top,
    transparent calc(var(--lisa-fade) * 112% - 12%),
    #000 calc(var(--lisa-fade) * 112%)
  );
  mask-image: linear-gradient(
    to top,
    transparent calc(var(--lisa-fade) * 112% - 12%),
    #000 calc(var(--lisa-fade) * 112%)
  );
}
/* 指针事件：一是被浮层盖住（原来的 inline pointerEvents 挪到了这里，语义不变），
   二是**纸升起来之后** —— 那时这一层已经看不见了，但里面有一个真的 <input>，
   不摘掉的话会点到 / 聚焦到一个看不见的输入框。
   class 由 StudioContactPanel 在 p ≥ 0.42 时挂上（它按帧写变量，顺手一挂最省）。 */
.lisa-hud-container[aria-hidden='true'] {
  pointer-events: none;
}
.studio-scope.is-contact-rising .lisa-hud-container {
  pointer-events: none;
}
.hud-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  letter-spacing: 1.5px;
  color: #ffb74d;
  margin-bottom: 12px;
}
.status-dot {
  width: 6px;
  height: 6px;
  background: #ffaa00;
  border-radius: 50%;
  box-shadow: 0 0 8px #ffaa00;
  animation: lisa-pulse 1.5s infinite;
}
.typed-box {
  font-size: 15px;
  line-height: 1.6;
  font-weight: 500;
  min-height: 54px;
  margin-bottom: 16px;
  letter-spacing: 0.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.blinking-cursor {
  display: inline-block;
  margin-left: 3px;
  color: #ffaa00;
  animation: lisa-blink 0.8s infinite;
}
.quick-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
  transition: opacity 0.4s ease;
}
.quick-pills button {
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 20px;
  color: #ffffff;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.quick-pills button:hover {
  background: #ffffff;
  color: #1a1a1a;
  text-shadow: none;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
}
.hud-input-row {
  position: relative;
  display: flex;
  align-items: center;
  padding-bottom: 6px;
}
.hud-input-row::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background-image: repeating-linear-gradient(
    to right,
    rgba(255, 230, 200, 0.5) 0,
    rgba(255, 230, 200, 0.5) 5px,
    transparent 5px,
    transparent 10px
  );
  -webkit-mask-image: linear-gradient(to right, #000 0%, #000 35%, transparent 100%);
  mask-image: linear-gradient(to right, #000 0%, #000 35%, transparent 100%);
  pointer-events: none;
}
.prompt-symbol {
  color: #ffaa00;
  font-weight: bold;
  margin-right: 8px;
  font-size: 14px;
}
.hud-input-row input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: #ffffff;
  font-size: 13px;
  font-family: inherit;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
.hud-input-row input::placeholder {
  color: rgba(255, 235, 215, 0.45);
}
@keyframes lisa-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
@keyframes lisa-pulse { 0% { transform: scale(0.95); opacity: 0.8; } 50% { transform: scale(1.2); opacity: 1; } 100% { transform: scale(0.95); opacity: 0.8; } }
      `}</style>
    </div>
  );
}
