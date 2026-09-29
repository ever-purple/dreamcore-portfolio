import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 序列帧加载器：**首窗优先放行 + 末窗优先加载 + 滚动插队**。
 *
 * ---------------------------------------------------------------------------
 * 为什么从「全量等完」改成「首窗放行」（2026-09-29 实测驱动）
 * ---------------------------------------------------------------------------
 * 上一版是「120 张全部解码完成才算 complete」。它的理由是「加载页本来就等了这 120 张，
 * 所以不额外增加等待」——**这个前提在慢网下不成立**，线上实测把它彻底推翻：
 *
 *   · 单张帧 108 KB 耗时 0.99 s → 链路只有约 **110 KB/s**
 *   · 120 张并发 8 全量下完 → **25.3 秒** / 10.69 MB / 平均 432 KB/s
 *   · 而本 hook 的兜底超时是 **18000 ms**，`useAssetPreload` 那侧是 12000 ms
 *
 * 于是放行时帧只下到 60%~72%，**缺的正好是序号末尾的「门开露黄光」**（App 放行条件是
 * `assetsReady && framesComplete`，所以以更晚的 18 s 为准）。再加上绘制端
 * `nearestLoadedLE()` 只向下兜底、重绘门禁又要求「进度必须变化才重绘」，
 * 迟到的帧永远补不上 —— 用户看到的「转很久、滚不全、结尾不出画面」就是这么来的。
 *
 * 关键事实：**首页进入的那一刻只需要第 1 帧**。300vh 的滚动行程走完要好几秒，
 * 后面的帧完全来得及在用户滚到之前陆续到位。所以「等全部」是把 25 秒的等待
 * 押在了用户根本还没看到的地方。
 *
 * 现在：只等**首窗**（前 `headCount` 张）就放行，同时把**末窗**（最后 `priorityTail` 张）
 * 提到队首 —— 保证滚到 100% 时「门开露黄光」那一帧一定在。其余帧按序后台补。
 *
 * ---------------------------------------------------------------------------
 * 三条优先级队列
 * ---------------------------------------------------------------------------
 *   urgent（focus 插队） > head（首窗，决定何时放行） > tail（末窗，结局保障） > rest（其余）
 *
 * `focus(frame)` 由 HomeSection 每帧滚动时调用（`onFrameFocus`），把光标附近的帧
 * 提到最前面。它在上一版是个空操作（`useCallback(() => {}, [])`）—— 那个遗漏导致
 * 「滚到哪一帧、那一帧还没下」时只能干等。现在复活：向前 2 帧、向后 14 帧插队。
 *
 * ---------------------------------------------------------------------------
 * 退出条件
 * ---------------------------------------------------------------------------
 * `complete`（= 放行）= 首窗全部定案 **或** 超时兜底。**坏图也算定案**
 * （`onerror` 同样计数），否则一张 404 就能把用户永久困在加载页。
 */

export interface WindowedFrames {
  /**
   * 稀疏数组：没加载到的位置 naturalWidth === 0，绘制端自行跳过。
   * 引用**全程稳定**，不会把绘制 effect 拖进「每加载一张就重算一次」。
   */
  images: HTMLImageElement[];
  /** 首窗就绪（与 complete 同义，保留两个名字是为了不改调用方） */
  ready: boolean;
  /** 首窗就绪 → 可以放行加载页 */
  complete: boolean;
  /** 已定案张数（成功 + 失败） */
  loadedCount: number;
  /**
   * 滚动到第 `frame` 帧时调用，把邻近未加载的帧插到队首。
   * 向前 2 帧（回滚时马上要用）、向后 14 帧（下滚的主要方向）。
   */
  focus: (frame: number) => void;
  /**
   * 每有一张帧定案就 +1。**绘制端用它判断「有没有迟到的帧需要补画」**。
   *
   * 为什么不是普通 state：帧会在几秒内陆续到位上百次，每次都 setState 会把
   * App 连同 HomeSection 重渲染上百轮（上一版注释里叫「把加载页拖成幻灯片」）。
   * 用 ref 则零渲染开销，消费方（HomeSection 的 rAF tick）在每帧顺手读一下即可。
   */
  revisionRef: { current: number };
  /**
   * 加载**失败**的张数（404 / 解码失败）。调用方用它决定要不要换一档编码重来。
   *
   * 为什么必须有：序列帧解码失败**不报错**，`onerror` 同样算「定案」，
   * 所以格式选错时的表现不是崩溃，而是**那一格永远没有画面**。
   */
  erroredRef: { current: number };
}

export interface WindowedFramesOptions {
  /**
   * 并发解码上限，默认 16（2026-09-30 从 12 提上来）。
   *
   * 为什么提到 16：现在加载页要**等整片下完才放行**（见 App 的 READY_FRAMES），
   * 下载总量从「首窗 8 张」变成「整片 120 张」，吞吐直接决定加载页停留时长。
   * Vercel 走 HTTP/2（一条连接多路复用，不受 6 连接/域限制），跨境高 RTT 链路上
   * 「在飞请求数」正是填满带宽-时延积的关键 —— 12 个流填不满，16 明显更快。
   *
   * 为什么不敢更高：解码虽然 `decoding='async'`，但同时在飞太多张会让低端机
   * 的解码线程排队、拖慢首帧出现。16 是「填管 + 不压垮解码」的折中。
   */
  concurrency?: number;
  /**
   * 兜底超时：到点即使首窗还没下完也算 `complete`，把用户放行。
   * 没有它的话慢网（3G / 弱 Wi-Fi）会被永久困在加载页 —— `useAssetPreload` 那个
   * 超时**救不了这里**，因为 App 的放行条件是 `assetsReady && framesComplete`，
   * 而 `framesComplete` 只从本 hook 来。
   * 没下完的帧由绘制端的 `nearestLoadedLE()` / 内联兜底帧顶替。
   *
   * 从 18000 降到 12000 再降到 7000：现在等的只是 8 张（约 0.7 MB）而不是 120 张
   * （10.7 MB），7 秒还下不完就是真的不可用了，早放行早让用户看到东西。
   */
  timeoutMs?: number;
  /** 首窗大小：前几张到位就放行，默认 8 */
  headCount?: number;
  /** 末尾优先帧数：把最后这几张提到队首，保证「开门」结局帧一定在，默认 16 */
  priorityTail?: number;
  /**
   * 是否开始加载。**默认 true**；传 `false` 时这个 hook 完全不动 ——
   * 既不请求、也**不放行**（`complete` 保持 false）。
   *
   * 为什么需要它：App 要先异步探测「这个浏览器能不能解 AVIF」，探测期间帧的 URL
   * 还不知道。若那时把 `urls = []` 传进来，本 hook 的「空列表直接放行」分支
   * 会立刻把加载页放掉 —— 首页会在帧一张都没下的时候就露出来。
   *
   * ⚠️ 别用「传个占位 URL」之类的绕法，那会先把 WebP 首窗拉起来、探测完成后再换
   * AVIF，白烧掉 8 个请求（约 640KB）的带宽。宁可晚一个微任务再开始。
   */
  enabled?: boolean;
}

/**
 * 慢网兜底放行时间。**从 18000 → 12000 → 7000 三连降。**
 *
 * 最初等 120 张（10.7MB）给 18s；改为「只等首窗 8 张」后降到 12s；
 * 现在再降到 **7000ms** —— 因为首窗只有 8 张（大屏 ~0.7MB / 小屏 ~0.22MB），
 * 即便在 100KB/s 的弱网下也只需 ~7s 就能下完，更慢的链路基本等于不可用，
 * 早放行比让用户盯着 0% 的转圈更有意义。
 *
 * ⚠️ 与 `LoadingScreen` 的「时间爬升」进度是配套的：超时那一刻数字刚好爬到 ~99%，
 * 不会有「数字冻在 0% 十几秒」的观感（用户原话「一直在转圈」就是这么来的）。
 */
const DEFAULT_TIMEOUT = 7000;
/** 首窗：约 0.7 MB（大屏）/ 0.22 MB（小屏），足够铺满进入时的第一屏 */
const DEFAULT_HEAD = 8;
/** 末窗：90% 滚动阈值（第 108 张）之后到 119 全部覆盖，留足余量 */
const DEFAULT_TAIL = 16;
/**
 * 首窗之后上报进度的间隔（张）。App 靠 `loadedCount` 判断「帧下到几成了、
 * 什么时候轮到 GLB 预热」。每 16 张报一次 → 120 张总共最多 7 次额外渲染。
 */
const PROGRESS_STEP = 16;

/** 帧状态：0 未开始 / 1 在飞 / 2 定案（成功或失败） */
const IDLE = 0;
const INFLIGHT = 1;
const SETTLED = 2;

export function useWindowedFrames(
  urls: string[],
  options: WindowedFramesOptions = {},
): WindowedFrames {
  const {
    concurrency = 16,
    timeoutMs = DEFAULT_TIMEOUT,
    headCount = DEFAULT_HEAD,
    priorityTail = DEFAULT_TAIL,
    enabled = true,
  } = options;

  const imagesRef = useRef<HTMLImageElement[]>([]);
  if (imagesRef.current.length !== urls.length) {
    imagesRef.current = Array.from({ length: urls.length });
  }
  const images = imagesRef.current;

  /** 滚动插队队列。住在 ref 里，因为要跨 effect 与事件回调共享同一份 */
  const urgentRef = useRef<number[]>([]);
  /** 让 `focus` 能唤醒 effect 内的 pump（pump 是闭包，外面拿不到） */
  const pumpRef = useRef<() => void>(() => {});
  /** 定案计数。绘制端读它来判断「迟到的帧要不要补画」 */
  const revisionRef = useRef(0);
  /** 失败张数。调用方读它来判断「是不是编码格式选错了」 */
  const erroredRef = useRef(0);

  const [state, setState] = useState<{ ready: boolean; complete: boolean; loadedCount: number }>({
    ready: false,
    complete: false,
    loadedCount: 0,
  });

  useEffect(() => {
    const n = urls.length;

    // 还没决定用哪一档编码：什么都不做，也**不放行**（详见 enabled 的注释）
    if (!enabled) return;

    // 空列表：直接放行，别让调用方永远等一个不会来的 ready
    if (n === 0) {
      setState({ ready: true, complete: true, loadedCount: 0 });
      return;
    }

    let cancelled = false;
    let done = 0;
    let active = 0;
    // 每换一次 URL（也就等于换一档编码）就把失败计数清零 —— 上一档的失败不该
    // 拖累这一档的判定。
    erroredRef.current = 0;

    /** 首窗大小（夹到 [0, n]）—— 它决定「什么时候放行」 */
    const head = Math.max(0, Math.min(headCount, n));
    /** 末窗大小（不超过剩下的帧数） */
    const tail = Math.max(0, Math.min(priorityTail, Math.max(0, n - head)));

    const status = new Uint8Array(n);
    /** 还差几张首窗帧，归零即放行 */
    let headLeft = head;

    // 三条优先级队列。pump 依次取：head → tail → rest
    const headQ: number[] = [];
    const tailQ: number[] = [];
    const restQ: number[] = [];
    for (let i = 0; i < head; i += 1) headQ.push(i);
    for (let i = Math.max(head, n - tail); i < n; i += 1) tailQ.push(i);
    for (let i = head; i < n - tail; i += 1) restQ.push(i);

    let timer = 0;

    /** 放行加载页。重复调用安全（首窗完成 / 超时 / 全部到齐都会走到这里） */
    const release = () => {
      if (cancelled) return;
      window.clearTimeout(timer);
      setState((s) => (s.complete ? s : { ready: true, complete: true, loadedCount: done }));
    };

    /** 一张帧定案：记账 → 推进首窗进度 → 接着填队 */
    const complete = (i: number) => {
      if (status[i] !== SETTLED) {
        status[i] = SETTLED;
        done += 1;
      }
      if (cancelled) return;

      revisionRef.current += 1;

      if (headLeft > 0 && i < head) {
        headLeft -= 1;
        if (headLeft === 0) {
          release();
        } else {
          // 首窗还没齐 —— 报一次进度，让加载页的百分比走得平滑。
          // 首窗期间最多 head 次（8 次）setState，开销可忽略。
          setState((s) => (s.complete ? s : { ready: false, complete: false, loadedCount: done }));
        }
      } else if (done >= n) {
        // 全部到齐：即使首窗早就放行了，也把 loadedCount 补成满值
        window.clearTimeout(timer);
        setState({ ready: true, complete: true, loadedCount: n });
        return;
      } else if (done % PROGRESS_STEP === 0) {
        // 首窗之后**节流**上报进度。
        //
        // 为什么要报：App 用它决定「什么时候轮到 GLB 预热」——
        // 2026-09-29 用户报「中间滚动动画断了、直接跳到门开」，根因就是预热组在
        // 加载页一消失（`entered`）就起跑，6 个 GLB（含 9.5MB 的 rack.glb）正好在
        // 用户开始滚动那一刻占掉近一半带宽，中间那 96 张帧一张都下不来。
        // 现在改成「帧下到七成」才放行预热。
        //
        // 为什么节流：每张都 setState 会重渲染 App 112 次；完全不报外面又看不到进度。
        setState((s) => (s.complete ? { ready: true, complete: true, loadedCount: done } : s));
      }
      pump();
    };

    const start = (i: number) => {
      status[i] = INFLIGHT;

      const url = urls[i];
      const img = images[i] ?? (images[i] = new Image());

      // 已解码（组件重挂载但 images 是同一份引用）或空槽：直接定案，不发请求。
      // ⚠️ 这两条分支**不能**走 settle() —— 那条路会 active -= 1，而这里没加过。
      if (img.naturalWidth > 0 || url === undefined) {
        complete(i);
        return;
      }

      active += 1;
      img.decoding = 'async';
      img.onload = () => {
        active -= 1;
        complete(i);
      };
      // 坏图也要放行，别让它把 complete 永远卡住；同时记一笔失败，
      // 让调用方能判断「是不是整档编码都解不了」，进而换一档重来。
      img.onerror = () => {
        active -= 1;
        erroredRef.current += 1;
        complete(i);
      };
      img.src = url;
    };

    /** 取下一个该加载的索引：urgent → head → tail → rest。已排队过的跳过 */
    const dequeue = (): number => {
      const urgent = urgentRef.current;
      while (urgent.length > 0) {
        const i = urgent.shift() as number;
        if (status[i] === IDLE) return i;
      }
      const queues = [headQ, tailQ, restQ];
      for (let q = 0; q < queues.length; q += 1) {
        const queue = queues[q];
        while (queue.length > 0) {
          const i = queue.shift() as number;
          if (status[i] === IDLE) return i;
        }
      }
      return -1;
    };

    const pump = () => {
      if (cancelled) return;
      while (active < concurrency) {
        const i = dequeue();
        if (i < 0) return;
        start(i);
      }
    };
    pumpRef.current = pump;

    // 超时兜底：到点无条件放行。必须放在 pump() 之前 —— release 里 clearTimeout(timer)，
    // 而 pump() 会同步调进 complete → release，若 timer 还没初始化就会撞上 TDZ。
    timer = window.setTimeout(() => {
      if (cancelled) return;
      setState((s) => (s.complete ? s : { ready: true, complete: true, loadedCount: done }));
    }, timeoutMs);

    pump();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      pumpRef.current = () => {};
      images.forEach((img) => {
        if (!img) return;
        img.onload = null;
        img.onerror = null;
      });
    };
  }, [urls, concurrency, timeoutMs, headCount, priorityTail, images, enabled]);

  /**
   * 滚动到第 `frame` 帧 → 把邻近未加载的帧插到队首。
   * HomeSection 的 tick 在帧号变化时调它（原 `onFrameFocus`）。
   */
  const focus = useCallback(
    (frame: number) => {
      const n = urls.length;
      if (!Number.isFinite(frame)) return;
      const at = Math.max(0, Math.min(n - 1, Math.floor(frame)));
      const urgent = urgentRef.current;
      // 向前 2 帧（回滚时立刻要用）→ 向后 14 帧（下滚的主要方向）
      for (let i = at - 2; i <= at + 14; i += 1) {
        if (i < 0 || i >= n) continue;
        if (!urgent.includes(i)) urgent.push(i);
      }
      // 唤醒 pump：当前可能有空闲并发位
      pumpRef.current();
    },
    [urls.length],
  );

  return {
    images,
    ready: state.ready,
    complete: state.complete,
    loadedCount: state.loadedCount,
    focus,
    revisionRef,
    erroredRef,
  };
}
