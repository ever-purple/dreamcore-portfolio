import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { COPY_PAGE_COPY, COPY_PROJECTS, type CopyProject } from '@/data/copyProjects';
import { CursorLabel } from '@/components/CursorLabel';
import { PageDecor } from '@/components/PageDecor';
import { StudioChrome } from '@/components/StudioChrome';
import { useEscape } from '@/lib/escape-stack';

/**
 * 报刊亭「第二排」落地页 —— 文案 / AI 项目列表（**购物小票**）。
 *
 * 2026-09-17：用户要求「每个文案对应一张购物小票，小票上有产品图 + 产品名，
 * 点开有展开动画看到全部文案，小票要有锯齿撕痕」。
 * 画风参考：喜茶式软手绘（产品插画 + 涂鸦小人 + 奶油底）；
 * 字体参考：spec-sheet 式宽字距技术感无衬线（大写、小字号、冷静克制）。
 *
 * 这是个**独立页面**（全屏铺满，有自己的滚动与返回）。
 * 小票卡片 = 紧凑预览（折叠态）；点开 → 模态层里小票从上往下「打印」展开（全文案）。
 *
 * 2026-09-22 第四轮（本轮）：
 *   · 小票上恢复**产品插画**；实景照片改放右侧文案面板顶部（通栏、multiply 融纸）；
 *   · 面板正文**左右两栏 + 中间一条竖虚线**（茶之韵按节分栏，带大号手写序号）；
 *   · 小票 + 贴纸加**悬停放大**（缩放挂在 .cp-receipt-unit 上，见 index.css 的说明）；
 *   · 标题「Copywriting & AI」→「Copywriting 文案」，中文那半字号更小；
 *   · 正文字体回到用户点名的**汉仪旗黑-40S**。
 */

type Props = {
  onClose: () => void;
};

export function CopyProjectPage({ onClose }: Props) {
  const [entered, setEntered] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // 用 ref 让 Esc 处理器始终读到最新的 openId（useEscape 只注册一次闭包）
  const openRef = useRef<string | null>(null);
  useEffect(() => {
    openRef.current = openId;
  }, [openId]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  /* 预热正文字体（旗黑 40S 子集 ~600KB）。
     它只在展开小票时才被用到，而 @font-face 是 font-display:swap ——
     等到点开才下载，会先看到一屏回退字体再"跳"成旗黑（正是用户抱怨的
     "有的粗有的细"的观感来源之一）。这里进页面就异步拉起来，等点开时已经就绪。
     预热要带上真实会渲染的字：字形是按需取用的，只 preload 字体文件不够。
     失败也无所谓（离线/被拦），静默吞掉。 */
  useEffect(() => {
    document.fonts?.load?.('16px "HYQiHei-40S"', '起源探索交流回归文案').catch(() => undefined);
  }, []);

  // ESC：小票展开时先收小票，否则退回书架。走全站统一的 Esc 栈。
  useEscape(() => {
    if (openRef.current) setOpenId(null);
    else onClose();
  });

  // 小票必须有产品图（cover）才上墙 —— 没图的不先放（"先做一个"即营养快线；
  // 之后给其它条目补 cover 图，小票自动出现，不用改组件）。
  // 2026-09-22：顶部的分类筛选（全部 / 文案 / AI 项目）已按用户要求整体删除
  // —— <nav class="cp-filters">、filter state、COPY_FILTERS 引用一起走，
  //    列表恒为全量。要恢复就去 git 里捞。
  const receipts = useMemo(() => COPY_PROJECTS.filter((p) => p.cover), []);

  const openProject = openId ? (COPY_PROJECTS.find((p) => p.id === openId) ?? null) : null;

  return (
    <>
    <div
      className={`cp-page${entered ? ' is-in' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="文案与 AI 项目"
      data-cursor=""
      data-cursor-tone="light"
    >
      <PageDecor variant="cp" />

      {/* 标题栏必须在 .cp-scroll **里面**（2026-09-22 第六轮）：
          原来它在滚动容器外面，.cp-scroll 的 overflow-y:auto 在 y≈147 处形成一条
          看不见的裁切线 —— 小票往上拖，票头/贴纸/产品图整段被切掉，看起来像
          「被标题栏盖住」。挪进来之后裁切边界变成屏幕物理上沿（y=0），
          小票可以完整地拖到标题区上方（小票 z-index 2 > 标题，画在标题之上）。
          代价：内容真溢出（矮屏）时标题会跟着滚走 —— 对这页可接受。 */}
      <div className="cp-scroll" data-cursor="" data-cursor-tone="light">
        <header className="cp-topbar">
          <div className="cp-brand">
            {/* 2026-09-22 第四轮：原先是「Copywriting & AI」，用户要「去掉 &AI，加上文案，
                文案字号比英文小」→ 英文只留 Copywriting，中文另起一个 span 好单独给字号。 */}
            <h1 className="cp-title">
              {COPY_PAGE_COPY.title}
              <span className="cp-title-cn">{COPY_PAGE_COPY.titleCn}</span>
            </h1>
            {COPY_PAGE_COPY.subtitle ? <p className="cp-subtitle">{COPY_PAGE_COPY.subtitle}</p> : null}
          </div>
        </header>
        {receipts.length === 0 ? (
          <p className="cp-empty">{COPY_PAGE_COPY.empty}</p>
        ) : (
          <div className="cp-grid">
            {receipts.map((p) => (
              <ReceiptCard key={p.id} project={p} onOpen={() => setOpenId(p.id)} />
            ))}
          </div>
        )}
      </div>

      <StudioChrome label="Return to Archive" onBack={onClose} tone="dark" className="cp-chrome" />
    </div>

    {/* 展开的小票（模态层）。挂本页根节点外面，避免被入场动画的 opacity/scale 影响。 */}
    {openProject ? <ReceiptSheet project={openProject} onClose={() => setOpenId(null)} /> : null}

    <CursorLabel />
    </>
  );
}

/** 单号（取 year 里的数字，补到 4 位） */
function receiptNo(year?: string) {
  return ((year ?? '').replace(/[^0-9]/g, '') || '000').padStart(4, '0');
}

/**
 * 标题块的第三行：把 blurb 收成「配料」那一句。
 * blurb = 「营养快线 = 果汁 + 牛奶，怀旧情怀上大分！」→ 取逗号前那段，去掉开头的店名与等号
 * → 「果汁 + 牛奶」。用户 2026-09-22 给的样张里，这一行是手写体的「果汁 + 牛奶」。
 */
function receiptSub(blurb: string | undefined, title: string) {
  const first = (blurb ?? '').split('，')[0].trim();
  const sub = first.startsWith(title) ? first.slice(title.length).trim().replace(/^[=＝]+\s*/, '') : first;
  return sub || title;
}

/** TOTAL：由明细求和（按“分”取整，2.99 + 1.8 + 1.2 浮点加出来是 5.989999…） */
function receiptTotal(items: { price: number }[]) {
  return (items.reduce((n, it) => n + Math.round(it.price * 100), 0) / 100).toFixed(2);
}

/** 今天（YYYY/MM/DD）—— 卡片与展开态共用，保证两处内容一模一样 */
function useToday() {
  const [today] = useState(() => {
    const n = new Date();
    const p = (v: number) => String(v).padStart(2, '0');
    return `${n.getFullYear()}/${p(n.getMonth() + 1)}/${p(n.getDate())}`;
  });
  return today;
}

/** 小票上沿的贴纸（用户 2026-09-22 给的 3.png 抠图；位置照参考图里那颗小蓝点） */
const STICKER_SRC = `${import.meta.env.BASE_URL}media/mascot-sticker.png`;

/**
 * 把小节正文按**句末标点**断行 —— 兜底用，只在 text 里没有显式换行时才走这条路。
 *
 * 2026-09-22 第四轮起，茶之韵四节已改成**显式 `\n`**（用户拿参考图说
 * 「排版按照这个来断句」）—— 因为参考图的断行位置**不只在句末**：
 * 「探索」「交流」「回归」三节都是**一句话用逗号串起来**再按逗号分行的，
 * 靠 `。！？` 断只会每节剩一行。所以正常路径是 `text.split('\n')`，
 * 这个函数只留给"以后新加的节没写显式换行"的情况。
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 文案面板里的一个「块」：有 label 的（茶之韵那种）带头号和序号，没有的只是一组行。 */
type PoemBlock = { label?: string; num?: number; lines: string[] };

/**
 * 把正文行按**空行**分组。
 * 约定来自 copyProjects：换行 = 一行，空行 = 一次分节留白。
 * 分栏时以「组」为最小单位，这样不会把一整段从中间劈到两栏去。
 */
function groupLines(lines: string[]): string[][] {
  const groups: string[][] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (l) cur.push(l);
    else if (cur.length) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

/**
 * 对半分到左右两栏。
 *
 * 规则来自用户 2026-09-22 第四轮给的**排版参考**（屏幕截图 2026-09-22 170953 / 171019）：
 *   · 茶之韵 4 节 → 左「1 起源 + 2 探索」/ 右「3 交流 + 4 回归」；
 *   · 郁美净 6 段 → 左 3 段（嗅觉…/一股泥土味…/花露水…）/ 右 3 段（秋的风里…/温暖…/味道…）。
 * 两张图都是**段数对半**，不是按行数或字数配平 ——
 * 所以这里就按块数 `ceil(n/2)` 切，简单照做，别自作聪明去"配平"
 * （早先按视觉重量配平过一版，郁美净会切成左 13 行 / 右 9 行，跟参考图正好相反）。
 */
function splitColumns<T>(items: T[]): [T[], T[]] {
  if (items.length < 2) return [items, []];
  const mid = Math.ceil(items.length / 2);
  return [items.slice(0, mid), items.slice(mid)];
}

/**
 * 行内强调标记 → React 节点。
 *
 * 用户 2026-09-22 给的郁美净参考图（屏幕截图 171019）里，划线只落在**个别词**上
 * （春雨 / 夏日庭院 / 温暖 / 童年的味道），另外首句是**整行浅色底高亮**。
 * 用户原话：「我原来加是为了强调」—— 所以标记写在数据里（`_词_` / `==整句==`），
 * 而不是给一串关键词去正文里到处匹配：同一个词在正文里可能出现多次
 * （郁美净的「温暖」就有两处），只有行内标记能精确指定划哪一处。
 *
 * 只支持这两种、不嵌套。用 `split` 而不是 `replace` + dangerouslySetInnerHTML：
 * 不引入 HTML 注入面，也不多一个依赖。
 */
const RICH_RE = /(==[^=]+==|_[^_]+_)/g;

function renderRich(line: string): ReactNode[] {
  return line
    .split(RICH_RE)
    .filter((seg) => seg !== '')
    .map((seg, i) => {
      if (seg.startsWith('==') && seg.endsWith('==') && seg.length > 4) {
        return (
          <mark className="cp-em-mark" key={i}>
            {seg.slice(2, -2)}
          </mark>
        );
      }
      if (seg.startsWith('_') && seg.endsWith('_') && seg.length > 2) {
        return (
          <span className="cp-em-u" key={i}>
            {seg.slice(1, -1)}
          </span>
        );
      }
      return seg;
    });
}


/**
 * 小票**本体** —— 卡片（折叠态）与展开态共用这一份 DOM。
 *
 * 用户 2026-09-22 要求「卡片的样子与点开后的小票要一致，长宽显示内容都要一样」，
 * 所以两处不能再各写一套：宽度、内边距、内容行全部只有这里一份定义（见 CSS 的 .cp-receipt-unit）。
 * 卡片额外的那行「▾ 点按展开全文」是交互提示、不属于小票内容，挂在 unit 外面。
 */
function ReceiptUnit({ project, className = '' }: { project: CopyProject; className?: string }) {
  const no = receiptNo(project.year);
  const today = useToday();
  const items = project.receiptItems ?? [];
  return (
    <div className={`cp-receipt-unit${className ? ` ${className}` : ''}`}>
      <div className="cp-receipt-paper cp-receipt-creases">
        <header className="cp-receipt-head cp-receipt-mono">
          <b>RECEIPT</b>
          <b>No.{no}</b>
        </header>

        {/* 产品插画（真透明 PNG）。
            2026-09-22 第四轮：上一轮这里放的是「氛围照片带」，用户要求
            「把产品图换回来，是让你把图片加在 Clipboard_Screenshot-2.png」——
            照片挪去了右侧文案面板（见 ReceiptSheet 的 .cp-poem-photo），
            小票上恢复原来的插画。 */}
        {project.cover ? (
          <img className="cp-receipt-img" src={project.cover} alt={project.title} draggable={false} />
        ) : null}

        <div className="cp-receipt-titlebox cp-receipt-hand">
          <h2 className="cp-receipt-name">{project.title}</h2>
          <span className="cp-receipt-mark" aria-hidden="true">
            {'"'}
          </span>
          <p className="cp-receipt-sub">{receiptSub(project.blurb, project.title)}</p>
        </div>

        {items.length ? (
          <div className="cp-receipt-items cp-receipt-hand">
            {items.map((it) => (
              <div className="row" key={it.name}>
                <span className="k">{it.name}</span>
                <i className="dots" aria-hidden="true" />
                <span className="v">¥{it.price.toFixed(2)}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="cp-receipt-dashes" aria-hidden="true" />

        <div className="cp-receipt-meta2 cp-receipt-mono">
          <div className="row">
            <span className="k">LOCATION</span>
            <i className="dots" aria-hidden="true" />
            <span className="v cp-receipt-hand">报刊亭</span>
          </div>
          <div className="row">
            <span className="k">DATE &amp; TIME</span>
            <i className="dots" aria-hidden="true" />
            <span className="v cp-receipt-hand">{today}</span>
          </div>
        </div>

        <div className="cp-receipt-dashes" aria-hidden="true" />

        <div className="cp-receipt-total2 cp-receipt-mono">
          <span>TOTAL :</span>
          {/* 红手绘圈里住的是**金额**（参考图版式）；没有明细的条目退回原来的「谢谢惠顾」 */}
          <em className="cp-receipt-stamp cp-receipt-hand">
            {items.length ? `¥${receiptTotal(items)}` : '谢谢惠顾'}
          </em>
        </div>

        <div className="cp-receipt-barcode" aria-hidden="true" />
        <p className="cp-receipt-credit cp-receipt-mono">@DREAMCORE 报刊亭</p>
      </div>

      {/* 贴纸必须挂在纸面**外面**：纸面用 mask 裁上下锯齿，放进去会被一起裁掉，
          就出不来“骑在纸沿上”的效果。 */}
      <span className="cp-receipt-sticker" aria-hidden="true">
        <img
          className="cp-receipt-sticker-img"
          src={project.sticker ?? STICKER_SRC}
          alt=""
          draggable={false}
        />
      </span>
    </div>
  );
}

/**
 * 网格里的「折叠小票」卡片 —— 与展开态共用同一份 ReceiptUnit，所以长宽/内容天然一致。
 *
 * 用户 2026-09-22：**打开前**小票可以在页面上随便拖（落点保留）；
 * **打开后**小票和文案都不可移动（展开态里已无任何拖动逻辑）。
 * 拖动与点击共存的做法：位移过 4px 才算拖动，拖动结束那一次的 click 被吞掉，不会误打开。
 */
function ReceiptCard({ project, onOpen }: { project: CopyProject; onOpen: () => void }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const movedRef = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    movedRef.current = false;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return; // 4px 内当点击
    d.moved = true;
    setDragging(true);
    setPos({ x: d.ox + dx, y: d.oy + dy });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    movedRef.current = !!dragRef.current?.moved;
    dragRef.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const moved = pos.x !== 0 || pos.y !== 0;

  return (
    <button
      type="button"
      className={`cp-receipt cp-drag-handle${moved ? ' is-moved' : ''}${dragging ? ' is-dragging' : ''}`}
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={() => {
        if (movedRef.current) {
          movedRef.current = false; // 刚拖完那一下只算拖动
          return;
        }
        onOpen();
      }}
      title="按住拖动 · 点按展开全文"
      data-cursor="Open"
      data-cursor-tone="light"
      aria-label={`展开 ${project.title} 的小票`}
    >
      <ReceiptUnit project={project} />
      <span className="cp-receipt-open cp-receipt-mono">▾ 点按展开全文</span>
    </button>
  );
}

/**
 * 展开（模态）视图 —— 左「长小票」（与卡片同一份 ReceiptUnit）+ 右侧文案面板。
 *
 * 2026-09-22 第三轮定下：
 *   · 「打开后小票和文案位置都不可移动」→ 这里**没有**任何拖动逻辑（拖动只在卡片上）；
 *   · 删掉面板顶部那个白底圆角说明块，面板就是诗行本身。
 *
 * 2026-09-22 第四轮改了面板的四件事：
 *   1. **照片当底**（用户：「把产品图换回来，是让你把图片加在 Clipboard_Screenshot-2.png」
 *      → 又补「图片是底，例如这样」）—— 小票上恢复产品插画；照片 absolute 铺满整个
 *      文案面板当底图，上面加一层黑色半透明蒙版压暗、正文用浅色字压在最上层
 *      （用户：「可以给图片加一层黑色透明蒙版，让画面变暗，让字体看清，字体不要有阴影」）。
 *   2. **左右两栏 + 中间一条竖虚线**，但**只有郁美净 / 茶之韵**（见 `twoColumn`）——
 *      用户先要的通用左右排版，随后改口「前两个文案不用用虚线分开」。
 *   3. 分开的方式是**按块数对半**（茶之韵 2/2 节、郁美净 3/3 段），照用户给的排版参考。
 *   4. 正文字重回到用户点名的 **汉仪旗黑-40S**（见 index.css 的 .cp-receipt-qihei）。
 *
 * 2026-09-22 第五轮：底图糊的根因在**素材**（旧版 560×231 的横幅带被 cover 放大 2.42 倍），
 * 已重出图（见 scripts/prep-receipt-photos.py）。融合方式并列试了两套 ——
 * 「纸纹渗入左上角」与「135° 黑色渐变蒙版」—— **用户选了后者**，前者与切换开关已删除。
 * 这里不再有任何 mode 参数：蒙版写死在 index.css 的 `.cp-receipt-panel.is-photo::after`。
 */
function ReceiptSheet({ project, onClose }: { project: CopyProject; onClose: () => void }) {
  // 保留空行：用户要的分节靠空行表达，所以不能用 filter(Boolean) 把空串丢掉
  const lines = (project.body ?? project.blurb).split('\n');

  /* 先把内容归成「块」，再按块分两栏（不把一段从中间劈开）。
     有 sections（茶之韵）→ 一节一块，带序号与节名；
     没有 → 按空行分组，每组一块。 */
  const blocks: PoemBlock[] = project.sections
    ? project.sections.map((s, i) => ({
        label: s.label,
        num: i + 1,
        /* 显式换行为准（茶之韵四节都写死了换行，见 copyProjects 那段注释）；
           没写换行的节才退回按句末标点断。 */
        lines: s.text.includes('\n') ? s.text.split('\n') : splitSentences(s.text),
      }))
    : groupLines(lines).map((g) => ({ lines: g }));

  /* 分栏由条目自己声明（`twoColumn`）。
     用户 2026-09-22 第四轮先要「左右排版 + 中间一条分割线」并给了茶之韵 / 郁美净两张参考，
     随后又说「**前两个文案不用用虚线分开**」—— 所以营养快线 / 银鹭（短文案）保持单栏，
     只有郁美净 / 茶之韵走两栏 + 中间那条竖虚线。右栏为空时 `.is-columns` 自然不挂上。 */
  const [left, right] = project.twoColumn ? splitColumns(blocks) : [blocks, []];

  const renderCol = (col: PoemBlock[]) => (
    <div className="cp-poem-col">
      {col.map((b, bi) => (
        <section className="cp-poem-sec" key={b.label ?? bi}>
          {b.label ? (
            <p className="cp-poem-sec-head">
              {/* 大号淡色手写数字（参考图里那个悬在节名左侧的「1 / 2 / 3 / 4」） */}
              <span className="cp-poem-num" aria-hidden="true">
                {b.num}
              </span>
              <span className="cp-poem-sec-label">{b.label}</span>
            </p>
          ) : null}
          {/* 正文行挂 `.cp-poem-line`：它是「正文行」与「节名行」的唯一区分钩子
              （节名那行是 .cp-poem-sec-head，别被同一个 `p` 选择器连带上）。
              整行曾经划过下划虚线（照排版参考），用户说「文案不用加下划虚线」→ 已去掉；
              现在只有数据里用 `_…_` / `==…==` 标出来的地方才有线或底 —— 见 renderRich。 */}
          {b.lines.map((line, li) => (
            <p className="cp-poem-line" key={li}>
              {renderRich(line)}
            </p>
          ))}
        </section>
      ))}
    </div>
  );

  return (
    <div
      className="cp-receipt-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${project.title} 小票`}
    >
      <button
        type="button"
        className="cp-receipt-close"
        onClick={onClose}
        aria-label="收起小票"
        data-cursor=""
        data-cursor-tone="light"
      >
        ×
      </button>

      <div className="cp-receipt-stage" onClick={(e) => e.stopPropagation()}>
        {/* 左：长小票（与网格卡片同一份 DOM，含折痕与贴纸）。
            用户 2026-09-22「让小票和贴纸都处在最上层，不要显示不出来」——
            它在 CSS 里是 sticky + 高 z-index：文案再长、滚动时它也一直留在视口里。 */}
        <ReceiptUnit project={project} className="cp-receipt-sheet" />

        {/* 右：文案面板 —— 汉仪旗黑-40S（用户 2026-09-22：
            手写体读整段长文案太吃力，正文换成旗黑；手写体只留给小票上的标题/明细）。
            结构 = 照片满幅当底 + 左右两栏正文（中间一条竖虚线）。 */}
        <section
          className={`cp-receipt-panel${project.photo ? ' is-photo' : ''}`}
          aria-label={`${project.title} 文案`}
        >
          {project.photo ? (
            /* **照片当底**（用户 2026-09-22：「图片是底，例如这样」）——
               绝对定位铺满整幅面板，上面叠纸纹 + 一层 135° 黑色渐变蒙版，正文再压在最上面。
               alt 留空：它是底图，产品名由左栏小票上的手写标题块承担。
               ⚠️ 底图素材由 scripts/prep-receipt-photos.py 出图，**不裁比例、只缩不放** ——
                  曾被压成 560×231 的横幅带，铺满 1042px 面板时放大 2.42 倍（糊）。
                  详见 index.css 的 .cp-poem-photo。 */
            <img className="cp-poem-photo" src={project.photo} alt="" draggable={false} />
          ) : null}

          <div className="cp-receipt-panel-body">
            <div
              className={`cp-receipt-poem cp-receipt-qihei${project.sections ? ' is-sections' : ''}${
                right.length ? ' is-columns' : ''
              }`}
            >
              {renderCol(left)}
              {right.length ? renderCol(right) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default CopyProjectPage;
