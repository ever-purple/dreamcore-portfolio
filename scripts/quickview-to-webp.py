#!/usr/bin/env python3
"""快速浏览版图片转 WebP（专用，纯 numpy SSIM，不依赖 scipy）。

针对 public/quick-view* 下**被代码引用**的图：
  - 带透明通道（RGBA）→ 无损 WebP（零画质风险）
  - 不透明照片（RGB）→ 有损阶梯 q82→q88→q90→q93，取第一个 SSIM 过闸的

闸门：最差 1% SSIM ≥ 0.975 且均值 ≥ 0.99（对原图），体积至少省 10%。
不过闸 → 保留原图不生成。
原文件一律不删（生成 <原名>.webp），可整体回退。

用法：
  python scripts/quickview-to-webp.py --dry-run
  python scripts/quickview-to-webp.py
"""
from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
PUB = REPO / "public"

# 快速版**被引用**的图（QuickViewShell.tsx + quick-view.css 里的 url()）
# rebuild/、hero-torn、explore-icons/*、02-carousel 等未被引用，不处理。
TARGETS = [
    "quick-view-v2/surreal-desktop/base-sky-meadow.png",
    "quick-view-v2/surreal-desktop/cloud.png",
    "quick-view-v2/surreal-desktop/curtain.png",
    "quick-view-v2/surreal-desktop/desk-crt-scene.png",
    "quick-view-v2/surreal-desktop/desk-crt-screen-glow.png",
    "quick-view-v2/surreal-desktop/floating-house.png",
    "quick-view-v2/surreal-desktop/goldfish.png",
    "quick-view-v2/surreal-desktop/house-shadow.png",
    "quick-view-v2/surreal-mobile/base-sky-meadow.png",
    "quick-view-v2/surreal-mobile/cloud.png",
    "quick-view-v2/surreal-mobile/curtain.png",
    "quick-view-v2/surreal-mobile/floating-house.png",
    "quick-view-v2/surreal-mobile/goldfish.png",
    "quick-view-v2/surreal-mobile/house-shadow.png",
    "quick-view/hero-explore-source.png",
    "quick-view/id-portrait.png",
]

PHOTO_LADDER = [82, 88, 90, 93]
SSIM_LONG_SIDE = 1280


def human(n: float) -> str:
    return f"{n/1048576:.2f} MB" if abs(n) >= 1048576 else f"{n/1024:.0f} KB"


def _luma(im: Image.Image) -> np.ndarray:
    a = np.asarray(im.convert("RGB"), dtype=np.float32)
    return 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]


def _gauss(z: np.ndarray, sigma: float = 1.5) -> np.ndarray:
    """用 Pillow 的 GaussianBlur 做高斯滤波（标准实现，与 scipy 一致口径）。"""
    from PIL import ImageFilter
    # GaussianBlur 只认 'L' 模式 uint8，float32 会被拒，这里转成 uint8 再转回 float
    im = Image.fromarray(z.astype(np.uint8), mode="L")
    return np.asarray(im.filter(ImageFilter.GaussianBlur(radius=sigma)), dtype=np.float32)


def ssim_worst1(ref: Image.Image, test: Image.Image) -> tuple[float, float]:
    def prep(im: Image.Image) -> np.ndarray:
        if max(im.size) > SSIM_LONG_SIDE:
            s = SSIM_LONG_SIDE / max(im.size)
            im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
        return _luma(im)

    x, y = prep(ref), prep(test)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mx, my = _gauss(x), _gauss(y)
    xx, yy, xy = _gauss(x * x), _gauss(y * y), _gauss(x * y)
    sx, sy, sxy = xx - mx * mx, yy - my * my, xy - mx * my
    m = ((2 * mx * my + c1) * (2 * sxy + c2)) / ((mx**2 + my**2 + c1) * (sx + sy + c2))
    flat = m.ravel()
    return float(flat.mean()), float(np.percentile(flat, 1))


def encode_webp(im: Image.Image, quality: int | None) -> bytes:
    buf = io.BytesIO()
    kw: dict = {"method": 6}
    if quality is None:
        kw["lossless"] = True
        kw["exact"] = True
    else:
        kw["quality"] = quality
        kw["alpha_quality"] = 100
    im.save(buf, "WEBP", **kw)
    return buf.getvalue()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--min-ssim-worst1", type=float, default=0.975)
    ap.add_argument("--min-ssim-mean", type=float, default=0.99)
    ap.add_argument("--min-gain", type=float, default=0.90)
    args = ap.parse_args()

    print(f"目标 {len(TARGETS)} 张（仅被引用的快速版图）")
    print(f"闸门：最差1% SSIM ≥ {args.min_ssim_worst1}，均值 ≥ {args.min_ssim_mean}，省 ≥ {(1-args.min_gain)*100:.0f}%\n")

    ok, skipped = [], []
    for rel in TARGETS:
        src = PUB / rel
        if not src.exists():
            print(f"[miss] {rel}")
            continue
        orig = src.stat().st_size
        with Image.open(src) as im0:
            alpha = im0.mode in ("RGBA", "LA") or (im0.mode == "P" and "transparency" in im0.info)
            rgb = im0.convert("RGB")
            rgba = im0.convert("RGBA") if alpha else None

        ladder: list[int | None] = [None] if alpha else list(PHOTO_LADDER) + [None]
        done = False
        for q in ladder:
            img = rgba if alpha else rgb
            data = encode_webp(img, q)
            if len(data) >= orig * args.min_gain:
                continue
            if q is None:
                # 无损：可见像素逐字节一致
                with Image.open(io.BytesIO(data)) as dec:
                    got = np.asarray(dec.convert("RGBA" if alpha else "RGB"))
                want = np.asarray(rgba if alpha else rgb)
                if alpha:
                    vis = want[:, :, 3] > 0
                    same = bool(np.array_equal(want[vis], got[vis]))
                else:
                    same = bool(np.array_equal(want, got))
                if not same:
                    continue
                ok.append((rel, orig, len(data), "lossless", 1.0))
                if not args.dry_run:
                    dst = src.with_suffix(".webp")
                    dst.write_bytes(data)
                done = True
                print(f"  OK  {human(orig):>8} → {human(len(data)):>8}  lossless  {rel}")
                break
            else:
                with Image.open(io.BytesIO(data)) as dec:
                    d = dec.convert("RGB")
                sm, s1 = ssim_worst1(rgb, d)
                if s1 < args.min_ssim_worst1 or sm < args.min_ssim_mean:
                    continue
                ok.append((rel, orig, len(data), f"q{q}", sm))
                if not args.dry_run:
                    dst = src.with_suffix(".webp")
                    dst.write_bytes(data)
                done = True
                print(f"  OK  {human(orig):>8} → {human(len(data)):>8}  q{q}  SSIM {sm:.4f}  {rel}")
                break
        if not done:
            skipped.append((rel, orig))
            print(f"  skip {human(orig):>8}  （未过闸，保留原图）  {rel}")

    o = sum(r[1] for r in ok)
    n = sum(r[2] for r in ok)
    print(f"\n成功 {len(ok)} 张，保留 {len(skipped)} 张")
    if o:
        print(f"体积 {human(o)} → {human(n)}（省 {human(o-n)}，压到 {n/o:.1%}）")
    if args.dry_run:
        print("（--dry-run：未写文件）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
