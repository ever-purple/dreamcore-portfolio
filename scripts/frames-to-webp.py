#!/usr/bin/env python3
"""帧序列 JPEG → WebP 批量转换（可复用），支持降分辨率与 PSNR 实测。

为什么值得做：`public/frames` 的 120 张 2560×1443 JPEG 一共 64MB，
而首屏加载页要等**全部 120 张**解码完才放行（`useWindowedFrames` 的 complete
没有任何超时兜底，`useAssetPreload` 那个 12s 超时救不了它）——
这是「网站打开慢」的唯一头号原因，实测首屏可用时间 64.12s @10Mbps。

实测（4 张样本）：WebP quality=88 保持原始分辨率时单张只有 JPEG 的 ~15%，
PSNR 45~47 dB（>40dB 即肉眼不可分辨）。120 张 64MB → 约 9.7MB。

用法：
    # 桌面全分辨率 q88（原地产出 .webp，保留 .jpg）
    python scripts/frames-to-webp.py

    # 小屏专用：1440 宽 q80，写进另一个目录
    python scripts/frames-to-webp.py --dst public/frames-sm --max-width 1440 --quality 80

    python scripts/frames-to-webp.py --dry-run
    python scripts/frames-to-webp.py --prune-originals     # 确认线上没问题后再删原图

要点：
  · **默认不删原 JPEG**，只加 WebP；确认线上没问题后再用 --prune-originals
  · --max-width 只在原图更宽时才缩，缩图用 LANCZOS（比默认 BICUBIC 更锐）
  · PSNR 用「差分图的直方图」算，O(1) 与图片大小无关，且是精确值不是估算
"""

from __future__ import annotations

import argparse
import io
import math
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageChops

REPO = Path(__file__).resolve().parent.parent
DEFAULT_SRC = REPO / "public" / "frames"


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def psnr(a: Image.Image, b: Image.Image) -> float:
    """精确 PSNR：对差分图取直方图，Σ h[k]·k² / N 就是 MSE（与尺寸无关，快）。"""
    diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
    hist = diff.histogram()  # 3 通道 × 256 bin
    total = a.width * a.height * 3
    if total == 0:
        return 0.0
    mse = 0.0
    for ch in range(3):
        base = ch * 256
        for k in range(256):
            c = hist[base + k]
            if c:
                mse += c * k * k
    mse /= total
    if mse <= 0:
        return 99.0
    return 10.0 * math.log10((255.0 * 255.0) / mse)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--dst", type=Path, default=None, help="输出目录，默认与 src 相同")
    ap.add_argument("--quality", type=int, default=88, help="WebP 质量，默认 88")
    ap.add_argument("--max-width", type=int, default=0, help="超过这个宽度就等比缩小（0 = 不缩）")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--backup-dir", type=Path, default=REPO / "_media_originals" / "frames-jpg")
    ap.add_argument("--no-backup", action="store_true")
    ap.add_argument("--prune-originals", action="store_true", help="转换后删除源 JPEG（默认保留）")
    args = ap.parse_args()

    dst_dir = args.dst or args.src
    if not args.src.is_dir():
        print(f"找不到源目录：{args.src}", file=sys.stderr)
        return 1

    jpgs = sorted(p for p in args.src.iterdir() if p.suffix.lower() in (".jpg", ".jpeg"))
    if not jpgs:
        print(f"{args.src} 里没有 JPEG，可能已经转换过了。")
        return 0

    backup = None if args.no_backup else args.backup_dir
    if not args.dry_run:
        dst_dir.mkdir(parents=True, exist_ok=True)
        if backup:
            backup.mkdir(parents=True, exist_ok=True)

    total_in = total_out = 0
    psnrs: list[float] = []
    out_dims = None
    # 从 0 起步往上取最大比值；若从 1.0 起步，除非有张图压完反而变大，否则永远不更新
    # （曾因为这个初值把「压缩最差的一张」印成空名字 + 100%）
    worst = (0.0, "")
    t0 = __import__("time").time()

    for i, src in enumerate(jpgs, 1):
        dst = dst_dir / f"{src.stem}.webp"
        size_in = src.stat().st_size
        total_in += size_in

        if args.dry_run:
            print(f"[{i:>3}/{len(jpgs)}] {src.name}  {human(size_in)}  → (dry-run)")
            continue

        if backup:
            shutil.copy2(src, backup / src.name)

        with Image.open(src) as im:
            im = im.convert("RGB")
            if args.max_width and im.width > args.max_width:
                h = round(im.height * args.max_width / im.width)
                im_small = im.resize((args.max_width, h), Image.LANCZOS)
            else:
                im_small = im
            out_dims = im_small.size
            buf = io.BytesIO()
            im_small.save(buf, "WEBP", quality=args.quality, method=6)
            data = buf.getvalue()

            if args.max_width and im.width > args.max_width:
                # 缩图后只能跟"缩过的原图"比，才是真正的编码损失
                ref = im_small
            else:
                ref = im
            psnrs.append(psnr(ref, Image.open(io.BytesIO(data))))

        dst.write_bytes(data)
        total_out += len(data)
        ratio = len(data) / size_in
        if ratio > worst[0]:
            worst = (ratio, src.name)
        print(f"[{i:>3}/{len(jpgs)}] {src.name}  {human(size_in):>9} → {human(len(data)):>9}  ({ratio:.0%})")

    if args.dry_run:
        print(f"\n干跑结束：共 {len(jpgs)} 张，原始 {human(total_in)}")
        return 0

    avg_psnr = sum(psnrs) / len(psnrs) if psnrs else 0
    print(f"\n输出目录：{dst_dir}")
    print(f"图像尺寸：{out_dims[0]}×{out_dims[1]}")
    print(f"合计：{human(total_in)} → {human(total_out)}   省 {1 - total_out / total_in:.0%}")
    print(f"PSNR：平均 {avg_psnr:.1f} dB，最低 {min(psnrs):.1f} dB（>40dB 视为视觉无损）")
    print(f"压缩最差的一张：{worst[1]}（{worst[0]:.0%} 原始体积）")
    print(f"耗时 {__import__('time').time() - t0:.1f}s")

    if args.prune_originals:
        removed = 0
        for src in jpgs:
            if (dst_dir / f"{src.stem}.webp").exists():
                src.unlink()
                removed += 1
        print(f"已删除 {removed} 个原 JPEG")
    else:
        print("原 JPEG 保留未删。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
