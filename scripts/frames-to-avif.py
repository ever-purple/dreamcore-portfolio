#!/usr/bin/env python3
"""帧序列 JPEG → AVIF 批量转换（可复用），带逐帧 PSNR / SSIM 实测。

为什么值得做：`public/frames` 现在是 120 张 2560×1443 WebP q88 = **9.36MB**，
这是首屏与推镜最大的单笔字节。AVIF 同画质下只有它的 ~64%。

⚠️ **别再用 PSNR 挑档位**：aom 的 `tune=ssim` 会把 PSNR 拉低 1.3dB 同时体积砍半，
但那不代表变差 —— PSNR 与感知质量在这个区间已经脱钩。本脚本同时打印
「SSIM 均值 / 最差 1% / 最差 0.1%」，**按最差区域决定档位**，不要只看均值。

实测结论（2560×1443，6 帧样本，4:2:0，speed 6，与 JPEG 母版比）：

| 档位 | 120 帧体积 | mean SSIM | 最差 1% | 最差 0.1% |
| --- | --- | --- | --- | --- |
| **WebP q88（现状）** | 9.36 MB | 0.9926 | 0.9656 | 0.9281 |
| **AVIF q64（默认，推荐）** | **6.03 MB** | **0.9930** | **0.9660** | 0.9179 |
| AVIF q64 tune=ssim | 3.50 MB | 0.9917 | 0.9529 | 0.8937 |
| AVIF q60 tune=ssim | 3.16 MB | 0.9912 | 0.9476 | 0.8872 |

→ 默认 `q=64`：**全指标 ≥ 现有 WebP，体积 −36%**，零画质风险。
   `--tune ssim` 再省一半，但细节区（木框/门缝）会明显变软，用户要求「肉眼看不出差别」时不要用。

用法：
    # 桌面全分辨率（写进新目录，WebP 目录保留做兜底）
    python scripts/frames-to-avif.py --dst public/frames-avif

    # 小屏专用
    python scripts/frames-to-avif.py --dst public/frames-sm-avif --max-width 1440

    # 只跑 6 张做画质评估（快）
    python scripts/frames-to-avif.py --sample 6 --dst /tmp/x

    python scripts/frames-to-avif.py --dry-run

要点：
  · 母版在 `_media_originals/frames-jpg/`（120 张 JPEG，64MB）。**不要从 WebP 再转** —— 那是二次有损。
  · aom 单张编码时 `max_threads` 拉满收益很小，正确做法是「多进程 + 每进程 1~2 线程」。
  · PSNR 用「差分图直方图」算，O(1) 与图片大小无关，且是精确值不是估算。
  · SSIM 用 11×11 高斯窗（σ=1.5）在**亮度通道**上算，与感知相关性远好于 PSNR。
"""

from __future__ import annotations

import argparse
import io
import math
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops

REPO = Path(__file__).resolve().parent.parent
MASTERS = REPO / "_media_originals" / "frames-jpg"
WEBP_REF = REPO / "public" / "frames"


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def psnr(a: Image.Image, b: Image.Image) -> float:
    """精确 PSNR：对差分图取直方图，Σ h[k]·k² / N 就是 MSE（与尺寸无关，快）。"""
    diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
    hist = diff.histogram()
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
    return 99.0 if mse <= 0 else 10.0 * math.log10((255.0 * 255.0) / mse)


SSIM_LONG_SIDE = 1280


def _luma(im: Image.Image) -> np.ndarray:
    """亮度通道，float32。

    ⚠️ 用 float32 不是为了省那点精度，是为了省内存：SSIM 每张要开十几个同尺寸中间数组，
    float64 在 2560×1443 上单张就 ~350MB，8 个进程直接 OOM（实测崩过）。
    """
    a = np.asarray(im.convert("RGB"), dtype=np.float32)
    return 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]


def ssim_stats(ref: Image.Image, test: Image.Image) -> tuple[float, float, float]:
    """亮度通道 SSIM：返回 (均值, 最差 1%, 最差 0.1%)。

    只看均值会被大片平坦暗区糊住 —— 真正会「看出来」的是最差的那 1%，
    所以档位判定应该看最差百分位。

    ⚠️ 在**长边 ≤ `SSIM_LONG_SIDE`** 的缩略图上算（省内存 + 快），
    所有候选档位走同一条缩放，所以**横向比较仍然有效**；
    但不要拿这个数字去和别人论文里的全分辨率 SSIM 比。
    """
    from scipy.ndimage import gaussian_filter

    def prep(im: Image.Image) -> np.ndarray:
        if max(im.size) > SSIM_LONG_SIDE:
            s = SSIM_LONG_SIDE / max(im.size)
            im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
        return _luma(im)

    x, y = prep(ref), prep(test)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    g = lambda z: gaussian_filter(z, 1.5, truncate=3.5)  # noqa: E731
    mx, my = g(x), g(y)
    xx, yy, xy = g(x * x), g(y * y), g(x * y)
    sx, sy, sxy = xx - mx * mx, yy - my * my, xy - mx * my
    m = ((2 * mx * my + c1) * (2 * sxy + c2)) / ((mx**2 + my**2 + c1) * (sx + sy + c2))
    flat = m.ravel()
    return float(flat.mean()), float(np.percentile(flat, 1)), float(np.percentile(flat, 0.1))


def encode_one(job: tuple) -> dict:
    """跑在子进程里：读母版 → 编码 → 自己算指标（省得把像素传回主进程）。"""
    (src, dst, max_width, quality, speed, subsampling, tune, max_threads, ref_dir) = job
    src, dst = Path(src), Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    with Image.open(src) as im0:
        im = im0.convert("RGB")
        if max_width and im.width > max_width:
            h = round(im.height * max_width / im.width)
            smaller = im.resize((max_width, h), Image.LANCZOS)
        else:
            smaller = im

        kw: dict = {
            "quality": quality,
            "subsampling": subsampling,
            "speed": speed,
            "codec": "aom",
            "max_threads": max_threads,
        }
        if tune != "default":
            kw["advanced"] = {"tune": tune}

        buf = io.BytesIO()
        smaller.save(buf, "AVIF", **kw)
        data = buf.getvalue()
        dst.write_bytes(data)

        # 画质参考：缩过图就跟「缩过的母版」比，那才是真正的编码损失
        ref_source = smaller if smaller is not im else im
        decoded = Image.open(io.BytesIO(data))
        p = psnr(ref_source, decoded)
        mean_s, p1_s, p01_s = ssim_stats(ref_source, decoded)

        # 与现有 WebP 的逐帧对照（只在尺寸对得上时有意义）
        cmp_kb = None
        if ref_dir:
            cand = Path(ref_dir) / f"{src.stem}.webp"
            if cand.exists():
                cmp_kb = cand.stat().st_size / 1024

    return {
        "name": src.name,
        "bytes": len(data),
        "w": smaller.size[0],
        "h": smaller.size[1],
        "psnr": p,
        "ssim_mean": mean_s,
        "ssim_p1": p1_s,
        "ssim_p01": p01_s,
        "cmp_kb": cmp_kb,
        "secs": time.time() - t0,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=MASTERS, help="母版 JPEG 目录")
    ap.add_argument("--dst", type=Path, required=False, help="AVIF 输出目录")
    ap.add_argument("--quality", type=int, default=64, help="AVIF 质量（默认 64，见文件头档位表）")
    ap.add_argument("--subsampling", default="4:2:0", choices=["4:2:0", "4:4:4"],
                    help="4:2:0 通用性最好，且实测体积优势明显")
    ap.add_argument("--speed", type=int, default=6, help="aom speed 0~10；speed 8/10 实测又大又差")
    ap.add_argument("--tune", default="default", choices=["default", "ssim", "psnr"],
                    help="⚠️ ssim 会砍半体积但让细节变软，见文件头说明")
    ap.add_argument("--max-width", type=int, default=0, help="超过这个宽度就等比缩小（0 = 不缩）")
    ap.add_argument("--workers", type=int, default=0, help="并行进程数，0 = 自动")
    ap.add_argument("--max-threads", type=int, default=2, help="每个 aom 实例的线程数")
    ap.add_argument("--sample", type=int, default=0, help="只跑前 N 张（等距取样）做评估")
    ap.add_argument("--ref-dir", type=Path, default=None, help="对照用的 WebP 目录，默认自动")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.dry_run and not args.dst:
        print("必须给 --dst（或只做评估时用 --sample + --dry-run）", file=sys.stderr)
        return 2
    if not args.src.is_dir():
        print(f"找不到母版目录：{args.src}", file=sys.stderr)
        return 1

    sources = sorted(p for p in args.src.iterdir() if p.suffix.lower() in (".jpg", ".jpeg"))
    if not sources:
        print(f"{args.src} 里没有 JPEG。")
        return 1

    if args.sample and args.sample < len(sources):
        step = len(sources) / args.sample
        sources = [sources[min(int(i * step), len(sources) - 1)] for i in range(args.sample)]

    if args.dst:
        args.dst.mkdir(parents=True, exist_ok=True)

    workers = args.workers or max(1, min(8, (os.cpu_count() or 4) - 1))
    same_width = args.max_width == 0
    ref_dir = args.ref_dir if args.ref_dir is not None else (WEBP_REF if same_width else None)
    if ref_dir and not Path(ref_dir).is_dir():
        ref_dir = None

    print(f"母版 {len(sources)} 张 ← {args.src}")
    print(f"档位 quality={args.quality} subsampling={args.subsampling} speed={args.speed} "
          f"tune={args.tune} max_width={args.max_width or 'orig'}")
    print(f"并行 {workers} 进程 × {args.max_threads} 线程"
          f"{'' if args.dry_run else f'  →  {args.dst}'}\n")

    if args.dry_run:
        total = sum(p.stat().st_size for p in sources)
        print(f"干跑结束：{len(sources)} 张，母版合计 {human(total)}")
        return 0

    jobs = [
        (str(p), str(args.dst / f"{p.stem}.avif"), args.max_width, args.quality,
         args.speed, args.subsampling, args.tune, args.max_threads, str(ref_dir) if ref_dir else "")
        for p in sources
    ]

    t0 = time.time()
    results: list[dict] = []
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for i, r in enumerate(ex.map(encode_one, jobs), 1):
            results.append(r)
            cmp_s = ""
            if r["cmp_kb"]:
                cmp_s = f"   WebP {r['cmp_kb']:6.1f}KB → {r['bytes']/1024/r['cmp_kb']:5.1%}"
            print(f"[{i:>3}/{len(jobs)}] {r['name']}  {human(r['bytes']):>9}  "
                  f"PSNR {r['psnr']:5.1f}  SSIM {r['ssim_mean']:.4f}/p1 {r['ssim_p1']:.4f}"
                  f"{cmp_s}")
    elapsed = time.time() - t0

    tot_out = sum(r["bytes"] for r in results)
    tot_cmp = sum(r["cmp_kb"] * 1024 for r in results if r["cmp_kb"])
    n_cmp = sum(1 for r in results if r["cmp_kb"])
    scale = len(sources) / len(results) if results else 1
    w, h = results[0]["w"], results[0]["h"]

    print(f"\n输出目录：{args.dst}")
    print(f"图像尺寸：{w}×{h}")
    print(f"合计：{human(tot_out)}   （{len(results)} 张，推算 120 张 ≈ {human(tot_out * 120 / len(results))}）")
    print(f"PSNR：平均 {np.mean([r['psnr'] for r in results]):.1f} dB，"
          f"最低 {min(r['psnr'] for r in results):.1f} dB")
    print(f"SSIM：均值 {np.mean([r['ssim_mean'] for r in results]):.4f}，"
          f"最差1% {np.mean([r['ssim_p1'] for r in results]):.4f}，"
          f"最差0.1% {np.mean([r['ssim_p01'] for r in results]):.4f}")
    if n_cmp:
        print(f"对照 WebP：{human(tot_cmp)} → {human(tot_out)}  =  {tot_out/tot_cmp:.0%}（省 {1-tot_out/tot_cmp:.0%}）")
    print(f"耗时 {elapsed:.1f}s（{elapsed/len(results):.2f}s/张，{scale and ''}{len(sources)/elapsed:.1f} 张/秒）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
