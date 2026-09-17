/**
 * 装饰形状生成器 —— 产出 `src/components/decorShapes.ts`（**不要手改那份文件**）。
 *
 * ## 为什么形状是"遮罩"而不是"图"
 * 参考图里的花/星/字母有一个共同点：**它们是由点（或线）构成的面**，不是实心色块
 * （图1 蓝底白点花、图2 草丛上的白+淡黄点阵花、图4 网眼蕾丝、图5 星星拼的字母）。
 * 而"点"必须能跟着令牌换色 —— 数据 URI 里的 SVG **读不到 CSS 变量**
 * （同 index.css 顶部图案注释里那条结论）。所以分工是：
 *
 *     SVG = 只有 alpha 的**剪影**（形状）→ 当 mask-image
 *     点阵 = CSS `radial-gradient` 平铺，颜色写 `var(--pdecor-color)` → 当 background
 *
 * 于是形状本身可以烤死成纯黑，颜色与浓度 100% 由 CSS 决定。
 *
 * ## 用法
 *   node scripts/gen-decor-shapes.mjs
 * 改了下面的参数（花瓣数 / 长度 / 抖动）就重跑一次。
 *
 * ## 约束
 * · 所有形状的 viewBox 都是 **200×200**（正方形）—— 元素按 100% 100% 拉伸遮罩，
 *   非正方形会被拉歪，所以 CSS 里宽高必须相等（.pdecor__orn 已用 aspect-ratio 保证）。
 * · 形状方向一律**朝上**（花头在 +Y 反方向），旋转交给 CSS 的 `--rot`。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'src', 'components', 'decorShapes.ts');

const R = (n) => Math.round(n * 100) / 100;
const n2 = (n) => String(R(n));
/** 极坐标 → SVG 坐标字符串（角度按屏幕坐标：0° 向右、90° 向下） */
const polar = (deg, r) => `${n2(Math.cos((deg * Math.PI) / 180) * r)},${n2(Math.sin((deg * Math.PI) / 180) * r)}`;

const uri = (inner, extra = '') =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"${extra}>${inner}</svg>`,
  );

/** 五角星 / 四角星的点串。R = 外径，r = 内径，n = 角数，rot = 起始角（-90 = 尖朝上） */
const starPts = (R, r, n = 5, rot = -90) =>
  Array.from({ length: n * 2 }, (_, i) => polar(rot + (i * 180) / n, i % 2 ? r : R)).join(' ');

/* ============================================================
   1. blossom —— 五瓣实心花（图1 那朵）
   petals 之间的角度**不均匀**（72° 均分读起来像齿轮），用一组手工错开的角，
   再加一点点半径差异，就有"手画"的松弛感。
   ============================================================ */
const BLOSSOM_PETALS = [
  { a: -96, rx: 29, ry: 50, d: 50 },
  { a: -20, rx: 26, ry: 46, d: 48 },
  { a: 54, rx: 30, ry: 52, d: 51 },
  { a: 126, rx: 27, ry: 47, d: 47 },
  { a: 200, rx: 28, ry: 51, d: 50 },
];
const blossom = uri(
  `<g transform="translate(100,104)">` +
    BLOSSOM_PETALS.map(
      (p) =>
        `<ellipse cx="0" cy="${n2(-p.d)}" rx="${n2(p.rx)}" ry="${n2(p.ry)}" transform="rotate(${n2(p.a)})"/>`,
    ).join('') +
    `<circle r="13"/>` +
    BLOSSOM_PETALS.map((p) => `<circle cx="${polar(p.a + 36, 24)}" r="4"/>`).join('') +
    `</g>`,
);

/** 只有一个花头、花瓣更细的版本（给"疏"的位置用） */
const blossomThin = uri(
  `<g transform="translate(100,104)">` +
    Array.from({ length: 6 }, (_, i) => {
      const a = -90 + i * 60 + (i % 2 ? 6 : -4);
      return `<ellipse cx="0" cy="-46" rx="17" ry="44" transform="rotate(${n2(a)})"/>`;
    }).join('') +
    `<circle r="9"/>` +
    `</g>`,
);

/* ============================================================
   2. lily —— 六瓣线描百合 + 花瓣上的实心星（图3）
   参考图3 的画法是"白线勾轮廓 + 实心小白星"，所以这里**笔画**（fill:none + stroke）
   而不是填充。stroke 在遮罩里同样是 alpha —— 线描出来的花，点阵只会落在线上。
   ============================================================ */
const LILY_PETAL = 'M0,0 C-21,-19 -31,-58 0,-98 C31,-58 21,-19 0,0 Z';
/* ⚠️ 两组花瓣**都要**写 fill/stroke：漏写的那一组会退回默认的"黑填充"，
   整朵花立刻糊成一坨实心（第一版就是这么错的）。stroke 取 2.4 —— 比点阵的
   5px 网格细，所以点阵落上去是**断续的珠链**，正好是参考图3 那种线描感。 */
const LILY_STROKE = 'fill="none" stroke="#000" stroke-width="2.4" stroke-linejoin="round"';
const lily = uri(
  `<g transform="translate(100,102)" ${LILY_STROKE}>` +
    [0, 60, 120].map((a) => `<path d="${LILY_PETAL}" transform="rotate(${n2(-90 + a)})"/>`).join('') +
    `</g>` +
    `<g transform="translate(100,102)" ${LILY_STROKE}>` +
    [30, 90, 150].map((a) => `<path d="${LILY_PETAL}" transform="rotate(${n2(-90 + a)})"/>`).join('') +
    `</g>` +
    /* 花瓣上的实心星（图3 的签名细节）：三颗，大小不一 */
    `<g transform="translate(100,102)">` +
    [
      [0, -50, 15],
      [34, -30, 10],
      [-30, -40, 8],
    ]
      .map(([x, y, s]) => `<g transform="translate(${n2(x)},${n2(y)})"><polygon points="${starPts(s, s * 0.42)}"/></g>`)
      .join('') +
    /* 花蕊：六根细线从中心散出 */
    Array.from({ length: 6 }, (_, i) => {
      const a = -90 + i * 60 + 30;
      const [x1, y1] = polar(a, 6).split(',').map(Number);
      const [x2, y2] = polar(a, 34).split(',').map(Number);
      return `<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="#000" stroke-width="1.8" stroke-linecap="round"/>`;
    }).join('') +
    `</g>`,
);

/* ============================================================
   3. spray —— 放射状"烟花花"（图2 草丛上那朵）
   13 根长短不一的射线 + 中心核 + 外围散点（散点是"能量散开"的关键，
   只画射线会像太阳）。角度刻意不完全均匀、长度有个 2 的倍数关系，读起来才有飘动感。
   ============================================================ */
const RAYS = [
  [-90, 62], [-62, 44], [-36, 54], [-8, 40], [20, 58], [46, 42], [74, 50],
  [104, 38], [132, 56], [160, 44], [188, 52], [216, 40], [244, 48], [272, 38],
];
const spray = uri(
  `<g transform="translate(100,100)">` +
    RAYS.filter((_, i) => i % 2 === 0)
      .map(([a, L]) => `<ellipse cx="0" cy="${n2(-L)}" rx="2.4" ry="${n2(L)}" transform="rotate(${n2(a)})"/>`)
      .join('') +
    RAYS.filter((_, i) => i % 2 === 1)
      .map(([a, L]) => `<ellipse cx="0" cy="${n2(-L)}" rx="1.6" ry="${n2(L)}" transform="rotate(${n2(a)})"/>`)
      .join('') +
    `<circle r="10"/>` +
    /* 外围散点：射线末端再往外撒一层，越远越小 */
    RAYS.map(([a, L], i) => {
      const d = L + 8 + (i % 3) * 4;
      return `<circle cx="${polar(a + (i % 2 ? 5 : -5), d)}" r="${n2(i % 3 === 0 ? 3.2 : 2.1)}"/>`;
    }).join('') +
    `</g>`,
);

/* ============================================================
   4. sprig —— 一枝带叶的茎（图1 下面的枝叶）
   边缘位置用它比再摆一朵花好：它有**方向**，能顺着页面边线"长"。
   ============================================================ */
const LEAF = 'M0,0 C-16,-13 -21,-40 0,-64 C21,-40 16,-13 0,0 Z';
const sprig = uri(
  `<g transform="translate(96,196)">` +
    /* 主茎：一条微微弯的粗线 */
    `<path d="M0,0 C-3,-56 6,-104 2,-152" fill="none" stroke="#000" stroke-width="4.6" stroke-linecap="round"/>` +
    /* 三片叶：两左一右，角度错开 */
    [
      { x: 0, y: -42, a: -138, s: 0.92 },
      { x: 3, y: -88, a: -44, s: 1.05 },
      { x: 1, y: -124, a: -142, s: 0.8 },
    ]
      .map((l) => `<path d="${LEAF}" transform="translate(${n2(l.x)},${n2(l.y)}) rotate(${n2(l.a + 90)}) scale(${n2(l.s)})"/>`)
      .join('') +
    /* 顶端一个小花头（同 blossom 的缩小版，让这枝"有结果"） */
    `<g transform="translate(2,-158) scale(0.36)">` +
    BLOSSOM_PETALS.map(
      (p) => `<ellipse cx="0" cy="${n2(-p.d)}" rx="${n2(p.rx)}" ry="${n2(p.ry)}" transform="rotate(${n2(p.a)})"/>`,
    ).join('') +
    `<circle r="13"/>` +
    `</g>` +
    `</g>`,
);

/* ============================================================
   5. star / sparkle —— 实心五角星（图3、图6）与四角闪光
   五角星内径取 0.42R：太小会变成"针"，太大会变成"盾牌"。
   ⚠️ 点串是以 **0,0 为中心**算的，必须 translate(100,100) —— 少这一层的话
      只有右下那一角落在 viewBox 里，读出来是个"箭头"（第一版就是这么错的）。
   ============================================================ */
const star = uri(`<g transform="translate(100,100)"><polygon points="${starPts(98, 41)}"/></g>`);
const sparkle = uri(`<g transform="translate(100,100)"><polygon points="${starPts(98, 17, 4, -90)}"/></g>`);

/* ============================================================
   6. oval —— 珠串椭圆框（图4 左边那圈蕾丝框）
   做法是"粗绳子 + 大虚线 + 圆头线帽"：虚线的每一段被圆头补成一颗珠子。
   ============================================================ */
const oval = uri(
  `<ellipse cx="100" cy="100" rx="74" ry="94" fill="none" stroke="#000" ` +
    `stroke-width="17" stroke-dasharray="1 13" stroke-linecap="round"/>` +
    `<ellipse cx="100" cy="100" rx="52" ry="70" fill="none" stroke="#000" stroke-width="1.6" stroke-dasharray="4 8"/>`,
);

/* ============================================================
   7. bow —— 线描蝴蝶结（图6 薄荷底上那几个）
   两片环 + 两条飘带 + 一个结。环用椭圆描边，飘带用尖三角，
   整体只描边不填充 —— 和参考图一样是"透气"的。
   ============================================================ */
const bow = uri(
  `<g transform="translate(100,92)" fill="none" stroke="#000" stroke-width="4" stroke-linejoin="round">` +
    `<ellipse cx="-34" cy="-6" rx="34" ry="23" transform="rotate(-16 -34 -6)"/>` +
    `<ellipse cx="34" cy="-6" rx="34" ry="23" transform="rotate(16 34 -6)"/>` +
    `<path d="M0,-20 C-14,-6 -14,10 0,22 C14,10 14,-6 0,-20 Z" fill="#000"/>` +
    `<path d="M-6,22 C-16,44 -30,58 -40,66 L-16,60 C-8,48 -2,36 0,26 Z"/>` +
    `<path d="M6,22 C16,44 30,58 40,66 L16,60 C8,48 2,36 0,26 Z"/>` +
    `</g>`,
);

/* ============================================================
   8. TILE_STARS —— 星星平铺 tile（图5：巧克力底上均匀铺满的薄荷星阵）
   96×96 的 tile 里四颗星（两大两小、错位成"散"的样子），mask-size 96px repeat。
   供 .pdecor__tiled--stars 当 mask —— 颜色照旧走 CSS 变量，这里只有剪影。
   四颗星都离 tile 边 ≥ 5.5px，repeat 拼接处不会出现裁半颗的星。
   ============================================================ */
const tileStar = (cx, cy, R) =>
  `<g transform="translate(${n2(cx)},${n2(cy)})"><polygon points="${starPts(R, R * 0.42)}"/></g>`;
const TILE_STARS =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
      tileStar(27, 27, 15) +
      tileStar(72, 63, 10) +
      tileStar(76, 14, 5.5) +
      tileStar(20, 76, 5.5) +
      `</svg>`,
  );

/* ============================================================ */

const SHAPES = {
  blossom,
  blossomThin,
  lily,
  spray,
  sprig,
  star,
  sparkle,
  oval,
  bow,
};

const banner = `/**
 * 装饰形状的**遮罩**（mask-image 用）—— 由 \`scripts/gen-decor-shapes.mjs\` 生成。
 * ⚠️ 不要手改这份文件：形状是参数化算出来的（花瓣角、茎的弧度、星的内外径…），
 *    要调就改生成器再跑一次 \`node scripts/gen-decor-shapes.mjs\`。
 *
 * 为什么这里只有"剪影"、没有颜色：
 *   数据 URI 里的 SVG **读不到 CSS 变量**，所以形状只保留 alpha，
 *   颜色与浓度由 CSS 的 \`--pdecor-color\` + 点阵 background 决定 —— 换配色不用碰这份文件。
 *   （同一条理由见 index.css 顶部「薄荷巧克力的图案」那段注释。）
 *
 * 每个形状的 viewBox 都是 200×200（正方形），所以元素必须等宽高
 * （.pdecor__orn 已用 \`aspect-ratio: 1\` 保证），否则遮罩会被拉歪。
 */

export const SHAPE = {
`;

const body = Object.entries(SHAPES)
  .map(([k, v]) => `  // ${v.length} 字符\n  ${k}: '${v}',`)
  .join('\n');

fs.writeFileSync(
  OUT,
  `${banner}${body}\n} as const;\n\nexport type ShapeName = keyof typeof SHAPE;\n\n` +
    `/** 星星平铺 tile（96×96，四颗星）：.pdecor__tiled--stars 的 mask，TSX 里内联传入。 */\n` +
    `export const TILE_STARS = '${TILE_STARS}';\n`,
  'utf8',
);

console.log(`已生成 ${OUT}`);
for (const [k, v] of Object.entries(SHAPES)) console.log(`  ${k.padEnd(13)} ${v.length} 字符`);
