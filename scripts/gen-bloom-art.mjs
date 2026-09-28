/* ASCII 花系生成器（参考用户给的 ascii art 花素材）。
 * 跑法：node scripts/gen-bloom-art.mjs   —— stdout 出图（人工审形），同时烤进
 *       src/components/bloomAsciiArt.ts。
 *
 * 通用模型：一朵花 = 若干「花瓣环」+ 可选「花丝/花药」+ 可选花心；可选一根花杆。
 *   花瓣环 ring：{ count 花瓣数, len 长, width 宽, sharp 尖端锐度, bend 外翻量, r0 起始半径, phase 相位 }
 *   花丝 stamens：{ count, len, bend, r0, filW 花丝粗, tipW 花药粗, tip 花药段长 }
 * 字符密度：花瓣 # % * +（脊→缘）、花丝 : 、花药 @ 、花心 # 、花杆 | 。
 * 字符格约 0.5 宽 × 1 高 —— 画布近似正方形，花不会被拉扁。
 */
import { writeFileSync } from 'node:fs';

const TAU = Math.PI * 2;
const CW = 0.5;

const spine = (t, th, bend, r0, len) => {
  const phi = th + bend * Math.pow(t / len, 2);
  const r = r0 + t;
  return [r * Math.cos(phi), r * Math.sin(phi)];
};
/** 花瓣半宽剖面：p=0 起点、p=1 尖端；sharp 越大越尖 */
const halfProfile = (t, len, width, sharp) => {
  const p = Math.min(1, t / len);
  return (width * Math.pow(Math.sin(Math.PI * Math.pow(p, 0.8)), sharp)) / 2;
};

function render({ W, H, blooms, stem }) {
  const cxg = (W - 1) / 2, cyg = (H - 1) / 2;
  const grid = Array.from({ length: H }, () => new Array(W).fill(' '));
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const x = (col - cxg) * CW, y = row - cyg;
      let best = { r: 9, kind: null };

      if (stem) {
        const sway = stem.sway * Math.sin((y + 3) / stem.period);
        if (y > stem.fromY && Math.abs(x - sway) < stem.half) best = { r: 0.1, kind: 'stem' };
        for (const ped of stem.pedicels ?? []) {
          for (let k = 0; k <= 40; k++) {
            const u = k / 40;
            const px = stem.x0 + (ped.x - stem.x0) * u, py = stem.y0 + (ped.y - stem.y0) * u;
            if (Math.hypot(x - px, y - py) < 0.5) best = { r: 0.1, kind: 'stem' };
          }
        }
      }

      for (const b of blooms) {
        const dx = x - b.x, dy = y - b.y;
        for (const ring of b.rings) {
          for (let i = 0; i < ring.count; i++) {
            const th = i * (TAU / ring.count) + (b.rot ?? 0) + (ring.phase ?? 0);
            for (let k = 0; k <= 90; k++) {
              const t = (k / 90) * ring.len;
              const [sx, sy] = spine(t, th, ring.bend, ring.r0, ring.len);
              const half = halfProfile(t, ring.len, ring.width, ring.sharp);
              const d = Math.hypot(dx - sx, dy - sy);
              if (d < half) {
                const ratio = d / half;
                if (ratio < best.r) best = { r: ratio, kind: 'petal' };
              }
            }
          }
        }
        const s = b.stamens;
        if (s) {
          for (let i = 0; i < s.count; i++) {
            const th = i * (TAU / s.count) + (b.rot ?? 0) + TAU / (s.count * 2) + (s.phase ?? 0);
            for (let k = 0; k <= 90; k++) {
              const t = (k / 90) * s.len;
              const [sx, sy] = spine(t, th, s.bend, s.r0, s.len);
              const isTip = t > s.len - s.tip;
              const half = (isTip ? s.tipW : s.filW) / 2;
              const d = Math.hypot(dx - sx, dy - sy);
              if (d < half) {
                const ratio = d / half;
                if (ratio < best.r) best = { r: ratio, kind: isTip ? 'anther' : 'fil' };
              }
            }
          }
        }
        if (b.core && Math.hypot(dx, dy) < b.core && best.r > 0.4) best = { r: 0.2, kind: 'core' };
      }

      let ch = ' ';
      if (best.kind === 'petal')
        ch = best.r < 0.28 ? '#' : best.r < 0.52 ? '%' : best.r < 0.78 ? '*' : '+';
      else if (best.kind === 'core') ch = '#';
      else if (best.kind === 'anther') ch = '@';
      else if (best.kind === 'fil') ch = ':';
      else if (best.kind === 'stem') ch = '|';
      grid[row][col] = ch;
    }
  }
  return grid.map((r) => r.join('').replace(/\s+$/, '')).join('\n');
}

/* ------------------------------- 花谱 ------------------------------- */

/* 彼岸花（red spider lily）：6 枚肥厚窄瓣 + 6 根**比瓣还长**的花丝（顶端 `@` 花药簇）
   + 底部一根裸露花葶 `|`。三个特征缺一个就读不出彼岸花：
     · 第一版画成放射星芒（无花丝无杆）→ 跟刚删掉的"烟花花"几乎一样，被用户打回；
     · 第二版改成"伞形三朵"→ 三朵的花丝互相穿插，整屏 `@` 噪点，还不如单朵；
     · 现在这版：**单朵**，靠"长花丝 + 裸杆"立住识别度。
   ⚠️ 两条实测经验，改参数前先看：
     1. **filW 必须 ≥ 0.6**。花丝细于一个字符格时画不出连续线条，只剩孤立的 `@` 花药点
        散在画面上 = 一屏噪点（0.26 那版就是这么废的）。
     2. **别做成多朵**。多朵时各花的花丝必然交叉，ASCII 里交叉的细线只读得出噪声。
   2026-09-17 晚：用户给的参考图确认形态；此前生成脚本被另一个会话误删，按同套花谱重建。 */
const lycoris = render({
  W: 62, H: 36,
  stem: { x0: 0, y0: -3, fromY: 8, half: 0.5, sway: 1.0, period: 8 },
  blooms: [
    { x: 0, y: -3, rot: 0.2, core: 1.2,
      rings: [{ count: 6, len: 11.0, width: 2.4, sharp: 0.85, bend: 1.3, r0: 0.5 }],
      stamens: { count: 6, len: 13.0, bend: -0.6, r0: 0.35, filW: 0.75, tipW: 1.15, tip: 1.6 } },
  ],
});

/* 百合：6 枚宽花瓣微外翻 + 6 根较短花丝（花药大）——
   ⚠️ 别加成两环：宽瓣一叠就糊成一坨（实测第一版就是），单环 6 瓣最像百合。 */
const lily = render({
  W: 74, H: 38,
  blooms: [
    { x: 0, y: 0, rot: -0.25, core: 1.1,
      rings: [{ count: 6, len: 13.5, width: 2.5, sharp: 0.78, bend: 0.5, r0: 0.55 }],
      stamens: { count: 6, len: 9.0, bend: -0.45, r0: 0.35, filW: 0.3, tipW: 0.85, tip: 1.3 } },
  ],
});

/* 莲花：三环尖瓣（外长内短），无花丝，小花心 */
const lotus = render({
  W: 78, H: 38,
  blooms: [
    { x: 0, y: 0, rot: 0.2, core: 1.5,
      rings: [
        { count: 8, len: 13.5, width: 2.3, sharp: 1.15, bend: 0.16, r0: 0.5 },
        { count: 8, len: 10.0, width: 2.1, sharp: 1.15, bend: 0.22, r0: 0.4, phase: TAU / 16 },
        { count: 6, len: 6.4, width: 1.9, sharp: 1.25, bend: 0.28, r0: 0.35, phase: TAU / 24 },
      ] },
  ],
});

/* 大丽花：三环细密花瓣（多且窄），花心小 */
const dahlia = render({
  W: 78, H: 38,
  blooms: [
    { x: 0, y: 0, rot: 0.15, core: 1.2,
      rings: [
        { count: 13, len: 13.2, width: 1.95, sharp: 0.85, bend: 0.5, r0: 0.5 },
        { count: 11, len: 9.4, width: 1.8, sharp: 0.85, bend: 0.6, r0: 0.4, phase: TAU / 26 },
        { count: 8, len: 5.6, width: 1.6, sharp: 0.95, bend: 0.72, r0: 0.35, phase: TAU / 16 },
      ] },
  ],
});

/* 三色堇：5 枚圆钝大瓣（下瓣略垂），花心一团 */
const pansy = render({
  W: 74, H: 38,
  blooms: [
    { x: 0, y: 0, rot: -0.3, core: 2.2,
      rings: [
        { count: 5, len: 12.0, width: 4.4, sharp: 0.62, bend: 0.2, r0: 0.5 },
        { count: 5, len: 7.6, width: 3.2, sharp: 0.7, bend: 0.3, r0: 0.4, phase: TAU / 10 },
      ] },
  ],
});

const ART = { lycoris, lily, lotus, dahlia, pansy };

const out = `/**
 * ASCII 花系字符画 —— 由 \`scripts/gen-bloom-art.mjs\` 参数化生成后烤进来。
 * （参考用户给的「ascii art · 花」素材：彼岸花 / 百合 / 三色堇 / 大丽花 / 莲花…）
 *
 * 与牵牛花（flowerAsciiArt.ts）同一套"用字符密度堆轮廓"的语言：
 *   花瓣 \`# % * +\`（脊→缘）、花丝 \`:\`、花药 \`@\`、花心 \`#\`、花杆 \`|\`。
 * 字符格约 0.5 宽 × 1 高，所以画布近似正方形，花不会被拉扁。
 *
 * 挂法见 PageDecor.tsx 的 \`b()\` 助手 + index.css 的 \`.ascii-bloom\`
 * （颜色吃 --pdecor-color，所以不会渲染成灰白）。
 *
 * ⚠️ 想调形状别手改这里：改 \`scripts/gen-bloom-art.mjs\` 里的花谱再重跑。
 */
export const ASCII_BLOOM = {
${Object.entries(ART)
  .map(([k, v]) => `  ${k}: \`${v.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`, `)
  .join('\n')}
} as const;

export type BloomKind = keyof typeof ASCII_BLOOM;
`;
writeFileSync('src/components/bloomAsciiArt.ts', out);

for (const [k, v] of Object.entries(ART)) {
  console.log(`\n===== ${k} =====`);
  console.log(v);
}
