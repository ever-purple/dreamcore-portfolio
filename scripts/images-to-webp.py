#!/usr/bin/env python3
"""图片转 WebP（逐张量化把关，可复用）。

与帧集转码同一个思路：**不靠猜档位**。但这里有两点不同，决定了实现方式完全不同：

1. **参照物就是现有文件本身**（现有 JPEG/PNG 即母版），所以这是一次二代压缩，
   SSIM 天然到不了 1.0，只能横向比各档位，不能拿绝对值跟帧集那批比。
2. **不能一刀切一个质量参数**。实测（`_trial-images.py`）：
   · 照片类：q80 体积只有原 9.5%，但最差 1% SSIM 掉到 0.93；
   · **细线条/文字/截图类：q90 的最差 1% 只有 0.81** —— 有损对它们是灾难；
   · **带 alpha 的插画：无损 WebP 只要原体积 53%，且逐像素完全相同** —— 零质量风险。

所以策略是**按图分组 + 逐张过闸**：

    不透明照片  → 有损阶梯 q80→q85→q88→q90→q93，取**第一个过闸**的
    带 alpha 图  → 直接无损 WebP（`exact=True`），过闸条件是**可见像素逐字节相同**
    任何一档都不过闸 / 省不到 10%  → **保留原图**，不生成新文件

闸门（可用参数改）：
    最差 1% SSIM ≥ 0.975  且  PSNR ≥ 40 dB（"视觉无损"的常用经验线）

⚠️ 原文件**一律不删不改**（新文件是同目录的 `<原名>.webp`），所以随时可以整体回退。

⚠️ 不处理 `og/`：分享卡必须是不透明 PNG（微信/小红书看图器对透明和 WebP 支持都不可靠），
   转成 WebP 会让分享预览坏掉。也不处理已经是 `.webp` 的（避免原地覆盖）。

用法：
    python scripts/images-to-webp.py --dry-run        # 只报告，不写文件
    python scripts/images-to-webp.py                  # 正式转码
    python scripts/images-to-webp.py --json out.json  # 附明细
"""

from __future__ import annotations

import argparse
import io
import json
import statistics
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
PUB = REPO / "public"

# 不动的目录：og/ 是分享卡（必须保持不透明 PNG），frames* 是序列帧（已单独处理过）
SKIP_DIRS = {"frames", "frames-sm", "frames-avif", "frames-sm-avif", "og", "resume"}
TARGET_EXTS = {".jpg", ".jpeg", ".png"}

PHOTO_LADDER = [80, 85, 88, 90, 93]
SSIM_LONG_SIDE = 1280


def human(n: float) -> str:
    return f"{n/1048576:.2f} MB" if abs(n) >= 1048576 else f"{n/1024:.0f} KB"


def _luma(im: Image.Image) -> np.ndarray:
    a = np.asarray(im.convert("RGB"), dtype=np.float32)
    return 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]


def psnr(a: Image.Image, b: Image.Image) -> float:
    x = np.asarray(a.convert("RGB"), dtype=np.float32)
    y = np.asarray(b.convert("RGB"), dtype=np.float32)
    mse = float(np.mean((x - y) ** 2))
    return float("inf") if mse == 0 else 10 * np.log10(255.0**2 / mse)


def ssim_worst1(ref: Image.Image, test: Image.Image) -> tuple[float, float]:
    """亮度 SSIM：(均值, 最差 1%)。在长边 ≤1280 缩略图上算。

    与帧集脚本同一套实现 —— 只有口径一致，两个任务的「验收线」才有可比性。
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
    return float(flat.mean()), float(np.percentile(flat, 1))


def encode_webp(im: Image.Image, quality: int | None) -> bytes:
    buf = io.BytesIO()
    kw: dict = {"method": 6}
    if quality is None:
        kw["lossless"] = True
        # ⚠️ exact=True 必须开：libwebp 无损默认会把**全透明像素的 RGB 清零**（它认为看不见），
        #    于是「解出来逐字节相同」这条断言会假失败（实测 kx-v4/kx-v5 就是这么报 ❌ 的）。
        kw["exact"] = True
    else:
        kw["quality"] = quality
        kw["alpha_quality"] = 100  # alpha 通道别做有损，否则边缘会花
    im.save(buf, "WEBP", **kw)
    return buf.getvalue()


def master_of(src: Path) -> Path | None:
    """`xxx-w1600.jpg` → 同目录的 `xxx.jpg`（q95 母版），没有就返回 None。

    为什么要费劲找母版：`works/` 的 -w1600 变体是 **q82**，直接转 WebP 是**二代压缩**
    （先继承 JPEG 自己的伪影、再加上 WebP 的），实测那样 WebP 全线打不过原 JPEG。
    改成「从 q95 母版缩到同样尺寸再编码」就回到了一代，实测同等画质下能省 8~31%。
    """
    import re

    # 用命名组：这个正则里嵌套了非捕获组，靠数括号极易数错（第一版就写成了 group(3)，
    # 直接 IndexError 把整个转码打挂）。
    m = re.match(r"^(?P<base>.*?)-w\d+(?P<ext>\.(?:jpg|jpeg|png))$", src.name, re.I)
    if not m:
        return None
    cand = src.with_name(m.group("base") + m.group("ext"))
    return cand if cand.exists() else None


def process_from_master(src: Path, rel: str, dry: bool, min_gain: float,
                        min_ssim_mean: float) -> dict:
    """母版模式：真值 = 母版缩到变体尺寸；candidate = 由**真值**编的 WebP。

    闸门用的是**对真值**的分数（而不是像变体互相之间那样比），所以这是唯一能把
    「画质没变差」真正量出来的路径。逐档试，取第一个「分数不低于现有 JPEG 且更小」的档。
    """
    res: dict = {"rel": rel, "orig": src.stat().st_size, "status": "skip", "reason": ""}
    master = master_of(src)
    assert master is not None
    try:
        with Image.open(src) as v0:
            cur = v0.convert("RGB")
        w, h = cur.size
        with Image.open(master) as m0:
            truth = m0.convert("RGB").resize((w, h), Image.LANCZOS)
    except Exception as e:
        res["reason"] = f"读图失败: {type(e).__name__}"
        return res

    res["w"], res["h"], res["alpha"] = w, h, False
    cur_sm, cur_s1 = ssim_worst1(truth, cur)

    for q in (82, 85, 88, 90, 92):
        data = encode_webp(truth, q)
        if len(data) >= src.stat().st_size * min_gain:
            res["reason"] = f"q{q} 省不到 {(1-min_gain)*100:.0f}%（为原 {len(data)/src.stat().st_size:.1%}）"
            continue
        with Image.open(io.BytesIO(data)) as d0:
            d = d0.convert("RGB")
        sm, s1 = ssim_worst1(truth, d)
        # ⚠️ 判据是「**不比现在差**」，不能用一条绝对线。
        # 现有 JPEG 自己就是有损的（实测对真值 0.9870~0.9920），拿 min_ssim_mean=0.99
        # 当门槛会**把它自己都判成不合格**，于是把本来能省的图全放过 ——
        # 实测 p05-consumer：WebP q88 得 0.9889 明明高于现有的 0.9870，却被 0.99 拦下。
        if sm < cur_sm or s1 < cur_s1 - 0.01:
            res["reason"] = (f"q{q} 不如现有 JPEG（{sm:.4f}/{s1:.4f} vs {cur_sm:.4f}/{cur_s1:.4f}）")
            continue
        res.update(status="ok", quality=f"q{q}/母版", bytes=len(data),
                   ssim_mean=sm, ssim_w1=s1, psnr=psnr(truth, d),
                   from_master=str(master.relative_to(PUB)).replace("\\", "/"))
        if not dry:
            data_path = src.with_suffix(".webp")
            tmp = data_path.with_suffix(".webp.part")
            tmp.write_bytes(data)
            tmp.replace(data_path)  # 原子替换，别留半截文件
            res["dst"] = str(data_path.relative_to(PUB)).replace("\\", "/")
        return res

    if not res["reason"]:
        res["reason"] = "所有档位都未过闸"
    return res


def process_one(job: tuple) -> dict:
    """子进程：读原图 → 按策略找**第一个过闸**的档位 → 自算指标。"""
    rel, min_ssim, min_ssim_mean, min_psnr, dry, min_gain, from_master = job
    src = PUB / rel

    if from_master and master_of(src) is not None:
        return process_from_master(src, rel, dry, min_gain, min_ssim_mean)

    orig = src.stat().st_size
    res: dict = {"rel": rel, "orig": orig, "status": "skip", "reason": ""}

    try:
        with Image.open(src) as im0:
            res["w"], res["h"] = im0.size
            alpha = im0.mode in ("RGBA", "LA") or (
                im0.mode == "P" and "transparency" in im0.info
            )
            res["alpha"] = alpha
            rgb = im0.convert("RGB")
            rgba = im0.convert("RGBA") if alpha else None
    except Exception as e:
        res["reason"] = f"打不开: {type(e).__name__}"
        return res

    # 带 alpha → 只走无损；不透明 → 走有损阶梯
    ladder: list[int | None] = [None] if alpha else list(PHOTO_LADDER)

    for q in ladder:
        img = rgba if alpha else rgb
        try:
            data = encode_webp(img, q)
        except Exception as e:
            res["reason"] = f"编码失败 q={q}: {type(e).__name__}"
            continue

        if len(data) >= orig * min_gain:
            res["reason"] = f"省不到 {(1-min_gain)*100:.0f}%（q={q} 为原 {len(data)/orig:.1%}）"
            continue

        if q is None:
            with Image.open(io.BytesIO(data)) as dec:
                got = np.asarray(dec.convert("RGBA"))
            want = np.asarray(rgba)
            # 只比**可见**像素：全透明区域的 RGB 是无意义的（exact=True 已尽量保留，
            # 但不同 libwebp 版本仍可能归一化），拿它判失败会误伤好图。
            vis = want[:, :, 3] > 0
            same = bool(np.array_equal(want[vis], got[vis]))
            if not same:
                res["reason"] = "无损但可见像素不一致"
                continue
            res.update(status="ok", quality="lossless", bytes=len(data),
                       ssim_mean=1.0, ssim_w1=1.0, psnr=float("inf"))
        else:
            with Image.open(io.BytesIO(data)) as dec:
                d = dec.convert("RGB")
                p = psnr(rgb, d)
                sm, s1 = ssim_worst1(rgb, d)
            # ⚠️ 主判据是 SSIM（最差 1% + 均值），PSNR 只当兜底。
            # 这里 PSNR 系统性偏低：参照物是 q82 的**有损 JPEG**，它自己的块效应/蚊噪
            # 被当成"信号"要求 WebP 复现，而 WebP 会把它抹平 —— 像素差变大、PSNR 掉，
            # 但**观感反而更干净**。帧集那次已经证明这个区间 PSNR 与感知质量脱钩，
            # 所以只留一个「低到 34dB 以下说明编码真的坏了」的兜底线。
            if s1 < min_ssim or sm < min_ssim_mean or p < min_psnr:
                res["reason"] = (
                    f"q{q} 未过闸（最差1% {s1:.4f} / 均 {sm:.4f} / PSNR {p:.1f}）"
                )
                continue
            res.update(status="ok", quality=q, bytes=len(data),
                       ssim_mean=sm, ssim_w1=s1, psnr=p)

        if not dry:
            dst = src.with_suffix(".webp")
            if dst.exists() and dst != src:
                # 同目录已有同名 .webp（例如 foo.jpg 与 foo.png 并存）→ 加后缀避免互相覆盖
                dst = src.with_name(src.stem + f"__from{src.suffix.lstrip('.')}.webp")
            tmp = dst.with_suffix(".webp.part")
            tmp.write_bytes(data)
            tmp.replace(dst)  # 原子替换，别留半截文件
            res["dst"] = str(dst.relative_to(PUB)).replace("\\", "/")
        return res

    if not res["reason"]:
        res["reason"] = "所有档位都未过闸"
    return res


def collect(only_referenced: bool = False) -> list[str]:
    """收出目标文件。

    ⚠️ `only_referenced` 不是「优化选项」，而是**别把力气花在死重量上**：
    实测 `public/works/` 里有 100 张 2880px 母版（61.8 MB）**在 src/ 里一张都没被引用**
    （代码只用 `-w1600` 变体），`-w640` 也全部没引用。它们不会产生任何网络请求，
    转成 WebP 只会让仓库更乱、不会让网站快一毫秒。
    """
    strict: set[str] = set()
    base: set[str] = set()
    if only_referenced:
        import re

        pat = re.compile(r"([A-Za-z0-9_\-/.]+\.(?:jpg|jpeg|png|webp))", re.I)
        for p in (REPO / "src").rglob("*"):
            if p.suffix.lower() not in {".ts", ".tsx", ".css", ".html"}:
                continue
            for s in pat.findall(p.read_text(encoding="utf-8", errors="replace")):
                s = s.lstrip("/")
                strict.add(s)
                base.add(s.rsplit("/", 1)[-1].lower())

    out = []
    for p in sorted(PUB.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in TARGET_EXTS:
            continue
        rel = str(p.relative_to(PUB)).replace("\\", "/")
        if rel.split("/")[0] in SKIP_DIRS:
            continue
        if only_referenced and not (rel in strict or rel.rsplit("/", 1)[-1].lower() in base):
            continue
        out.append(rel)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只报告，不写文件")
    ap.add_argument("--json")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--min-ssim-worst1", type=float, default=0.975)
    ap.add_argument("--min-ssim-mean", type=float, default=0.990)
    ap.add_argument("--min-psnr", type=float, default=34.0,
                    help="只当兜底线（见 process_one 注释：参照有损图时 PSNR 会系统偏低）")
    ap.add_argument("--min-gain", type=float, default=0.90,
                    help="新文件必须小于原文件的这个比例才值得替换（默认 0.90）")
    ap.add_argument("--only-referenced", action="store_true",
                    help="只处理 src/ 里能引用到的（跳过仓库里的死重量，见 collect() 注释）")
    ap.add_argument("--from-master", action="store_true",
                    help="对 `-wN` 变体改用同目录母版重编（一代压缩，见 process_from_master）")
    args = ap.parse_args()

    targets = collect(args.only_referenced)
    total = sum((PUB / r).stat().st_size for r in targets)
    print(f"目标 {len(targets)} 张 / {human(total)}（已排除 {sorted(SKIP_DIRS)} 与既有 .webp）")
    print(f"闸门：最差1% SSIM ≥ {args.min_ssim_worst1}，SSIM 均值 ≥ {args.min_ssim_mean}，"
          f"PSNR ≥ {args.min_psnr}（兜底），体积至少省 {(1-args.min_gain)*100:.0f}%"
          f"{'；只处理被引用的' if args.only_referenced else ''}\n")

    t0 = time.time()
    jobs = [
        (r, args.min_ssim_worst1, args.min_ssim_mean, args.min_psnr, args.dry_run,
         args.min_gain, args.from_master)
        for r in targets
    ]
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        results = list(ex.map(process_one, jobs))

    ok = [r for r in results if r["status"] == "ok"]
    skipped = [r for r in results if r["status"] == "skip"]
    new_bytes = sum(r["bytes"] for r in ok)
    old_bytes = sum(r["orig"] for r in ok)

    by_dir: dict[str, list[dict]] = {}
    for r in ok:
        by_dir.setdefault(r["rel"].split("/")[0], []).append(r)

    print(f"=== 按目录 ===")
    print(f"{'目录':<14}{'张数':>5}{'原MB':>9}{'新MB':>9}{'压到':>8}{'无损':>6}")
    for d in sorted(by_dir, key=lambda k: -sum(x["orig"] for x in by_dir[k])):
        v = by_dir[d]
        o = sum(x["orig"] for x in v)
        n = sum(x["bytes"] for x in v)
        ll = sum(1 for x in v if x["quality"] == "lossless")
        print(f"{d:<14}{len(v):>5}{o/1048576:>9.2f}{n/1048576:>9.2f}{n/o:>8.1%}{ll:>6}")

    print(f"\n转码成功 {len(ok)} 张，保留原图 {len(skipped)} 张")
    if old_bytes:
        print(f"体积：{human(old_bytes)} → {human(new_bytes)}（压到 {new_bytes/old_bytes:.1%}，省 {human(old_bytes-new_bytes)}）")
        print(f"对全部目标的净效果：{human(total)} → {human(total - old_bytes + new_bytes)}"
              f"（压到 {(total - old_bytes + new_bytes)/total:.1%}）")
    ll = [r for r in ok if r["quality"] == "lossless"]
    ph = [r for r in ok if r["quality"] != "lossless"]
    if ll:
        print(f"  无损 {len(ll)} 张：{human(sum(r['orig'] for r in ll))} → {human(sum(r['bytes'] for r in ll))}")
    if ph:
        from collections import Counter

        cnt = Counter(str(r["quality"]) for r in ph)
        dist = "、".join(f"{k} ×{v}" for k, v in cnt.most_common())
        print(f"  有损 {len(ph)} 张：{human(sum(r['orig'] for r in ph))} → {human(sum(r['bytes'] for r in ph))}"
              f"（档位：{dist}）")

    print(f"\n耗时 {time.time()-t0:.0f}s")
    print("\n=== 未生成的（前 15，已保留原图）===")
    for r in sorted(skipped, key=lambda r: -r["orig"])[:15]:
        print(f"  {r['orig']/1024:7.0f} KB  {r['rel']:<48} {r['reason']}")

    if args.json:
        Path(args.json).write_text(
            json.dumps({"results": results}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\n明细写到 {args.json}")
    if args.dry_run:
        print("\n（--dry-run：没有写任何文件）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
