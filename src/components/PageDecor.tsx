import type { CSSProperties } from 'react';
import { SHAPE, TILE_STARS, type ShapeName } from '@/components/decorShapes';

/**
 * 子页面背景装饰层（2026-09-17 / 第二轮重构）
 * =============================================================================
 * 用户看完第一轮后的反馈（原话）：
 *   · 「我想要这种大一点的花，最好是有颜色的，颜色要与背景搭配」
 *   · 「我想要波点、星星、格子元素均匀铺满」
 *   · 「我想要这样的英文字」（图6 Angel Girl / 图7 星星花体 / 图8 点阵 Sweet Thing）
 *   · 「现在的装饰很分散，没有 ins 风美感」
 *   · 「巧克力色和薄荷色的对比度不高…也可能是拉了透明度的原因」
 *
 * ## 逐条落法
 *   1. **大而有色的花** —— 尺寸 clamp 上调到 220~340px，浓度从 0.2 提到 0.45~0.7
 *      （点阵在半实色时读起来就是"有颜色的花"，参考图1/图3 都是这么亮的）；
 *      主花颜色用薄荷深（浅底）/ 薄荷（深底），灰调的 green/base 降为辅助。
 *   2. **均匀铺满** —— grain 散点层（中间挖空）换成 tiled 平铺层：
 *      polka（波点布）/ stars（星星阵，SVG tile 遮罩）/ grid（方格蕾丝）三种，
 *      真正铺满整页。不抢字的保险改成"细 + 淡"：线 1px、点 1~2px。
 *   3. **英文字** —— 字体从 Caveat 换成 **JheriCurls**（首页 Portfolio 大字同款卷曲花体，
 *      正文不敢用它是因为小字号不可读，装饰字母都在 88px+，卷曲感正是要的）。
 *   4. **聚拢成簇** —— 每页收敛成 **两簇**（对角各一），簇 = 大花 + 花体字母/蕾丝件
 *      + 1~2 颗星互相咬合（元素之间允许重叠，才有"拼贴"的 ins 感）；
 *      游离的散星从 8~10 颗砍到 2~3 颗。
 *   5. **对比度** —— 全部透明度上调：大花 0.45~0.7 · 字母 0.4~0.5 · 星 0.6~0.85 ·
 *      平铺层 0.10~0.16（浅底）/ 0.24~0.3（巧克力底，照图5 的实色星阵）。
 *
 * ## "不遮挡主体内容"的机制（不变）
 *   整层 z-index:-1 —— 物理上画在父级背景之上、正常流内容之下，不可能盖住任何字。
 *   大簇贴边角、中心留白；平铺层靠"细 + 淡"保正文。
 *
 * ## 遮罩手法（不变）
 *   SVG data-URI 读不到 CSS 变量 → 形状只留 alpha 当 mask-image，
 *   颜色与浓度全在 CSS 变量上。⚠️ 用户明确"不要牵牛花"（那是 AsciiFlower 的主角）。
 */

type Tone = 'mint' | 'mintdeep' | 'base' | 'green' | 'paper' | 'choc';
type Kind = ShapeName | 'softstar' | 'letter';
type TiledKind = 'polka' | 'stars' | 'grid';

type Orn = {
  k: Kind;
  /** 中心点（页面百分比，允许越界值 → 只露半朵，像印上去被裁了边） */
  x: number;
  y: number;
  /** 宽度；`letter` 这一档给的是字号 */
  w: string;
  rot?: number;
  tone: Tone;
  op: number;
  /** 覆盖点阵网格尺寸 / 点半径（不填走 DOTS 里按形状定的默认值） */
  dot?: string;
  r?: string;
  /** softstar 的虚焦量 */
  blur?: string;
  /** letter 的文字 */
  text?: string;
  /** 窄屏隐藏 */
  sm?: boolean;
};

/** 点阵密度：面状 5px 网格 ≈ 43% 覆盖；星/字母 3px 更密才够实。 */
const DOTS: Record<Kind, { dot: string; r: string }> = {
  blossom: { dot: '5px', r: '1.85px' },
  blossomThin: { dot: '5px', r: '1.85px' },
  sprig: { dot: '5px', r: '1.85px' },
  spray: { dot: '4px', r: '1.5px' },
  lily: { dot: '3px', r: '1.2px' },
  oval: { dot: '3px', r: '1.15px' },
  bow: { dot: '3px', r: '1.05px' },
  star: { dot: '3px', r: '1.35px' },
  sparkle: { dot: '3px', r: '1.35px' },
  softstar: { dot: '5px', r: '1.8px' },
  letter: { dot: '3px', r: '1.25px' },
};

type Variant = {
  /** 平铺层：波点 / 星星 / 格子，均匀铺满整页 */
  tiled?: { kind: TiledKind; tone: Tone; op: number };
  orn: Orn[];
};

const o = (
  k: Kind,
  x: number,
  y: number,
  w: string,
  tone: Tone,
  op: number,
  extra: Omit<Orn, 'k' | 'x' | 'y' | 'w' | 'tone' | 'op'> = {},
): Orn => ({ k, x, y, w, tone, op, ...extra });

/** 簇内的小亮星：比第一轮大一号、亮一档（0.6~0.85），跟大花咬合出"拼贴感" */
const tiny = (x: number, y: number, w: string, tone: Tone, op: number, rot = 0, sm = false): Orn =>
  o('star', x, y, w, tone, op, { rot, sm });

const VARIANTS: Record<string, Variant> = {
  /* ======================= 媒体页（白底 · 卡片在中带）=======================
     2026-09-17 对比度一轮：白底上"薄荷深"读起来发灰，所以大花改**巧克力/暖褐**
     （深底压浅底 = 直接的高对比），薄荷只留作小星点缀 → 这才是"薄荷巧克力"。
     上下两条饰带各聚一簇，浓度整体抬高一档。 */
  mjp: {
    tiled: { kind: 'polka', tone: 'green', op: 0.18 },
    orn: [
      /* 左上簇：大花 + 花体字母咬合（字母压着花瓣边，才有拼贴感） */
      o('blossom', 5, 6, 'clamp(210px, 24vw, 340px)', 'choc', 0.72, { rot: -14 }),
      o('letter', 15, 15, 'clamp(88px, 10vw, 160px)', 'base', 0.78, { rot: -7, text: 'Reel' }),
      tiny(22, 4, 'clamp(24px, 2.6vw, 40px)', 'mintdeep', 0.88, -12),
      o('sparkle', 9, 20, 'clamp(26px, 2.8vw, 42px)', 'mint', 0.85),
      /* 右下簇：烟花花 + 蕾丝椭圆框 + 星 */
      o('spray', 92, 88, 'clamp(190px, 21vw, 320px)', 'choc', 0.64, { rot: 8 }),
      o('oval', 83, 94, 'clamp(130px, 15vw, 220px)', 'base', 0.74, { rot: -6 }),
      tiny(80, 78, 'clamp(20px, 2.2vw, 34px)', 'mintdeep', 0.88, 8),
      /* 顶带小星，压着标题栏的空白 */
      tiny(52, 4, 'clamp(14px, 1.5vw, 24px)', 'mintdeep', 0.85, 8),
      o('sparkle', 70, 9, 'clamp(18px, 2vw, 30px)', 'mint', 0.82, { rot: 22, sm: true }),
    ],
  },

  /* ======================= 文案页（暖米纸 · 星星阵饰带）=======================
     卡片是半透明白 → 平铺的星星阵会透出一层，正是"印在带底纹的纸上"。
     左上是巧克力大花簇，**字母 Copy 移到右下簇、压在蝴蝶结花心上**（避开左上标题）。 */
  cp: {
    tiled: { kind: 'stars', tone: 'mintdeep', op: 0.2 },
    orn: [
      o('blossom', 3, 9, 'clamp(220px, 25vw, 360px)', 'choc', 0.7, { rot: -12 }),
      tiny(23, 5, 'clamp(22px, 2.4vw, 36px)', 'mint', 0.82, 10),
      o('lily', 96, 78, 'clamp(180px, 20vw, 300px)', 'base', 0.58, { rot: 6 }),
      o('bow', 85, 91, 'clamp(120px, 14vw, 200px)', 'choc', 0.68, { rot: -6 }),
      /* 字母 Copy 落在右下簇、压在蝴蝶结上 —— 与左上标题错开 */
      o('letter', 78, 86, 'clamp(92px, 10.5vw, 170px)', 'base', 0.76, { rot: -5, text: 'Copy' }),
      tiny(90, 66, 'clamp(18px, 2vw, 30px)', 'mintdeep', 0.82, -16),
      tiny(50, 92, 'clamp(13px, 1.4vw, 22px)', 'mint', 0.8, 6),
      o('sparkle', 42, 4, 'clamp(22px, 2.4vw, 36px)', 'mintdeep', 0.78),
    ],
  },

  /* ======================= 项目详情页（左栏深棕 + 右栏纸面）=======================
     装饰只落纸面（stage 左缩一个栏宽，见 CSS）。右上一簇、左下一簇对角，
     平铺层用方格蕾丝——和详情页"策划案"的纸感最搭。白纸面用巧克力花保证对比。 */
  wkp: {
    tiled: { kind: 'grid', tone: 'green', op: 0.18 },
    orn: [
      o('spray', 94, 9, 'clamp(180px, 20vw, 300px)', 'choc', 0.68, { rot: 10 }),
      tiny(84, 18, 'clamp(20px, 2.2vw, 34px)', 'mintdeep', 0.88, 12),
      o('blossom', 7, 84, 'clamp(200px, 22vw, 330px)', 'base', 0.68, { rot: -10 }),
      o('letter', 17, 93, 'clamp(76px, 8.5vw, 140px)', 'choc', 0.78, { rot: -4, text: 'Plan' }),
      tiny(26, 74, 'clamp(18px, 2vw, 30px)', 'mint', 0.84, -8),
      o('oval', 96, 52, 'clamp(120px, 13vw, 200px)', 'choc', 0.62, { rot: 8, sm: true }),
    ],
  },

  /* ======================= 实习日记（牛皮纸本子内页）=======================
     纸面已有四条手写水印（keep going / 2026 / idea! / to be continued），
     两簇贴左上与右下角，字母 Diary 挂左中空白带——和四条水印全错开。
     巧克力花压在牛皮纸上对比足够，浓度略收一档避免显脏。 */
  diary: {
    tiled: { kind: 'polka', tone: 'base', op: 0.18 },
    orn: [
      o('blossom', 12, 12, 'clamp(190px, 21vw, 300px)', 'choc', 0.64, { rot: -14 }),
      tiny(24, 22, 'clamp(20px, 2.2vw, 34px)', 'mint', 0.82, 14),
      o('blossomThin', 90, 82, 'clamp(170px, 19vw, 280px)', 'base', 0.62, { rot: 10 }),
      o('bow', 81, 93, 'clamp(110px, 12.5vw, 180px)', 'choc', 0.64, { rot: -8 }),
      tiny(78, 70, 'clamp(16px, 1.8vw, 28px)', 'mintdeep', 0.82, -12, true),
      o('letter', 6, 42, 'clamp(72px, 8vw, 132px)', 'base', 0.66, { rot: -6, text: 'Diary' }),
      tiny(48, 90, 'clamp(13px, 1.4vw, 22px)', 'mint', 0.8, 20),
    ],
  },

  /* ======================= 联系方式的巧克力纸（深底 · 薄荷当墨）=======================
     巧克力底 + 薄荷花本就是高对比，浓度再抬一档，星阵饰带也更实。 */
  contact: {
    tiled: { kind: 'stars', tone: 'mint', op: 0.32 },
    orn: [
      o('blossomThin', 5, 87, 'clamp(190px, 21vw, 310px)', 'mint', 0.8, { rot: -16 }),
      tiny(15, 71, 'clamp(22px, 2.4vw, 38px)', 'mint', 0.92, 10),
      o('sprig', 96, 76, 'clamp(160px, 18vw, 260px)', 'mint', 0.74, { rot: 6, sm: true }),
      o('oval', 92, 24, 'clamp(130px, 14vw, 210px)', 'mint', 0.8, { rot: 10 }),
      tiny(84, 44, 'clamp(18px, 2vw, 30px)', 'mint', 0.92, -14),
      o('sparkle', 8, 38, 'clamp(20px, 2.2vw, 34px)', 'mint', 0.88, { rot: 18 }),
    ],
  },

  /* ======================= 工作室全屏菜单（巧克力覆盖层 · 薄荷当墨）=======================
     替换原来那朵 ASCII 牵牛花（用户：太像素风 / ascii）。这里改用和子页同款的
     实色花 + 薄荷星阵饰带，巧克力底上薄荷天然高对比。菜单主体文字在正中，
     装饰只在四角与上下饰带，不抢字。 */
  menu: {
    tiled: { kind: 'stars', tone: 'mint', op: 0.28 },
    orn: [
      o('blossom', 6, 8, 'clamp(200px, 22vw, 320px)', 'mint', 0.78, { rot: -14 }),
      tiny(26, 4, 'clamp(22px, 2.4vw, 36px)', 'mint', 0.9, 10),
      o('spray', 94, 90, 'clamp(190px, 21vw, 320px)', 'mint', 0.74, { rot: 8 }),
      o('oval', 84, 96, 'clamp(130px, 14vw, 210px)', 'mint', 0.78, { rot: -6 }),
      tiny(80, 76, 'clamp(20px, 2.2vw, 34px)', 'mint', 0.9, 8),
    ],
  },
};

/**
 * 一条装饰。`letter` 用 JheriCurls 花体 + 点阵填充（background-clip: text）——
 * 图7"星星拼成的花体字母"的落法：文字当遮罩、点阵当墨。
 * ⚠️ 不能在数据 URI 里写字：SVG 当图片渲染时页面 web font 用不上。
 */
function OrnSpan({ orn, word }: { orn: Orn; word?: string }) {
  const dots = DOTS[orn.k];
  const style = {
    left: `${orn.x}%`,
    top: `${orn.y}%`,
    '--rot': orn.rot ?? 0,
    '--pdecor-op': orn.op,
    '--pdecor-dot': orn.dot ?? dots.dot,
    '--pdecor-r': orn.r ?? dots.r,
    ...(orn.blur ? { '--pdecor-blur': orn.blur } : null),
  } as CSSProperties;

  const cls = `pdecor__orn pdecor--${orn.tone}${orn.sm ? ' pdecor__orn--sm-hide' : ''}`;

  if (orn.k === 'letter') {
    return (
      <span className={`${cls} pdecor__orn--letter`} style={{ ...style, fontSize: orn.w }} aria-hidden="true">
        {word || orn.text}
      </span>
    );
  }

  const shape = orn.k === 'softstar' ? SHAPE.star : SHAPE[orn.k];
  return (
    <span
      className={`${cls}${orn.k === 'softstar' ? ' pdecor__orn--soft' : ''}`}
      style={{ ...style, width: orn.w, '--pdecor-shape': `url("${shape}")` } as CSSProperties}
      aria-hidden="true"
    />
  );
}

/** 平铺层：polka/grid 的图案在 CSS 类里；stars 的 SVG tile 遮罩在这里内联传入
 *  （遮罩不烤色，颜色吃 .pdecor--tone 的 --pdecor-color）。
 *  2026-09-17 用户：「不要全部铺满，只要上下两个长条」—— 渲染成上下两条饰带。 */
function TiledLayer({ tiled }: { tiled: NonNullable<Variant['tiled']> }) {
  const style =
    tiled.kind === 'stars'
      ? ({
          '--pdecor-top': tiled.op,
          WebkitMaskImage: `url("${TILE_STARS}")`,
          maskImage: `url("${TILE_STARS}")`,
          WebkitMaskSize: '96px 96px',
          maskSize: '96px 96px',
          WebkitMaskRepeat: 'repeat',
          maskRepeat: 'repeat',
        } as CSSProperties)
      : ({ '--pdecor-top': tiled.op } as CSSProperties);

  return (
    <>
      <span
        className={`pdecor__tiled pdecor__tiled--top pdecor__tiled--${tiled.kind} pdecor--${tiled.tone}`}
        style={style}
      />
      <span
        className={`pdecor__tiled pdecor__tiled--bottom pdecor__tiled--${tiled.kind} pdecor--${tiled.tone}`}
        style={style}
      />
    </>
  );
}

export function PageDecor({ variant, word }: { variant: keyof typeof VARIANTS; word?: string }) {
  const cfg = VARIANTS[variant];
  if (!cfg) return null;

  return (
    <div className={`pdecor pdecor--${String(variant)}`} aria-hidden="true">
      <div className="pdecor__stage">
        {cfg.tiled ? <TiledLayer tiled={cfg.tiled} /> : null}
        {cfg.orn.map((orn, i) => (
          <OrnSpan key={`${orn.k}-${i}`} orn={orn} word={word} />
        ))}
      </div>
    </div>
  );
}
