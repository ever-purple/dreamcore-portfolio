/**
 * 手账编辑器 —— 素材面板
 * =============================================================================
 * 用户要求（2026-09-23）：
 *   「素材你可以在添加 <桌面文件夹> 里的，也要自己在小红书、pinterest 找一些加上」
 *   「现在有的素材也要有」（追加）
 *
 * 面板内容 = `src/data/diaryStickers.ts`（由 scripts/prep-diary-editor-assets.py 生成）：
 *   · 用户桌面那 20 张（抠底后落在 public/journal/editor）；
 *   · 项目原本就有的手账素材（tape / stickers / motifs / papers，直接引用原路径）；
 *   · 程序化补的 18 张（gen-*.png）。
 * 共 5 组 73 条，按组切换。
 *
 * 点一张 = 以贴纸形态落在当前页中央（可随即拖动 / 缩放 / 旋转 / 裁切）。
 * 连点同一张会自动错开落点（见 layout.staggerSpot）。
 */

import { useMemo, useState } from 'react';
import { DIARY_STICKER_GROUPS, type DiarySticker } from '@/data/diaryStickers';
import { useEscape } from '@/lib/escape-stack';

export function StickerPicker({
  onPick,
  onClose,
}: {
  onPick: (a: DiarySticker) => void;
  onClose: () => void;
}) {
  const groups = DIARY_STICKER_GROUPS;
  const [tab, setTab] = useState(groups[0]?.key ?? 'sticker');
  const current = useMemo(() => groups.find((g) => g.key === tab) ?? groups[0], [groups, tab]);
  useEscape(onClose, true);

  return (
    <div className="dp-picker" role="dialog" aria-label="选择素材">
      <div className="dp-picker-head">
        <strong>素材库</strong>
        <span className="dp-picker-count">
          共 {groups.reduce((n, g) => n + g.items.length, 0)} 张
        </span>
        <button type="button" className="dp-picker-close" onClick={onClose} aria-label="关闭素材库">
          ✕
        </button>
      </div>
      <div className="dp-picker-tabs" role="tablist">
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            role="tab"
            aria-selected={g.key === tab}
            className={`dp-tab${g.key === tab ? ' is-on' : ''}`}
            onClick={() => setTab(g.key)}
          >
            {g.label}
            <em>{g.items.length}</em>
          </button>
        ))}
      </div>
      <div className="dp-picker-body">
        <div className="dp-picker-grid">
          {current?.items.map((a) => (
            <button
              key={a.id}
              type="button"
              className="dp-thumb"
              onClick={() => onPick(a)}
              title={a.label}
            >
              <img src={a.src} alt={a.label} loading="lazy" draggable={false} />
              <span className="dp-thumb-label">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="dp-picker-foot">
        点一张即可贴到当前页 · 落下来后可以拖动、缩放、旋转、裁切
      </p>
    </div>
  );
}
