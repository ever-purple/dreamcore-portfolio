/**
 * 卡片「圆柱面弯曲」绘制 —— 参考站那层顶点着色器的 Canvas 等价实现。
 * ---------------------------------------------------------------------------
 * **为什么不能继续用 CSS 3D 变换**
 *   参考站（mattjinn.com）把每一帧视频贴成 WebGL 纹理，然后在**顶点着色器**里把整条
 *   片子的顶点按 `θ = x / R` 挪到圆柱面上 —— 于是卡片的**上下两条边真的变成弧线**，
 *   两端朝观众收拢、中间朝观众鼓出来，就是凸透镜 / 桶形。
 *
 *   而 CSS 3D 变换是**仿射**的：屏幕上任何直线在变换后还是直线。所以
 *   `translateZ + rotateY + skewX` 拼出来的只是「透视梯形 + 斜切」—— 上边永远笔直、
 *   左右缘只会被整体拉长压短。作者的原话是「很生硬」，说的正是这个：
 *   平面卡在透视里被斜切，看着像一张歪掉的照片，而不是一张拱起来的弧面。
 *
 * **所以这里改成一帧一画**：把源画面（当前那条卡的 `<video>`，其余用 poster 图）
 * 沿水平方向切成 N 条竖切片，每条切片按它在圆柱面上的角度单独投影后 `drawImage` 过去。
 *   · 竖直方向的缩放 `s = d / (d + z)` 让两端的切片**变矮** → 上下边成为弧线；
 *   · 弧长映射 `x = R·sinφ` 让画面**越靠边越压缩** → 桶形 / 凸透镜的横向挤压；
 *   · 顺手按 `1 − cosφ` 给转过去的侧面**压暗** → 卡片有体积，不是一张剪成弧形的贴纸。
 *
 * ⚠️ 与 WebGL 的差别只有一处：这里是「CPU 切条 + 光栅化」，参考站是 GPU 里一个 draw call。
 *    所以切片数要克制 —— 见下面 SLICES 的推导，16 条以上折线对真弧线的偏差已 < 0.05px，
 *    取 24 条是为了让相邻切片的接缝有富余，不是精度需要。
 */

/** 一次绘制需要的圆柱参数（由 {@link cylinderFrom} 推出；验证脚本复用同一条公式） */
export type CylinderParams = {
  /** 0 = 完全不弯（平面矩形），1 = 弯到头 */
  bend: number;
  /** 弧顶落在卡片宽度上的归一化位置：-1 = 左缘，0 = 正中，+1 = 右缘 */
  apex: number;
  /** 卡内透视视距（px）—— 越小透视越强、两端缩得越狠 */
  dist: number;
  /** bend=1 时卡片铺开的弧**半角**（弧度） */
  halfAngle: number;
  /** 背向观众的侧面压暗强度 0~1 */
  shade: number;
  /** 纵向切片数 */
  slices: number;
};

/* ============================ 调参区 ============================
 * 改手感只动这几个数。单位都是「bend=1 时」的极值。 */

/**
 * 弧半角：36° ≈ 半径 675px（848px 宽的卡片）。定这个值的依据是**参考站量出来的数**：
 * 顶边弦斜率峰值约 3~4°，在 424px 的半宽上对应弧高约 26px —— 36°/1100px 视距算出来
 * 25px，对得上。（2026-09-16 第一版给了 28°/1300px，实测弧高只有 14px，太含蓄。）
 */
const MAX_HALF_ANGLE = (36 * Math.PI) / 180;
/**
 * 卡内透视视距 —— **决定"边缘往回收"的强度**：yh = (H/2)·D/(D + R(1−cosφ))。
 * 2026-09-21 从 1100 收到 950：照参考站无头实测校正（1920×1000 视口、卡片 894×549）——
 *   静止时顶边 sag 只有 **3px（平的）**；过渡中鼓到 **39~73px ≈ 卡片高的 13%**。
 *   950px 下弧两端缩到 86.9%（sag ≈13%），1100px 只有 88.5%（sag ≈11.5%），偏含蓄。
 * 用户对这一段的口径是：「不仅仅是凸起来，而是**像一张幕布**一样，除了凸起来的地方
 * 其他地方的边缘会向里收」—— 所以这个值（连同 WIDTH_DROP）就是"收多少"的旋钮。
 */
const VIEW_DIST = 950;
/**
 * 弧顶跟随 `--off` 偏移的系数：**弧顶朝屏幕中心偏**（off=±1 时挪到卡片 ±APEX_K 处）。
 *
 * 2026-09-21 用户明确要求（原话）：「不是中间凸起来形成一个鼓，而是滚轮下滑时右边鼓起来、
 * 上滑左边鼓起，两个视频画布之间有一种被拉扯过来的感觉」——
 * 也就是整条片子是**绕屏幕中心那根圆柱**摊开的，而不是每张卡各鼓各的：
 *   · 下滑（下一条从右边进来）→ 右邻的**内缘**（朝屏幕中心那条边）最近、朝观众凸，
 *     于是"右边鼓起来"；上滑时反过来，左邻的内缘凸 →"左边鼓起"；
 *   · 跨格中途，左右两张卡的内缘同时朝观众鼓出来，中间的缝隙被撑开 ——
 *     这就是"两块画布之间被拉扯过来"的来源。
 * ⚠️ 别把这里改回 0（2026-09-21 中途试过，得到的是"每张卡自对称的桶形"，正是用户否掉的那个）；
 *    也别给太大：CSS 那边还有一发 `rotateY(off · bulge · 26deg)` 负责把外缘转走，
 *    两边叠加会变成夸张的楔形（2026-09-16 第一版给到 0.8，两侧卡直接斜成三角形）。
 */
const APEX_K = 0.5;
/** 弧顶偏移上限 —— 超过 ±1 弧顶就跑出卡片了，卡片会退化成楔形 */
const APEX_MAX = 0.5;
/** 侧面压暗强度 */
const SHADE = 0.32;
/**
 * 切片数。
 * 顶边是折线的拼接，对真弧线的最大偏差 = |y''|·Δx²/8；实测口径下 16 条已 < 0.05px
 * （肉眼极限约 0.3px），24 条纯粹给接缝留富余。
 */
const SLICES = 24;
/**
 * 横向收窄量：bend=1 时卡片投影宽度收到 91%（左右各留 4.5% 透明）。
 * 2026-09-21 从 0.05 提到 0.09 —— 参考站过渡中实测卡片宽度从 894 收到 776~858
 * （收 4%~13%），它同样是"幕布"观感的一半（横着也在往里收，不是只有上下边弯）。
 * ⚠️ 别调到 0.2 以上：卡片会在跨格时明显"缩一圈"，像被抽走而不是被顶起来。
 */
const WIDTH_DROP = 0.09;
/** 小于它就按平面绘制（省掉 24 次切片，静止时一个 drawImage 就够） */
export const FLAT_EPS = 0.012;

/** 默认参数（bend=0 的平面状态） */
export const FLAT_PARAMS: CylinderParams = {
  bend: 0,
  apex: 0,
  dist: VIEW_DIST,
  halfAngle: MAX_HALF_ANGLE,
  shade: SHADE,
  slices: SLICES,
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 由两个驱动量推出圆柱参数。
 *
 * @param bulge 跨格进度 |current − round(current)| × 2 —— 落位 0 / 正跨在两条中间 1
 * @param off   这张卡到当前落位的距离 i − current（夹在 ±2.2），决定弧顶偏向哪边
 *
 * **圆柱的轴在屏幕中心**（2026-09-21 用户口径）：off>0（卡片在中心右侧）时它的**左缘**
 * 朝向屏幕中心、是离观众最近的那条 → 弧顶左移（apex 取负）；off<0 时反过来。
 * 于是"下滑右边鼓、上滑左边鼓"，两张卡的内缘一起凸出来形成被拉扯的观感。
 */
export function cylinderFrom(bulge: number, off: number): CylinderParams {
  const bend = clamp(bulge, 0, 1);
  // off>0 = 卡片在屏幕中心**右侧** → 它的左缘朝向中心 → 弧顶左移 → apex 取负
  const apex = clamp(-off * APEX_K, -APEX_MAX, APEX_MAX);
  return { bend, apex, dist: VIEW_DIST, halfAngle: MAX_HALF_ANGLE, shade: SHADE, slices: SLICES };
}

/**
 * 把一帧画面按圆柱面投影画进 ctx。
 *
 * 坐标系：以卡片左上角为原点，单位是 CSS px（调用方需先把 ctx 的 transform 设成 dpr 缩放）。
 * 源画面按 `object-fit: cover` 语义裁切，所以 `srcW/srcH` 与卡片比例不同也不会变形。
 *
 * @returns 是否真的画了东西（无可用帧 / 尺寸非法时返回 false，调用方应保留上一帧）
 */
export function drawBentCard(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource | null,
  srcW: number,
  srcH: number,
  W: number,
  H: number,
  p: CylinderParams = FLAT_PARAMS,
): boolean {
  if (W <= 0 || H <= 0) return false;
  ctx.clearRect(0, 0, W, H);
  if (!src || !(srcW > 0) || !(srcH > 0)) return false;

  /* ---- object-fit: cover 的源取样框 ---- */
  const cover = Math.max(W / srcW, H / srcH);
  const cropW = W / cover;
  const cropH = H / cover;
  const cropX = (srcW - cropW) / 2;
  const cropY = (srcH - cropH) / 2;

  const bend = clamp(p.bend, 0, 1);
  if (bend <= FLAT_EPS) {
    ctx.drawImage(src, cropX, cropY, cropW, cropH, 0, 0, W, H);
    return true;
  }

  /* ---- 圆柱面映射 ----
   * 弧长 = 卡片宽度 → 半径 R = W / (2θ)；点 u∈[-1,1] 在弧上的角度 φ = (u − apex)·θ。 */
  const theta = bend * p.halfAngle;
  const R = W / (2 * theta);
  const D = Math.max(200, p.dist);
  const cx = W / 2;
  const cy = H / 2;
  const apex = clamp(p.apex, -1, 1);
  const angleAt = (u: number) => (u - apex) * theta;
  const arcX = (u: number) => R * Math.sin(angleAt(u));

  /* 横向重新归一化到卡片自己的宽度（见 WIDTH_DROP 说明），但要**先减掉两端中点**，
     否则弧顶偏移时整幅画面会整体横移出格子。 */
  const midArc = (arcX(-1) + arcX(1)) / 2;
  const span = arcX(1) - arcX(-1) || 1;
  const kx = (W * (1 - WIDTH_DROP * bend)) / span;
  const xAt = (u: number) => cx + (arcX(u) - midArc) * kx;
  /** 竖直半高 + 「转过去的程度」（1 − cosφ，0 = 正对观众） */
  const yAt = (u: number) => {
    const phi = angleAt(u);
    const s = D / (D + R * (1 - Math.cos(phi)));
    return { yh: (H / 2) * s, away: 1 - Math.cos(phi) };
  };

  const awayMax = Math.max(yAt(-1).away, yAt(1).away) || 1;
  const slices = Math.max(4, Math.round(p.slices));

  /* ⚠️ 必须开平滑：切片之间是靠重采样拼起来的，关掉平滑会出现硬边。 */
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'medium';

  /* ⚠️ 相邻切片必须**横向重叠**，否则每条缝上会出现一道发丝白线。
     原因是 `clip()` 的边界是抗锯齿的：切片 k 在共享边界 x₁ 上只覆盖约 50%，
     切片 k+1 同样只覆盖约 50%，两次 source-over 合成后 alpha = 0.5 + 0.5×0.5 = 0.75
     —— 于是每 1/24 卡宽就有一列 25% 透明的竖线，叠在白底上就是一片"栅栏"。
     （2026-09-16 实测：截图放大后肉眼可见。）
     解法：路径的两条竖边各向外扩 EXT px，让相邻切片在这 2px 上重叠；
     后画的切片以不透明内容盖住前一条的抗锯齿边，缝就消失了。
     纵向的 `BLEED` 是为源重采样准备的，两者作用不同，别合并。 */
  const EXT = 1;
  const BLEED = 1;
  const srcSliceW = cropW / slices;
  let prev = { x: xAt(-1), ...yAt(-1) };

  for (let i = 0; i < slices; i += 1) {
    const u1 = -1 + (2 * (i + 1)) / slices;
    const cur = { x: xAt(u1), ...yAt(u1) };
    const yhMax = Math.max(prev.yh, cur.yh);
    const l = prev.x - EXT;
    const r = cur.x + EXT;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(l, cy - prev.yh);
    ctx.lineTo(r, cy - cur.yh);
    ctx.lineTo(r, cy + cur.yh);
    ctx.lineTo(l, cy + prev.yh);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(
      src,
      cropX + i * srcSliceW - BLEED,
      cropY,
      srcSliceW + BLEED * 2,
      cropH,
      l - BLEED,
      cy - yhMax,
      Math.max(0.75, r - l) + BLEED * 2,
      yhMax * 2,
    );

    /* 侧面压暗：越背着观众越暗（clip 之后 fillRect 只会落在切片里） */
    if (p.shade > 0) {
      const a = p.shade * (((prev.away + cur.away) / 2) / awayMax);
      if (a > 0.004) {
        ctx.fillStyle = `rgba(0,0,0,${a.toFixed(4)})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
    ctx.restore();
    prev = cur;
  }
  return true;
}
