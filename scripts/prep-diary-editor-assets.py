# -*- coding: utf-8 -*-
"""手账编辑器素材准备脚本（可重跑）。

职责：
1. 把桌面「新建文件夹 (4)」里的用户素材按语义名复制到 public/journal/editor/；
2. 对 4 张白底（烤入棋盘格）RGB 图 + 1 张灰底书签图做「外圈连通背景抠除」；
3. 用 Pillow 读真实像素尺寸，产出 src/data/diaryStickers.ts 清单。

抠底思路来自 white-bg-png-cutout 技能：背景 = 近中性亮色 + 与画布边缘连通；
对烤入棋盘格的图，额外要求背景像素的局部窗口内「明暗混杂」（棋盘特征），
避免洪水填充吃掉贴纸的白色啤边。图案内部的白（高光/白肚）由 fill_holes 保住。

用法：
    python scripts/prep-diary-editor-assets.py [--contact _cut-check.png]

若桌面源目录不存在，且 public/journal/editor/ 已有产物，则直接复用产物重出清单。
"""
import argparse
import os
import shutil

import numpy as np
from PIL import Image
from scipy import ndimage

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDITOR_DIR = os.path.join(PROJ, "public", "journal", "editor")
USER_DIR = "C:/Users/sunchenxi/Desktop/新建文件夹 (4)"
TS_OUT = os.path.join(PROJ, "src", "data", "diaryStickers.ts")

NEIGH4 = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)

# (桌面源文件名, 目标文件名, 中文 label, 组)
# 组：sticker / tape / note / frame / decor / illus
USER_ASSETS = [
    ("390f5909-dbb6-4479-bad9-d215a8bf2ed6.png", "star-outline-black.png", "黑线手绘星星组", "sticker"),
    ("5b998a28-8af3-48eb-9fb5-5ef377a84d3b.png", "flower-pink-line.png", "粉色花卉线稿", "sticker"),
    ("8808d91a-ecb1-44c7-81f1-e7f2e2f4d3eb.png", "star-dot-brown.png", "深棕波点星", "sticker"),
    ("8b4ef324-c542-43b0-8f05-1224da4dc1e4.png", "spiral-mint-dots.png", "薄荷波点螺旋", "sticker"),
    ("9172df03-52ec-4f11-84ce-124ab558ce62.png", "star-swirl-pink.png", "粉棕螺旋纹星", "sticker"),
    ("cb2beab9-14a9-486f-98ae-aa168a91b18c.png", "star-dot-teal.png", "青绿波点描边星", "sticker"),
    ("f9597dc1-7131-4273-bec7-30dec1b73c27.png", "flower-halftone-black.png", "黑白网点花", "sticker"),
    ("fe9cb860-6ef3-445b-82bf-81370805e39c.png", "note-pink-clip.png", "粉点便签（回形针）", "note"),
    ("下载.png", "bookmark-blue.png", "深蓝四格照片条", "frame"),
    ("发带-透明底.png", "tape-stripe-blue.png", "蓝白条纹胶带", "tape"),
    ("和.png", "illus-apple-red.png", "红绿苹果插画", "illus"),
    ("圆点胶带-透明底.png", "tape-dot-black.png", "黑白圆点胶带", "tape"),
    ("布料-透明底.png", "tape-linen-gray.png", "灰白麻布带", "tape"),
    ("格纹拼贴-透明底.png", "tape-plaid-sun.png", "粉格太阳胶带", "tape"),
    ("素材1-透明底.png", "note-blue-crumpled.png", "蓝揉纸便签（星星回形针）", "note"),
    ("素材2-透明底.png", "note-collage-tall.png", "蓝格星条拼贴便签", "note"),
    ("给.png", "sticker-swirl-blue.png", "蓝色螺旋花贴纸", "sticker"),
    ("素材3-透明底.png", "note-white-crumpled.png", "白揉纸横线便签", "note"),
    ("花生牛奶饮品插画生成.png", "illus-fish-pair.png", "两条蓝鱼插画", "illus"),
    ("苹果.png", "illus-apple-green.png", "青苹果带粉星插画", "illus"),
]

# 需要抠底的图：目标文件名 -> (thr, sat, hetero, win)
#   thr/sat：近中性亮色判定（min_channel>=thr 且 max-min<=sat）
#   hetero： True=要求局部窗口明暗混杂（对付烤入的棋盘格背景）
#   win    ：混杂判定窗口半径
CUTOUT = {
    "illus-apple-red.png": (228, 18, False, 0),
    "sticker-swirl-blue.png": (228, 18, False, 0),
    "illus-fish-pair.png": (228, 18, True, 8),
    "illus-apple-green.png": (228, 18, True, 8),
    "bookmark-blue.png": (100, 26, False, 0),
}

CUTOUT_MAX_SIDE = 1400  # 抠底输出长边上限（编辑器贴纸用不着 2048）

# 已有 journal 素材：子目录 -> [(文件名, 中文 label, 组)]
EXISTING = {
    "tape": [(f"tape-{i:02d}.png", f"和纸胶带 {i:02d}", "tape") for i in range(1, 17)],
    "stickers": [
        ("star-teal.png", "青绿星星", "sticker"),
        ("star-brown.png", "棕色波点星", "sticker"),
        ("star-spiral.png", "螺旋星星", "sticker"),
        ("star-torn.png", "撕边纸星", "sticker"),
        ("apple.webp", "苹果贴纸", "illus"),
        ("fish.webp", "小鱼贴纸", "illus"),
        ("blob-blue.webp", "蓝色泡泡块", "sticker"),
        ("spiral-mint.webp", "薄荷螺旋（小）", "sticker"),
        ("star-cyan.webp", "青色星星", "sticker"),
        ("star-polka.webp", "波点星星", "sticker"),
        ("star-spiral-pink.webp", "粉色螺旋星", "sticker"),
        ("stars-white.webp", "白色星星组", "sticker"),
    ],
    "motifs": [
        ("flower-dot-black.png", "黑色波点花", "sticker"),
        ("flower-dot-pink.png", "粉色波点花", "sticker"),
        ("spiral-mint.png", "薄荷螺旋纹", "sticker"),
    ],
    "papers": [
        ("clipboard-gold.png", "金色板夹", "note"),
        ("note-pink.png", "粉色便签纸", "note"),
        ("paper-binder.png", "活页夹纸张", "note"),
        ("paper-dotnote.png", "波点信纸", "note"),
    ],
}

# 生成贴纸（_gen-editor-stickers.py 产物）：文件名 -> (中文 label, 组)
GEN_LABELS = {
    "gen-tape-stripe-cream.png": ("牛皮条纹胶带", "tape"),
    "gen-tape-dot-mint.png": ("薄荷波点胶带", "tape"),
    "gen-tape-plaid-mist.png": ("雾蓝格纹胶带", "tape"),
    "gen-tape-solid-lotus.png": ("藕粉做旧胶带", "tape"),
    "gen-star-solid-kraft.png": ("巧克力实心星", "sticker"),
    "gen-star-outline-lotus.png": ("藕粉描边星", "sticker"),
    "gen-star-four-mist.png": ("雾蓝四角星", "sticker"),
    "gen-heart-solid-lotus.png": ("藕粉实心爱心", "sticker"),
    "gen-heart-outline-choco.png": ("巧克力描边爱心", "sticker"),
    "gen-daisy-white.png": ("白色小雏菊", "sticker"),
    "gen-flower-lotus.png": ("藕粉五瓣花", "sticker"),
    "gen-arrow-straight-choco.png": ("手绘直线箭头", "decor"),
    "gen-arrow-curve-mist.png": ("手绘弯箭头", "decor"),
    "gen-bubble-cream.png": ("对话气泡", "decor"),
    "gen-label-kraft.png": ("牛皮标签条", "decor"),
    "gen-note-lined-butter.png": ("淡黄横线便签", "note"),
    "gen-pin-tape-decor.png": ("图钉胶带装饰", "decor"),
    # 相框类：带格子/留白区，用来放照片，不是便签
    "gen-polaroid-frame.png": ("拍立得相框", "frame"),
    "gen-frame-duo.png": ("双联相框", "frame"),
    "gen-frame-quad.png": ("四格相框", "frame"),
    "gen-film-strip.png": ("胶片条相框", "frame"),
}

GROUP_LABELS = {"sticker": "贴纸", "tape": "胶带", "note": "便签纸", "frame": "相框", "decor": "装饰", "illus": "插画"}
GROUP_ORDER = ["sticker", "tape", "note", "frame", "decor", "illus"]

# id 冲突覆盖：文件名同名但内容不同时，手动指定全局唯一 id
ID_OVERRIDES = {
    "/journal/stickers/spiral-mint.webp": "spiral-mint-mini",
}


def cutout(src, dst, thr, sat, hetero, win):
    """外圈连通背景抠除。返回 True=成功。"""
    im = Image.open(src).convert("RGB")
    arr = np.asarray(im).astype(np.int16)
    mn, mx = arr.min(axis=2), arr.max(axis=2)
    bright = (mn >= thr) & ((mx - mn) <= sat)
    if hetero:
        # 局部窗口内同时存在「白」与「棋盘灰」→ 属于棋盘背景特征
        grayish = bright & (mn <= 250)
        whiteish = mn > 250
        k = 2 * win + 1
        gray_cnt = ndimage.uniform_filter(grayish.astype(np.float32), k)
        white_cnt = ndimage.uniform_filter(whiteish.astype(np.float32), k)
        cand = bright & (gray_cnt > 0.02) & (white_cnt > 0.02)
    else:
        cand = bright
    lab, _ = ndimage.label(cand, structure=NEIGH4)
    edge = np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))
    edge = edge[edge > 0]
    bg = np.isin(lab, edge)
    fg = ndimage.binary_fill_holes(ndimage.binary_closing(~bg, np.ones((5, 5), bool)))
    # 丢弃碎渣：保留面积 >= 0.2% 画布的连通域
    lab2, n2 = ndimage.label(fg)
    if n2 == 0:
        return False
    sizes = ndimage.sum(fg, lab2, range(1, n2 + 1))
    keep_ids = [i + 1 for i, s in enumerate(sizes) if s >= 0.002 * fg.size]
    fg = np.isin(lab2, keep_ids)
    alpha = ndimage.gaussian_filter(fg.astype(np.float32), 0.7)
    alpha = np.clip(alpha, 0, 1)
    ys, xs = np.where(alpha > 0.03)
    if len(ys) < 100:
        return False
    out = np.dstack([np.asarray(im), (alpha * 255).astype(np.uint8)])
    out = out[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    pim = Image.fromarray(out, "RGBA")
    if max(pim.size) > CUTOUT_MAX_SIDE:
        s = CUTOUT_MAX_SIDE / max(pim.size)
        pim = pim.resize((round(pim.width * s), round(pim.height * s)), Image.LANCZOS)
    pim.save(dst)
    return True


def make_contact_sheet(paths, out_path, tile=260):
    """把抠底结果合成到米色底上做目检。"""
    cols = 3
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tile, rows * tile), (242, 232, 213))
    for i, p in enumerate(paths):
        im = Image.open(p).convert("RGBA")
        im.thumbnail((tile - 16, tile - 16))
        x = (i % cols) * tile + (tile - im.width) // 2
        y = (i // cols) * tile + (tile - im.height) // 2
        sheet.paste(im, (x, y), im)
    sheet.save(out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contact", default=None, help="输出抠底目检拼图路径")
    args = ap.parse_args()
    os.makedirs(EDITOR_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(TS_OUT), exist_ok=True)

    # 1) 复制 + 抠底
    cut_done = {}
    for src_name, dst_name, _label, _grp in USER_ASSETS:
        dst = os.path.join(EDITOR_DIR, dst_name)
        src = os.path.join(USER_DIR, src_name)
        if dst_name in CUTOUT:
            if os.path.exists(src):
                ok = cutout(src, dst, *CUTOUT[dst_name])
                cut_done[dst_name] = ok
                print(f"cutout {dst_name}: {'OK' if ok else 'FAILED -> opaque'}")
            elif os.path.exists(dst):
                cut_done[dst_name] = True  # 复用上次产物
                print(f"cutout {dst_name}: reuse existing")
            else:
                cut_done[dst_name] = False
        else:
            if os.path.exists(src):
                shutil.copyfile(src, dst)
            elif not os.path.exists(dst):
                raise SystemExit(f"missing source and dest: {dst_name}")
            print(f"copy {dst_name}")

    # 2) 汇总清单条目（Pillow 读真实尺寸）
    entries = []  # (id, src, label, group, opaque)

    def add(path_rel, label, grp, opaque=False):
        p = os.path.join(PROJ, "public", path_rel.lstrip("/").replace("/", os.sep))
        with Image.open(p) as im:
            w, h = im.size
        sid = ID_OVERRIDES.get(path_rel) or os.path.splitext(os.path.basename(path_rel))[0].lower()
        entries.append({"id": sid, "src": path_rel, "w": w, "h": h,
                        "label": label, "group": grp, "opaque": opaque})

    for src_name, dst_name, label, grp in USER_ASSETS:
        op = (dst_name in CUTOUT) and not cut_done.get(dst_name, False)
        add(f"/journal/editor/{dst_name}", label, grp, opaque=op)

    for sub, items in EXISTING.items():
        for fname, label, grp in items:
            add(f"/journal/{sub}/{fname}", label, grp)

    for fname, (label, grp) in GEN_LABELS.items():
        p = os.path.join(EDITOR_DIR, fname)
        if os.path.exists(p):
            add(f"/journal/editor/{fname}", label, grp)
        else:
            print(f"!! gen sticker missing, skipped: {fname}")

    # 3) 写 diaryStickers.ts
    by_group = {g: [] for g in GROUP_ORDER}
    for e in entries:
        by_group[e["group"]].append(e)

    lines = []
    lines.append("/**")
    lines.append(" * 手账编辑器素材清单 —— 由 scripts/prep-diary-editor-assets.py 生成，不要手改。")
    lines.append(" * 素材来源：用户素材（public/journal/editor）、已有手账素材（public/journal/*）、")
    lines.append(" * 程序化生成贴纸（gen-*.png）。重新生成：python scripts/prep-diary-editor-assets.py")
    lines.append(" */")
    lines.append("export type DiarySticker = {")
    lines.append("  id: string;")
    lines.append("  /** public/ 下的绝对路径，如 '/journal/editor/star-dot-brown.png' */")
    lines.append("  src: string;")
    lines.append("  w: number;")
    lines.append("  h: number;")
    lines.append("  /** 中文短名，用作 hover 提示与无障碍标签 */")
    lines.append("  label: string;")
    lines.append("  /** 白底未抠干净的图，编辑器里会提示可能需要处理 */")
    lines.append("  opaque?: boolean;")
    lines.append("};")
    lines.append("")
    lines.append("export type DiaryStickerGroup = {")
    lines.append("  /** 稳定 key：'sticker' | 'tape' | 'note' | 'frame' | 'decor' | 'illus' */")
    lines.append("  key: string;")
    lines.append("  /** 中文组名，如 '贴纸' / '胶带' / '便签纸' / '相框' / '装饰' / '插画' */")
    lines.append("  label: string;")
    lines.append("  items: DiarySticker[];")
    lines.append("};")
    lines.append("")
    lines.append("/** 分组清单（素材面板按这个展示） */")
    lines.append("export const DIARY_STICKER_GROUPS: DiaryStickerGroup[] = [")
    for g in GROUP_ORDER:
        items = by_group[g]
        if not items:
            continue
        lines.append(f"  {{ key: '{g}', label: '{GROUP_LABELS[g]}', items: [")
        for e in items:
            op = ", opaque: true" if e["opaque"] else ""
            lines.append(
                f"    {{ id: '{e['id']}', src: '{e['src']}', w: {e['w']}, h: {e['h']}, "
                f"label: '{e['label']}'{op} }},")
        lines.append("  ]},")
    lines.append("];")
    lines.append("")
    lines.append("/** 摊平后的全部素材（按 id 查用） */")
    lines.append(
        "export const DIARY_STICKERS: DiarySticker[] = "
        "DIARY_STICKER_GROUPS.flatMap((g) => g.items);")
    lines.append("")
    with open(TS_OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"manifest -> {TS_OUT} ({len(entries)} items)")

    # 4) 目检拼图
    if args.contact:
        cut_paths = [os.path.join(EDITOR_DIR, d) for d in CUTOUT]
        make_contact_sheet(cut_paths, args.contact)
        print(f"contact sheet -> {args.contact}")


if __name__ == "__main__":
    main()
