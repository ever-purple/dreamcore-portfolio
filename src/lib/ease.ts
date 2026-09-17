/**
 * 全站缓动曲线 —— **JS 侧**（2026-09-16 第二档 ⑥）
 * ---------------------------------------------------------------------------
 * 和 src/index.css 里那 5 个 `--ease-*` token 是**同一套曲线的两个语言版本**。
 * 改一处必须改另一处，这张表就是对照单：
 *
 *     CSS token          GSAP（本文件）        数值（cubic-bezier）
 *     --ease-world       EASE.world           0.22, 1, 0.36, 1      落定 / 出场
 *     --ease-world-in    EASE.worldIn         0.55, 0.02, 0.9, 0.42  冲出去 / 离场
 *     --ease-pop         EASE.pop             0.34, 1.56, 0.64, 1    弹跳 / overshoot
 *     --ease-io          EASE.io              0.4, 0, 0.2, 1         对称进出
 *     --ease-in          EASE.in              0.5, 0, 0.75, 0        加速离场
 *
 * 为什么不直接用 GSAP 的 `power3.out` / `expo.out` / `sine.inOut`
 * ---------------------------------------------------------------------------
 * 因为那是**第三套**命名法。CSS 侧写 cubic-bezier、JS 侧写 powerN.out，
 * 两边"看着差不多"但永远对不齐：`power3.out` 是 quart、`power4.out` 才是本站
 * 的 world 曲线，写错一个数字（3 还是 4）没有任何东西会报错，只有"这个页面的
 * 入场怎么跟别的页面手感不一样"这种说不清的观感差异。
 *
 * 所以这里用 GSAP 3.13+ 随包免费的 `CustomEase`，把 CSS 的 cubic-bezier
 * **原样转成 GSAP 缓动函数** —— 不是"接近"，是同一个函数：
 *     三次贝塞尔 (x1,y1) (x2,y2) ≡ SVG path  M0,0 C x1,y1 x2,y2 1,1
 * 这样"内容页进场"在 CSS 和 JS 里走的是同一条曲线，改 token 两边一起变。
 *
 * 用法：`gsap.to(el, { autoAlpha: 1, ease: EASE.world })`
 */
import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';

gsap.registerPlugin(CustomEase);

/** cubic-bezier(x1,y1,x2,y2) → CustomEase（≡ 同一条三次贝塞尔曲线） */
function bezier(id: string, x1: number, y1: number, x2: number, y2: number) {
  return CustomEase.create(id, `M0,0 C${x1},${y1} ${x2},${y2} 1,1`);
}

export const EASE = {
  /** 落定 / 出场 —— 全站主力。等价于 CSS `--ease-world` */
  world: bezier('wkp-world', 0.22, 1, 0.36, 1),
  /** 冲出去 / 离场加速 —— 等价于 CSS `--ease-world-in` */
  worldIn: bezier('wkp-world-in', 0.55, 0.02, 0.9, 0.42),
  /** 弹跳 / overshoot —— 等价于 CSS `--ease-pop` */
  pop: bezier('wkp-pop', 0.34, 1.56, 0.64, 1),
  /** 对称进出 —— 等价于 CSS `--ease-io` */
  io: bezier('wkp-io', 0.4, 0, 0.2, 1),
  /** 加速离场 —— 等价于 CSS `--ease-in` */
  in: bezier('wkp-in', 0.5, 0, 0.75, 0),
} as const;
