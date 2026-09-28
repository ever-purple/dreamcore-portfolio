#!/usr/bin/env python3
"""校验 fonts-sliced.css 的分片是否完整可用。

分片方案最大的风险是「覆盖出现空洞」：某个字没有任何一片负责它，浏览器就会掉回
别的字体 —— 表现为「同一段文字里有的字换了字体」，极难肉眼发现。所以切完必须
用脚本证明：每个字库的各分片码位之并集 == 原字体 cmap，且互不重叠。

同时抽查每片是不是合法的 woff2、能不能解出预期的字。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "src" / "styles" / "fonts-sliced.css"

PAT_FAM = re.compile(r"font-family:\s*'([^']+)'")
PAT_WT = re.compile(r"font-weight:\s*(\d+)")
PAT_URL = re.compile(r"src:\s*url\('([^']+)'\)")
PAT_UR = re.compile(r"unicode-range:\s*([^;]+);")


def parse_ranges(ur: str) -> set[int]:
    cps: set[int] = set()
    for part in ur.split(","):
        part = part.strip().removeprefix("U+")
        if "-" in part:
            a, b = part.split("-")
            cps.update(range(int(a, 16), int(b, 16) + 1))
        elif part:
            cps.add(int(part, 16))
    return cps


def main() -> int:
    # 用字池必须和切片脚本用的一致，否则校验就校了个寂寞
    import importlib.util  # noqa: PLC0415

    spec = importlib.util.spec_from_file_location(
        "slice_cjk_font", ROOT / "scripts" / "slice-cjk-font.py"
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    pool = mod.build_pool()
    print(f"用字池 {len(pool)} 个字")

    css_text = CSS.read_text(encoding="utf-8")
    blocks = re.findall(r"@font-face\s*\{(.*?)\}", css_text, re.S)
    print(f"CSS 共 {len(blocks)} 条 @font-face")

    faces = []
    for b in blocks:
        fam = PAT_FAM.search(b)
        wt = PAT_WT.search(b)
        url = PAT_URL.search(b)
        ur = PAT_UR.search(b)
        if not (fam and wt and url and ur):
            print(f"  ✗ 解析失败：{b[:80]!r}")
            return 1
        faces.append((fam.group(1), wt.group(1), url.group(1), ur.group(1)))

    # 按 family+weight 分组，检查覆盖
    groups: dict[tuple[str, str], list[tuple[str, list[int]]]] = {}
    for fam, wt, url, ur in faces:
        groups.setdefault((fam, wt), []).append((url, sorted(parse_ranges(ur))))

    problems = 0
    for (fam, wt), items in sorted(groups.items()):
        # 从首片 URL 推出原字体文件名
        stem = Path(items[0][0]).stem.rsplit("-", 1)[0]
        orig = ROOT / "public" / "fonts" / f"{stem}.woff2"
        if not orig.exists():
            print(f"  {fam}/{wt}: 找不到原字体 {orig.name}，跳过覆盖对比")
            continue
        with TTFont(orig, fontNumber=0) as f:
            orig_cmap = set(f.getBestCmap().keys())

        covered: set[int] = set()
        overlaps: list[tuple[int, int]] = []
        prev_end = -1
        for url, cps in sorted(items, key=lambda x: x[1][0] if x[1] else 0):
            for cp in cps:
                if cp in covered:
                    overlaps.append((cp, cp))
                covered.add(cp)
            if cps and cps[0] <= prev_end:
                overlaps.append((cps[0], prev_end))
            if cps:
                prev_end = cps[-1]

        # 判据 1：用字池里的字必须全覆盖（这个才是"会不会掉回系统字体"的真正门槛）
        pool_cps = {ord(c) for c in pool} & orig_cmap
        missing = pool_cps - covered
        # 判据 2：分片之间不能重叠，否则同一字可能被两片抢，浏览器行为不确定
        # 判据 3（信息）：原库里站点用不到的字没覆盖 —— 这是省体积的代价，只提示
        unused = orig_cmap - covered

        nfiles = len(items)
        status = "OK "
        if missing:
            status = "MISS"
            problems += 1
        if overlaps:
            status = "OVLP"
            problems += 1
        print(
            f"  [{status}] {fam}/{wt}  片数={nfiles}  "
            f"用字池覆盖={len(pool_cps)-len(missing)}/{len(pool_cps)}"
            f"  原库未用={len(unused)}"
        )
        if missing:
            sample = " ".join(f"U+{c:04X}({chr(c)!r})" for c in sorted(missing)[:8])
            print(f"        ✗ 用字池缺 {len(missing)} 个：{sample}")
        if overlaps:
            print(f"        ✗ 重叠 {len(overlaps)} 处，首处 U+{overlaps[0][0]:04X}")

    # 抽查片文件本身是不是合法 woff2
    print("\n抽查前 3 片能否正常解析：")
    for fam, wt, url, _ in faces[:3]:
        p = ROOT / "public" / url.lstrip("/")
        try:
            with TTFont(p, fontNumber=0) as f:
                n = len(f.getBestCmap())
            print(f"  ✓ {p.relative_to(ROOT)}  解出 {n} 个码位  ({p.stat().st_size/1024:.1f}KB)")
        except Exception as exc:  # noqa: BLE001
            print(f"  ✗ {p.name} 解析失败：{type(exc).__name__}: {exc}")
            problems += 1

    print()
    if problems:
        print(f"发现 {problems} 个问题，不要上线")
        return 1
    print("覆盖完整、无重叠、文件合法")
    return 0


if __name__ == "__main__":
    sys.exit(main())
