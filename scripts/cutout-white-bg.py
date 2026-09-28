"""把「白底插画」抠成透明 PNG 并裁边 —— 文案页产品图 / 贴纸的素材流水线。

为什么需要：用户给的插画常常是「透明底被压平成白底」的 PNG（alpha 全 255，
只剩一层几乎看不见的棋盘残影，实测底色 246~255）。直接放进小票会在奶油色纸
（#f9f9ef）上压出一个白方块。

做法（scipy.ndimage，全图秒级）：
  1. 候选背景 = 近中性且亮（各通道 >= --thr 且 max-min <= --sat）
  2. 只把**与四边连通**的候选块算作背景（连通域标记后取贴边的 label）
  3. 前景 = 取反 → 二值闭运算（补描边断口）→ 补洞 → 只留最大连通域（去零散噪点）
     ⚠️「补洞」这一步是关键：奶盒正面、玻璃杯内部这些**图案内部的白色**
        必然被前景包住，补洞后自动保住；反过来说，如果只按亮度全局抠图（不做连通性），
        图案里的白会被一起掏空 —— 这是最容易踩的坑。
  4. alpha 边缘做一次极轻的高斯羽化消锯齿
  5. 按 alpha 裁到内容包围盒，等比缩到 --max 以内

用法：
  python scripts/cutout-white-bg.py <src.png> <dst.png> [--max 700] [--thr 232] [--sat 12]
  python scripts/cutout-white-bg.py --batch   # 跑本文件底部 BATCH 里登记的那批
"""

from __future__ import annotations

import argparse
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

NEIGH4 = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=bool)


def cutout(src: str, dst: str, max_side: int, thr: int, sat: int, feather: float = 0.7):
    im = Image.open(src)
    a = np.asarray(im.convert("RGB")).astype(np.int16)
    mx, mn = a.max(2), a.min(2)

    # 1) 候选背景
    cand = (mn >= thr) & ((mx - mn) <= sat)

    # 2) 只保留与四边连通的候选块
    lab, n = ndimage.label(cand, structure=NEIGH4)
    touch = np.unique(
        np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]])
    )
    touch = touch[touch > 0]
    bg = np.isin(lab, touch) if touch.size else np.zeros_like(cand)

    # 3) 前景 = 取反 + 闭运算 + 补洞 + 最大连通域
    fg = ~bg
    fg = ndimage.binary_closing(fg, structure=np.ones((5, 5), bool))
    fg = ndimage.binary_fill_holes(fg)
    lab2, n2 = ndimage.label(fg, structure=NEIGH4)
    if n2 > 1:
        sizes = ndimage.sum(fg, lab2, index=np.arange(1, n2 + 1))
        fg = lab2 == (int(np.argmax(sizes)) + 1)
    elif n2 == 0:
        sys.exit(f"[x] {os.path.basename(src)}：整张图都被判成背景了，把 --thr 调低试试")

    # 4) 羽化
    alpha = fg.astype(np.float32)
    if feather:
        alpha = ndimage.gaussian_filter(alpha, feather)

    ys, xs = np.where(alpha > 0.5)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1

    # 5) 裁边 + 缩放
    rgb = a[y0:y1, x0:x1].astype(np.uint8)
    al = alpha[y0:y1, x0:x1]
    out = Image.fromarray(np.dstack([rgb, np.round(al * 255).astype(np.uint8)]), "RGBA")
    if max(out.size) > max_side:
        k = max_side / max(out.size)
        out = out.resize(
            (max(1, round(out.width * k)), max(1, round(out.height * k))), Image.LANCZOS
        )
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    out.save(dst, optimize=True)

    cov = float((np.asarray(out)[..., 3] > 20).mean())
    print(
        f"[✓] {os.path.basename(src):<28} {str(im.size):<12} -> {str(out.size):<11} "
        f"不透明 {cov * 100:5.1f}%  {os.path.getsize(dst) // 1024:>4}KB   {os.path.basename(dst)}"
    )


BATCH = [
    # 产品图（文案页小票上的产品图）
    ("吧的.png", "yinlu-peanut-milk.png", 700, 232, 12),
    ("花生牛奶饮品插画生成 (1).png", "yumeijing-cream.png", 700, 232, 12),
    ("v.png", "tea-rhyme-glass.png", 700, 232, 12),
    # 贴纸（骑在小票上沿，显示宽度只有 ~68px，400 足够）
    ("4.png", "sticker-yinlu.png", 400, 232, 12),
    ("2.png", "sticker-yumeijing.png", 400, 232, 12),
    ("12.png", "sticker-tea.png", 400, 232, 12),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?")
    ap.add_argument("dst", nargs="?")
    ap.add_argument("--max", type=int, default=700)
    ap.add_argument("--thr", type=int, default=232)
    ap.add_argument("--sat", type=int, default=12)
    ap.add_argument("--batch", action="store_true", help="跑 BATCH 里登记的整批")
    args = ap.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if args.batch:
        src_dir = r"C:/Users/sunchenxi/Desktop"
        out_dir = os.path.join(root, "public", "media")
        for name, dst_name, mx, thr, sat in BATCH:
            src = os.path.join(src_dir, name)
            if not os.path.isfile(src):
                print(f"[skip] 找不到 {src}")
                continue
            cutout(src, os.path.join(out_dir, dst_name), mx, thr, sat)
        return

    if not args.src or not args.dst:
        ap.error("需要 <src> <dst>，或加 --batch")
    cutout(args.src, args.dst, args.max, args.thr, args.sat)


if __name__ == "__main__":
    main()
