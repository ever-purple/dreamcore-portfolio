# -*- coding: utf-8 -*-
"""检查 NanoOldSongA 子集有没有**漏字**（漏了就静默回退 Noto Serif）。

为什么需要这个脚本
------------------
`NanoOldSongA` 是子集字体（约 630 字形），**缺字不报错**，浏览器直接拿 fallback
列表的下一个 —— 也就是 `Noto Serif SC`。表现是"同一行里两种宋体"，
用户肉眼看得出来，但归因很难。这个坑已经踩过三次：

  · 2026-09-15  菜单中文（于/我/联/系/式/简/历）
  · 2026-09-15  工作室 tooltip（四个板块名）
  · 2026-09-28  联系方式面板「分享网站」—— 享/网/站 缺，(分) 在，
                用户原话「联系方式有三个字不是纳米宋了」

根因不在"忘了重跑 subset-nanooldsong.py"，而在 **HARDCODED_DISPLAY 那份清单
天生不全**：脚本按设计只自动扫 `data/*.ts` 的 display 字段（不收全站 CJK，
否则子集会被灌成第二个全字库），组件里写死的中文只能手工登记。
这个脚本把"还差哪些字"直接列出来，让手工那一步有据可依。

用法
----
  C:/Users/sunchenxi/.workbuddy/binaries/python/envs/default/Scripts/python.exe scripts/check-font-subset.py
  （加 --quiet 只看第 ① 段，适合塞进构建前检查）

两段输出
--------
  ① 漂移：脚本现在会收集、但当前 woff2 里没有的字 → **必须重跑子集脚本**。
  ② 候选：组件里写死的中文，按「缺字数」升序。少的更像 display 文案；
          多的一律是正文（About / 日记正文走 Noto Sans SC，缺字正常）。

⚠️ ② 只是候选清单，判断"这句到底走不走纳米宋"要看它所在元素的 CSS
   （`grep -A6 '^\\.类名' src/index.css` 有没有 NanoOldSongA）。
   想拿**运行时 ground truth**，用 `_verify-font-coverage.mjs`
   （CDP `CSS.getPlatformFontsForNode`，直接量出每个字实际用了哪个字体）；
   只关心分享卡浮层的话，`_verify-share-card.mjs` 的 G8 组是同一把量具的聚焦版
   （含"✕ 交给系统字体"和"come in 走拉丁字体"两条反面对照）。
"""
import os
import re
import sys
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUBSET = os.path.join(ROOT, "public", "fonts", "NanoOldSongA-subset.woff2")
CJK = re.compile(r"[\u3400-\u9fff]")


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------------------
# ① 与 subset-nanooldsong.py 的收集规则保持一致（改了那边要同步改这里）
# ---------------------------------------------------------------------------
DATA_FILES = [
    ("src/data/work-pages.ts", [r"heroLine:\s*'([^']*)'", r"statement:\s*'([^']*)'",
                                r"title:\s*'([^']*)'", r"introTitle:\s*'([^']*)'",
                                r"stepsTitle:\s*'([^']*)'", r"stepsToc:\s*'([^']*)'",
                                r"intro:\s*\n?\s*'([^']*)'"]),
    ("src/data/works.ts", [r"title:\s*'([^']*)'", r"heading:\s*'([^']*)'"]),
    ("src/data/works.local.ts", [r'"title":\s*"([^"]*)"', r'"heading":\s*"([^"]*)"']),
    ("src/data/mediaWorks.ts", [r"title:\s*'([^']*)'"]),
    ("src/data/copyProjects.ts", [r"title:\s*'([^']*)'"]),
    ("src/data/studio.ts", [r"name:\s*'([^']*)'", r"target:\s*'([^']*)'"]),
    ("src/data/diary.ts", [r"title:\s*'([^']*)'", r"org:\s*'([^']*)'", r"role:\s*'([^']*)'",
                           r"date:\s*'([^']*)'", r"chips:\s*\[([^\]]*)\]",
                           r"index:\s*'([^']*)'", r"label:\s*'([^']*)'", r"place:\s*'([^']*)'",
                           r"caption:\s*'([^']*)'", r"value:\s*'([^']*)'", r"sub:\s*'([^']*)'",
                           r"no:\s*'([^']*)'", r"items:\s*\[([^\]]*)\]"]),
]


def collected_chars():
    """data/*.ts 的 display 字段 + HARDCODED_DISPLAY 里的字。"""
    out = {}
    for rel, pats in DATA_FILES:
        text = read(rel)
        for pat in pats:
            for hit in re.findall(pat, text):
                for ch in hit:
                    if CJK.match(ch):
                        out.setdefault(ch, rel)
    # HARDCODED_DISPLAY 直接从子集脚本里抠（唯一真源，不在这里抄一份）。
    # ⚠️ 只认「整行以 " 开头」的行 —— 那块里夹杂着大量注释，
    #    注释里的中文（如「用户要求"字体统一"后」）都是**说明文字**，不是登记项。
    #    早期版本用 re.findall(r'"([^"]*)"') 无差别扫整块，
    #    于是把注释里的「字/统」当成漏字报了出来（假阳性）。
    src = read("scripts/subset-nanooldsong.py")
    block = re.search(r"HARDCODED_DISPLAY = \[(.*?)\n\]", src, flags=re.S).group(1)
    for line in block.splitlines():
        line = line.strip()
        if not line.startswith('"'):
            continue
        for s in re.findall(r'"([^"]*)"', line):
            for ch in s:
                if CJK.match(ch):
                    out.setdefault(ch, "HARDCODED_DISPLAY")
    return out


cmap = TTFont(SUBSET).getBestCmap()
print(f"当前子集：{len(cmap)} 字形 / {os.path.getsize(SUBSET)} bytes")

wanted = collected_chars()
drift = {c: f for c, f in wanted.items() if ord(c) not in cmap}

print()
print("① 漂移：收集规则里的字、但当前子集没有（重跑 subset-nanooldsong.py 即可修）")
if drift:
    by_file = {}
    for c, f in drift.items():
        by_file.setdefault(f, []).append(c)
    for f, cs in by_file.items():
        print(f"   {f}\n      缺：{''.join(sorted(set(cs)))}")
    print("   ❌ 有漂移")
else:
    print("   ✅ 无漂移 —— data/*.ts + HARDCODED_DISPLAY 的字都在子集里")

if "--quiet" in sys.argv:
    raise SystemExit(1 if drift else 0)

# ---------------------------------------------------------------------------
# ② 组件里写死的中文（脚本按设计不收，只能手工登记）
# ---------------------------------------------------------------------------
LIT = re.compile(r"'([^'\\\n]*)'|\"([^\"\\\n]*)\"|`([^`\\]*)`")
# 不渲染到画面上：读屏/原生 tooltip 用，收进子集纯属浪费
SKIP_ATTR = re.compile(r"\b(?:aria-label|aria-labelledby|title|alt|placeholder|data-[\w-]+)\s*=\s*\{?\s*$")

rows = []
for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, "src")):
    dirnames[:] = [d for d in dirnames if d not in ("node_modules", "lib", "data")]
    for fn in filenames:
        if not fn.endswith((".ts", ".tsx")):
            continue
        path = os.path.join(dirpath, fn)
        src = read(os.path.relpath(path, ROOT))
        src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)      # 块注释
        src = re.sub(r"(?m)^\s*//.*$", "", src)              # 整行行注释
        src = re.sub(r"(?m)\s//\s[^\n]*$", "", src)          # 行尾行注释
        missing, samples = set(), {}
        for m in LIT.finditer(src):
            if SKIP_ATTR.search(src[max(0, m.start() - 30):m.start()]):
                continue
            text = m.group(1) or m.group(2) or m.group(3) or ""
            for ch in text:
                if CJK.match(ch) and ord(ch) not in cmap:
                    missing.add(ch)
                    samples.setdefault(ch, text[:22])
        if missing:
            rows.append((len(missing),
                         os.path.relpath(path, ROOT).replace("\\", "/"),
                         missing, samples))

rows.sort()
print()
print("② 组件里写死的中文候选（按缺字数升序；少的更像 display 文案）")
for n, rel, chars, samples in rows[:12]:
    print(f"   【{n:>3}】{rel}")
    print(f"        {''.join(sorted(chars))}")
    for ch in sorted(chars)[:5]:
        print(f"          {ch} ← 「{samples[ch]}」")
if len(rows) > 12:
    print(f"   （共 {len(rows)} 个文件命中，只列前 12）")
print()
print("   判断某一句是否真的走纳米宋：看它所在元素的 CSS 有没有 NanoOldSongA，")
print("   或直接跑运行时探针 _verify-font-coverage.mjs（ground truth）。")
