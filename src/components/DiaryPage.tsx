import { Fragment, type CSSProperties } from 'react';
import type { DiaryEntry, DiarySection, DiarySheet, DiaryTone } from '@/data/diary';
import { EditableText } from '@/components/diary-editor/EditableText';
import { El } from '@/components/diary-editor/PageEl';
import { openImageZoom } from '@/lib/diary-editor/zoom';

/**
 * 实习日记 · 页型渲染
 * =============================================================================
 * **2026-09-23 作者模式可编辑化**（用户：「把实习日记做成在作者模式下是可编辑的手账本」）：
 *   本文件的**文字节点全部换成 `<EditableText>`** —— 编辑态下是 contenteditable、
 *   点着就能改；阅读态渲染成和以前一模一样的普通元素（零回归）。
 *   `slot` = 页内槽位名，拼上当前页 id（lib/diary-editor/pageId.ts）得到稳定 key；
 *   改过的字存在 IndexedDB 的 `PageEdit.text` 里，刷新后优先于这里的原文。
 *
 * **2026-09-23 第二轮：整块可移动**（用户：「上面的所有东西都可以移动，文本、边框、底图等等」）
 *   块级对象（大标题、正文块、月份圈选行、拍立得照片、贴纸、📌抬头、成果行…）
 *   套上 `<El slot label as className>` 登记成**结构元素** —— 编辑态它们会出现透明的
 *   命中框，可以点选、拖动、缩放、旋转、成组（见 diary-editor/DiaryCanvas.tsx）。
 *   位移以增量形式存在 `PageEdit.els` 里，阅读态照样生效（刷新后位置不变）。
 *   ⚠️ 登记的是**块级对象**，不是每个字：`<EditableText>` 那些行内槽位仍归"改字"管，
 *      单独挪一个词没有意义（而且行内元素不接受 transform）。想拆开搬就用
 *      「排列」里的成组/解组，或者双击元素后把它整块挪走。
 *
 * ⚠️ 加新文字节点**必须给唯一 slot**，且 slot 发布后不要再改名 ——
 *    改名等于把用户改过的内容（以及挪过的位置）丢掉（都按 id 存）。
 * ⚠️ `slot` 只在**同一页内**需要唯一；跨页重复没关系（页 id 会区分）。
 *    所以各页型可以放心用 `title` / `block0` 这类短名。
 *
 * **2026-09-22 晚 第三轮**（用户给全文重做内容，原话「你不要改我的文案」）：
 *   · 板块页最上面加「📌 核心工作内容与实战成果」抬头（用户原话，每页都有）；
 *   · 正文 = **小标题单拎的块**（blocks：sub 单独一行做小标题，text 是正文段）；
 *   · 篇首页时间改成**月份圈选行**（.dx-months，参考电子手帐截图）：
 *     1–12 手写体排开、实习月份圈起来，右侧「地点：北京」；
 *   · 篇首页标签用用户给的：「公司与项目介绍」「核心工作」（core 短名）。
 *
 * ## 三种页型
 *   chapter 篇首 —— 公司·岗位 + 月份圈选 + 地点 + 大标题 + 公司与项目介绍 + 核心工作
 *   section 板块 —— 📌 抬头 + 标题 +（旧篇的一句话定位）+ 小标题块×N +（成果/数字）
 *   review  复盘 —— 标题 + 小标题块×N
 *
 * ⚠️ 每一页都会被翻页层**渲染 12 遍**（12 条竖带各一份完整纸面，见 NotebookOverlay）。
 *    因此：(1) 每一页都必须塞进一页高度，不能靠内部滚动（否则每页 12 个滚动条）；
 *          (2) 这里不要放 `id`、不要放 canvas / 各带共享的实例化对象。
 *    改完跑 `node verify-diary.mjs` 逐页量溢出。
 */

/* ============================ 每篇一套配色 ============================ */

/**
 * tone → accent 三件套。注入到 .diary-entry 的 CSS 变量上。
 * 清爽版式里 accent 只剩**两处用途**：要点前的圆点、成果那行的底色 ——
 * 不再有纸带 / 荧光笔 / 贴纸，配色只服务于"扫读时抓重点"。
 *
 * ⚠️ 两个色位是**两种底**，别混用，改色必须重新量对比度（底线 4.5:1）：
 *    accent-on   压在 accent 上的字色
 *    accent-deep 压在纸面（#ece7d4）上的字色
 */
/* export：侧面章节标签（NotebookOverlay）也用这套篇色 —— 单一数据源，别抄一份 hex */
export const TONES: Record<DiaryTone, { accent: string; deep: string; on: string }> = {
  mint: { accent: '#b5e3d6', deep: '#33604e', on: '#24473a' },
  blue: { accent: '#bcc9ec', deep: '#3b5187', on: '#2c3f6b' },
  yellow: { accent: '#f0e3a0', deep: '#66532c', on: '#5c4c26' },
  rose: { accent: '#f0cdd7', deep: '#8a4356', on: '#6d3345' },
  plain: { accent: '#ded6c2', deep: '#5c5140', on: '#4a4133' },
};

const toneStyle = (tone?: DiaryTone): CSSProperties =>
  ({
    '--di-accent': TONES[tone ?? 'plain'].accent,
    '--di-accent-deep': TONES[tone ?? 'plain'].deep,
    '--di-accent-on': TONES[tone ?? 'plain'].on,
  }) as CSSProperties;

/* ============================ 贴纸 ============================ */

/**
 * 贴纸（2026-09-22 晚用户：「这里面有贴纸，你加一些，不要太繁杂，现在单调又空」）。
 * 每篇按 tone 配一张同色系贴纸（透明底 WebP，源图在桌面「新建文件夹 (4)」）：
 *   mint → 绿螺旋 / blue → 青星 / yellow → 波点星 / rose → 粉螺旋星 / plain → 白星丛。
 * 密度刻意压低：篇首页 2 张（右上 + 右下）、板块页/复盘页各 1 张（右下角），
 * 全部绝对定位、pointer-events:none，不参与排版，也不会压住文字与底部跳转条。
 * ⚠️ 每页被翻页层渲染 12 遍 —— 贴纸是纯 <img>（浏览器缓存一次），无 id 无状态，安全。
 * 2026-09-23 第二轮：两张贴纸各自登记成结构元素（可单独挪走 / 换位置）。
 */
const TONE_STICKER: Record<DiaryTone, string> = {
  mint: 'spiral-mint',
  blue: 'star-cyan',
  yellow: 'star-polka',
  rose: 'star-spiral-pink',
  plain: 'stars-white',
};

function Stickers({ entry, kind }: { entry: DiaryEntry; kind: 'chapter' | 'section' | 'review' }) {
  // 2026-09-22 晚用户收窄口径：「只改第二页，也就是第一段实习的第一页」——
  // 贴纸只挂在篇 01（xinbai）的篇首页（chapter）上，其余页保持清爽。
  if (!(entry.id === 'xinbai' && kind === 'chapter')) return null;
  const main = `/journal/stickers/${TONE_STICKER[entry.challengeTone ?? 'plain']}.webp`;
  return (
    <>
      <El slot="stickerA" label="贴纸 · 右上" as="img" className="dx-sticker dx-sticker-a" src={main} alt="" aria-hidden="true" />
      <El
        slot="stickerB"
        label="贴纸 · 右下"
        as="img"
        className="dx-sticker dx-sticker-b"
        src="/journal/stickers/stars-white.webp"
        alt=""
        aria-hidden="true"
      />
    </>
  );
}

/* ============================ 篇首照片（手账拍立得） ============================ */

/**
 * 篇首照片（2026-09-23 用户：把两张实习照片放进篇首页的右下区域，做手账拍立得美化）。
 * 只挂在篇 01（xinbai）的篇首页（chapter）：
 *   · 两张照片 = 拍立得（白框 + 底部手写体说明 + 顶部和纸胶带 + 轻微旋转错位）；
 *   · 绝对定位在右下角空白处，压在牛皮纸 backing 之上、不挡文字、不压底部跳转条；
 *   · 纯 <img> + CSS，无 id 无状态，翻页层渲染 12 遍也安全。
 * 2026-09-23：说明文字可点改（slot=photoA.cap / photoB.cap）；
 *              两张照片各自登记成结构元素（可单独挪走、缩放、旋转）。
 */
function ChapterPhotos({ entry }: { entry: DiaryEntry }) {
  if (entry.id !== 'xinbai') return null;
  return (
    <div className="dx-photos">
      <El slot="photoA" label="照片 · 上" as="figure" className="dx-polaroid dx-polaroid-a">
        <img src="/journal/photos/xinbai-dish.jpg" alt="雪国涌泉甜品" />
        <figcaption className="dx-cap">
          <EditableText slot="photoA.cap" value="入口的雪国涌泉" singleLine />
        </figcaption>
      </El>
      <El slot="photoB" label="照片 · 下" as="figure" className="dx-polaroid dx-polaroid-b">
        <img src="/journal/photos/xinbai-room.jpg" alt="就餐区一隅" />
        <figcaption className="dx-cap">
          <EditableText slot="photoB.cap" value="林间投影就餐区" singleLine />
        </figcaption>
      </El>
    </div>
  );
}

/* ============================ 页眉与抬头 ============================ */

/**
 * 页眉元信息行：公司 · 岗位（+ 页码）在左，时间 · 地点在右。
 * 2026-09-22 用户：「把时间地点按照日记本上的格式在右边写上年月地点，
 * 用手写字体写具体的数字和北京二字」—— 右侧那截用 PFHuTu-Meta 手写体（.dx-meta-where）。
 * 篇首页例外（withWhere=false）：时间地点由月份圈选行承担，不重复。
 * 2026-09-23：`slotBase` 让同一种页型在不同页里互不覆盖（s0 / s1 / s2 …）；
 *              `elSlot` 是这一行的**结构元素 id**（可整行挪走）。
 */
function Meta({
  entry,
  slotBase,
  elSlot,
  withWhere = true,
}: {
  entry: DiaryEntry;
  slotBase: string;
  elSlot: string;
  withWhere?: boolean;
}) {
  /* 用户 2026-09-23：「顶部的都删掉（页码）」——
     页眉里不放页码；翻页进度统一由书底部的页码胶囊（.diary-pager）承担。 */
  return (
    <El slot={elSlot} label="页眉（公司·时间·地点）" as="p" className="dx-meta">
      <span className="dx-meta-who">
        <EditableText slot={`${slotBase}.who`} value={`${entry.org} · ${entry.role}`} />
      </span>
      {withWhere ? (
        <span className="dx-meta-where">
          <EditableText slot={`${slotBase}.date`} value={entry.date} singleLine />
          <EditableText slot={`${slotBase}.place`} value={entry.place} singleLine />
        </span>
      ) : null}
    </El>
  );
}

/**
 * 篇首页的月份圈选行 —— 用户 2026-09-22 晚给的参考（电子手帐截图）+ 后续追加：
 * 「后面写上月，空一个格写 2026 北京，把后面的北京删掉」——
 * 即：1–12 圈出实习月份 → 「月」→ 空一格 → 年份「2026」→「北京」；
 * 原先右对齐的「地点：北京」不再单独出现。
 * 全部走 PFHuTu-Meta 手写体（子集含 0-9 月 地点：北京/天津）。
 *
 * 2026-09-23：数字与年份也可点改 —— 改的是**字**，圈选状态仍由数据里的
 * `entry.months` 决定（想换圈选的月份，需要在编辑器里告诉我改数据；这条写进报告了）。
 */
const MONTHS_ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function MonthRow({ entry }: { entry: DiaryEntry }) {
  const year = entry.date.slice(0, 4);
  return (
    <El
      slot="months"
      label="月份圈选行"
      as="div"
      className="dx-months"
      role="img"
      aria-label={`实习时间 ${entry.date}，地点 ${entry.place}`}
    >
      {MONTHS_ALL.map((m) => (
        <span key={m} className={`dx-month${entry.months.includes(m) ? ' is-on' : ''}`}>
          <EditableText slot={`month${m}`} value={String(m)} singleLine />
        </span>
      ))}
      <span className="dx-months-unit">月</span>
      <EditableText slot="year" value={year} className="dx-months-year" singleLine />
      {/* 用户 2026-09-22：「2026圆点北京，加个圆点」—— 年份与地点之间一个手写圆点 */}
      <span className="dx-months-dot" aria-hidden="true">·</span>
      <EditableText slot="place" value={entry.place} className="dx-months-place" singleLine />
    </El>
  );
}

/* ============================ 篇首页 ============================ */

/**
 * 「小标题：内容」的细目行 —— 冒号前那一截按用户「小标题单拎出来」的习惯单独上色。
 * 2026-09-23：**两截各自可点改**（slot 分别是 `.k` 与 `.v`）——
 * 合成一个 contenteditable 就没法保留"冒号前上色"这个设计，只能拆成两个。
 */
function LeafRow({ text, slot }: { text: string; slot: string }) {
  const i = text.indexOf('：');
  if (i < 0) return <EditableText slot={`${slot}.v`} value={text} />;
  return (
    <>
      <EditableText slot={`${slot}.k`} value={text.slice(0, i + 1)} className="dx-mm-k" singleLine />
      <EditableText slot={`${slot}.v`} value={text.slice(i + 1)} />
    </>
  );
}

/**
 * 篇首页「核心工作」的思维导图（2026-09-22 晚用户：「做成思维导图的样子向右延伸出去」）：
 * 根节点「核心工作」在左，一级是组（01 活动策划…），二级是组下细目，全部向右展开。
 * 连接线用 ::before（横向短枝）+ ::after（纵向主干）画 —— 纯 CSS 的肘形树线，
 * 每个末级都断在最后一行（见 CSS 注释）。
 * 2026-09-23：根 / 组号 / 组名 / 每条细目都可点改。
 *             整棵导图登记成一个结构元素（`core`）—— 它是右栏的**一个整体**，
 *             拆成几十个可独立搬动的叶子反而更难用（想细分可以解组后单独挪）。
 */
function CoreMindMap({ groups }: { groups: { no: string; title: string; items: string[] }[] }) {
  return (
    <ul className="dx-mm">
      <li>
        <EditableText slot="mm.root" value="核心工作" className="dx-mm-root" singleLine />
        <ul className="dx-mm">
          {groups.map((g, gi) => (
            <li key={gi}>
              <span className="dx-mm-node">
                <EditableText slot={`mm.g${gi}.no`} value={g.no} className="dx-mm-no" singleLine />
                <EditableText slot={`mm.g${gi}.title`} value={g.title} singleLine />
              </span>
              {g.items.length ? (
                <ul className="dx-mm">
                  {g.items.map((t, ti) => (
                    <li key={ti} className="dx-mm-leaf">
                      <LeafRow text={t} slot={`mm.g${gi}.i${ti}`} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </li>
    </ul>
  );
}

/**
 * 篇首 = 这一段的"封面"。2026-09-22 晚第四轮（用户看截图）：
 *   「整体往下移动，把顶上的北京新白文化传播有限公司市场部实习生换成标题，
 *    把原标题删了。间距拉大」——
 * 即：大标题顶到页首（原先那行印刷体 org·role 元信息删掉，信息不重复出现），
 * 下面依次是月份圈选行、左公司介绍/右思维导图；块间距整体放大。
 * 板块页/复盘页不受影响，页眉照旧走 Meta（org·role + 手写日期地点）。
 */
function ChapterPage({ entry }: { entry: DiaryEntry }) {
  const groups =
    entry.core ?? entry.sections.map((s) => ({ no: s.index, title: s.title, items: [] as string[] }));
  return (
    <article
      className={`diary-entry dx dx-chapter${entry.id === 'xinbai' ? ' dx-page2' : ''}`}
      style={toneStyle(entry.challengeTone)}
    >
      {/* 2026-09-22 晚第五轮（用户：「月份日期在顶部，与标题换个位置」）——
          月份圈选行顶到页首，下面才是大标题。 */}
      <MonthRow entry={entry} />
      <El slot="title" label="大标题" as="h2" className="dx-title">
        <EditableText slot="title" value={entry.title} />
      </El>

      {/* 左右两栏（2026-09-22 晚用户：「把核心工作部分放页面右边」）：
          左 = 公司与项目介绍，右 = 核心工作思维导图（向右侧延伸）。 */}
      <div className="dx-cols">
        {entry.intro ? (
          <El slot="intro" label="公司与项目介绍" as="section" className="dx-block dx-col-left">
            <h3 className="dx-k">
              <EditableText slot="intro.k" value="公司与项目介绍" />
            </h3>
            <EditableText slot="intro.text" value={entry.intro} as="p" className="dx-text" />
          </El>
        ) : null}
        <El slot="core" label="核心工作（思维导图）" as="section" className="dx-block dx-col-right">
          <CoreMindMap groups={groups} />
        </El>
      </div>
      <Stickers entry={entry} kind="chapter" />
      <ChapterPhotos entry={entry} />
    </article>
  );
}

/* ============================ 板块页 ============================ */

/**
 * 板块页思维导图（2026-09-24 用户：「只放刚刚发的两张图片」——
 *   一张对应踏春块、一张对应妇女节块）——
 * 只挂在篇 01（xinbai）的板块 01（活动策划与落地营销）页：
 *   · 上张（spring，梦核春境 / 把春天吃进梦里）贴「踏春」块（block 0）；
 *   · 下张（women，非袖珍人生 不止今天）贴「妇女节」块（block 1）；
 *   · 绝对定位在正文右侧留白处，不进文档流、翻页层 12 份副本零状态；
 *   · 每张都可点开灯箱看原图（object-fit:contain 等比不变形，文件本身未重编码）。
 */
function SectionPhotos({ entry, sectionIndex }: { entry: DiaryEntry; sectionIndex: number }) {
  if (!(entry.id === 'xinbai' && sectionIndex === 0)) return null;
  return (
    <div className="dx-photos-sec">
      <figure className="dx-map">
        <img
          src="/journal/photos/xinbai-spring.png"
          alt="踏春主题思维导图 · 把春天吃进梦里"
          onClick={(e) => {
            e.stopPropagation();
            openImageZoom('/journal/photos/xinbai-spring.png', '踏春主题思维导图 · 把春天吃进梦里');
          }}
        />
        <figcaption className="dx-cap">踏春 · 把春天吃进梦里</figcaption>
      </figure>
      <figure className="dx-map">
        <img
          src="/journal/photos/xinbai-women.png"
          alt="妇女节策划思维导图 · 非袖珍人生"
          onClick={(e) => {
            e.stopPropagation();
            openImageZoom('/journal/photos/xinbai-women.png', '妇女节策划思维导图 · 非袖珍人生');
          }}
        />
        <figcaption className="dx-cap">妇女节 · 非袖珍人生</figcaption>
      </figure>
    </div>
  );
}

function SectionPage({
  entry,
  section,
  sectionIndex,
}: {
  entry: DiaryEntry;
  section: DiarySection;
  sectionIndex: number;
}) {
  return (
    <article
      /* 2026-09-24：篇 01（第一段实习）专属 class —— 用户「只做第一个实习经历的」，
         胶带小标题 / 字号层级 / 照片只改这一段，篇 02–04 的板块页保持原样。 */
      className={`diary-entry dx dx-sec${entry.id === 'xinbai' ? ' dx-sec1' : ''}`}
      style={toneStyle(entry.challengeTone)}
    >
      {/* 用户 2026-09-22 晚：「📌 核心工作内容与实战成果（这个放在每一个工作内容的最上面）」。
          2026-09-23：把 📌 拆成**自己的元素**（用户：「图标选不了，我要把这个放大」）——
          以前点图标只会选中整行抬头，现在点它单独选中它，字号/字体/颜色、拖动、缩放都只作用在图标上。
          2026-09-23 晚：用户先提「图钉图标删掉」，随即又说「不删 📌 图标」→ 保持保留。 */}
      <El slot="pin" label="📌 抬头" as="p" className="dx-pin">
        <El slot="pin.icon" label="📌 图标" as="span" className="dx-pin-icon">
          <EditableText slot="pin.icon" value="📌" singleLine />
        </El>
        <EditableText slot="pin" value="核心工作内容与实战成果" />
      </El>
      <Meta
        entry={entry}
        slotBase={`s${sectionIndex}`}
        elSlot="meta"
      />
      <El slot="title" label="标题" as="h2" className="dx-title">
        <EditableText slot="no" value={section.index} className="dx-no" singleLine />
        <EditableText slot="title" value={section.title} />
      </El>

      {/* 2026-09-24 用户：「采用这个胶带素材放在标题下面」——
          真实胶带 PNG（藕粉实心，gen-tape-solid-lotus.png）贴在标题正下方，
          做成可登记的结构元素，编辑态能单独选中 / 拖动 / 缩放。纯装饰、不进灯箱。 */}
      <El
        slot="tapetitle"
        label="标题胶带"
        as="img"
        className="dx-tape-title"
        src="/journal/editor/gen-tape-solid-lotus.png"
        alt="装饰胶带"
      />

      {/* 旧篇保留的一句话定位（篇 01 新文案没有这一层） */}
      {section.summary ? (
        <El slot="summary" label="一句话定位" as="p" className="dx-lead">
          <EditableText slot="summary" value={section.summary} />
        </El>
      ) : null}

      {/* 正文：小标题与正文**拆成两个独立结构元素**（用户 2026-09-24：
          「小标题和正文没有分开，想调整小标题和正文之间的间距都没法调，
          他俩还是一起移动的」—— 原来两者同属一个 `<El>`，选中/移动永远是整块，
          间距也被 CSS 写死。拆开后各自可选中、可拖动，间距 = 拖动其中一个即可。
          槽名（blockN.sub / blockN.text）保持不变，旧数据由 storage 的迁移函数搬位置。
          小标题元素沿用 blockN 这个 id（旧覆盖落在它头上正合适）；
          正文元素用 blockNt。sub 为空时只出正文。 */}
      {section.blocks.map((b, i) => (
        <Fragment key={i}>
          {b.sub ? (
            <El slot={`block${i}`} label={`正文块 ${i + 1} · 小标题`} as="h3" className="dx-k">
              <EditableText slot={`block${i}.sub`} value={b.sub} />
            </El>
          ) : null}
          <El
            slot={`block${i}t`}
            label={`正文块 ${i + 1}${b.sub ? ' · 正文' : ''}`}
            as="p"
            className="dx-text"
          >
            <EditableText slot={`block${i}.text`} value={b.text} />
          </El>
        </Fragment>
      ))}

      {/* 成果：整页唯一带底色的一行（篇 02–04 保留，篇 01 新文案没有） */}
      {section.result ? (
        <El slot="result" label="成果行" as="p" className="dx-result">
          <span className="dx-result-k">
            <EditableText slot="result.k" value="成果" singleLine />
          </span>
          <EditableText slot="result.text" value={section.result} />
        </El>
      ) : null}

      {section.highlights?.length ? (
        <El slot="hl" label="数字要点" as="ul" className="dx-hl">
          {section.highlights.map((h, i) => (
            <li key={i}>
              <span className="dx-hl-v">
                <EditableText slot={`hl${i}.v`} value={h.value} singleLine />
              </span>
              <span className="dx-hl-l">
                <EditableText slot={`hl${i}.l`} value={h.label} singleLine />
              </span>
            </li>
          ))}
        </El>
      ) : null}
      <SectionPhotos entry={entry} sectionIndex={sectionIndex} />
    </article>
  );
}

/* ============================ 复盘页 ============================ */

function ReviewPage({
  entry,
}: {
  entry: DiaryEntry;
}) {
  return (
    <article className="diary-entry dx dx-review" style={toneStyle(entry.challengeTone)}>
      <Meta entry={entry} slotBase="rev" elSlot="meta" />
      <El slot="title" label="标题" as="h2" className="dx-title">
        <EditableText slot="title" value="复盘" />
      </El>
      {entry.review.map((b, i) => (
        <Fragment key={i}>
          {b.sub ? (
            <El slot={`block${i}`} label={`正文块 ${i + 1} · 小标题`} as="h3" className="dx-k">
              <EditableText slot={`block${i}.sub`} value={b.sub} />
            </El>
          ) : null}
          <El slot={`block${i}t`} label={`正文块 ${i + 1}${b.sub ? ' · 正文' : ''}`} as="p" className="dx-review-text">
            <EditableText slot={`block${i}.text`} value={b.text} />
          </El>
        </Fragment>
      ))}
      <El slot="sign" label="落款" as="p" className="dx-sign">
        <EditableText slot="sign" value={entry.title} singleLine />
      </El>
    </article>
  );
}

/* ============================ 用户新增的空白页 ============================ */

/**
 * 「加页」新建的空白页 —— 没有对应的 DiarySheet，所以单独一个组件。
 * 纸上只有一句可点改的提示；贴纸 / 文字贴纸由编辑器的图层系统挂上去（见 NotebookOverlay）。
 */
export function BlankPage() {
  return (
    <article className="diary-entry dx dx-blank">
      <El slot="hint" label="空白页提示" as="p" className="dx-blank-hint">
        <EditableText
          slot="blank.hint"
          value="点这里写字，或从下面的「素材库」贴点东西。"
        />
      </El>
    </article>
  );
}

/* ============================ 入口 ============================ */

export function DiaryPage({ sheet }: { sheet: DiarySheet }) {
  switch (sheet.kind) {
    case 'chapter':
      return <ChapterPage entry={sheet.entry} />;
    case 'section':
      return (
        <SectionPage
          entry={sheet.entry}
          section={sheet.section}
          sectionIndex={sheet.sectionIndex}
        />
      );
    case 'review':
      return <ReviewPage entry={sheet.entry} />;
    default:
      return null;
  }
}
