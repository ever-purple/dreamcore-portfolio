import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 序列帧「全量预加载」—— 回到最初的实现。
 *
 * 为什么又把窗口式换成全量：
 * ---------------------------------------------------------------------------
 * 窗口式（只保 [focus-6, focus+20] 里的帧、窗口外主动 removeAttribute('src') 释放解码）
 * 为了省内存牺牲了「滚动到哪一帧、那一帧就一定在」，实测出来的三个症状合起来
 * 正是用户说的「显示不全，甚至不动」：
 *
 *   ① 快速下滚：当前进度那张还没解码完，只能拿"最近的已解码旧帧"顶上
 *      → 画面冻在某一帧不动，等解码追上来再突然跳一大段（中间几十帧全没看到）。
 *   ② 回滚（100 → 0）：下滚时被释放掉的帧要重新下载，
 *      → 上滚时画面卡住，根本回不到起点。
 *   ③ 刚进入时首帧若还没解码，且静止时 tick 认为"进度没变"就不重绘
 *      → canvas 一直是纯黑，什么都看不到。
 *
 * 全量的代价是常驻显存（120 × 2560×1443×4B ≈ 1.7GB），换来的是**任何时刻滚到
 * 哪一帧就有哪一帧**：0 → 100 完整开门到 OPEN，100 → 0 完整回到起点，两个方向
 * 都是连续的，不会冻、不会跳、不会黑屏。
 *
 * 关于"要不要等 64MB"：加载页本来就等了全部帧（useAssetPreload 的 wait 里就有
 * 这 120 张，而且它也是用 Image 解码的），所以这里**不会额外增加等待**——
 * 字节已经在缓存里，只是再建一份常驻的解码位图给 canvas 用。
 */

export interface WindowedFrames {
  /**
   * 稀疏数组：没加载到的位置 naturalWidth === 0，绘制端自行跳过。
   * 引用**全程稳定**，不会把绘制 effect 拖进「每加载一张就重算一次」。
   */
  images: HTMLImageElement[];
  /** 全部解码完成（全量加载下与 complete 同义，保留两个名字是为了不改调用方） */
  ready: boolean;
  /** 全部就绪 */
  complete: boolean;
  /** 已就绪张数 */
  loadedCount: number;
  /**
   * 全量加载没有「焦点窗口」的概念，这里退化为空操作。
   * 保留在接口里，HomeSection 不用改签名。
   */
  focus: (frame: number) => void;
}

export interface WindowedFramesOptions {
  /** 并发解码上限，默认 12。120 张同时发会把主线程和带宽一起打满 */
  concurrency?: number;
  /**
   * 兜底超时：到点即使还没全下完也算 `complete`，把用户放行。
   * 没有它的话慢网（3G / 弱 Wi-Fi）会被永久困在加载页 —— `useAssetPreload` 那个
   * 12s 超时**救不了这里**，因为 App 的放行条件是 `assetsReady && framesComplete`，
   * 而 `framesComplete` 只从本 hook 来。
   * 没下完的帧由绘制端的 `nearestLoadedLE()` 顶替（画最近一张已就绪的），
   * 所以放行后画面是"稍糊但一直在动"，而不是黑屏或冻帧。
   */
  timeoutMs?: number;
}

/** 慢网兜底放行时间。3.2MB 的移动端帧集在这个时限内能跑满 1.4Mbps 以上的链路 */
const DEFAULT_TIMEOUT = 18000;

export function useWindowedFrames(
  urls: string[],
  options: WindowedFramesOptions = {},
): WindowedFrames {
  const { concurrency = 12, timeoutMs = DEFAULT_TIMEOUT } = options;

  const imagesRef = useRef<HTMLImageElement[]>([]);
  if (imagesRef.current.length !== urls.length) {
    imagesRef.current = Array.from({ length: urls.length });
  }
  const images = imagesRef.current;

  const [state, setState] = useState<{ ready: boolean; complete: boolean; loadedCount: number }>({
    ready: false,
    complete: false,
    loadedCount: 0,
  });

  useEffect(() => {
    let cancelled = false;
    let done = 0;
    let next = 0;
    let active = 0;

    /** 全部到位时对外置一次状态（避免 120 次 setState 把加载页拖成幻灯片） */
    const markAllDone = () => {
      if (cancelled) return;
      window.clearTimeout(timer);
      setState({ ready: true, complete: true, loadedCount: done });
    };

    /** 一张解码完成（或失败） */
    const settle = () => {
      active -= 1;
      if (cancelled) return;
      done += 1;
      if (done >= urls.length) {
        done = urls.length;
        markAllDone();
      }
      pump();
    };

    const start = (i: number) => {
      const url = urls[i];
      const img = images[i] ?? (images[i] = new Image());

      // 组件重挂载但数组是同一个引用 → 已解码的直接算完成，不重复请求
      if (img.naturalWidth > 0) {
        done += 1;
        if (done >= urls.length) markAllDone();
        return;
      }
      // 空槽 / 坏 URL：也要计数，否则 complete 永远等不到
      if (url === undefined) {
        done += 1;
        if (done >= urls.length) markAllDone();
        return;
      }

      active += 1;
      img.decoding = 'async';
      img.onload = () => settle();
      // 坏图也要放行，别让它把 complete 永远卡住
      img.onerror = () => settle();
      img.src = url;
    };

    const pump = () => {
      if (cancelled) return;
      while (active < concurrency && next < urls.length) {
        const i = next;
        next += 1;
        start(i);
      }
    };

    // 空列表：直接放行，别让调用方永远等一个不会来的 ready
    if (urls.length === 0) {
      setState({ ready: true, complete: true, loadedCount: 0 });
      return;
    }

    // 超时兜底：到点无条件放行，没下完的帧交给绘制端的 nearestLoadedLE 顶替。
    // 必须放在 pump() 之前 —— markAllDone 里 clearTimeout(timer)，而 pump() 会同步
    // 调进 markAllDone，若 timer 还没初始化就会撞上 TDZ（const 的暂时性死区）。
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setState((s) => (s.complete ? s : { ready: true, complete: true, loadedCount: done }));
    }, timeoutMs);

    pump();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      images.forEach((img) => {
        if (!img) return;
        img.onload = null;
        img.onerror = null;
      });
    };
  }, [urls, concurrency, timeoutMs, images]);

  // 全量加载：focus 不再需要
  const focus = useCallback(() => {}, []);

  return {
    images,
    ready: state.ready,
    complete: state.complete,
    loadedCount: state.loadedCount,
    focus,
  };
}
