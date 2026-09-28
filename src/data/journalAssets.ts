/**
 * 手账素材清单 —— **本文件由 scripts/prep-journal-assets.py 生成，不要手改**。
 *
 * 素材来自用户提供的手账贴纸图，抠底（透明 PNG-8）后落在 public/journal/ 下。
 * 换图 / 改尺寸：改脚本里的 MANIFEST 再跑一次，这个文件会跟着重写。
 *
 * ⚠️ 贴纸 / 花 / 螺旋纹 / 白纸件都是用户用真抠图工具做的**预抠版**（`action='precut'`）：
 *    脚本对它们**只收边 + 压尺寸，不重算 alpha** —— alpha 是抠图工具算的，比洪水填充准。
 *    本清单里已无标 'ai' 的条目；唯一还缺的素材是「蓝格便签 note-blue-archive」。
 */

export type JournalAsset = {
  id: string;
  /** public/ 下的绝对路径，直接用 <img src> / <image href> */
  src: string;
  w: number;
  h: number;
};

export const JOURNAL_TAPE: JournalAsset[] = [
  { id: 'tape-01', src: '/journal/tape/tape-01.png', w: 296, h: 74 },
  { id: 'tape-02', src: '/journal/tape/tape-02.png', w: 316, h: 92 },
  { id: 'tape-03', src: '/journal/tape/tape-03.png', w: 299, h: 179 },
  { id: 'tape-04', src: '/journal/tape/tape-04.png', w: 315, h: 73 },
  { id: 'tape-05', src: '/journal/tape/tape-05.png', w: 309, h: 108 },
  { id: 'tape-06', src: '/journal/tape/tape-06.png', w: 332, h: 98 },
  { id: 'tape-07', src: '/journal/tape/tape-07.png', w: 345, h: 103 },
  { id: 'tape-08', src: '/journal/tape/tape-08.png', w: 346, h: 100 },
  { id: 'tape-09', src: '/journal/tape/tape-09.png', w: 278, h: 92 },
  { id: 'tape-10', src: '/journal/tape/tape-10.png', w: 300, h: 80 },
  { id: 'tape-11', src: '/journal/tape/tape-11.png', w: 293, h: 99 },
  { id: 'tape-12', src: '/journal/tape/tape-12.png', w: 294, h: 90 },
  { id: 'tape-13', src: '/journal/tape/tape-13.png', w: 292, h: 107 },
  { id: 'tape-14', src: '/journal/tape/tape-14.png', w: 312, h: 78 },
  { id: 'tape-15', src: '/journal/tape/tape-15.png', w: 286, h: 57 },
  { id: 'tape-16', src: '/journal/tape/tape-16.png', w: 311, h: 96 },
];

export const JOURNAL_STARS: JournalAsset[] = [
  { id: 'star-teal', src: '/journal/stickers/star-teal.png', w: 480, h: 480 },
  { id: 'star-brown', src: '/journal/stickers/star-brown.png', w: 480, h: 456 },
  { id: 'star-spiral', src: '/journal/stickers/star-spiral.png', w: 473, h: 480 },
  { id: 'star-torn', src: '/journal/stickers/star-torn.png', w: 307, h: 251 },
];

export const JOURNAL_MOTIFS: JournalAsset[] = [
  { id: 'flower-dot-black', src: '/journal/motifs/flower-dot-black.png', w: 480, h: 445 },
  { id: 'flower-dot-pink', src: '/journal/motifs/flower-dot-pink.png', w: 276, h: 480 },
  { id: 'spiral-mint', src: '/journal/motifs/spiral-mint.png', w: 480, h: 460 },
];

export const JOURNAL_PAPERS: JournalAsset[] = [
  { id: 'clipboard-gold', src: '/journal/papers/clipboard-gold.png', w: 303, h: 480 },
  { id: 'note-pink', src: '/journal/papers/note-pink.png', w: 480, h: 365 },
  { id: 'paper-binder', src: '/journal/papers/paper-binder.png', w: 631, h: 1000 },
  { id: 'paper-dotnote', src: '/journal/papers/paper-dotnote.png', w: 1000, h: 761 },
];

const ALL = [...JOURNAL_TAPE, ...JOURNAL_STARS, ...JOURNAL_MOTIFS, ...JOURNAL_PAPERS];

/** 按 id 取 —— 页面上用 id 写（'star-teal' / 'tape-15'），别写路径 */
export const assetById = (id: string): JournalAsset | undefined => ALL.find((a) => a.id === id);
