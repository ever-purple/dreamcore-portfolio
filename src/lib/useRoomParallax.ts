import { useEffect, type RefObject } from 'react';
import { prefersReduced } from '@/lib/motion-pref';

/**
 * 工作室房间的「鼠标动、背景也动」景深视差（2026-09-16 第六轮 / 用户第 1 条需求）。
 *
 * ## 参考片是怎么做的
 * `屏幕录制 2026-09-16 232934.mp4`（用户给的参考）是一段水下镜头：鼠标一动，
 * **不同深度的层走不同的量** —— 远景（地平线）几乎不动、中景（气泡）动一些、
 * 前景（鱼）动得最多。所以读起来是"镜头在空间里转"，而不是"一整张照片在平移"。
 * 这是本改造唯一条不能省的规则：**只动一层 = 平移，动三层才叫视差**。
 *
 * ## 落到工作室房间
 * 房间只有一块画面板（视频 + 镜头畸变），所以纵深靠"板上板下的两样东西"造出来：
 *   ① `.studio-lens-root` —— 整块画面板，最远，1× + 3.5% 余量放大
 *   ② `.studio-vignette`  —— 氛围暗角，相当于"空气"，1.6×
 * ⚠️ `.pulse-dot`（物件上的脉冲提醒点）**故意不参与**（2026-09-17 用户第 1 条要求：
 *    「鼠标视差晃动时，那四个脉冲圈不要跟着动」）。它原本是最远/最近里"最近"的那层（2.2×），
 *    但它是**交互提示**不是景物：跟着晃会显得像可点物体在飘。别把它加回来。
 * ⚠️ 倍率全部写在 `index.css` 里，**不在这里**。本模块只产出一个归一化主量：
 *    `--px` / `--py`，画面正中 = 0、左右/上下边缘 = ±1（**无单位**）。
 *    写好一处、两层各自去乘 —— 调景深不用碰 JS，而且层与层天然同步、不会各飘各的。
 *
 * ## 为什么用弹簧-阻尼，而不是 `cur += (t - cur) * k`
 * 和 `StudioLensBackground` 的水波同源：指数插值虽然也滞后，但没有惯性、停得"死"；
 * 弹簧带一点过冲再收住，才有"镜头有重量"的感觉（用户对动效的一贯要求是"慢一点、要有惯性"）。
 * 参数是照水波那套数值选出来的，主量约 0.25s 到位。
 *
 * ## 两个必须留的细节
 *  1. **量化后写入**：值没变就不 `setProperty`。弹簧会无限逼近目标，不量化的话
 *     每帧都产生一个极小差值 → 每帧都改 transform → 白白唤醒合成器。
 *     量化到 1/400（≈ 0.0025）后，"鼠标静止"就是零开销。
 *  2. **鼠标离开画面要归位**（blur / pointerleave → 目标回 0）：否则下次进来时
 *     画面会从上次那个偏移"横穿"回来，很脏。
 *
 * ## 调试
 * `?roompar=0.6,-0.4` 把主量钉在指定位置（沿用 `?lensreveal=` 的约定）——
 * 无头截图与回归探针里没有真实鼠标，只有钉住才能验证两层真的各自位移了。
 */

/** 刚度：越大跟得越紧（与水波的主水波同档） */
const STIFF = 0.045;
/** 阻尼：越小越黏 */
const FRIC = 0.86;
/** 写入前的量化档位：1/400 */
const QUANT = 400;

const clamp1 = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

export function useRoomParallax(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    const vel = { x: 0, y: 0 };

    const last: Record<string, string> = {};
    const write = (name: string, v: number) => {
      const s = (Math.round(v * QUANT) / QUANT).toFixed(3);
      if (last[name] === s) return;
      last[name] = s;
      root.style.setProperty(name, s);
    };

    /* ---- 调试钉值：钉住就不再跟鼠标（也不挂监听）---- */
    const pin = new URLSearchParams(window.location.search).get('roompar');
    if (pin !== null) {
      const [sx, sy] = pin.includes(',') ? pin.split(',') : ['0.6', '-0.4'];
      const nx = Number.parseFloat(sx);
      const ny = Number.parseFloat(sy);
      cur.x = target.x = clamp1(Number.isFinite(nx) ? nx : 0.6);
      cur.y = target.y = clamp1(Number.isFinite(ny) ? ny : -0.4);
      write('--px', cur.x);
      write('--py', cur.y);
      return;
    }

    // 关掉动效 → 什么都不写，让 CSS 里 `var(--px, 0)` 的兜底值生效（静止在正中）
    if (prefersReduced()) return;

    const settle = () => {
      target.x = 0;
      target.y = 0;
    };

    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // 归一化到 -1..1：注意除以的是**变换后**的 rect —— 画面板自己带 scale/translate，
      // 但按变换后的盒子归一化得到的仍是元素本地坐标，所以水波 mask 依旧贴着鼠标。
      target.x = clamp1(((e.clientX - r.left) / r.width) * 2 - 1);
      target.y = clamp1(((e.clientY - r.top) / r.height) * 2 - 1);
    };

    let raf = 0;
    const tick = () => {
      vel.x = (vel.x + (target.x - cur.x) * STIFF) * FRIC;
      vel.y = (vel.y + (target.y - cur.y) * STIFF) * FRIC;
      cur.x += vel.x;
      cur.y += vel.y;
      write('--px', cur.x);
      write('--py', cur.y);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', settle);
    document.addEventListener('pointerleave', settle);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', settle);
      document.removeEventListener('pointerleave', settle);
      root.style.removeProperty('--px');
      root.style.removeProperty('--py');
    };
  }, [rootRef]);
}
