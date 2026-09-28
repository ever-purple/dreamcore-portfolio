import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 序列帧「窗口式」预加载。
 *
 * 为什么不用 useImagePreloader：那个版本要等 120 张 2560×1443 的 JPG 全部下完
 * 才置 complete，而 LoadingScreen 与 HomeSection 的滚动门禁都挂在 complete 上，
 * 于是首屏必须等 64MB 才动 —— 慢网下等于打不开。
 *
 * 更隐蔽的问题是内存：120 张全解码约 2560×1443×4B ≈ 1.7GB，移动端会被系统直接杀掉。
 *
 * 这里的取舍：**不降画质**（帧依然是原始 2560×1443），只降「同时要下的量」和「同时占多少内存」。
 *   · 开局只等前 readyCount 张（默认 12 张 ≈ 4MB）就放行；
 *   · focus(frame) 由滚动 tick 驱动，围绕当前位置展开 [frame-behind, frame+ahead] 取窗；
 *   · 窗口外的帧主动释放解码位图（removeAttribute('src')），滚回来再从 HTTP 缓存补；
 *     正常速度下这些帧基本还在内存缓存里，用户感知不到二次加载。
 *   · 没到位的帧在绘制端自然「停住」，用户看到的是原地等一下，而不是白屏或降级模糊。
 */

export interface WindowedFrames {
  /**
   * 稀疏数组：没加载到的位置 naturalWidth === 0，绘制端自行跳过。
   * 引用**全程稳定**，不会把绘制 effect 拖进「每加载一张就重算一次」。
   */
  images: HTMLImageElement[];
  /** 首个窗口就绪 —— 放行用它，别用 complete */
  ready: boolean;
  /** 全部就绪 —— 只用来停调度 */
  complete: boolean;
  /** 已就绪张数 */
  loadedCount: number;
  /** 告诉 hook 当前滚动落在第几帧，据此展开预取窗口 */
  focus: (frame: number) => void;
}

export interface WindowedFramesOptions {
  /** 开局放行所需的张数，默认 12（≈4MB @360KB/张） */
  readyCount?: number;
  /** 预取窗口向前看多少张，默认 20 */
  ahead?: number;
  /** 预取窗口向后保留多少张，默认 6 */
  behind?: number;
  /** 跑出窗口多远释放解码，默认 32。必须 > ahead，否则和预取打架 */
  recycle?: number;
  /** 并发请求上限，默认 6 */
  concurrency?: number;
}

export function useWindowedFrames(
  urls: string[],
  options: WindowedFramesOptions = {},
): WindowedFrames {
  const {
    readyCount = 12,
    ahead = 20,
    behind = 6,
    recycle = 32,
    concurrency = 6,
  } = options;

  const imagesRef = useRef<HTMLImageElement[]>([]);
  if (imagesRef.current.length !== urls.length) {
    imagesRef.current = Array.from({ length: urls.length });
  }
  const images = imagesRef.current;

  const focusRef = useRef<(frame: number) => void>(() => {});
  const [state, setState] = useState<{ ready: boolean; complete: boolean; loadedCount: number }>({
    ready: false,
    complete: false,
    loadedCount: 0,
  });

  useEffect(() => {
    let cancelled = false;

    const requested = new Set<number>();
    const recycled = new Set<number>();
    const loaded = new Set<number>();
    const queue: number[] = [];
    let active = 0;
    let lastFocus = -1;

    /** 释放解码位图：槽位置空，滚回来时会被重新请求（多半命中内存缓存） */
    const recycleOne = (i: number) => {
      const img = images[i];
      if (!img) return;
      img.onload = null;
      img.onerror = null;
      img.removeAttribute('src');
      recycled.add(i);
      // 清掉「已请求」标记，否则 focus 不会重新把它排进队列
      requested.delete(i);
    };

    const settle = (i: number) => {
      active -= 1;
      if (cancelled) return;
      loaded.add(i);
      const n = loaded.size;
      setState((s) => ({
        ready: s.ready || n >= Math.min(readyCount, urls.length),
        complete: n >= urls.length,
        loadedCount: n,
      }));

      // 落在窗口外的（可能在排队期间被滚动甩开的）顺手放掉解码
      if (lastFocus >= 0 && Math.abs(i - lastFocus) > recycle) recycleOne(i);

      Promise.resolve().then(pump);
    };

    const loadOne = (i: number) => {
      const url = urls[i];
      if (url === undefined) return;
      requested.add(i);
      recycled.delete(i);
      active += 1;
      const img = images[i] ?? (images[i] = new Image());
      img.decoding = 'async';
      img.onload = () => settle(i);
      // 坏图也要放行，别让它把 ready 永远卡住；不重试，重试只会拖慢进度
      img.onerror = () => settle(i);
      img.src = url;
    };

    const pump = () => {
      while (active < concurrency && queue.length > 0) {
        loadOne(queue.shift() as number);
      }
    };

    const doFocus = (frame: number) => {
      const f = Math.max(0, Math.min(urls.length - 1, Math.round(frame) || 0));
      lastFocus = f;

      // 1) 把窗口内缺的排进队列，近的先补
      const fresh: number[] = [];
      const lo = Math.max(0, f - behind);
      const hi = Math.min(urls.length - 1, f + ahead);
      for (let i = lo; i <= hi; i += 1) {
        if (requested.has(i) || i < readyCount) continue;
        fresh.push(i);
      }
      if (fresh.length > 0) {
        fresh.sort((a, b) => Math.abs(a - f) - Math.abs(b - f));
        queue.push(...fresh);
        pump();
      }

      // 2) 窗口外的放掉解码，别让 1.7GB 位图堆在内存里
      const rlo = f - recycle;
      const rhi = f + recycle;
      for (let i = 0; i < urls.length; i += 1) {
        if (i >= rlo && i <= rhi) continue;
        if (requested.has(i) && !recycled.has(i)) recycleOne(i);
      }
    };

    // 开局只排前 readyCount 张；其余等 focus 驱动
    for (let i = 0; i < Math.min(readyCount, urls.length); i += 1) queue.push(i);
    lastFocus = 0;
    focusRef.current = doFocus;
    pump();

    return () => {
      cancelled = true;
      focusRef.current = () => {};
      // 稀疏数组里还有空槽（尚未请求的帧），不判空会在这里把整个渲染树打挂
      images.forEach((img) => {
        if (!img) return;
        img.onload = null;
        img.onerror = null;
      });
    };
  }, [urls, readyCount, ahead, behind, recycle, concurrency, images]);

  const focus = useCallback((frame: number) => focusRef.current(frame), []);

  return {
    images,
    ready: state.ready,
    complete: state.complete,
    loadedCount: state.loadedCount,
    focus,
  };
}
