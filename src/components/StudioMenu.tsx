import { useEffect } from 'react';

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="studio-menu-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Studio menu"
    >
      {/* 居中十字辅助线 */}
      <div className="menu-crosshair-h" aria-hidden="true" />
      <div className="menu-crosshair-v" aria-hidden="true" />

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
          </a>
        ))}
      </nav>
    </div>
  );
}
