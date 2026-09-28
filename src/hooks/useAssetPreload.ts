import { useEffect, useState } from 'react';

/**
 * 真实资源加载进度（加载页 0→100% 的唯一数据来源）。
 *
 * 为什么要另建一个，而不是在 LoadingScreen 里计时：
 * 计时器跟「实际下完了多少」毫无关系，网快网慢都走 3 秒，
 * 看着像在加载，其实进度条是假的。这里改成一条一条地等真实资源。
 *
 * 分成两组：
 *   wait    —— 计进百分比、也决定什么时候放行加载页。
 *              内容是首屏真正要用的东西（前 N 张序列帧 + 几个小模型）。
 *   prefetch —— 只预热 HTTP 缓存，不计入百分比、不阻塞放行。
 *              给「点进去才用得上的大模型」用（比如 9MB 的书架 rack.glb），
 *              这样进工作室时它多半已经在缓存里了，不会卡一下。
 *
 * 三条保底规则（否则慢网/断网会把用户永久困在加载页）：
 *   1. 单个资源挂了也算完成，不重试；
 *   2. 起一个总超时，到点强制放行；
 *   3. 走「省流量」或 2G/3G 时不预热大模型。
 */

export interface AssetPreload {
  /** 计入百分比的部分 */
  done: number;
  total: number;
  /** wait 组到齐（或超时）→ 放行 */
  ready: boolean;
  prefetchDone: number;
  prefetchTotal: number;
}

interface Options {
  /** 计入进度、决定是否放行 */
  wait: string[];
  /** 后台预热，只在空闲时拉，不影响放行 */
  prefetch?: string[];
  timeoutMs?: number;
  /** 同时最多拉几个。120 张帧一起发会打满带宽、把关键资源挤没，必须限流 */
  concurrency?: number;
}

const DEFAULT_TIMEOUT = 12000;

/** 判断这批资源是否值得后台预热（省流量模式 / 慢网就别烧用户流量了） */
function worthPrefetching(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!c) return true;
  if (c.saveData) return false;
  return !/^(slow-2g|2g|3g)$/.test(String(c.effectiveType || ''));
}

/** 一张图要能被绘制端直接用，得解码，所以用 Image；.glb 只把字节拉进缓存就够 */
const isImage = (url: string) => /\.(jpe?g|png|webp|gif|avif|svg)$/i.test(url);

export function useAssetPreload({
  wait,
  prefetch = [],
  timeoutMs = DEFAULT_TIMEOUT,
  concurrency = 8,
}: Options): AssetPreload {
  const [done, setDone] = useState(0);
  const [ready, setReady] = useState(false);
  const [prefetchDone, setPrefetchDone] = useState(0);

  const waitKey = wait.join('|');
  const prefetchKey = prefetch.join('|');

  useEffect(() => {
    let cancelled = false;
    const list = wait.length > 0 ? wait : [];

    if (list.length === 0) {
      setDone(0);
      setReady(true);
      return;
    }

    let finished = 0;
    let active = 0;
    const queue = [...list];

    const finish = () => {
      if (cancelled) return;
      finished += 1;
      setDone(finished);
      if (finished >= list.length) setReady(true);
      pump(); // 腾出一个位置，队列里还有就接着来
    };

    /** 限流：一次最多 concurrency 个在飞，剩下的排队 */
    const pump = () => {
      while (active < concurrency && queue.length > 0) {
        const url = queue.shift() as string;
        active += 1;
        const done = () => {
          active -= 1;
          finish();
        };
        if (isImage(url)) {
          const img = new Image();
          img.decoding = 'async';
          img.onload = done;
          img.onerror = done; // 坏图也放行，别让一张坏图把这页卡死
          img.src = url;
        } else {
          fetch(url)
            .then((r) => {
              if (!r.ok) throw new Error(String(r.status));
              return r.arrayBuffer(); // 只进 HTTP 缓存，解析交给 three.js
            })
            .then(done)
            .catch(done);
        }
      }
    };

    // 超时兜底：到点无条件放行（再慢也不能把人困在加载页）
    const timer = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, timeoutMs);

    pump();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // waitKey 才是真正的依赖（数组每次渲染都是新引用，直接放数组会无限重跑）
  }, [waitKey, timeoutMs]);

  useEffect(() => {
    if (prefetch.length === 0) return;
    let cancelled = false;
    if (!worthPrefetching()) return;

    // 晚 1.2 秒再拉，别跟首屏抢带宽
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      let finished = 0;
      const finish = () => {
        if (cancelled) return;
        finished += 1;
        setPrefetchDone(finished);
      };
      prefetch.forEach((url) => {
        fetch(url)
          .then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            return r.arrayBuffer();
          })
          .then(finish)
          .catch(finish);
      });
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [prefetchKey]);

  return { done, total: wait.length, ready, prefetchDone, prefetchTotal: prefetch.length };
}
