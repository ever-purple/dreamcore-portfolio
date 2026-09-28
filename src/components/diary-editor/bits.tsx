/**
 * 手账编辑器 —— 工具栏零件（弹出面板 / 按钮 / 样式九宫格）
 *
 * 设计取向：工具栏在**底部**，所以所有弹出面板一律**向上**弹。
 *
 * ⚠️ 面板必须走 **portal + position:fixed**，不能留在工具栏的 DOM 子树里。
 *    原因（实测踩到，代价很大）：工具栏中间那段是横向可滚的
 *    （`.dp-toolbar-scroll { overflow-x: auto }`），而按 CSS 规范，一个方向不是
 *    `visible` 时另一方向也会被算成 `auto` —— 于是向上弹的面板被**整个裁掉**：
 *    `getBoundingClientRect()` 明明有正确坐标，`elementFromPoint()` 在每个格子上
 *    却都命中下面那张纸（被裁掉的内容不参与命中测试）。
 *    表现就是「九种图片框 / 八种文字框 / 纸张 / 取色器全都点不中」。
 *    搬到 body 下、用 fixed 定位，就彻底不受任何祖先的 overflow 影响。
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FRAME_STYLES, TEXT_ALIGNS, TEXT_BOX_STYLES, type FrameStyle, type TextAlign, type TextBoxStyle } from '@/lib/diary-editor/types';

/* ============================ 弹出面板 ============================ */

export function Popover({
  label,
  title,
  children,
  icon,
  active,
  wide,
  value,
}: {
  label: string;
  title?: string;
  children: (close: () => void) => ReactNode;
  icon?: ReactNode;
  active?: boolean;
  wide?: boolean;
  /**
   * 按钮上紧跟 label 显示的**当前值**（如「图片框样式 · 拍立得」）。
   *
   * 用户 2026-09-23 要求「选中文字或素材边框样式，文字的字体字号颜色样式也会在下方
   * 这里显示出来」—— 下拉框天然会显示当前值，但**弹层按钮**不会，所以这里补上：
   * 不展开面板也能一眼看到"现在用的是什么框 / 什么底色 / 什么颜色"。
   * 传 `—` 表示"当前对象没有这一项"（例如结构元素没有贴纸底框）。
   */
  value?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number; maxH: number } | null>(null);

  /* 面板宽度估算（只用于视口夹取；真实宽度由 CSS 的 min-width 决定） */
  const estW = wide ? 400 : 268;

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    /* 水平：以按钮中心对齐，再夹进视口（否则最左/最右那组的宽面板会出界） */
    const half = Math.min(estW, innerWidth - 16) / 2;
    const left = Math.max(half + 8, Math.min(innerWidth - half - 8, b.left + b.width / 2));
    /* 垂直：贴着按钮上沿往上，上限是按钮上方那块空间（不越过视口顶部） */
    const maxH = Math.max(160, Math.min(innerHeight * 0.66, b.top - 24));
    setPos({ left: Math.round(left), bottom: Math.round(innerHeight - b.top + 10), maxH: Math.round(maxH) });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    /* 面板打开后按真实宽度再夹一次（宽面板 / 长文案时更准） */
    const el = panelRef.current;
    if (el) {
      const w = el.getBoundingClientRect().width;
      const b = btnRef.current?.getBoundingClientRect();
      if (b && w > 0 && w < innerWidth - 16) {
        const half = w / 2;
        const left = Math.max(half + 8, Math.min(innerWidth - half - 8, b.left + b.width / 2));
        if (left !== pos?.left) setPos((p) => (p ? { ...p, left: Math.round(left) } : p));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    /* 视口 / 滚动变化时重新贴位（工具栏是 fixed 在底部的，滚的是页面） */
    const onMove = () => place();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      /* 面板已经 portal 出去了，所以「点按钮本身」也要单独判一次 ——
         否则点按钮会先被"点到外面"关掉、再被按钮自己的 onClick 打开。 */
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    /* 用捕获阶段：本地的 Esc 监听在 window 上，这里要抢先关面板而不是退出编辑 */
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`dp-btn${active ? ' is-active' : ''}${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={title ?? label}
        aria-expanded={open}
      >
        {icon}
        <span className="dp-btn-label">{label}</span>
        {value !== undefined && value !== null ? <span className="dp-btn-value">{value}</span> : null}
        <span className="dp-caret" aria-hidden="true">
          ▴
        </span>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              className={`dp-pop${wide ? ' is-wide' : ''}`}
              role="dialog"
              aria-label={label}
              style={{ left: pos.left, bottom: pos.bottom, maxHeight: pos.maxH }}
            >
              {children(() => setOpen(false))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/* ============================ 按钮 ============================ */

export function TbButton({
  label,
  title,
  onClick,
  icon,
  active,
  disabled,
  tone,
}: {
  label: string;
  title?: string;
  onClick?: () => void;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  tone?: 'danger' | 'primary';
}) {
  return (
    <button
      type="button"
      className={`dp-btn${active ? ' is-active' : ''}${tone ? ` is-${tone}` : ''}`}
      onClick={onClick}
      title={title ?? label}
      disabled={disabled}
    >
      {icon}
      <span className="dp-btn-label">{label}</span>
    </button>
  );
}

export function TbSep() {
  return <span className="dp-sep" aria-hidden="true" />;
}

export function TbGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="dp-group" aria-label={title}>
      <span className="dp-group-title">{title}</span>
      <div className="dp-group-row">{children}</div>
    </div>
  );
}

/* ============================ 下拉（原生 select 外壳） ============================ */

export function TbSelect({
  label,
  value,
  onChange,
  children,
  title,
  previewFont,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  title?: string;
  /**
   * 让**下拉框本身**用这个字体渲染 —— 字体选择器要"所见即所得"：
   * 选中 Caveat，工具栏上那个框里显示的也是 Caveat 的字形。
   * （选项各自的字体由调用方在 `<option style>` 上写。）
   */
  previewFont?: string;
}) {
  return (
    <label className="dp-select" title={title ?? label}>
      <span className="dp-select-label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={previewFont ? { fontFamily: previewFont } : undefined}
      >
        {children}
      </select>
    </label>
  );
}

/* ============================ 九宫格选择器 ============================ */

/** 图片框十种：预览直接用真的 `.dp-frame.is-*` 类，所见即所得 */
export function FrameGrid({
  value,
  onPick,
  exclude,
}: {
  value: FrameStyle;
  onPick: (v: FrameStyle) => void;
  /** 不给选的样式（如「四格相框」只对图片有意义，视频的九宫格里不出现） */
  exclude?: FrameStyle[];
}) {
  return (
    <div className="dp-gridbox">
      <p className="dp-pop-hint">图片 / 视频贴纸外观</p>
      <div className="dp-grid9">
        {FRAME_STYLES.filter((f) => !exclude?.includes(f.id)).map((f) => (
          <button
            key={f.id}
            type="button"
            className={`dp-cell${value === f.id ? ' is-on' : ''}`}
            onClick={() => onPick(f.id)}
            title={f.label}
          >
            <span className="dp-cell-demo">
              <span className={`dp-demo-box is-${f.id}`}>
                <span className="dp-demo-pic" />
              </span>
            </span>
            <span className="dp-cell-label">{f.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 文字框八种 */
export function TextBoxGrid({
  value,
  onPick,
}: {
  value: TextBoxStyle;
  onPick: (v: TextBoxStyle) => void;
}) {
  return (
    <div className="dp-gridbox">
      <p className="dp-pop-hint">文字贴纸背景</p>
      <div className="dp-grid8">
        {TEXT_BOX_STYLES.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`dp-cell${value === b.id ? ' is-on' : ''}`}
            onClick={() => onPick(b.id)}
            title={b.label}
          >
            <span className="dp-cell-demo">
              <span className={`dp-demo-text is-${b.id}`}>文</span>
            </span>
            <span className="dp-cell-label">{b.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================ 色板 ============================ */

const SWATCHES = [
  '#3a2e23', '#8a6a3f', '#b5e3d6', '#33604e', '#6f86c9',
  '#8a4356', '#d9c94a', '#c2503c', '#f2eee0', '#ffffff',
];

export function ColorRow({
  value,
  onChange,
  label = '文字颜色',
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div className="dp-color">
      <span className="dp-pop-hint">{label}</span>
      <div className="dp-color-row">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={`dp-swatch${value.toLowerCase() === c ? ' is-on' : ''}`}
            style={{ background: c } as CSSProperties}
            onClick={() => onChange(c)}
            title={c}
            aria-label={c}
          />
        ))}
        <label className="dp-swatch is-pick" title="自定义颜色">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
          <span aria-hidden="true">＋</span>
        </label>
      </div>
    </div>
  );
}

/* ============================ 对齐 ============================ */

/**
 * 一行四个对齐按钮（左 / 居中 / 右 / 两端）。
 *
 * 用户 2026-09-23：「把文字块做成ppt那种框，可以调整对齐，可以自行换行」。
 * 做成常驻的四个小按钮而不是弹层：对齐是文字排版里改得最勤的一项，藏进弹层会很难找。
 *
 * 图标用三根纯 CSS 横线（`.dp-align-icon` + `data-a`），不走 SVG ——
 * 三横线的长短差异就是"对齐"最直白的画法，而且会跟着按钮的文字色走。
 */
export function TbAlignRow({
  value,
  onChange,
}: {
  value: TextAlign;
  onChange: (v: TextAlign) => void;
}) {
  return (
    <div className="dp-aligns" role="group" aria-label="对齐">
      {TEXT_ALIGNS.map((a) => (
        <button
          key={a.id}
          type="button"
          className={value === a.id ? 'dp-btn is-icon is-active' : 'dp-btn is-icon'}
          title={a.label}
          aria-label={a.label}
          aria-pressed={value === a.id}
          onClick={() => onChange(a.id)}
        >
          <span className="dp-align-icon" data-a={a.id} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>
      ))}
    </div>
  );
}
