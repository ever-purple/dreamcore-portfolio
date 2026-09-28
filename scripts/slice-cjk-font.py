#!/usr/bin/env python3
"""把「整套中文字库」切成 unicode-range 分片。

为什么需要
----------
public/fonts 里的 NotoSerifSC-400.woff2 是 7946 字的整套思源宋体（1.44MB），
但整个站点实际只用到 1874 个汉字。@font-face 指哪浏览器下哪，不会替你挑 ——
于是首屏白背一整套字库。切成一片一片后，浏览器只下载「页面里真的出现了那些字」
的那些片，字形数据一个像素都没减，所以清晰度完全不受影响。

切的是「用字池」而不是整库
--------------------------
用字池 = 源码里实际出现的字符（含 public/insp/data.json 里的正文）
       ∪ GB2312 一级常用字 3755 个（兜底：作者模式新打的字不会掉回系统字体）
       ∪ ASCII / 拉丁 / 全角标点

GB2312 兜底那部分平时不会命中，所以不增加首屏体积；只在有人真的打出那些字时
才额外拉一片。

产出
----
    public/fonts/sliced/<原名>/<原名>-001.woff2
    src/styles/fonts-sliced.css   ← 自动生成的 @font-face 规则

用法
----
    python scripts/slice-cjk-font.py                  # 全量切（约 18 分钟）
    python scripts/slice-cjk-font.py --only zpix      # 只切 zpix
    python scripts/slice-cjk-font.py --chunk 180      # 改片的粒度
    python scripts/slice-cjk-font.py --dry-run        # 只算分片计划不生成
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 每片多少个字。分片总大小 ≈ 用字池大小，片数只影响「要发几个请求」，
# 300 是实测的甜点：首屏命中 2–4 片，一个请求几十 KB。
CHUNK = 300

# 目标字体：(文件名, CSS font-family, font-weight)
FONTS = [
    ("NotoSerifSC-300.woff2", "Noto Serif SC", 300),
    ("NotoSerifSC-400.woff2", "Noto Serif SC", 400),
    ("NotoSerifSC-500.woff2", "Noto Serif SC", 500),
    ("NotoSerifSC-600.woff2", "Noto Serif SC", 600),
    ("NotoSerifSC-700.woff2", "Noto Serif SC", 700),
    ("NotoSansSC-300.woff2", "Noto Sans SC", 300),
    ("NotoSansSC-400.woff2", "Noto Sans SC", 400),
    ("NotoSansSC-500.woff2", "Noto Sans SC", 500),
    ("NotoSansSC-700.woff2", "Noto Sans SC", 700),
    ("zpix.woff2", "Zpix", 400),
    ("Cubic_11.woff2", "Cubic11", 400),
]

SCAN_GLOBS = [
    "src/**/*.tsx",
    "src/**/*.ts",
    "src/**/*.css",
    "public/insp/*.json",
    "index.html",
]

# 不切这些（本来就小 / 已经是专用子集，动它们风险大于收益）
SKIP_HINTS = ("Inter-", "Caveat")


def gb2312_level1() -> set[str]:
    """GB2312 一级汉字 3755 个 —— 日常书面用字兜底。"""
    out: set[str] = set()
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                out.add(bytes((hi, lo)).decode("gbk"))
            except UnicodeDecodeError:
                continue
    return out


def collect_source_chars() -> set[str]:
    chars: set[str] = set()
    for pat in SCAN_GLOBS:
        for f in ROOT.glob(pat):
            if f.is_file():
                try:
                    chars.update(f.read_text(encoding="utf-8", errors="ignore"))
                except OSError:
                    continue
    return chars


def build_pool() -> set[str]:
    src = collect_source_chars()
    pool = src | gb2312_level1()
    # ASCII + 拉丁 + 常见全角标点
    pool.update(chr(c) for c in range(0x20, 0x7F))
    pool.update(chr(c) for c in range(0x00A0, 0x024F))
    pool.update("，。、！？：；「」『』（）【】《》…—·～“”‘’")
    return pool


def font_cmap(path: Path) -> set[str] | None:
    from fontTools.ttLib import TTFont  # noqa: PLC0415

    try:
        with TTFont(path, fontNumber=0) as f:
            return {chr(c) for c in f.getBestCmap().keys()}
    except Exception:
        return None


def chunk_chars(pool: set[str], avail: set[str], size: int) -> list[list[str]]:
    """按码位排序后切块；只保留字体里真的有的字。"""
    ordered = sorted((c for c in pool if c in avail), key=lambda c: ord(c))
    return [ordered[i : i + size] for i in range(0, len(ordered), size)]


def ranges_of(chunk: list[str]) -> str:
    spans: list[list[int]] = []
    for cp in sorted(ord(c) for c in chunk):
        if spans and cp == spans[-1][1] + 1:
            spans[-1][1] = cp
        else:
            spans.append([cp, cp])
    return ", ".join(
        f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in spans
    )


def slice_one(src: Path, chunk: list[str]) -> bytes:
    """切一片。切片之间互不依赖，所以可以丢给多个进程并行跑。"""
    from fontTools import subset  # noqa: PLC0415
    from fontTools.ttLib import TTFont  # noqa: PLC0415

    opt = subset.Options()
    opt.flavor = "woff2"
    font = TTFont(src, fontNumber=0)
    s = subset.Subsetter(options=opt)
    s.populate(text="".join(chunk))
    s.subset(font)
    font.flavor = "woff2"
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


def _worker(task: tuple[str, str, list[str]]) -> tuple[int, int, str]:
    """并行切片任务：(源文件, 输出文件, 该片的字) → (字节数, 0, '') 或 (0, 0, 报错)。"""
    src, out, chunk = task
    try:
        data = slice_one(Path(src), chunk)
        Path(out).write_bytes(data)
        return (len(data), 0, "")
    except Exception as exc:  # noqa: BLE001
        return (0, 0, f"{type(exc).__name__}: {exc}")


HEADER = """/* ============================================================================
   中文字体 · unicode-range 分片（scripts/slice-cjk-font.py 自动生成）
   ----------------------------------------------------------------------------
   整套字库按 300 字一片切开。浏览器只会下载「页面里真的出现了那些字」的片，
   字形数据本身一个像素都没减 —— 清晰度完全不变。
   改字体请改脚本重跑，不要手改这个文件。
   ========================================================================= */
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只切某个字体（文件名片段）")
    ap.add_argument("--chunk", type=int, default=CHUNK)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    pool = build_pool()
    print(f"用字池：{len(pool)} 个字（源码 + GB2312 一级兜底 + 西文）", file=sys.stderr)

    targets = [
        (f, fam, w)
        for f, fam, w in FONTS
        if (not args.only or args.only in f) and not any(h in f for h in SKIP_HINTS)
    ]

    started = time.time()
    plan: list[tuple[str, str, int, int, list[list[str]]]] = []
    total_in = 0
    for fname, family, weight in targets:
        src = ROOT / "public" / "fonts" / fname
        if not src.exists():
            print(f"  跳过（不存在）: {fname}", file=sys.stderr)
            continue
        avail = font_cmap(src)
        if avail is None:
            print(f"  跳过（读不出 cmap）: {fname}", file=sys.stderr)
            continue
        chunks = chunk_chars(pool, avail, args.chunk)
        if not chunks:
            print(f"  跳过（用字池里没有这个字库的字）: {fname}", file=sys.stderr)
            continue
        plan.append((fname, family, weight, len(chunks), chunks))
        total_in += src.stat().st_size
        print(
            f"  {fname:26s} 全库 {src.stat().st_size/1024/1024:.2f}MB "
            f"→ {len(chunks)} 片",
            file=sys.stderr,
        )

    if args.dry_run:
        for fname, family, weight, n, _ in plan:
            print(f"  would slice {fname} → {n} 片")
        return 0

    out_root = ROOT / "public" / "fonts" / "sliced"
    css_blocks: list[str] = []
    made = 0
    total_out = 0

    # 收集所有切片任务后一次性并行跑（fontTools 切片互不依赖，20 核能快十几倍）
    tasks: list[tuple[str, str, list[str]]] = []
    for fname, family, weight, n, chunks in plan:
        stem = Path(fname).stem
        outdir = out_root / stem
        outdir.mkdir(parents=True, exist_ok=True)
        # 清掉上一轮的同名片，避免 --chunk 改小后残留旧文件
        for stale in outdir.glob(f"{stem}-*.woff2"):
            stale.unlink()
        for i, chunk in enumerate(chunks, start=1):
            tasks.append(
                (
                    str(ROOT / "public" / "fonts" / fname),
                    str(outdir / f"{stem}-{i:03d}.woff2"),
                    chunk,
                )
            )

    workers = max(2, min(len(tasks), (os.cpu_count() or 4) - 4))
    print(f"开始并行切片：{len(tasks)} 片 / {workers} 进程", file=sys.stderr)
    done = 0
    if workers > 1:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            for size, _, err in pool.map(_worker, tasks, chunksize=1):
                done += 1
                if err:
                    print(f"  ✗ 第 {done} 片失败：{err}", file=sys.stderr)
                    return 1
                made += 1
                total_out += size
                if done % 10 == 0 or done == len(tasks):
                    print(
                        f"  ...{done}/{len(tasks)} 片  ({time.time()-started:.0f}s)",
                        file=sys.stderr,
                    )
    else:
        for src, out, chunk in tasks:
            size, _, err = _worker((src, out, chunk))
            if err:
                print(f"  ✗ {out} 失败：{err}", file=sys.stderr)
                return 1
            made += 1
            total_out += size

    for fname, family, weight, n, chunks in plan:
        stem = Path(fname).stem
        css_blocks.append(
            f"/* {fname} —— {n} 片 */\n"
            + "".join(
                "@font-face {\n"
                f"  font-family: '{family}';\n"
                f"  src: url('/fonts/sliced/{stem}/{stem}-{i:03d}.woff2') format('woff2');\n"
                f"  font-weight: {weight}; font-style: normal; font-display: swap;\n"
                f"  unicode-range: {ranges_of(chunk)};\n"
                "}\n"
                for i, chunk in enumerate(chunks, start=1)
            )
        )
        print(f"  ✓ {fname} → {n} 片  ({time.time()-started:.0f}s)", file=sys.stderr)

    css_path = ROOT / "src" / "styles" / "fonts-sliced.css"
    css_path.parent.mkdir(parents=True, exist_ok=True)
    css_path.write_text(HEADER + "\n".join(css_blocks), encoding="utf-8")

    print()
    print(f"输入合计   {total_in/1024/1024:.2f}MB")
    print(f"分片后合计 {total_out/1024/1024:.2f}MB（共 {made} 片）")
    print(f"CSS 已写出：{css_path.relative_to(ROOT)}")
    print(f"耗时 {time.time()-started:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
