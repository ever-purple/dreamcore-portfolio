/**
 * 工作室背景音乐的「连续性」音频链（2026-09-16 第二档 ④）
 * ---------------------------------------------------------------------------
 * 改造前：只要离开工作室画面（进策划案 / 报刊亭 / 开菜单 / 钻进 CRT），
 * 就直接 `audio.pause()`，回来再 `play()`。音乐被硬生生掐断 —— 每进一个板块
 * 「世界」就断一次、每退回来又从头接一次。这正是用户说的
 * 「每个板块很分离」在**听觉**上的来源（视觉上是顶栏/转场不统一）。
 *
 * 改造后：一条 Web Audio 链，音乐**永不暂停**（除非用户明确要看视频）：
 *
 *     <audio> ──► Gain ──► destination
 *
 * ## 三档语义
 * ---------------------------------------------------------------------------
 *   · `away()` —— **慢慢远去**：约 3.4s 淡到听不见（曲线见下），低通**不动**。
 *     进任何子页面（菜单 / 书架 / 笔记本 / 策划 / 文案 / CRT / About）都走它。
 *     音乐**不 pause**，所以随时 `play()` 一拉就回到原位置 —— 这是"连续性"的落点：
 *     它不是被掐断，是"走远了"。
 *   · `halt()` —— **立刻停**：`audio.pause()`。只在进「视频与音乐」页时用 ——
 *     那页自己会出声，背景音乐必须让位，淡出都嫌吵。
 *   · `stop()` —— **终态停**：离开工作室回首页，不再恢复。
 *
 * 为什么是"淡到极小而**不**暂停"：暂停要付出"重新起播"的代价 ——
 * `audio.play()` 的 promise 兑现前有一小段静默，且 StrictMode 双挂载下容易丢状态。
 *
 * ## ⚠️⚠️ 淡出曲线：这是本文件最容易被改错的地方（2026-09-16 晚踩了两次）
 * ---------------------------------------------------------------------------
 * 第一版：`exponentialRampToValueAtTime(1e-4, t+3.4)` —— 指数斜坡在**幅度**上等 dB，
 *   而 dB 范围是 0.7(-3dB) → 1e-4(-80dB) = **77dB**。等 dB 意味着跨度均匀铺在时间上，
 *   于是**走到一半就已经 -41dB**（基本听不见了）。用户听完的反馈正是：
 *   「音乐消失的太快，没有渐渐消失的效果」。
 *   教训：**"等 dB 线性"听起来均匀，但只在跨度不大的时候成立** ——
 *   一旦要淡到 -80dB，前 40% 的时间就把"听得见→听不见"这段跑完了。
 *
 * 第二版（当前）：按**响度**铺时间。响度 ≈ 幅度^0.6（Stevens 幂律），
 *   要让响度随时间线性下降，幅度就得走 `a(k) = from · (1-k)^1.7`：
 *
 *     k(时间)   0.25    0.50    0.75    1.00
 *     幅度      0.44    0.22    0.08    0
 *     dB        -7.2   -13.2   -21.7   -inf
 *
 *   —— 中点还有 -13dB（清楚听得见"在变小"），到 3/4 处才 -22dB，最后才归零。
 *   这才是"渐渐消失"。实现用**分段线性**近似这条幂曲线（14 段够平滑），
 *   而不是 `setValueCurveAtTime`：分段斜坡能被 `cancelScheduledValues` 干净打断，
 *   而 value curve 在中途被 cancel 时有"参数卡在最后计算值"的历史坑（Chrome）。
 *
 * 第三版别做的事：**不要**在淡出时同时扫低通。第一版还叠了 `18000 → 1200Hz`，
 *   中高频先没，听感上"歌被拿走了"，比增益下降快得多 —— 那是"太快"的另一半原因。
 *   现在的 `away()` 是**纯音量**，与用户原话「音量渐渐变小，渐渐消失」一致。
 *   如果以后想要"隔着门听"的距离感，请单独加一档（例如进 CRT 时），
 *   并且**别和淡出叠在同一段时间里**。
 *
 * ## 为什么要走 Web Audio 而不是直接改 `audio.volume`
 * ---------------------------------------------------------------------------
 * `audio.volume` 只能**瞬跳**：0.7 → 0 会"咔"一声。只有 AudioParam 有真正的斜坡，
 * 所以音量一律交给 GainNode：**`audio.volume` 恒为 1**，别在别处改它。
 * （Web Audio 不可用时另有一条 rAF 版手动淡出兜底，见 `fadeVolumeManually`。）
 *
 * ## ⚠️ 三条必须遵守的约束（都踩过）
 * ---------------------------------------------------------------------------
 *  1. `createMediaElementSource` **一个元素只能建一次**，重复建抛 InvalidStateError。
 *     所以建链动作被 `build()` 锁在内部，只跑一次，对外只暴露方法。
 *  2. AudioContext 出生就是 `suspended`，必须在**用户手势**里 `resume()`。
 *     漏了它整条链静音 —— 而且特别难查：代码全对、元素在播、就是没声。
 *     所以对外一定要留 `unlock()`，由调用方挂在 pointerdown / keydown 上。
 *  3. Web Audio 不可用（或建链抛错）时**降级**为直接改 `audio.volume`：
 *     功能不丢，只是精度差一点。降级发生在 `build()` 里，一处收口。
 *
 * ## ⚠️ 改斜坡前还要知道这条
 * ---------------------------------------------------------------------------
 * `setTargetAtTime` 之间互相打断是安全的，但**排进时间线的斜坡会赖着**：
 * 淡出到一半时若只调 `setTargetAtTime(FULL)`，剩下没走完的 `linearRamp` 会继续把值往下拽
 * —— 表现为"返回工作室后音乐回不来"。所以这里统一 `cancelScheduledValues` 后
 * 先用当前实际值 `setValueAtTime` 钉一下起点（读 `.value` 拿到的是斜坡路上值，不会跳变）。
 *
 * 顺带一提：`createMediaElementSource` 之后，元素的输出**只**走这条链，
 * 不再直接进 destination。所以「ctx 没 resume → 完全没声」是必然的，不是浏览器抽风。
 * CORS 同理：音源换了跨域地址就必须给 audio 加 crossOrigin，否则链会变成静音
 * （当前 `/studio/studio-music.mp3` 是同源，无需处理）。
 */

/** 回到工作室画面时的前台增益（原来的 audio.volume = 0.7 就是这个值） */
const FULL_GAIN = 0.7;

/**
 * 淡出总时长（秒）。用户给的区间是 3–4s，取 3.4。
 * 配下面那条幂曲线：整段都能听见它在变小，最后才归零。
 */
const FADE_OUT = 3.4;

/** 幂曲线的分段数。14 段直线去逼近 `(1-k)^1.7`，残差已远小于听阈。 */
const FADE_SEGMENTS = 14;

/**
 * 幂曲线的指数。1.7 ≈ 1/0.6，把"响度线性下降"翻译成"幅度怎么走"。
 * 调大 → 前段掉得慢、尾段掉得急；调小 → 靠近线性淡出（前段掉得快，听感"突然小了"）。
 */
const FADE_CURVE_P = 1.7;

/**
 * 回前台用的 `setTargetAtTime` 时间常数（秒）。0.35 ≈ 1s 走到 95% ——
 * "音乐缓缓推上来"而不是"啪一下回来"。比淡出的 3.4s 短很多，是因为
 * 回到工作室时用户期望立刻听见环境声，不需要仪式感。
 */
const TAU_UP = 0.35;

export type StudioMusic = {
  /** 原始 audio 元素。**不要**直接改它的 volume / 调 play / pause，一律走下面方法。 */
  readonly audio: HTMLAudioElement;
  /** 在用户手势里调用：建链 + resume AudioContext。漏了它就完全没声。 */
  unlock(): void;
  /** 拉回前台满音量（幂等；已终态停则不动作）。打断进行中的淡出。 */
  play(): void;
  /** 慢慢远去：约 3.4s 渐弱到零，但**不暂停** —— 进任何子页面时用。 */
  away(): void;
  /** 立刻停：暂停元素，`play()` 可以重新拉起。只在进「视频与音乐」页时用。 */
  halt(): void;
  /** 用户主动关闭 / 恢复全站声音。 */
  setMuted(muted: boolean): void;
  /** 终态停：只在**离开工作室**（回首页）时用，之后不再恢复。 */
  stop(): void;
  isStopped(): boolean;
  /** 给无头验证用：读当前实际增益（斜坡中读到的是路上值，稳定后≈目标值） */
  debug(): {
    paused: boolean;
    muted: boolean;
    gain: number;
    ctx: string;
    webAudio: boolean;
    halted: boolean;
  };
  dispose(): void;
};

export function createStudioMusic(src: string): StudioMusic {
  const audio = new Audio(src);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 1; // 音量一律由 GainNode 负责，见文件头说明

  let ctx: AudioContext | null = null;
  let gainNode: GainNode | null = null;
  /** 终态：离开工作室，任何方法都不再出声 */
  let stopped = false;
  /** 临时停：进视频页，`play()` 可以解除 */
  let halted = false;
  let userMuted = false;
  /** 降级路径下的 rAF 淡出手柄 */
  let fadeRaf = 0;

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  /** 建链。只跑一次；失败时留下 ctx = null，全局降级到 audio.volume。 */
  const build = () => {
    if (ctx) return;
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return; // 降级：没有 Web Audio，只能手动 tween 音量
    try {
      ctx = new AC();
      const source = ctx.createMediaElementSource(audio);
      gainNode = ctx.createGain();
      gainNode.gain.value = FULL_GAIN;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
    } catch {
      // 建链失败（老浏览器 / 元素已被别的上下文占用）→ 退回手动 tween 音量
      ctx = null;
      gainNode = null;
      audio.volume = FULL_GAIN;
    }
  };

  /** 当前实际增益（斜坡路上值），并保证 > 0 以便后续做指数/幂运算。 */
  const currentGain = () => {
    const v = gainNode ? gainNode.gain.value : audio.volume;
    return Number.isFinite(v) ? Math.max(v, 0) : 0;
  };

  /**
   * 渐弱到 0：把增益按"响度随时间近似线性"的幂曲线推下去。
   * 分成 14 段线性斜坡 —— 既能被 `cancelScheduledValues` 干净打断，
   * 又足够平滑（见文件头「淡出曲线」那一节）。
   */
  const scheduleFadeOut = (dur: number) => {
    if (!gainNode || !ctx) return;
    const p = gainNode.gain;
    const t = ctx.currentTime;
    const from = currentGain() || FULL_GAIN;
    p.cancelScheduledValues(t);
    p.setValueAtTime(from, t);
    for (let i = 1; i <= FADE_SEGMENTS; i++) {
      const k = i / FADE_SEGMENTS;
      p.linearRampToValueAtTime(from * Math.pow(1 - k, FADE_CURVE_P), t + dur * k);
    }
  };

  /** 回前台：指数逼近，可被后续调用随时改写。 */
  const scheduleRise = () => {
    if (!gainNode || !ctx) return;
    const p = gainNode.gain;
    const t = ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(currentGain(), t);
    p.setTargetAtTime(FULL_GAIN, t, TAU_UP);
  };

  /** 降级路径：没有 Web Audio 时用 rAF 手搓同一条幂曲线，别让音量"咔"地掉下去。 */
  const fadeVolumeManually = (target: number, dur: number) => {
    if (fadeRaf) {
      cancelAnimationFrame(fadeRaf);
      fadeRaf = 0;
    }
    const to = clamp01(target);
    if (dur <= 0) {
      audio.volume = to;
      return;
    }
    const from = audio.volume;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / (dur * 1000));
      // 与 Web Audio 那条同源：响度线性 → 幅度走 (1-k)^P
      audio.volume = clamp01(from * Math.pow(1 - k, FADE_CURVE_P));
      fadeRaf = k < 1 ? requestAnimationFrame(step) : 0;
    };
    fadeRaf = requestAnimationFrame(step);
  };

  const tryPlay = () => {
    if (stopped) return;
    const p = audio.play();
    if (p) void p.catch(() => {});
  };

  const resumeCtx = () => {
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  };

  return {
    audio,

    unlock() {
      build();
      resumeCtx();
      if (userMuted) {
        audio.muted = true;
        if (gainNode && ctx) gainNode.gain.setValueAtTime(0, ctx.currentTime);
      }
    },

    play() {
      if (stopped) return;
      halted = false;
      tryPlay();
      resumeCtx();
      if (userMuted) return;
      if (gainNode && ctx) scheduleRise();
      else fadeVolumeManually(FULL_GAIN, 0);
    },

    away() {
      // 已经终态停 / 已暂停（无声音可淡）就不用做斜坡了
      if (stopped || halted) return;
      tryPlay();
      resumeCtx();
      if (gainNode && ctx) scheduleFadeOut(FADE_OUT);
      else fadeVolumeManually(0, FADE_OUT);
    },

    halt() {
      if (stopped) return;
      halted = true;
      // 直接暂停；不先淡出 —— 视频页有自己的声音，多留 3 秒反而是干扰
      audio.pause();
    },

    setMuted(muted: boolean) {
      userMuted = muted;
      audio.muted = muted;
      if (gainNode && ctx) {
        const p = gainNode.gain;
        const t = ctx.currentTime;
        p.cancelScheduledValues(t);
        p.setValueAtTime(muted ? 0 : currentGain(), t);
        if (!muted && !stopped && !halted) p.setTargetAtTime(FULL_GAIN, t, TAU_UP);
      } else if (!muted && !stopped && !halted) {
        audio.volume = FULL_GAIN;
      }
    },

    stop() {
      stopped = true;
      halted = false;
      audio.pause();
    },

    isStopped: () => stopped,

    debug: () => ({
      paused: audio.paused,
      muted: audio.muted,
      // 斜坡未走完时读到的是路上值：稳定后 >0.2s 再断言即可（验证脚本已如此处理）
      gain: gainNode ? gainNode.gain.value : audio.volume,
      ctx: ctx ? ctx.state : 'none',
      webAudio: !!ctx,
      halted,
    }),

    dispose() {
      audio.pause();
      audio.currentTime = 0;
      if (fadeRaf) {
        cancelAnimationFrame(fadeRaf);
        fadeRaf = 0;
      }
      // 关掉 context，否则 StrictMode 双挂载会一次泄漏一个 AudioContext
      if (ctx) {
        void ctx.close().catch(() => {});
        ctx = null;
        gainNode = null;
      }
    },
  };
}
