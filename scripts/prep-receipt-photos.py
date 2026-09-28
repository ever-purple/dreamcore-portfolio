"""把用户给的 4 张「氛围照片」处理成小票右侧文案面板的**满幅底图**。

⚠️ 2026-09-22 第五轮重写 —— 上一版是错的，本版改掉两件事：
   1. **不再裁成 2.42 的横幅带**。那是给"顶部通栏照片带"用的长宽比；照片现在铺满整个
      面板（面板实测 1042×560，比例 ≈1.86），源图本身 ≈1.79 已经很接近，硬裁成 2.42
      反而丢掉了大半构图。
   2. **不再压到 560px 宽**，并且**绝不放大**。面板 1042 CSS px 宽，560 的源图被
      `object-fit: cover` 拉到 1357×560 渲染（DPR2 下 2714×1120）—— 放大 2.4~4.8 倍，
      这就是用户说的「不要放大、不要压缩画质」的根因。
      本版按 `--cap`（默认 2084 = 面板宽 1042 × 2，够 2x 屏）**只缩不放**：
      源图比 cap 大就 LANCZOS 缩到 cap，比 cap 小就原样保留原生分辨率。

用法：
  python scripts/prep-receipt-photos.py --batch
  python scripts/prep-receipt-photos.py <src> <dst> [--cap 2084] [--q 92]
"""

from __future__ import annotations

import argparse
import os

from PIL import Image

# 源图 → 输出文件名。**不设 ratio**：保持原画幅（源图比例本来就贴近面板）。
BATCH = [
    # 营养快线：桌面上一杯分层饮品（橙底白顶）+ 老风扇 / 相机
    (r"C:/Users/sunchenxi/Desktop/111.png", "photo-nutrition-express.jpg"),
    # 茶之韵：山间日出 + 木桌上的茶碗
    (r"C:/Users/sunchenxi/Desktop/268f85a1-6503-4a68-9fad-db92811c41c7.png", "photo-tea-rhyme.jpg"),
    # 郁美净：雪天窗边的旧房间 + 针织毯 + 茶杯（冬天/童年温度）
    (r"C:/Users/sunchenxi/Desktop/933cc3dc-f03b-488a-8c74-4d448b36b281.jpg", "photo-yumeijing.jpg"),
    # 银鹭花生牛奶：窗台上的一杯花生奶 + 花生
    (r"C:/Users/sunchenxi/Desktop/782a65f1-cd48-4804-84ef-ebcc61be9e91.jpg", "photo-yinlu.jpg"),
]

# 面板实测宽（CSS px，见 verify 里 Emulation 1440×900 下的 .cp-receipt-panel）。
# 这里只用于打印诊断：告诉用户源图够不够 2x 屏用。
PANEL_W = 1042


def prep(src: str, dst: str, cap: int = 2084, quality: int = 92) -> None:
    im = Image.open(src).convert("RGB")
    src_size = im.size

    # **只缩不放**：比 cap 宽才缩，比 cap 小原样留原生像素。
    if im.width > cap:
        im = im.resize((cap, max(1, round(im.height * cap / im.width))), Image.LANCZOS)

    d = os.path.dirname(dst)
    if d:
        os.makedirs(d, exist_ok=True)
    im.save(dst, "JPEG", quality=quality, optimize=True, progressive=True)

    # 诊断：这张图铺满面板时会被放大多少倍（<1 才是"没放大"）
    scale = PANEL_W / im.width
    flag = "OK 不放大" if im.width >= PANEL_W else f"⚠ 会被放大 {scale:.2f}x（源图偏小）"
    retina = "够 2x 屏" if im.width >= PANEL_W * 2 else f"2x 屏需 {PANEL_W * 2}px"
    print(f"[OK] {os.path.basename(src):<46} {str(src_size):<14} -> "
          f"{str(im.size):<12} {os.path.getsize(dst) // 1024:>5}KB  {os.path.basename(dst)}"
          f"   {flag} / {retina}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?")
    ap.add_argument("dst", nargs="?")
    ap.add_argument("--cap", type=int, default=2084, help="输出最大宽度（默认 2084 = 面板宽×2）")
    ap.add_argument("--q", type=int, default=92, help="JPEG 质量（默认 92）")
    ap.add_argument("--batch", action="store_true")
    args = ap.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, "public", "media")

    if args.batch or not args.src:
        for name, dst_name in BATCH:
            if not os.path.isfile(name):
                print(f"[skip] 找不到 {name}")
                continue
            prep(name, os.path.join(out_dir, dst_name), args.cap, args.q)
        return

    if not args.dst:
        ap.error("需要 <src> <dst>，或加 --batch")
    prep(args.src, args.dst, args.cap, args.q)


if __name__ == "__main__":
    main()
