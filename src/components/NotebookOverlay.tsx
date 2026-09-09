import { useEffect, useState } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  onHoverChange?: (hovering: boolean) => void;
};

const RING_COUNT = 14;

/**
 * 线圈本弹层：点击笔记本后纸张从中央弹开（放大 + 回正到 -2° 倾斜），
 * 左侧金属双线圈装订，页面留白（内容后续填充）。
 * 关闭时反向收起。ESC / 点击遮罩均可关闭。
 */
export function NotebookOverlay({ open, onClose, onHoverChange }: Props) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, 380);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, onClose]);

  if (!mounted) return null;

  return (
    <div
      className={`notebook-overlay ${closing ? 'is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Notebook"
    >
      <div className="notebook-backdrop" onClick={onClose} />

      <div className="notebook-page">
        {/* 左侧金属线圈 */}
        <div className="notebook-spiral" aria-hidden="true">
          {Array.from({ length: RING_COUNT }).map((_, i) => (
            <span key={i} className="notebook-ring" />
          ))}
        </div>
        {/* 页面横线（内容后续填充） */}
        <div className="notebook-lines" aria-hidden="true" />
      </div>

      <button
        type="button"
        className="notebook-close"
        onClick={onClose}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
        aria-label="Close notebook"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
