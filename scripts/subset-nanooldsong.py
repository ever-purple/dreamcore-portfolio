# -*- coding: utf-8 -*-
"""纳米老宋-A 子集化：收集网页 display 元素实际用字 → 生成 woff2。

什么时候要跑：改了任何用 --wkp-display 的文案（heroLine / statement / stepsTitle /
steps[].title / cols[].title / sections[].heading / title）之后 —— 子集里没有的字会回退到 Noto Serif。

用法：
  C:/Users/sunchenxi/.workbuddy/binaries/python/envs/default/Scripts/python.exe scripts/subset-nanooldsong.py

依赖：pip install fonttools brotli（已装在托管 venv default）。

⚠️ 关键坑（2026-09-15 排查）：
  不能用 fontTools 的 Python API `Subsetter.populate(unicodes=...)` —— 该字体内部
  字形命名是 `uXXXX`（不是标准 `uniXXXX`），Python API 回查码位时丢 CJK，结果子集里
  一个汉字都没有（只剩 ASCII/标点）。必须走 **pyftsubset CLI**（`--unicodes=` 参数），
  CLI 对 `uXXXX` 命名处理正确。所以本脚本只负责收集字符 + 拼 CLI 参数 + 调 pyftsubset。
"""
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = r"D:/字体/纳米老宋-v1.001/NanoOldSongA-Regular.ttf"
OUT = os.path.join(ROOT, "public", "fonts", "NanoOldSongA-subset.woff2")
PYFTSUBSET = r"C:/Users/sunchenxi/.workbuddy/binaries/python/envs/default/Scripts/pyftsubset.exe"

chars = set()

def add_file(path, patterns):
    with open(path, encoding="utf-8") as f:
        t = f.read()
    for pat in patterns:
        for m in re.findall(pat, t):
            chars.update(m)

add_file(os.path.join(ROOT, "src/data/work-pages.ts"), [
    r"heroLine:\s*'([^']*)'",
    r"statement:\s*'([^']*)'",
    r"title:\s*'([^']*)'",
    r"introTitle:\s*'([^']*)'",
    r"stepsTitle:\s*'([^']*)'",
    r"stepsToc:\s*'([^']*)'",
    r"intro:\s*\n?\s*'([^']*)'",
])
add_file(os.path.join(ROOT, "src/data/works.ts"), [
    r"title:\s*'([^']*)'",
    r"heading:\s*'([^']*)'",
])
add_file(os.path.join(ROOT, "src/data/works.local.ts"), [
    r'"title":\s*"([^"]*)"',
    r'"heading":\s*"([^"]*)"',
])
# 报刊亭两排的落地页：视频/音乐、文案/AI 的标题
# （2026-09-15 加：第一排视频标题是中文，不收就会回退系统字体）
add_file(os.path.join(ROOT, "src/data/mediaWorks.ts"), [
    r"title:\s*'([^']*)'",
])
add_file(os.path.join(ROOT, "src/data/copyProjects.ts"), [
    r"title:\s*'([^']*)'",
])
# 工作室物件标签（2026-09-15 起 tooltip 从 Noto Serif 换成 NanoOldSongA，
# 四个板块名「个人信息 / 实习与思考 / 策划项目 / 创作档案」必须收进来）
add_file(os.path.join(ROOT, "src/data/studio.ts"), [
    r"name:\s*'([^']*)'",
    r"target:\s*'([^']*)'",
])

# 组件里写死的 display 文本（新加写死标题记得在这里补）
chars.update("三步 · 从文化符号到情绪价值")

# 数字 / 常用标点 / 英文字母
chars.update("0123456789")
# 箭头也在这一档：→ 用于内页，← 是视频页「← Back」的前置箭头（漏了会回退系统字体）
chars.update(" ··｜：；，。、！？—…“”‘’《》【】「」（）/\\&→←↑↓×")
chars.update("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
# ASCII **半角**标点 —— 很容易漏。
# 上面那行只有全角「：」，而时长写的是 "00:56"（半角冒号），
# 漏掉它会让 5 个字符里的 1 个静默回退到 Noto Serif（2026-09-15 用
# CSS.getPlatformFontsForNode 抓到：NanoOldSong-A(4) + Noto Serif SC(1)）。
chars.update(":;,.!?'\"()[]{}<>@#$%^*+=_|~`-")

text = "".join(sorted(chars))
cjk = sum(1 for c in chars if "\u4e00" <= c <= "\u9fff")
print(f"字符数 {len(chars)}（CJK {cjk}）")

# 拼成 pyftsubset 的 --unicodes 参数：连续的码位压缩成 a-b 区间，其余逐个逗号分隔
cps = sorted({ord(c) for c in text})
ranges = []
i = 0
while i < len(cps):
    j = i
    while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
        j += 1
    if j == i:
        ranges.append(f"{cps[i]:X}")
    else:
        ranges.append(f"{cps[i]:X}-{cps[j]:X}")
    i = j + 1
unicodes_arg = ",".join(ranges)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
cmd = [
    PYFTSUBSET, SRC,
    f"--unicodes={unicodes_arg}",
    "--flavor=woff2",
    "--notdef-outline",
    "--recommended-glyphs",
    "--name-IDs=*",
    "--name-languages=*",
    "--drop-tables+=FFTM,meta,DSIG",
    f"--output-file={OUT}",
]
print(" ".join(cmd[:2]), "--unicodes=<...>", "--flavor=woff2 ...")
r = subprocess.run(cmd, capture_output=True, text=True)
if r.returncode != 0:
    print("pyftsubset 失败：")
    print(r.stdout)
    print(r.stderr)
    raise SystemExit(1)

# 校验：子集里 CJK 字形必须在
from fontTools.ttLib import TTFont  # noqa: E402
chk = TTFont(OUT).getBestCmap()
missing = [c for c in text if ord(c) > 127 and ord(c) not in chk]
if missing:
    print("⚠️ 子集仍缺字：", "".join(missing))
    raise SystemExit(1)
print("OK ->", OUT, os.path.getsize(OUT), "bytes（CJK 校验通过）")
