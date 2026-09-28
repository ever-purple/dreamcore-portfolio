# -*- coding: utf-8 -*-
"""纳米老宋-A 子集化：收集网页 display 元素实际用字 → 生成 woff2。

什么时候要跑：改了任何用 --wkp-display 的文案（heroLine / statement / stepsTitle /
steps[].title / cols[].title / sections[].heading / title / 实习日记的 display 字段）之后
—— 子集里没有的字会回退到 Noto Serif。

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
# 实习日记（2026-09-16）：纸带标签 date/org、手写标题 title、岗位/标签 chips
# 都走 NanoOldSongA（display 宋体）——不收就静默回退 Noto Serif，字形不成套。
# 注意：body 正文走站点正文字体（Noto Sans SC），故意不收，控制子集体积。
add_file(os.path.join(ROOT, "src/data/diary.ts"), [
    r"title:\s*'([^']*)'",
    r"org:\s*'([^']*)'",
    r"role:\s*'([^']*)'",
    r"date:\s*'([^']*)'",
    r"chips:\s*\[([^\]]*)\]",
    # 2026-09-17 拼贴版式新增的 display 字段 —— 漏一个就静默回退 Noto Serif
    # （同一行里两种宋体，肉眼能看出来但很容易归因错）：
    #   板块卡 index（'01' / '项目一'）、便签与复盘胶带的 label（'核心挑战' / '复盘'）、
    #   纸带上的 place（'北京' / '天津'）、数据表 caption（'老铁降温季 · 传播数据'）、
    #   数字贴纸 value（'18.41亿+' —— 只有「亿」是中文，其余是阿拉伯数字）。
    r"index:\s*'([^']*)'",
    r"label:\s*'([^']*)'",
    r"place:\s*'([^']*)'",
    r"caption:\s*'([^']*)'",
    r"value:\s*'([^']*)'",
    # 2026-09-22 晚第三轮：正文改成「小标题单拎的块」，小标题 sub 走 NanoOldSongA；
    #   篇首「核心工作」改两级结构（组号 no / 组名 title / 细目 items），都走 .dx-mm-*
    #   —— 漏了就是小标题半行 Noto Serif。
    #   ⚠️ core 是嵌套数组（[ { no, title, items: [...] } … ]），`core:\[([^\]]*)\]`
    #      会在**第一个 `]`**（第一组的 items 结尾）就截断 —— 只收第一组的字。
    #      所以按最内层的字段扫：no / title / items。
    r"sub:\s*'([^']*)'",
    r"no:\s*'([^']*)'",
    r"items:\s*\[([^\]]*)\]",
])

# 组件里写死的 display 文本。
#
# ⚠️ 这里是**唯一需要手工维护**的地方 —— data/*.ts 是自动扫的，但 JSX 里写死的
#    display 文案（标题、标签、按钮）扫不到，漏了就会静默回退 Noto Serif
#    （同一行里两个宋体混着，肉眼能看出来但很容易归因错）。
#    新加写死的 display 标题，记得在这里补一句。
#
# 为什么不做"全站 src/ 扫 CJK"：实测那样会收进 1500+ 字（约 700KB+），
#    而 body 正文走的是 Noto Sans SC、About/Green Os 走 --ab-* 系列字体，
#    跟 NanoOldSongA 无关。所以宁可显式登记，也别把子集灌成第二个全字库。
HARDCODED_DISPLAY = [
    # 策划案内页的固定小节标题
    "三步 · 从文化符号到情绪价值",
    # 全屏菜单（StudioMenu.tsx 的 MENU_ITEMS.zh）——
    # 2026-09-16 用户要求"字体统一"后，菜单中文从「PF频凡胡涂体」换成 NanoOldSongA，
    # 其中 于/我/联/系/式/简/历 原本不在子集里（实测确认），不补就会一半新宋一半旧宋。
    "关于我",
    "策划项目",
    "AI及视频",
    "联系方式",
    "简历",
    # 工作室物件的中文批注（与 ObjectZone / studio.ts 的 name 对应）
    "个人信息",
    "实习日记",
    "创作档案",
    # 木马（策划档案）里的空槽位占位文案 —— 两个组件各写死一句：
    #   WorksWheel.tsx 的 '待提交项目'（轮盘条目）、
    #   WorkDetail.tsx 的 '空槽位 · 等待提交'（详情面板标题）。
    # 2026-09-16 把 .ww-title / .works-panel-title 统一到 NanoOldSongA 后，
    # 这两句必须收进来，否则"空/槽/位/等"会静默回退 Noto Serif（一行两种宋体）。
    "待提交项目",
    "空槽位 · 等待提交",
    # 实习日记拼贴版式（2026-09-17）里写死在 JSX 的小标签：
    #   DiaryPage.tsx 的板块卡「成果」行前缀。data/*.ts 扫不到，只能登记。
    "成果",
    # 实习日记「一个板块一页」改版（2026-09-17 第二轮）新增的写死 display 文案：
    #   RunHead 的篇号「篇」、复盘页的「Review / 复盘」、篇首页的「核心挑战」便签、
    #   页眉页序「第 n / m 页」的「第 / 页」，
    #   以及 NotebookOverlay 进度胶囊的「封面 / 篇首 / 篇 NN / 第 n/m 页」。
    #   漏了照旧是静默回退 Noto Serif —— 一行里两种宋体。
    "篇",
    "封面",
    "篇首",
    "复盘",
    "核心挑战",
    "第",
    "页",
    # 实习日记第三轮（2026-09-22 晚）新增的写死 display 文案（DiaryPage.tsx）：
    #   篇首页两个块标签、板块页每页最上面的抬头（📌 是 emoji，走系统 emoji 字体，
    #   不进子集；后面的汉字要收）。
    "公司与项目介绍",
    "核心工作",
    "核心工作内容与实战成果",
]
chars.update("".join(HARDCODED_DISPLAY))

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
