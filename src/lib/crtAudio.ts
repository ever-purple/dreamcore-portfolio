import { isGlobalMuted } from '@/lib/globalAudio';

/**
 * CRT 显像管音效（Web Audio 实时合成，不引入任何音频文件）。
 *
 * 为什么要合成：老式显示器那一套声音很有标志性（消磁"咚——嗡"、15.7kHz 行频啸叫、
 * 静电噪声、断电时亮点"啪"地收缩），但要凑齐这些素材得找音效库还占体积。
 * 用振荡器 + 噪声 buffer 现场合成，参数随时能调，体积 0。
 *
 * ⚠️ 必须在用户手势里调用（浏览器自动播放策略）——本项目是点电脑触发的，天然满足。
 */

let ctx: AudioContext | null = null;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** 每次播放前把上下文唤醒（切标签页回来可能 suspended） */
function ready(): AudioContext | null {
  const ac = audio();
  if (!ac) return null;
  if (ac.state === 'suspended') void ac.resume().catch(() => {});
  return ac;
}

/** 一段白噪声 buffer（缓存复用，别每次都生成） */
let noiseBuf: AudioBuffer | null = null;
function noise(ac: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(ac.sampleRate * 1.2);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf = buf;
  return buf;
}

type ToneOpts = {
  freq: number;
  to?: number;
  /** 开始时间（相对 now） */
  at?: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
};

/** 一个带指数扫频 + 指数衰减包络的音 */
function tone(ac: AudioContext, o: ToneOpts) {
  const t0 = ac.currentTime + (o.at ?? 0);
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to && o.to !== o.freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
  }
  // 起音 8ms 避免爆音，之后指数衰减
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.02);
}

/** 高通白噪声（静电 / 雪花声） */
function statics(ac: AudioContext, at: number, dur: number, gain: number, cut = 1800) {
  const t0 = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(cut, t0);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(hp).connect(g).connect(ac.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/** 15.7kHz 行频啸叫 —— CRT 的招牌声，音量必须极小否则刺耳 */
function flyback(ac: AudioContext, at: number, dur: number, gain = 0.012) {
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(15734, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.06);
  g.gain.setValueAtTime(gain, t0 + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/**
 * 通电消磁（DeGauss）：镜头扎进屏幕的瞬间用。
 * 组成 = 低频"咚" + 金属感下扫 boing + 静电雪花 + 持续的行频啸叫。
 */
export function playCrtOn(): void {
  if (isGlobalMuted()) return;
  const ac = ready();
  if (!ac) return;
  tone(ac, { freq: 78, to: 44, dur: 0.16, gain: 0.32 }); // 通电"咚"
  tone(ac, { freq: 1500, to: 110, at: 0.02, dur: 0.5, gain: 0.2 }); // 消磁 boing 主音
  tone(ac, { freq: 3000, to: 220, at: 0.02, dur: 0.42, gain: 0.07, type: 'triangle' }); // 泛音，金属感
  statics(ac, 0.01, 0.42, 0.075); // 静电
  flyback(ac, 0.06, 1.5); // 行频啸叫（一直持续到 OS 起来）
  tone(ac, { freq: 660, to: 990, at: 0.62, dur: 0.14, gain: 0.05, type: 'square' }); // 进系统的一声提示
}

/**
 * 断电：亮点"啪"地收掉，行频啸叫瞬间降调消失。
 * 返回（Zoom Out）时用。
 */
export function playCrtOff(): void {
  if (isGlobalMuted()) return;
  const ac = ready();
  if (!ac) return;
  tone(ac, { freq: 900, to: 60, dur: 0.3, gain: 0.2 }); // 下扫
  tone(ac, { freq: 15734, to: 3000, dur: 0.22, gain: 0.02 }); // 行频掉下来
  statics(ac, 0, 0.16, 0.05, 900);
  tone(ac, { freq: 120, to: 70, at: 0.24, dur: 0.12, gain: 0.1 }); // 收尾的闷响
}
