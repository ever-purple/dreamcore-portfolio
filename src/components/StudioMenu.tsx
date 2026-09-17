import { useEscape } from '@/lib/escape-stack';
import { HandFrame } from '@/components/HandFrame';
import { PageDecor } from '@/components/PageDecor';

export type StudioMenuId = 'about' | 'works' | 'lab' | 'contact' | 'resume';

type Props = {
  open: boolean;
  onClose: () => void;
  /** 点某一条菜单项。目前只有 'about' 有落地页，其余保持占位。 */
  onSelect?: (id: StudioMenuId) => void;
  onHoverChange?: (hovering: boolean) => void;
};

const MENU_ITEMS: { id: StudioMenuId; en: string; zh: string }[] = [
  { id: 'about', en: 'About Me', zh: '关于我' },
  { id: 'works', en: 'Works', zh: '策划项目' },
  { id: 'lab', en: 'Creative Lab', zh: 'AI及视频' },
  { id: 'contact', en: 'Contact', zh: '联系方式' },
  { id: 'resume', en: 'Resume', zh: '简历' },
];

/**
 * Studio 全屏菜单：中英双语导航，英文大、中文小，顶部 Close 按钮。
 */
export function StudioMenu({ open, onClose, onSelect, onHoverChange }: Props) {
  // ESC 收菜单。走全站统一的 Esc 栈（@/lib/escape-stack）——
  // 菜单是全局导航，可能盖在内容页之上，只有"栈"能保证一次按键只收最上面那层。
  useEscape(onClose, open);

  if (!open) return null;

  return (
    <div
      className="studio-menu-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Studio menu"
    >
      {/* 背景装饰：和子页同款的实色花 + 薄荷星阵饰带（替换原来的 ASCII 牵牛花，
          用户：太像素风 / ascii）。菜单主体文字在正中，装饰只在四角与上下饰带。
          层级 z-index:-1，不可能盖住菜单字。 */}
      <PageDecor variant="menu" />

      {/* 居中十字辅助线 */}
      <div className="menu-crosshair-h" aria-hidden="true" />
      <div className="menu-crosshair-v" aria-hidden="true" />

      {/* 关闭。**必须挂在这里**，不能指望顶上那枚 MENU 变 Close ——
          2026-09-16 菜单层级从 40 抬到 400（要压得住内容页），于是工作室顶栏(z50)
          被压到菜单底下，那枚 Close 点不到了；不补这一颗，鼠标就没法关菜单。
          位置/尺寸/笔触刻意和 StudioChrome 里那枚 MENU 完全对齐 ——
          读起来就是"同一颗按钮，只是从 MENU 变成了 Close"。 */}
      <button
        type="button"
        className="studio-pill studio-menu-close"
        onClick={onClose}
        aria-label="关闭菜单"
        data-cursor="Close"
        data-cursor-tone="dark"
      >
        <HandFrame shape="ring">Close</HandFrame>
      </button>

      <nav className="studio-menu-items">
        {MENU_ITEMS.map((item) => (
          <a
            key={item.id}
            href="#"
            className="studio-menu-link"
            onClick={(e) => {
              // 别让 href="#" 真的去改 hash —— 工作室用 #about 表示"About 开着"，
              // 放它跳会把 URL 状态搅乱。
              e.preventDefault();
              onSelect?.(item.id);
            }}
            onMouseEnter={() => onHoverChange?.(true)}
            onMouseLeave={() => onHoverChange?.(false)}
          >
            <span className="menu-en">{item.en}</span>
            <span className="menu-zh">{item.zh}</span>
            {/* 悬停时的手写下划线：两笔弧线（来回描一遍），与光标 / 物件标签同一套笔触。
                以前是 `::after` 一条 0.05em 高的**实心横杠** —— 也是用户要清掉的那种"硬色块"。 */}
            <svg
              className="menu-underline"
              viewBox="0 0 300 14"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path className="hand__stroke" pathLength={100} d="M4 9 C60 3 142 12 296 6" />
              <path className="hand__stroke" pathLength={100} d="M296 7 C238 11 122 3 16 9" />
            </svg>
          </a>
        ))}
      </nav>
    </div>
  );
}
