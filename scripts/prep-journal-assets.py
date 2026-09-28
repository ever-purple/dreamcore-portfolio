# -*- coding: utf-8 -*-
"""手账素材预处理：抠底 + 裁到内容框 + 压到网页尺寸。

## 为什么不用 AI 抠图服务
11 张素材分成两类，判据是**前景本身有没有大面积白色**：

  · 前景是**饱和色/深色**、白色只出现在**封闭区域内部**（星星、贴纸、旋转纹、半调花）
    → 本地「从四边洪水填充」就能抠得很干净，而且**封闭的内白会被完整保留**
      （这是关键：普通"把白色变透明"的写法会把星星的白色内圈一起挖空）。
  · 前景**本身就是白色/近白**（粉色便签的纸面、金色夹纸板上的打孔纸）
    → 白纸和白底在数值上分不开，本地抠不了，只能送 AI 抠图服务。
      **这一档 2026-09-17 晚已经由用户用真抠图工具做完了**，见下面 MANIFEST 里的
      `action="precut"` 那一组；本脚本从此只负责"收边 + 压尺寸 + 量化"。

用法：
    python scripts/prep-journal-assets.py              # 全量重跑（precut + 胶带切片）
    python scripts/prep-journal-assets.py --list       # 只看清单与分档

输出：public/journal/<category>/<name>.png（全部带 alpha，长边 ≤ MAX_EDGE）

## 洪水填充的三个细节（都是为了让边缘不脏）
1. **从四边起填，不是"所有接近底色的像素"**：后者会把封闭内白一起吃掉。
2. **先腐蚀 1px 再羽化 0.6px**：直接把二值 mask 羽化，边缘会留一圈原来的底色（白边/灰边），
   腐蚀掉那 1px 正好把脏边删掉，代价是形状肉眼不可见地小一圈。
3. **容差按底色的实际噪声定**：纯白底 34 够；灰底（127,127,127）压到 22 ——
   灰底那几张贴纸的蓝色夹子离灰色不远，容差一放就会连夹子一起吃掉。
"""
import argparse
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ROOT = os.path.join(ROOT, "public", "journal")
MAX_EDGE = 480
# 量化色数。这些是**平面图形**素材（星星、波点、半调点阵），本来就没几个颜色，
# 量化几乎无损而收益巨大：半调花实测 399KB → 73KB（-82%）。
# 不量化的话 23 张素材合计 2MB —— 单页多挂几张就能拖慢首屏。
QUANT_COLORS = 64

DESK = r"C:\Users\sunchenxi\Desktop\新建文件夹 (3)"
# 第二批：用户拿真抠图工具做的**预抠版**（2026-09-17 21:02 给过来的，文件名是 UUID）。
# 同一件东西 **precut 一律优先于本地 key** —— 实测旧洪水填充有实质损伤
# （star-teal 的右尖被啃掉一截、star-torn 有一颗粒子被裁到边），
# 而且这一批补上了本地做不了的"白纸"件（夹纸板 / 粉便签）。
PRECUT = r"C:\Users\sunchenxi\Desktop\新建文件夹 (4)"


def pc(uid: str, name: str, cat: str) -> dict:
    """一件预抠图素材。**文件名是 UUID，所以必须在这里显式配对**，不能扫目录猜名字。"""
    return dict(src=os.path.join(PRECUT, uid + ".png"), name=name, cat=cat, action="precut")


# action: precut（用户预抠，只收边+压尺寸）| key（四边洪水填充）| key-soft（软键，半调图专用）
#         | slice-sheet（整版胶带切片）| ai（本地做不了，需 AI 抠图 —— 目前清单里已无此项）
MANIFEST = [
    # —— 星星 / 贴纸 ——
    #    旧的 key 洪水填充源（9a4546f7… / 9c3cd329… / ca51d9c7… / 45969fd8… 四张 jpg）
    #    已全部由下面这组 precut 取代，不要再退回 flood。
    pc("cb2beab9-14a9-486f-98ae-aa168a91b18c", "star-teal",   "stickers"),
    pc("8808d91a-ecb1-44c7-81f1-e7f2e2f4d3eb", "star-brown",  "stickers"),
    pc("9172df03-52ec-4f11-84ce-124ab558ce62", "star-spiral", "stickers"),
    pc("390f5909-dbb6-4479-bad9-d215a8bf2ed6", "star-torn",   "stickers"),
    # —— 半调（点阵）花 + 薄荷螺旋纹（旧源 62d4cd69… / 84433b2a… / 1e0944c7… 同样退役）——
    pc("f9597dc1-7131-4273-bec7-30dec1b73c27", "flower-dot-black", "motifs"),
    pc("5b998a28-8af3-48eb-9fb5-5ef377a84d3b", "flower-dot-pink",  "motifs"),
    pc("8b4ef324-c542-43b0-8f05-1224da4dc1e4", "spiral-mint",      "motifs"),
    # —— 白纸件 ——
    #    这三件原先是标 'ai' 跳过的（白纸和白底数值上分不开）。2026-09-17 晚用户用真抠图
    #    工具做好给了其中两件。⚠️ 还差一件「蓝格便签（note-blue-archive）」没给，暂缺。
    pc("2f369159-d38a-4d5c-9c24-357aec2845db", "clipboard-gold", "papers"),
    pc("fe9cb860-6ef3-445b-82bf-81370805e39c", "note-pink",      "papers"),
    # —— 大纸件（2026-09-17 晚，用户：「这种素材是让你放大把文字写上面的」）——
    #    这两张是用户从「新建文件夹 (3)/抠图结果」直接给的**中文名** PNG（不是 UUID），
    #    且比上面两张白纸件大得多（1152×2048）—— 它们是「写字用的纸」，不是小贴纸。
    #    所以走 precut 但 `max_edge=1000`（放大保留写字空间）。
    #    量化用 `quant=128` 而不是 0：纸面是低对比纸纹（std 仅 11~21），128 色几乎无损
    #    却能把体积从 764KB 压到 116KB（实测）；0 色不量化会白吃 6 倍带宽。
    #    燕尾夹纸：完整纸面 + 顶部燕尾夹，纸面干净，是复盘页写复盘感悟的主纸。
    #    波点便签：纸面是波点便签，顶部还叠着几颗星，写字会跟波点打架，先放大备用。
    dict(src=os.path.join(DESK, "抠图结果", "燕尾夹纸张_抠图.png"), name="paper-binder", cat="papers",
         action="precut", max_edge=1000, quant=128),
    dict(src=os.path.join(DESK, "抠图结果", "波点便签与星星_抠图.png"), name="paper-dotnote", cat="papers",
         action="precut", max_edge=1000, quant=128),
    # —— 和纸胶带整版：先切中缝两栏，再按行切 ——
    #    这一件**没有**预抠版（整版切片本地做得比抠图工具好），仍走本地。
    dict(src=os.path.join(DESK, "7c9c400e47c4b61e969388bf56000835.jpg"), name="", cat="tape", action="slice-sheet"),
]


def backdrop_color(rgb: np.ndarray) -> np.ndarray:
    """底色取四边像素的中位数 —— 比取四角稳（有些素材角上有阴影/裁切痕迹）"""
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    return np.median(border, axis=0)


def flood_from_border(cand: np.ndarray) -> np.ndarray:
    """把 cand 里**与四边连通**的部分标出来。纯 numpy + BFS，图不大（≤2M 像素）够用。"""
    h, w = cand.shape
    reach = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x] and not reach[y, x]:
                reach[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x] and not reach[y, x]:
                reach[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        if y > 0 and cand[y - 1, x] and not reach[y - 1, x]:
            reach[y - 1, x] = True; dq.append((y - 1, x))
        if y < h - 1 and cand[y + 1, x] and not reach[y + 1, x]:
            reach[y + 1, x] = True; dq.append((y + 1, x))
        if x > 0 and cand[y, x - 1] and not reach[y, x - 1]:
            reach[y, x - 1] = True; dq.append((y, x - 1))
        if x < w - 1 and cand[y, x + 1] and not reach[y, x + 1]:
            reach[y, x + 1] = True; dq.append((y, x + 1))
    return reach


def ink_color(im: Image.Image) -> tuple:
    """可见像素的平均色 —— 用来判断这东西贴在米色纸（≈ #F0E9D8）上会不会看不见。
    白 / 米色系的胶带抠出来是「透明底 + 近白墨」，贴在奶油色纸上等于隐身。"""
    a = np.asarray(im.convert("RGBA"), dtype=np.float32)
    m = a[:, :, 3] > 128
    if not m.any():
        return (0, 0, 0)
    return tuple(int(round(v)) for v in a[:, :, :3][m].mean(axis=0))


def ink_vs_paper(ink: tuple) -> float:
    """与米色纸底 (#F0E9D8) 的距离；小于 ~30 的贴在页面上基本看不见。"""
    return float(np.sqrt(sum((c - p) ** 2 for c, p in zip(ink, (240, 233, 216)))))


def key_out(src: str, dst: str, tol: float = 34.0, pad: int = 4, mode: str = "flood") -> dict:
    """mode='flood' 从四边洪水填充（保留封闭内白）；mode='soft' 按"离底色多远"给软 alpha。

    ⚠️ 半调（点阵）图**必须用 soft**。点与点之间的白底和四边是**连通的**，
       走 flood 会从点缝里一路漏进去，把花心整片吃空 —— 实测粉色那张只剩 4% 覆盖率。
       软键则天然正确：点是实色 → alpha 接近 255，点缝是白底 → 接近 0，
       原图那种"镂空的蕾丝感"被原样保留。
    """
    im = Image.open(src).convert("RGB")
    rgb = np.asarray(im, dtype=np.float32)
    bg = backdrop_color(rgb)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))

    if mode == "soft":
        alpha = Image.fromarray(np.clip(dist / 62.0, 0, 1).__mul__(255).astype(np.uint8))
    else:
        reach = flood_from_border(dist <= tol)
        alpha = Image.fromarray(np.where(reach, 0, 255).astype(np.uint8))
        # 腐蚀 1px 去掉残留的底色边，再轻微羽化让边缘不锯齿
        alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))

    out = im.convert("RGBA")
    out.putalpha(alpha)
    bbox = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bbox:
        return dict(ok=False, reason="抠完什么都不剩（前景和底色太接近）")
    l, t, r, b = bbox
    out = out.crop((max(0, l - pad), max(0, t - pad), min(out.width, r + pad), min(out.height, b + pad)))
    out = _fit(out)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    _save_png(out, dst)
    cover = (np.asarray(out.convert("RGBA"))[:, :, 3] > 128).mean()
    return dict(ok=True, size=out.size, kb=os.path.getsize(dst) // 1024, cover=cover,
                ink=ink_color(out), bg=tuple(int(v) for v in bg))


def _fit(im: Image.Image) -> Image.Image:
    if max(im.size) <= MAX_EDGE:
        return im
    s = MAX_EDGE / max(im.size)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)


def _save_png(im: Image.Image, dst: str, quant: int = QUANT_COLORS) -> None:
    """量化到 quant 色再存 —— 见文件头对体积的说明。
    FASTOCTREE 支持 RGBA，出来是带 alpha 调色板的 PNG-8，浏览器照常吃。
    quant=0 表示不量化（纸件保留纸纹，见 ingest_precut 的说明）。"""
    if quant and quant < 256:
        im = im.quantize(colors=quant, method=Image.FASTOCTREE)
    im.save(dst, "PNG", optimize=True)


def ingest_precut(src: str, dst: str, alpha_min: int = 10, pad: int = 2,
                  max_edge: int = MAX_EDGE, quant: int = QUANT_COLORS) -> dict:
    """用户已抠好的透明 PNG：**绝不重算 alpha**，只做「收边 + 压尺寸 + 降体积」。

    为什么这一档不能复用 `key_out`：`key_out` 是从四边/底色**猜**前景在哪，
    而这张图的 alpha 是抠图工具算好的、比我们准。拿猜的结果覆盖它只会把它弄坏
    （白纸件尤其明显：白纸和白底在数值上分不开，洪水填充会把整张纸抹掉）。
    所以这里只干三件不改变形状的事：
      1. 按 alpha 裁掉四周全透明的空边（`alpha_min` 以上才算内容，`pad` 留 2px 防啃掉抗锯齿边）；
      2. 长边压到 max_edge；
      3. 量化到 quant 色。

    实测收益：这几张从 1.26MB / 774KB 级别降到几十 KB，而 alpha 通道一个像素没动。

    ⚠️ `max_edge` / `quant` 是为「纸件」开的两个口子（2026-09-17）：
       普通贴纸/花是**平面小件**，压到 480、量化 64 色几乎无损；
       而纸件要**放大把文字写在上面**（用户原话），480 太小、纸面纹理一量化就糊成色块，
       所以纸件单独传 `max_edge=1000, quant=0`（不量化），保留纸纹与可写字的空间。
    """
    im = Image.open(src).convert("RGBA")
    bbox = im.getchannel("A").point(lambda v: 255 if v > alpha_min else 0).getbbox()
    if not bbox:
        return dict(ok=False, reason="整张都是透明的（alpha 阈值 %d 下找不到内容）" % alpha_min)
    l, t, r, b = bbox
    src_size = (im.width, im.height)
    im = im.crop((max(0, l - pad), max(0, t - pad),
                  min(im.width, r + pad), min(im.height, b + pad)))
    cropped = im.size
    if max(im.size) > max_edge:
        s = max_edge / max(im.size)
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    _save_png(im, dst, quant=quant)
    cover = (np.asarray(im.convert("RGBA"))[:, :, 3] > 128).mean()
    return dict(ok=True, size=im.size, src_size=src_size, cropped=cropped,
                kb=os.path.getsize(dst) // 1024, cover=cover)


def slice_sheet(src: str, dst_dir: str, tol: float = 30.0, min_cover: float = 0.45,
                max_ratio: float = 0.62) -> list:
    """和纸胶带整版：**先按中缝分成左右两栏，再在每栏里按行切**。

    ⚠️ 不能只按"整行都是底色"切行。实测那份整版第 3 行是两条**错落**的胶带
    （一条正放、一条压着它斜放），行投影切不开，会把两条并成一个 262px 高的方框；
    而同一行左右两条（棕波点 + 粉）只切行不切列，也会并成一条 480px 宽的"双条"。
    整版是规整的两栏，先切列就都解决了。

    还加两道形状闸门：`max_ratio` 卡掉"高得不像一条胶带"的（合并框），
    `min_cover` 卡掉底色级的白/米色胶带（它们本身就是底色，抠完只剩碎片，
    留着只会得到一块硬矩形边的白片）。
    """
    im = Image.open(src).convert("RGB")
    rgb = np.asarray(im, dtype=np.float32)
    bg = backdrop_color(rgb)
    near = (np.sqrt(((rgb - bg) ** 2).sum(axis=2)) <= tol)
    h, w = near.shape

    # 中缝：中间三分之一里"最接近纯底色"的那一列
    col_ratio = near.mean(axis=0)
    lo, hi = int(w * 0.33), int(w * 0.67)
    x_mid = lo + int(np.argmax(col_ratio[lo:hi]))

    os.makedirs(dst_dir, exist_ok=True)
    results, idx = [], 0
    for (cx0, cx1) in ((0, x_mid), (x_mid, w)):
        col = near[:, cx0:cx1]
        row_bg = col.mean(axis=1) > 0.965
        bands, start = [], None
        for y, is_bg in enumerate(row_bg):
            if not is_bg and start is None:
                start = y
            elif is_bg and start is not None:
                if y - start > 24:
                    bands.append((start, y))
                start = None
        if start is not None and h - start > 24:
            bands.append((start, h))

        for (y0, y1) in bands:
            idx += 1
            name = "tape-%02d.png" % idx
            tmp = os.path.join(dst_dir, "_tmp.png")
            im.crop((cx0, y0, cx1, y1)).save(tmp)
            res = key_out(tmp, os.path.join(dst_dir, name), tol=tol, pad=2)
            os.remove(tmp)
            dest = os.path.join(dst_dir, name)
            reason = None
            if not res.get("ok"):
                reason = res.get("reason")
            elif res["cover"] < min_cover:
                reason = "底色级白/米色胶带，抠完覆盖率仅 %.0f%%" % (res["cover"] * 100)
            elif res["size"][1] / max(res["size"][0], 1) > max_ratio:
                reason = "高宽比 %.2f 太方 —— 多半是两条错落胶带被并进了一个框" % (
                    res["size"][1] / res["size"][0])
            if reason:
                if os.path.exists(dest):
                    os.remove(dest)
                results.append((idx, dict(ok=False, reason=reason)))
            else:
                results.append((idx, res))
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list:
        for m in MANIFEST:
            print("%-14s %-18s %s" % (m["action"], m["name"] or "(整版切片)", m.get("why", "")))
        return

    saved = {"stickers": [], "motifs": [], "tape": [], "papers": []}

    def _record(cat: str, path: str) -> None:
        im = Image.open(path)
        # ⚠️ 路径要去掉 public 这一层：Vite 把 public/ 整个映射到站点根，
        #    写 /public/journal/... 在 dev 和 build 下都是 404。
        saved.setdefault(cat, []).append(dict(
            id=os.path.splitext(os.path.basename(path))[0],
            src="/" + os.path.relpath(path, os.path.join(ROOT, "public")).replace(os.sep, "/"),
            w=im.width, h=im.height,
        ))

    for m in MANIFEST:
        if m["action"] == "ai":
            print("SKIP  %-18s → 需 AI 抠图：%s" % (m["name"], m["why"]))
            continue
        if not os.path.exists(m["src"]):
            print("MISS  %-18s %s" % (m["name"], m["src"]))
            continue
        if m["action"] == "slice-sheet":
            dst_dir = os.path.join(OUT_ROOT, m["cat"])
            for idx, res in slice_sheet(m["src"], dst_dir):
                if res.get("ok"):
                    # 顺手量一下「墨色 vs 米色纸底」：白 / 米色系那几条胶带抠得没问题，
                    # 但贴在奶油色纸面上等于隐身 —— 选中它们做装饰会白费功夫。
                    d = ink_vs_paper(res.get("ink", (0, 0, 0)))
                    print("OK    tape-%02d  %sx%s  %dKB  覆盖 %.0f%%  %s%s" % (
                        idx, res["size"][0], res["size"][1], res["kb"], res["cover"] * 100,
                        res.get("ink"), "  ← 与纸底太近，纸上会看不见" if d < 30 else ""))
                    _record(m["cat"], os.path.join(dst_dir, "tape-%02d.png" % idx))
                else:
                    print("DROP  tape-%02d  %s" % (idx, res.get("reason")))
            continue
        if m["action"] == "precut":
            # 用户预抠版：只收边 + 压尺寸，alpha 原样保留（详见 ingest_precut 的 docstring）
            dst = os.path.join(OUT_ROOT, m["cat"], m["name"] + ".png")
            res = ingest_precut(m["src"], dst,
                                max_edge=m.get("max_edge", MAX_EDGE),
                                quant=m.get("quant", QUANT_COLORS))
            if res.get("ok"):
                print("OK    %-18s %sx%s ← 原图 %sx%s → 收边 %sx%s  %dKB  覆盖 %.0f%%" % (
                    m["name"], res["size"][0], res["size"][1],
                    res["src_size"][0], res["src_size"][1],
                    res["cropped"][0], res["cropped"][1], res["kb"], res["cover"] * 100))
                _record(m["cat"], dst)
            else:
                print("FAIL  %-18s %s" % (m["name"], res["reason"]))
            continue
        dst = os.path.join(OUT_ROOT, m["cat"], m["name"] + ".png")
        res = key_out(m["src"], dst, mode="soft" if m["action"] == "key-soft" else "flood")
        if res.get("ok"):
            print("OK    %-18s %sx%s  %dKB  覆盖 %.0f%%  底色 %s" % (
                m["name"], res["size"][0], res["size"][1], res["kb"], res["cover"] * 100, res["bg"]))
            _record(m["cat"], dst)
        else:
            print("FAIL  %-18s %s" % (m["name"], res["reason"]))

    write_manifest(saved)


def write_manifest(saved: dict) -> None:
    """把产出的素材连同**真实像素尺寸**写成 TS 清单。

    为什么要生成而不是手写：接入层要给每张贴纸算宽高比（贴纸是按宽定、高自适应的），
    手抄一次 23 组尺寸迟早抄错，而且下次换素材还得再抄一遍。
    """
    path = os.path.join(ROOT, "src", "data", "journalAssets.ts")
    lines = [
        "/**",
        " * 手账素材清单 —— **本文件由 scripts/prep-journal-assets.py 生成，不要手改**。",
        " *",
        " * 素材来自用户提供的手账贴纸图，抠底（透明 PNG-8）后落在 public/journal/ 下。",
        " * 换图 / 改尺寸：改脚本里的 MANIFEST 再跑一次，这个文件会跟着重写。",
        " *",
        " * ⚠️ 贴纸 / 花 / 螺旋纹 / 白纸件都是用户用真抠图工具做的**预抠版**（`action='precut'`）：",
        " *    脚本对它们**只收边 + 压尺寸，不重算 alpha** —— alpha 是抠图工具算的，比洪水填充准。",
        " *    本清单里已无标 'ai' 的条目；唯一还缺的素材是「蓝格便签 note-blue-archive」。",
        " */",
        "",
        "export type JournalAsset = {",
        "  id: string;",
        "  /** public/ 下的绝对路径，直接用 <img src> / <image href> */",
        "  src: string;",
        "  w: number;",
        "  h: number;",
        "};",
        "",
    ]
    for cat, const in (("tape", "JOURNAL_TAPE"), ("stickers", "JOURNAL_STARS"),
                       ("motifs", "JOURNAL_MOTIFS"), ("papers", "JOURNAL_PAPERS")):
        items = saved.get(cat, [])
        lines.append("export const %s: JournalAsset[] = [" % const)
        for it in items:
            lines.append("  { id: '%s', src: '%s', w: %d, h: %d }," % (it["id"], it["src"], it["w"], it["h"]))
        lines.append("];")
        lines.append("")
    lines += [
        "const ALL = [...JOURNAL_TAPE, ...JOURNAL_STARS, ...JOURNAL_MOTIFS, ...JOURNAL_PAPERS];",
        "",
        "/** 按 id 取 —— 页面上用 id 写（'star-teal' / 'tape-15'），别写路径 */",
        "export const assetById = (id: string): JournalAsset | undefined => ALL.find((a) => a.id === id);",
        "",
    ]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    total = sum(len(saved.get(c, [])) for c in ("tape", "stickers", "motifs", "papers"))
    print("WROTE src/data/journalAssets.ts（%d 个素材）" % total)


if __name__ == "__main__":
    main()
