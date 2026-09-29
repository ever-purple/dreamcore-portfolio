/**
 * 手账编辑器素材清单 —— 由 scripts/prep-diary-editor-assets.py 生成，不要手改。
 * 素材来源：用户素材（public/journal/editor）、已有手账素材（public/journal/*）、
 * 程序化生成贴纸（gen-*.png）。重新生成：python scripts/prep-diary-editor-assets.py
 */
export type DiarySticker = {
  id: string;
  /** public/ 下的绝对路径，如 '/journal/editor/star-dot-brown.webp' */
  src: string;
  w: number;
  h: number;
  /** 中文短名，用作 hover 提示与无障碍标签 */
  label: string;
  /** 白底未抠干净的图，编辑器里会提示可能需要处理 */
  opaque?: boolean;
};

export type DiaryStickerGroup = {
  /** 稳定 key：'sticker' | 'tape' | 'note' | 'frame' | 'decor' | 'illus' */
  key: string;
  /** 中文组名，如 '贴纸' / '胶带' / '便签纸' / '相框' / '装饰' / '插画' */
  label: string;
  items: DiarySticker[];
};

/** 分组清单（素材面板按这个展示） */
export const DIARY_STICKER_GROUPS: DiaryStickerGroup[] = [
  { key: 'sticker', label: '贴纸', items: [
    { id: 'star-outline-black', src: '/journal/editor/star-outline-black.webp', w: 464, h: 434, label: '黑线手绘星星组' },
    { id: 'flower-pink-line', src: '/journal/editor/flower-pink-line.webp', w: 736, h: 736, label: '粉色花卉线稿' },
    { id: 'star-dot-brown', src: '/journal/editor/star-dot-brown.webp', w: 488, h: 464, label: '深棕波点星' },
    { id: 'spiral-mint-dots', src: '/journal/editor/spiral-mint-dots.webp', w: 736, h: 705, label: '薄荷波点螺旋' },
    { id: 'star-swirl-pink', src: '/journal/editor/star-swirl-pink.webp', w: 1199, h: 1245, label: '粉棕螺旋纹星' },
    { id: 'star-dot-teal', src: '/journal/editor/star-dot-teal.webp', w: 1036, h: 1036, label: '青绿波点描边星' },
    { id: 'flower-halftone-black', src: '/journal/editor/flower-halftone-black.webp', w: 736, h: 736, label: '黑白网点花' },
    { id: 'sticker-swirl-blue', src: '/journal/editor/sticker-swirl-blue.webp', w: 1375, h: 1400, label: '蓝色螺旋花贴纸' },
    { id: 'star-teal', src: '/journal/stickers/star-teal.png', w: 480, h: 480, label: '青绿星星' },
    { id: 'star-brown', src: '/journal/stickers/star-brown.png', w: 480, h: 456, label: '棕色波点星' },
    { id: 'star-spiral', src: '/journal/stickers/star-spiral.png', w: 473, h: 480, label: '螺旋星星' },
    { id: 'star-torn', src: '/journal/stickers/star-torn.webp', w: 307, h: 251, label: '撕边纸星' },
    { id: 'blob-blue', src: '/journal/stickers/blob-blue.webp', w: 320, h: 320, label: '蓝色泡泡块' },
    { id: 'spiral-mint-mini', src: '/journal/stickers/spiral-mint.webp', w: 320, h: 307, label: '薄荷螺旋（小）' },
    { id: 'star-cyan', src: '/journal/stickers/star-cyan.webp', w: 320, h: 320, label: '青色星星' },
    { id: 'star-polka', src: '/journal/stickers/star-polka.webp', w: 320, h: 304, label: '波点星星' },
    { id: 'star-spiral-pink', src: '/journal/stickers/star-spiral-pink.webp', w: 316, h: 320, label: '粉色螺旋星' },
    { id: 'stars-white', src: '/journal/stickers/stars-white.webp', w: 305, h: 249, label: '白色星星组' },
    { id: 'flower-dot-black', src: '/journal/motifs/flower-dot-black.png', w: 480, h: 445, label: '黑色波点花' },
    { id: 'flower-dot-pink', src: '/journal/motifs/flower-dot-pink.png', w: 276, h: 480, label: '粉色波点花' },
    { id: 'spiral-mint', src: '/journal/motifs/spiral-mint.webp', w: 480, h: 460, label: '薄荷螺旋纹' },
    { id: 'gen-star-solid-kraft', src: '/journal/editor/gen-star-solid-kraft.webp', w: 205, h: 198, label: '巧克力实心星' },
    { id: 'gen-star-outline-lotus', src: '/journal/editor/gen-star-outline-lotus.webp', w: 205, h: 198, label: '藕粉描边星' },
    { id: 'gen-star-four-mist', src: '/journal/editor/gen-star-four-mist.webp', w: 214, h: 216, label: '雾蓝四角星' },
    { id: 'gen-heart-solid-lotus', src: '/journal/editor/gen-heart-solid-lotus.webp', w: 260, h: 232, label: '藕粉实心爱心' },
    { id: 'gen-heart-outline-choco', src: '/journal/editor/gen-heart-outline-choco.webp', w: 260, h: 232, label: '巧克力描边爱心' },
    { id: 'gen-daisy-white', src: '/journal/editor/gen-daisy-white.webp', w: 198, h: 198, label: '白色小雏菊' },
    { id: 'gen-flower-lotus', src: '/journal/editor/gen-flower-lotus.webp', w: 200, h: 195, label: '藕粉五瓣花' },
  ]},
  { key: 'tape', label: '胶带', items: [
    { id: 'tape-stripe-blue', src: '/journal/editor/tape-stripe-blue.webp', w: 1200, h: 1200, label: '蓝白条纹胶带' },
    { id: 'tape-dot-black', src: '/journal/editor/tape-dot-black.webp', w: 600, h: 600, label: '黑白圆点胶带' },
    { id: 'tape-linen-gray', src: '/journal/editor/tape-linen-gray.webp', w: 750, h: 750, label: '灰白麻布带' },
    { id: 'tape-plaid-sun', src: '/journal/editor/tape-plaid-sun.webp', w: 1102, h: 502, label: '粉格太阳胶带' },
    { id: 'tape-01', src: '/journal/tape/tape-01.webp', w: 296, h: 74, label: '和纸胶带 01' },
    { id: 'tape-02', src: '/journal/tape/tape-02.png', w: 316, h: 92, label: '和纸胶带 02' },
    { id: 'tape-03', src: '/journal/tape/tape-03.webp', w: 299, h: 179, label: '和纸胶带 03' },
    { id: 'tape-04', src: '/journal/tape/tape-04.webp', w: 315, h: 73, label: '和纸胶带 04' },
    { id: 'tape-05', src: '/journal/tape/tape-05.webp', w: 309, h: 108, label: '和纸胶带 05' },
    { id: 'tape-06', src: '/journal/tape/tape-06.png', w: 332, h: 98, label: '和纸胶带 06' },
    { id: 'tape-07', src: '/journal/tape/tape-07.png', w: 345, h: 103, label: '和纸胶带 07' },
    { id: 'tape-08', src: '/journal/tape/tape-08.webp', w: 346, h: 100, label: '和纸胶带 08' },
    { id: 'tape-09', src: '/journal/tape/tape-09.webp', w: 278, h: 92, label: '和纸胶带 09' },
    { id: 'tape-10', src: '/journal/tape/tape-10.webp', w: 300, h: 80, label: '和纸胶带 10' },
    { id: 'tape-11', src: '/journal/tape/tape-11.webp', w: 293, h: 99, label: '和纸胶带 11' },
    { id: 'tape-12', src: '/journal/tape/tape-12.webp', w: 294, h: 90, label: '和纸胶带 12' },
    { id: 'tape-13', src: '/journal/tape/tape-13.png', w: 292, h: 107, label: '和纸胶带 13' },
    { id: 'tape-14', src: '/journal/tape/tape-14.webp', w: 312, h: 78, label: '和纸胶带 14' },
    { id: 'tape-15', src: '/journal/tape/tape-15.webp', w: 286, h: 57, label: '和纸胶带 15' },
    { id: 'tape-16', src: '/journal/tape/tape-16.png', w: 311, h: 96, label: '和纸胶带 16' },
    { id: 'gen-tape-stripe-cream', src: '/journal/editor/gen-tape-stripe-cream.webp', w: 420, h: 120, label: '牛皮条纹胶带' },
    { id: 'gen-tape-dot-mint', src: '/journal/editor/gen-tape-dot-mint.webp', w: 420, h: 119, label: '薄荷波点胶带' },
    { id: 'gen-tape-plaid-mist', src: '/journal/editor/gen-tape-plaid-mist.webp', w: 420, h: 120, label: '雾蓝格纹胶带' },
    { id: 'gen-tape-solid-lotus', src: '/journal/editor/gen-tape-solid-lotus.webp', w: 420, h: 120, label: '藕粉做旧胶带' },
  ]},
  { key: 'note', label: '便签纸', items: [
    { id: 'note-pink-clip', src: '/journal/editor/note-pink-clip.webp', w: 1152, h: 2048, label: '粉点便签（回形针）' },
    { id: 'note-blue-crumpled', src: '/journal/editor/note-blue-crumpled.webp', w: 736, h: 981, label: '蓝揉纸便签（星星回形针）' },
    { id: 'note-collage-tall', src: '/journal/editor/note-collage-tall.webp', w: 1152, h: 2048, label: '蓝格星条拼贴便签' },
    { id: 'note-white-crumpled', src: '/journal/editor/note-white-crumpled.webp', w: 1152, h: 2048, label: '白揉纸横线便签' },
    { id: 'clipboard-gold', src: '/journal/papers/clipboard-gold.png', w: 303, h: 480, label: '金色板夹' },
    { id: 'note-pink', src: '/journal/papers/note-pink.png', w: 480, h: 365, label: '粉色便签纸' },
    { id: 'paper-binder', src: '/journal/papers/paper-binder.png', w: 631, h: 1000, label: '活页夹纸张' },
    { id: 'paper-dotnote', src: '/journal/papers/paper-dotnote.webp', w: 1000, h: 761, label: '波点信纸' },
    { id: 'gen-note-lined-butter', src: '/journal/editor/gen-note-lined-butter.webp', w: 360, h: 360, label: '淡黄横线便签' },
  ]},
  { key: 'frame', label: '相框', items: [
    { id: 'bookmark-blue', src: '/journal/editor/bookmark-blue.webp', w: 383, h: 1400, label: '深蓝四格照片条' },
    { id: 'gen-polaroid-frame', src: '/journal/editor/gen-polaroid-frame.webp', w: 356, h: 413, label: '拍立得相框' },
    { id: 'gen-frame-duo', src: '/journal/editor/gen-frame-duo.webp', w: 572, h: 404, label: '双联相框' },
    { id: 'gen-frame-quad', src: '/journal/editor/gen-frame-quad.webp', w: 532, h: 532, label: '四格相框' },
    { id: 'gen-film-strip', src: '/journal/editor/gen-film-strip.webp', w: 640, h: 258, label: '胶片条相框' },
  ]},
  { key: 'decor', label: '装饰', items: [
    { id: 'gen-arrow-straight-choco', src: '/journal/editor/gen-arrow-straight-choco.webp', w: 230, h: 63, label: '手绘直线箭头' },
    { id: 'gen-arrow-curve-mist', src: '/journal/editor/gen-arrow-curve-mist.webp', w: 218, h: 145, label: '手绘弯箭头' },
    { id: 'gen-bubble-cream', src: '/journal/editor/gen-bubble-cream.webp', w: 253, h: 161, label: '对话气泡' },
    { id: 'gen-label-kraft', src: '/journal/editor/gen-label-kraft.webp', w: 366, h: 106, label: '牛皮标签条' },
    { id: 'gen-pin-tape-decor', src: '/journal/editor/gen-pin-tape-decor.webp', w: 309, h: 107, label: '图钉胶带装饰' },
  ]},
  { key: 'illus', label: '插画', items: [
    { id: 'illus-apple-red', src: '/journal/editor/illus-apple-red.webp', w: 1195, h: 1274, label: '红绿苹果插画' },
    { id: 'illus-fish-pair', src: '/journal/editor/illus-fish-pair.webp', w: 1400, h: 892, label: '两条蓝鱼插画' },
    { id: 'illus-apple-green', src: '/journal/editor/illus-apple-green.webp', w: 1351, h: 1400, label: '青苹果带粉星插画' },
    { id: 'apple', src: '/journal/stickers/apple.webp', w: 320, h: 320, label: '苹果贴纸' },
    { id: 'fish', src: '/journal/stickers/fish.webp', w: 320, h: 320, label: '小鱼贴纸' },
  ]},
];

/** 摊平后的全部素材（按 id 查用） */
export const DIARY_STICKERS: DiarySticker[] = DIARY_STICKER_GROUPS.flatMap((g) => g.items);
