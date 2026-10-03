"""把本机的汉仪旗黑裁成网页子集 woff2（文案页正文用）。

## 为什么要重做（2026-09-22 第二版）
第一版只扫 `src/data/copyProjects.ts` 的字符串字面量，结果两处翻车：
  1. 用户换了正文（第 11 轮把 4 段新文案灌进来）后**脚本没重跑**，页面实测
     449 个用字里 **286 个不在子集里** → 大量字掉回 Noto Sans SC，
     而旗黑-40S 本来就比 Noto 粗，于是就出现用户看到的「有的粗有的细」。
  2. 组件里**硬编码**的中文（谢谢惠顾 / 报刊亭 / 点按展开全文 / 收起小票）
     从来没被收进去 —— 因为第一版只扫数据文件。

所以这一版改成：
  · 扫 **整个 `src/`**（.ts/.tsx/.css/.html/.json 全部字符）—— 页面会渲染的字
    必然是源码字符的子集，从根上断掉"漏扫"；
  · 再并上 **GB2312 一级常用字 3755 个** 兜底 —— 用户以后改文案/加字也不会掉字。
    代价：11KB → ~592KB。这个站本来就加载 4.5MB 的 Noto Sans SC，可以接受。
    （想省流量：删掉 `gb2312_l1()` 那一段就回到十几 KB。）
  · 字重：**2026-09-22 第四轮用户拍板「文案字体用汉仪旗黑-40S」→ 默认 40S**。
    中间用过 60S（当时用户在解「有的粗有的细」那个问题，措辞是「统一换成粗的」），
    但粗档在他自己的屏上偏糊，最后还是指定回标准档 40S。
    各切面**字宽完全一致**（都是 576/12字@48px），换字重不推版，随时切回来即可。
    ⚠️ 配套的 CSS 必须把 `font-weight` 写成 **400**、`@font-face` 写 `font-weight: 100 900`：
    40S 只有一档，如果声明里还留着 700，浏览器会**合成加粗**（假粗），
    那才是真正难看的「有的粗有的细」。

## 用法
    python subset-qihei.py
    python subset-qihei.py --weight 60S     # 想再粗一档
    python subset-qihei.py --no-common      # 只收源码用字（十几 KB，改文案要重跑）

⚠️ 改了 `src/` 里任何会被渲染的中文之后，请重跑本脚本（默认档已含常用字，一般不用）。
"""

from __future__ import annotations

import argparse
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 仓库根（脚本已移入 scripts/，要上溯一级）
FONT_DIRS = [
    r"C:/Users/sunchenxi/AppData/Local/Microsoft/Windows/Fonts",
    r"C:/Windows/Fonts",
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft/Windows/Fonts"),
]
OUT_DIR = os.path.join(ROOT, "public", "fonts")

SRC_EXT = (".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".json", ".md")

# 拉丁 / 数字 / 常用标点 / 报纸会用到的小符号
EXTRA = (
    "".join(chr(c) for c in range(0x20, 0x7F))     # ASCII
    + "".join(chr(c) for c in range(0xA0, 0x100))  # Latin-1 补充
    + "“”‘’·—…、。，；：？！（）《》〈〉【】「」『』～　¥￥"
    + "▾✦◆●○▲△★☆→←↑↓×÷±°№"
)


def find_font(weight: str) -> str:
    name = f"HYQiHei-{weight}.otf"
    for d in FONT_DIRS:
        if not d:
            continue
        p = os.path.join(d, name)
        if os.path.isfile(p):
            return p
    sys.exit(f"[x] 找不到 {name}，试过：{FONT_DIRS}")


def gb2312_l1() -> str:
    """GB2312 一级常用字（区位 16~55 区 = 0xB0A1~0xD7F9），3755 个。
    直接解码字节区间就能拿到，不需要外部字表。"""
    out = []
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                ch = bytes([hi, lo]).decode("gb2312")
            except UnicodeDecodeError:
                continue
            if len(ch) == 1:
                out.append(ch)
    return "".join(out)


def scan_src() -> set[str]:
    chars: set[str] = set()
    for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, "src")):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "dist")]
        for fn in filenames:
            if not fn.endswith(SRC_EXT):
                continue
            with open(os.path.join(dirpath, fn), encoding="utf-8", errors="ignore") as fh:
                chars |= set(fh.read())
    return chars


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weight", default="40S", help="旗黑切面，如 40S / 55S / 60S / 65S / 70S")
    ap.add_argument("--no-common", action="store_true", help="不并 GB2312 一级常用字")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    src_otf = find_font(args.weight)
    out_name = args.out or f"HYQiHei{args.weight}-subset.woff2"
    out_path = os.path.join(OUT_DIR, out_name)

    want = set(EXTRA) | scan_src()
    if not args.no_common:
        want |= set(gb2312_l1())
    # ⚠️ 这里**只能**滤掉控制字符，不能用 `.strip()` —— Python 的 strip 会把
    #    U+3000（全角空格）和 U+00A0（nbsp）一并当空白扔掉，而「duang duang～　这是什么声音？」
    #    里就有全角空格，会被静默丢字。实测踩过。
    want = {c for c in want if ord(c) >= 0x20}

    font = TTFont(src_otf)
    cmap: set[int] = set()
    for t in font["cmap"].tables:
        cmap |= set(t.cmap.keys())

    text = "".join(sorted(want))
    present = [c for c in text if ord(c) in cmap]
    absent = [c for c in text if ord(c) not in cmap]

    opts = subset.Options()
    opts.flavor = "woff2"
    opts.desubroutinize = True
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = False
    opts.drop_tables = ["FFTM"]

    f = subset.load_font(src_otf, opts)
    s = subset.Subsetter(options=opts)
    s.populate(text="".join(present))
    s.subset(f)
    os.makedirs(OUT_DIR, exist_ok=True)
    f.flavor = "woff2"
    f.save(out_path)

    size = os.path.getsize(out_path)
    print(f"源字体   {os.path.basename(src_otf)}  ({os.path.getsize(src_otf)//1024} KB, "
          f"{len(cmap)} 码位)")
    print(f"收录     {len(present)} 字"
          + (f"（另有 {len(absent)} 个源字体本身就没有，已跳过）" if absent else ""))
    print(f"输出     {out_name}  {size//1024} KB  （压缩到源字体的 "
          f"{size/os.path.getsize(src_otf)*100:.2f}%）")
    if absent:
        print(f"         源字体缺：{''.join(absent[:60])}")
    # 关键自检：源码里出现过的 CJK 字符必须全在子集里
    src_cjk = sorted(c for c in scan_src() if ord(c) > 0x2E7F)
    present_set = set(present)
    not_subset = [c for c in src_cjk if c not in present_set]
    print(f"自检     源码 CJK {len(src_cjk)} 字，未收录 {len(not_subset)}"
          + (f" -> {''.join(not_subset[:40])}" if not_subset else " ✔"))


if __name__ == "__main__":
    main()
