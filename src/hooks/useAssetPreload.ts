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
 *              内容是首屏真正要用的东西（现在的定义是「首页本体那一串序列帧」）。
 *   prefetch —— 只预热 HTTP 缓存，不计入百分比、不阻塞放行，**且等 wait 组跑完才开始**。
 *              给「点进去才用得上的大模型」用（工作室里的 6 个 GLB，含 9MB 的 rack.glb），
 *              这样进工作室时它多半已经在缓存里了，不会卡一下。
 *              2026-09-28：原来它在加载页期间就并行开拉，等于跟序列帧抢带宽，
 *              现在改成 ready 门控 + 并发 3，首屏带宽独占。
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
  /**
   * 预热组的门控，**覆盖**默认的「wait 组 ready」。
   *
   * 为什么需要它（2026-09-29 实测）：wait 组从「全部 120 张帧」改成「首窗 8 张」之后，
   * wait 组 1 秒就跑完了 —— 预热组于是跟着提前到第 1 秒起跑，跟剩下的 112 张帧抢带宽。
   * 实测首屏下载的 4.02MB 里**有 1.48MB 是这些 GLB**（mascot 344KB / dvd 325KB /
   * dv 314KB …），而它们首页一个都用不到。现在由 App 传 `entered`：
   * **加载页消失之后**才开始预热。
   */
  prefetchGate?: boolean;
}

const DEFAULT_TIMEOUT = 12000;

/** 预热组的并发上限。6 个模型（含 9MB 的 rack.glb）一起发会把网络打满 */
const PREFETCH_CONCURRENCY = 3;

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
  prefetchGate,
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
    // **wait 组跑完（ready）之后**才允许预热（调用方可用 prefetchGate 覆盖）。
    // 这里原来是「固定延迟 1.2s 就开跑」，等于在加载页还在等帧的时候跟它抢带宽 ——
    // 首屏最慢的那几秒里，一个 9MB 的 rack.glb 正在并行下载，把帧挤到后面。
    // ⚠️ 2026-09-29 补：wait 组缩到「首窗 8 张」之后，`ready` 1 秒就到，
    // 这道闸门形同虚设 —— 实测首屏下载的 4.02MB 里 1.48MB 是这些 GLB。
    // 所以 App 现在传 `prefetchGate = entered`，把预热推到**加载页消失之后**。
    const gate = prefetchGate ?? ready;
    if (!gate) return;
    let cancelled = false;
    // 省流量模式 / 2G/3G：别为了预热烧用户流量
    if (!worthPrefetching()) return;

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      let finished = 0;
      let active = 0;
      const queue = [...prefetch];

      const finish = () => {
        active -= 1;
        if (cancelled) return;
        finished += 1;
        setPrefetchDone(finished);
        pump();
      };

      /** 限量并发：6 个模型一起发会把刚刚好起来的网络又打满 */
      const pump = () => {
        while (active < PREFETCH_CONCURRENCY && queue.length > 0) {
          const url = queue.shift() as string;
          active += 1;
          fetch(url)
            .then((r) => {
              if (!r.ok) throw new Error(String(r.status));
              return r.arrayBuffer(); // 只进 HTTP 缓存，解析交给 three.js
            })
            .then(finish)
            .catch(finish);
        }
      };

      pump();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [prefetchKey, ready, prefetchGate]);

  return { done, total: wait.length, ready, prefetchDone, prefetchTotal: prefetch.length };
}
