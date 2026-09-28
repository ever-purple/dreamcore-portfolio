import * as THREE from 'three';

/* ============================================================================
 * 报刊亭 · 创作档案 —— 架上书籍（程序化生成）
 *
 * 为什么不用 GLB：
 *   原始 `书1.glb` 是**单网格 1,500,000 三角面 + 一张 4096² 碎片化 UV 图集**
 *   （封面与书页烘在同一张图上，UV 岛零散分布）。摆 12 本 = 1800 万面，
 *   且图集无法做到「每本封面不一样」。故改为程序化建模：
 *   每本 4 个 box（48 面）+ 一张独立封面贴图，可任意变化且几乎不吃显存。
 *
 * 封面（当前为占位）：
 *   `coverTexture()` 会先找 `public/newsstand/covers/<NN>.jpg|png`，
 *   找到就用真封面，找不到则回落到程序化的**纯色编号占位封面**。
 *   → 之后只要把封面图按 01.jpg / 02.jpg … 丢进该目录即自动生效，无需改代码。
 * ========================================================================== */

/** 单本书的摆放参数（坐标一律用**书架原始模型单位**：架子1.glb 在 gltf 场景空间里宽约 0.26 / 高约 0.57） */
export type BookSpec = {
  /** 横向位置，书架中心为 0 */
  x: number;
  /** 书高（封面竖向尺寸） */
  h: number;
  /** 向后仰角（度）——参考图里书微微后靠，几乎正面朝镜头 */
  tilt: number;
  /** 水平微转（度），让一排书不那么齐整 */
  yaw: number;
  /** 封面编号，决定配色与版式（0..N-1，每本不同） */
  cover: number;
  /** 厚度系数微调（1 = 标准） */
  thick?: number;
};

/** 一排（一个托盘槽） */
export type RowSpec = {
  /** 该层层板的台面 y（书底直接坐在台面上，**完整展示、不再下沉**） */
  lipY: number;
  /** 书在槽内的前后位置（0 = 层板前后中点） */
  z: number;
  books: BookSpec[];
};

// W / D 导出：报刊亭场景要拿它们给书配「静止位拾取代理盒」（尺寸必须与书一致）
export const W = 0.115; // 书宽（模型单位；架子1.glb 高 1.07 / 宽 0.485，与老架子同尺度）
const H = 0.148; // 书高（展示柜层间净高约 0.18，不能顶到上层搁板）
export const D = 0.034; // 书厚

/**
 * 下层书籍：放在展示柜**下层搁板**上，完整展示（取消「只露一半」），
 * 封面朝外、正面朝镜头，微微后仰贴合参考图姿态。
 * lipY=0.545 / 上层搁板 0.737，由 ?nsgeo=1 几何探针标定。
 */
export const BOOK_ROWS: RowSpec[] = [
  {
    lipY: 0.548,
    z: 0.012,
    books: [
      { x: -0.122, h: H * 1.04, tilt: 4, yaw: -3, cover: 1 },
      { x: 0.002, h: H * 1.08, tilt: 4, yaw: 2, cover: 4, thick: 1.12 },
      { x: 0.122, h: H * 1.0, tilt: 4, yaw: -2, cover: 6, thick: 0.9 },
    ],
  },
];

/* ---------------------------------------------------------------- 封面 */

/** 每本的底色（低饱和、贴合房间的暖调；真封面到位后只是回落色） */
const COVER_TINTS = [
  { bg: '#8d3a2b', ink: '#f2e8d8' },
  { bg: '#22312b', ink: '#e7ddc8' },
  { bg: '#c9b391', ink: '#2a2118' },
  { bg: '#2f4a63', ink: '#e9e2d2' },
  { bg: '#6f6338', ink: '#f4ecd9' },
  { bg: '#1d2429', ink: '#dfe6ea' },
  { bg: '#a8623a', ink: '#f7efe0' },
  { bg: '#3d4a33', ink: '#ece4d0' },
  { bg: '#7a3b4e', ink: '#f3e9dc' },
];

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Inter", "Helvetica Neue", Arial, sans-serif';

/** 逐字绘制（手动字距，不依赖 ctx.letterSpacing 的浏览器支持） */
function tracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: 'left' | 'center' | 'right' = 'left',
) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width + tracking);
  const total = widths.reduce((a, b) => a + b, 0) - tracking;
  let cx = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total;
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += widths[i];
  });
}

/** 一张共享的噪声瓦片（只生成一次），用来铺出纸纹，避免逐像素遍历整张封面 */
let noiseTile: HTMLCanvasElement | null = null;
function noise(): HTMLCanvasElement {
  if (noiseTile) return noiseTile;
  const n = 96;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const x = c.getContext('2d');
  if (x) {
    const img = x.createImageData(n, n);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 118 + (Math.random() - 0.5) * 88;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }
  noiseTile = c;
  return c;
}

/** 纸纹 + 暗角，避免看起来是纯色块（用平铺噪声，成本 O(1)） */
function paper(ctx: CanvasRenderingContext2D, w: number, h: number, amount = 0.07) {
  ctx.save();
  const pat = ctx.createPattern(noise(), 'repeat');
  if (pat) {
    ctx.globalAlpha = amount;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();

  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, h * 0.1, w * 0.5, h * 0.5, h * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function barcode(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ink: string) {
  ctx.save();
  ctx.fillStyle = ink;
  let cx = x;
  let seed = Math.round(x * 977 + w * 31) || 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  while (cx < x + w) {
    const bw = 1 + Math.floor(rnd() * 3.2);
    if (rnd() > 0.32) ctx.fillRect(cx, y, bw, h);
    cx += bw + 1.4 + rnd() * 2.2;
  }
  ctx.restore();
}

/**
 * 第一本书（cover=1）的「文案」主题封面 —— 插画为主（用户 2026-09-22）。
 *
 * 构图（暖牛皮纸底，与文案页的小票纸张肌理同气质）：
 *   上半是标题「Copywriting」+ 中文「文案」（小一号）；
 *   中下是一本**摊开的笔记本**插画：左右两页、中线书脊、纸上画着一行行
 *   手写感文字线条（用起伏的小弧线模拟「写满字的纸页」，而不是死板的直线）；
 *   右下角一支斜放的钢笔，笔尖指向纸页 —— 呼应「写文案」这个动作。
 *   底部一条条码 + 页脚小字，压住版式，像一本讲究的纸本刊物。
 *
 * 用纯 Canvas 绘制（零素材依赖），风格与占位封面同一套机制。
 */
function drawCopywritingCover(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // —— 底：暖牛皮纸（贴近文案页 --wkp-paper 的暖灰米，但更暖一点做封面底色）——
  const bgTop = '#c9b391';
  const bgBottom = '#b89c74';
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, bgTop);
  bg.addColorStop(1, bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const ink = '#2a2118';       // 深墨
  const inkSoft = 'rgba(42,33,24,0.55)';
  const pad = w * 0.09;
  ctx.textBaseline = 'alphabetic';

  // —— 标题区 ——
  ctx.fillStyle = ink;
  ctx.font = `600 ${w * 0.128}px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.fillText('Copywriting', pad, pad + w * 0.13);

  ctx.font = `500 ${w * 0.058}px ${SANS}`;
  ctx.fillStyle = inkSoft;
  // 中文「文案」用字距拉开
  tracked(ctx, '文 案', pad + w * 0.012, pad + w * 0.13 + w * 0.082, w * 0.03);

  // 标题下一条细线（隔开标题与插画）
  ctx.strokeStyle = inkSoft;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(1, w * 0.004);
  ctx.beginPath();
  ctx.moveTo(pad, pad + w * 0.13 + w * 0.13);
  ctx.lineTo(w - pad, pad + w * 0.13 + w * 0.13);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // —— 摊开的笔记本插画 ——
  // 本子居中，宽约 0.84w，高约 0.52w（两页并排）
  const nbW = w * 0.84;
  const nbH = w * 0.50;
  const nbX = (w - nbW) / 2;
  const nbY = h * 0.335;
  const spineX = nbX + nbW / 2; // 中线书脊

  // 本子阴影（略微投影，让本子「浮」在封面上）
  ctx.save();
  ctx.shadowColor = 'rgba(42,33,24,0.32)';
  ctx.shadowBlur = w * 0.05;
  ctx.shadowOffsetY = w * 0.028;
  // 纸页底色（左右两页）
  ctx.fillStyle = '#f4ecd9';
  roundRect(ctx, nbX, nbY, nbW, nbH, w * 0.014);
  ctx.fill();
  ctx.restore();

  // 两页之间的书脊凹痕（竖线 + 中间微暗）
  const spineGrad = ctx.createLinearGradient(spineX - w * 0.03, 0, spineX + w * 0.03, 0);
  spineGrad.addColorStop(0, 'rgba(42,33,24,0)');
  spineGrad.addColorStop(0.5, 'rgba(42,33,24,0.16)');
  spineGrad.addColorStop(1, 'rgba(42,33,24,0)');
  ctx.fillStyle = spineGrad;
  ctx.fillRect(spineX - w * 0.03, nbY, w * 0.06, nbH);

  // 纸页上的「手写文字行」—— 用小弧线模拟写满字的行
  // 左右两页各画若干行，行内用起伏的短横线（不是直线，有手写感）
  const pagePad = w * 0.055;
  const pageInnerW = nbW / 2 - pagePad * 2;
  const lineCount = 7;
  const lineGap = (nbH - pagePad * 2) / (lineCount - 1);
  const drawLines = (pageCenterX: number) => {
    const lx = pageCenterX - pageInnerW / 2;
    for (let li = 0; li < lineCount; li++) {
      const ly = nbY + pagePad + li * lineGap;
      const lineW = pageInnerW * (0.55 + Math.random() * 0.42);
      // 手写感的起伏线：一段段小弧
      ctx.strokeStyle = inkSoft;
      ctx.globalAlpha = 0.34;
      ctx.lineWidth = Math.max(1, w * 0.006);
      ctx.beginPath();
      const segs = 8;
      for (let s = 0; s <= segs; s++) {
        const sx = lx + (lineW * s) / segs;
        const sy = ly + (s % 2 === 0 ? 0 : w * 0.006);
        if (s === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };
  drawLines(nbX + nbW / 4); // 左页
  drawLines(nbX + (nbW * 3) / 4); // 右页

  // 右页上一条「正在写」的高亮笔迹（更实的一行，表示笔刚写过）
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = Math.max(1.2, w * 0.007);
  ctx.beginPath();
  const hiX = nbX + (nbW * 3) / 4 - pageInnerW / 2;
  const hiY = nbY + pagePad + lineGap * 4;
  const hiW = pageInnerW * 0.62;
  for (let s = 0; s <= 6; s++) {
    const sx = hiX + (hiW * s) / 6;
    const sy = hiY + (s % 2 === 0 ? 0 : w * 0.007);
    if (s === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // —— 钢笔（右下角，斜放，笔尖指向纸页）——
  const penX = nbX + nbW * 0.82;
  const penY = nbY + nbH * 1.16;
  const penLen = w * 0.34;
  const penAngle = -0.62; // 斜度
  ctx.save();
  ctx.translate(penX, penY);
  ctx.rotate(penAngle);
  // 笔身
  ctx.fillStyle = '#8d3a2b';
  roundRect(ctx, -penLen, -w * 0.022, penLen, w * 0.044, w * 0.01);
  ctx.fill();
  // 笔帽/笔夹（尾端深色一段）
  ctx.fillStyle = '#22312b';
  roundRect(ctx, -penLen, -w * 0.022, w * 0.07, w * 0.044, w * 0.008);
  ctx.fill();
  // 笔尖（金属色三角）
  ctx.fillStyle = '#d8c69a';
  ctx.beginPath();
  ctx.moveTo(0, -w * 0.022);
  ctx.lineTo(w * 0.055, 0);
  ctx.lineTo(0, w * 0.022);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // —— 页脚：条码 + 小字 ——
  barcode(ctx, pad, h - pad - h * 0.062, w * 0.3, h * 0.06, ink);
  ctx.fillStyle = inkSoft;
  ctx.font = `400 ${w * 0.032}px ${SANS}`;
  ctx.textAlign = 'right';
  tracked(ctx, 'WRITING · 文案 · NO.01', w - pad, h - pad - h * 0.01, w * 0.01, 'right');
  ctx.textAlign = 'left';

  paper(ctx, w, h, 0.05);
}

/** roundRect 垫片（老浏览器没有 ctx.roundRect） */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 占位封面：纯色 + 细线框 + 卷号。像设计选择，不像「图丢了」。 */
function drawPlaceholder(ctx: CanvasRenderingContext2D, w: number, h: number, i: number) {
  const t = COVER_TINTS[i % COVER_TINTS.length];
  const pad = w * 0.085;
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'alphabetic';

  ctx.strokeStyle = t.ink;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, w * 0.005);
  ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
  ctx.globalAlpha = 1;

  ctx.fillStyle = t.ink;
  ctx.font = `500 ${w * 0.042}px ${SANS}`;
  tracked(ctx, 'CREATIVE LAB', pad * 1.6, pad * 2.1, w * 0.016);

  ctx.font = `400 ${w * 0.3}px ${SERIF}`;
  ctx.textAlign = 'right';
  ctx.fillText(String(i + 1).padStart(2, '0'), w - pad * 1.35, h - pad * 1.5);
  ctx.textAlign = 'left';

  barcode(ctx, pad * 1.6, h * 0.58, w * 0.34, h * 0.062, t.ink);

  ctx.globalAlpha = 0.5;
  ctx.fillStyle = t.ink;
  ctx.fillRect(pad * 1.6, h * 0.72, w - pad * 3.2, Math.max(1, w * 0.005));
  ctx.globalAlpha = 1;

  paper(ctx, w, h);
}

const CW = 512;
const CH = 716;
/** 封面宽高比，供将来校验真封面尺寸 */
export const COVER_ASPECT = CW / CH;

type CoverEntry = { tex: THREE.Texture; real: boolean };
const coverCache = new Map<number, CoverEntry>();

/** 封面文件探测顺序（放 public/newsstand/covers/ 下即可自动生效） */
const COVER_EXT = ['jpg', 'png', 'webp'];

/**
 * 取第 i 号封面。先尝试真封面文件，失败则用占位图。
 * 真封面是异步加载的：拿到后回调通知，由调用方替换 material.map。
 */
export function coverTexture(i: number, onReal?: (tex: THREE.Texture) => void): THREE.Texture {
  const key = i % COVER_TINTS.length;
  const hit = coverCache.get(key);
  if (hit) {
    if (hit.real && onReal) onReal(hit.tex);
    return hit.tex;
  }

  const cv = document.createElement('canvas');
  cv.width = CW;
  cv.height = CH;
  const ctx = cv.getContext('2d');
  const placeholder = new THREE.CanvasTexture(cv);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  placeholder.anisotropy = 8;
  if (ctx) {
    // 第一本书（cover=1）＝「文案」主题插画封面；其余保持占位（2026-09-22）
    if (i === 1) drawCopywritingCover(ctx, CW, CH);
    else drawPlaceholder(ctx, CW, CH, key);
  }
  placeholder.needsUpdate = true;
  const entry: CoverEntry = { tex: placeholder, real: false };
  coverCache.set(key, entry);

  // 异步找真封面
  const base = `${import.meta.env.BASE_URL}newsstand/covers/`;
  const name = String(key + 1).padStart(2, '0');
  const tryExt = (ei: number) => {
    if (ei >= COVER_EXT.length) return;
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      entry.tex = tex;
      entry.real = true;
      placeholder.dispose();
      onReal?.(tex);
    };
    img.onerror = () => tryExt(ei + 1);
    img.src = `${base}${name}.${COVER_EXT[ei]}`;
  };
  tryExt(0);

  return placeholder;
}

/** 封底：底色 + 条码 */
function backTexture(i: number): THREE.Texture {
  const t = COVER_TINTS[i % COVER_TINTS.length];
  const w = 256;
  const h = 358;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  if (ctx) {
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = t.ink;
    ctx.font = `400 ${w * 0.22}px ${SERIF}`;
    ctx.fillText(String(i + 1).padStart(2, '0'), 30, 72);
    ctx.globalAlpha = 0.7;
    ctx.fillRect(30, 250, w - 60, 3);
    barcode(ctx, 30, 268, 118, 32, t.ink);
    ctx.globalAlpha = 1;
    paper(ctx, w, h, 0.04);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ---------------------------------------------------------------- 建模 */

/** 书的底面在 group 本地 y=0（tilt 绕「书脚」转，书才会稳稳坐在层板上） */
export function createBook(spec: BookSpec): THREE.Group {
  const g = new THREE.Group();
  const w = W;
  const h = spec.h;
  const d = D * (spec.thick ?? 1);
  const board = d * 0.18; // 封面/封底厚度
  const tint = COVER_TINTS[spec.cover % COVER_TINTS.length];

  const pagesMat = new THREE.MeshStandardMaterial({
    color: 0xe9e0cb,
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.5,
  });
  const coverMat = new THREE.MeshStandardMaterial({
    map: coverTexture(spec.cover, (tex) => {
      coverMat.map = tex;
      coverMat.needsUpdate = true;
    }),
    roughness: 0.6,
    metalness: 0,
    envMapIntensity: 0.75,
  });
  const backMat = new THREE.MeshStandardMaterial({
    map: backTexture(spec.cover),
    roughness: 0.62,
    metalness: 0,
    envMapIntensity: 0.7,
  });
  const spineMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tint.bg),
    roughness: 0.62,
    metalness: 0,
    envMapIntensity: 0.7,
  });

  const pages = new THREE.Mesh(
    new THREE.BoxGeometry(w - board * 1.6, h - board * 2.2, d - board * 2),
    pagesMat,
  );
  pages.position.set(board * 0.4, h / 2 + board * 0.2, -board * 0.1);
  g.add(pages);

  const front = new THREE.Mesh(new THREE.BoxGeometry(w, h, board), coverMat);
  front.position.set(0, h / 2, (d - board) / 2);
  g.add(front);

  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, board), backMat);
  back.position.set(0, h / 2, -(d - board) / 2);
  g.add(back);

  const spine = new THREE.Mesh(new THREE.BoxGeometry(board, h, d), spineMat);
  // ⚠️ 书脊必须在封面**左侧紧贴、不重叠**：封面 box 宽 w、左端 x=-w/2，
  //   书脊宽 board，其中心应在 -w/2 - board/2（内侧 x=-w/2 与封面左端对齐）。
  //   老代码中心写 -(w-board)/2 = -w/2 + board/2，书脊 box 右半段**穿进封面**，
  //   接缝处 Z-fighting —— 深绿色书脊封条边缘高频闪烁（用户 2026-09-22
  //   「只有第一本穿模，封书条一直闪」；只有第一本显眼是因为它的书脊是深绿、
  //   和暖牛皮封面强对比，另两本同色看不出）。
  spine.position.set(-(w / 2) - board / 2, h / 2, 0);
  g.add(spine);

  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.frustumCulled = false;
  });

  return g;
}
