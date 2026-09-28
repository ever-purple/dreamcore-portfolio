/**
 * 手账编辑器 —— 右键菜单
 * =============================================================================
 * 用户 2026-09-23 追加：「鼠标右键功能就是常用的复制粘贴剪切成组拆组等功能，
 * 类似于可画或者 PPT 的那样」。
 *
 * 所以菜单项**照 PowerPoint 的顺序**排：剪贴板三项 → 层级四项 → 组合两项 →
 * 位置两项 → 文字 / 复位 → 全选 / 删除。每项右侧给出对应的快捷键，
 * 这样"右键能做的事"和"快捷键能做的事"一眼能对上（同一套 API，不会两套行为）。
 *
 * ## 两个必须注意的点
 * 1. **必须 portal + position: fixed**。跟 Popover 同一个坑：菜单要跟随鼠标出现在
 *    任意位置，留在画布/工具栏子树里会被某个祖先的 `overflow` 裁掉，表现为
 *    "菜单看见了但点不中"（被裁掉的部分不参与命中测试）。
 * 2. **打开时先量再摆**。鼠标在屏幕右下角时菜单会出界，useLayoutEffect 里量出
 *    真实宽高后往回收一次（paint 前完成，用户看不到跳动）。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type CtxItem =
  | { kind: 'sep' }
  | {
      kind: 'item';
      label: string;
      /** 右侧的快捷键提示（与 context 里实际绑定的键一一对应） */
      hint?: string;
      /** 危险操作（删除）用红字 */
      danger?: boolean;
      disabled?: boolean;
      onPick: () => void;
    };

export function CtxMenu({
  x,
  y,
  head,
  items,
  onClose,
}: {
  /** 鼠标位置（clientX / clientY） */
  x: number;
  y: number;
  /** 菜单顶部那一行说明（"选中 3 个对象" / "页面元素「正文」" / "空白处"） */
  head: string;
  items: CtxItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  /* 先按鼠标位置摆上，再按真实宽高夹进视口 —— 都要在 paint 之前做完 */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, innerHeight - r.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (ev: PointerEvent) => {
      if (ref.current?.contains(ev.target as Node)) return;
      onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        /* 抢先关菜单，而不是让 Esc 冒泡去"退出编辑" */
        ev.stopPropagation();
        onClose();
      }
    };
    /* 滚动时菜单会脱离对象，直接关掉最省心（PPT 也是这个行为） */
    const onScroll = () => onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="dp-ctxmenu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
    >
      <p className="dp-ctx-head">{head}</p>
      {items.map((it, i) =>
        it.kind === 'sep' ? (
          <span key={`s${i}`} className="dp-ctx-sep" aria-hidden="true" />
        ) : (
          <button
            key={`i${i}`}
            type="button"
            role="menuitem"
            className={`dp-ctx-item${it.danger ? ' is-danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              it.onPick();
              onClose();
            }}
          >
            <span className="dp-ctx-label">{it.label}</span>
            {it.hint ? <span className="dp-ctx-hint">{it.hint}</span> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
