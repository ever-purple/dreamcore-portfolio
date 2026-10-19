import { isGlobalMuted } from '@/lib/globalAudio';

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let context: AudioContext | null = null;

function ready(): AudioContext | null {
  if (isGlobalMuted()) return null;
  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context ??= new Ctor();
    if (context.state === 'suspended') void context.resume().catch(() => {});
    return context;
  } catch {
    return null;
  }
}

function rollerTick(ac: AudioContext, at: number, strength = .07) {
  const t = ac.currentTime + at;
  const oscillator = ac.createOscillator();
  const gain = ac.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(320, t);
  gain.gain.setValueAtTime(.0001, t);
  gain.gain.exponentialRampToValueAtTime(strength, t + .004);
  gain.gain.exponentialRampToValueAtTime(.0001, t + .07);
  oscillator.connect(gain).connect(ac.destination);
  oscillator.start(t);
  oscillator.stop(t + .08);
}

/** 模拟小型热敏/底片打印机：进纸、滚轮加速、减速和最终松纸。 */
export function playFilmPrinter(): void {
  const ac = ready();
  if (!ac) return;
  const t = ac.currentTime;
  const duration = 3.2;

  const motor = ac.createOscillator();
  const motorFilter = ac.createBiquadFilter();
  const motorGain = ac.createGain();
  motor.type = 'sawtooth';
  motor.frequency.setValueAtTime(138, t);
  motorFilter.type = 'lowpass';
  motorFilter.frequency.value = 1200;
  motorGain.gain.setValueAtTime(.0001, t);
  motorGain.gain.linearRampToValueAtTime(.09, t + .09);
  motorGain.gain.linearRampToValueAtTime(.003, t + .35);
  motorGain.gain.setValueAtTime(.003, t + .5);
  motorGain.gain.linearRampToValueAtTime(.105, t + .57);
  motorGain.gain.setValueAtTime(.105, t + 1.05);
  motorGain.gain.linearRampToValueAtTime(.004, t + 1.14);
  motorGain.gain.setValueAtTime(.004, t + 1.36);
  motorGain.gain.linearRampToValueAtTime(.12, t + 1.43);
  motorGain.gain.setValueAtTime(.12, t + 1.94);
  motorGain.gain.linearRampToValueAtTime(.004, t + 2.04);
  motorGain.gain.setValueAtTime(.004, t + 2.3);
  motorGain.gain.linearRampToValueAtTime(.085, t + 2.38);
  motorGain.gain.linearRampToValueAtTime(.0001, t + duration);
  motor.connect(motorFilter).connect(motorGain).connect(ac.destination);
  motor.start(t);
  motor.stop(t + duration + .02);

  const frames = Math.floor(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frames; index += 1) {
    const pulse = .55 + .45 * Math.sin(index / ac.sampleRate * Math.PI * 34);
    data[index] = (Math.random() * 2 - 1) * pulse;
  }
  const paper = ac.createBufferSource();
  const paperFilter = ac.createBiquadFilter();
  const paperGain = ac.createGain();
  paper.buffer = buffer;
  paperFilter.type = 'bandpass';
  paperFilter.frequency.value = 1900;
  paperFilter.Q.value = .7;
  paperGain.gain.setValueAtTime(.0001, t);
  paperGain.gain.linearRampToValueAtTime(.085, t + .12);
  paperGain.gain.linearRampToValueAtTime(.004, t + .35);
  paperGain.gain.setValueAtTime(.004, t + .5);
  paperGain.gain.linearRampToValueAtTime(.11, t + .58);
  paperGain.gain.linearRampToValueAtTime(.006, t + 1.12);
  paperGain.gain.setValueAtTime(.006, t + 1.36);
  paperGain.gain.linearRampToValueAtTime(.12, t + 1.44);
  paperGain.gain.linearRampToValueAtTime(.006, t + 2.02);
  paperGain.gain.setValueAtTime(.006, t + 2.3);
  paperGain.gain.linearRampToValueAtTime(.09, t + 2.4);
  paperGain.gain.linearRampToValueAtTime(.0001, t + duration);
  paper.connect(paperFilter).connect(paperGain).connect(ac.destination);
  paper.start(t);
  paper.stop(t + duration);

  [0, .16, .31, .54, .66, .78, .9, 1.02, 1.4, 1.52, 1.64, 1.76, 1.88, 2.34, 2.5, 2.68, 2.86, 3.02].forEach((at, index, ticks) => {
    rollerTick(ac, at, index === 0 || index === ticks.length - 1 ? .09 : .055);
  });
}
