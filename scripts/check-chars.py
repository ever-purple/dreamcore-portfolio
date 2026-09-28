#!/usr/bin/env python3
"""抽查：给定的字是否被某条分片的 unicode-range 覆盖、字形是否真的在那片文件里。"""

import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
css = (ROOT / "src" / "styles" / "fonts-sliced.css").read_text(encoding="utf-8")
blocks = re.findall(r"@font-face\s*\{(.*?)\}", css, re.S)
print(f"CSS 共 {len(blocks)} 条")

chars = sys.argv[1] if len(sys.argv) > 1 else "攀瞻蕾簿"
pat_ur = re.compile(r"unicode-range:\s*([^;]+);")
pat_url = re.compile(r"src:\s*url\('([^']+)'\)")

for ch in chars:
    cp = ord(ch)
    hits = []
    for b in blocks:
        m_ur = pat_ur.search(b)
        m_url = pat_url.search(b)
        if not (m_ur and m_url):
            print("  ✗ 有 @font-face 块缺 unicode-range 或 src：", b[:60].replace("\n", " "))
            continue
        for part in m_ur.group(1).split(","):
            part = part.strip().removeprefix("U+")
            inside = False
            if "-" in part:
                a, bb = part.split("-")
                inside = int(a, 16) <= cp <= int(bb, 16)
            elif part:
                inside = int(part, 16) == cp
            if inside:
                hits.append(m_url.group(1))
                break
    print(f"{ch} U+{cp:04X}: 命中 {len(hits)} 片")
    for h in hits:
        p = ROOT / "public" / h.lstrip("/")
        try:
            with TTFont(p, fontNumber=0) as f:
                has = cp in f.getBestCmap()
            print(f"    {h}  文件存在={p.exists()}  字形在文件里={has}")
        except Exception as e:  # noqa: BLE001
            print(f"    {h}  读取失败 {e}")
    if not hits:
        print("    ✗ 没有任何分片覆盖它！")
