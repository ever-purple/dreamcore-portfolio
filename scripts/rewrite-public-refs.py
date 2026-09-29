#!/usr/bin/env python3
"""改写 / 体检全仓的图片引用：`src/` 代码 + `public/` 数据文件（一个守卫看两边）。

为什么需要它：转码与改写的**扫描范围曾经不一致**，于是反复出现「文件已经压好了，
引用却还指着原图」—— 2026-09-30 一天之内撞了三次：
  · `public/insp/data.json` / `public/diary-book/index.html`（**不是**被源码引用的，
    是运行时 fetch 的正式内容与独立页面）—— 上一轮的改写器只扫 `src/`，整类漏掉；
  · `src/lib/carousel/carousel-scene.ts` 还指着 `carousel-column.png`（494 KB），
    而同目录 `carousel-column.webp`（292 KB）已经躺着了；
  · `p05-keymsg-w1600.webp` / `p16-color-w1600.webp` 同理。
每一次都是「压了等于没压」。所以这个检查必须是**一个**工具、**一次**扫完。

两种模式：
    python scripts/rewrite-public-refs.py --check      # 只体检，不改
    python scripts/rewrite-public-refs.py              # 改写（逐条断言目标存在，全过了才落盘）
    python scripts/rewrite-public-refs.py --dry-run

体检回答两个问题：
  ① **有没有死链** —— 引用的文件是不是真的存在；
  ② **有没有该换没换的** —— 同目录/同名已经有更小的 `.webp`，引用却还指着 `.jpg/.png`。

改写规则，**只有目标 `.webp` 真的存在才动**：
  ① 相对该文件自身目录找 `<stem>.webp` / `<stem>__from{ext}.webp`（仅 `public/` 下的文件有意义）；
  ② 退化为**站内绝对路径**（`/insp/media/x.png` → `public/insp/media/x.webp`）；
  ③ 退化为**按纯文件名唯一匹配**（大量路径是模板串拼的，如 `asset('carousel-column.png')`）；
  ④ 同名出现多个（歧义）→ 跳过并在末尾列出，**绝不猜**。

⚠️ **改写是纯文本替换，注释里的文件名也会被改**（2026-09-30 实测：
   `src/index.css` 里一句「原来的 banner-sticker.png」被改成「原来的 banner-sticker.webp」——
   历史事实被改成了谎话）。所以**注释里写文件名时别带后缀**，或者别写「原来的 xxx」这种时态。
   反过来，如果注释里那个名字本身有价值，就把它写成 `banner-sticker` 这样的无后缀形式。
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PUB = REPO / "public"
SRC = REPO / "src"
SKIP_DIRS = {"frames", "frames-sm", "frames-avif", "frames-sm-avif", "og", "resume"}
# public/ 下要扫的文本文件
TEXT_EXTS = {".json", ".html", ".htm", ".css", ".js", ".mjs", ".webmanifest", ".txt"}
# src/ 下要扫的源码（`.css` 两边都算）
CODE_EXTS = {".ts", ".tsx", ".js", ".mjs", ".css", ".json", ".html"}
IMG_RE = re.compile(r"([A-Za-z0-9_\-/.]+\.(?:jpg|jpeg|png))(?![A-Za-z0-9])", re.I)

# 按文件名建索引（键 = 小写文件名），供模板串场景兜底
BY_NAME: dict[str, list[Path]] = {}
# 所有 public 图片（含原图）按文件名 —— 只用来判断「这个引用到底存不存在」，
# 免得把 `src/` 里那些纯文件名的模板串误报成死链。
BY_ORIG: dict[str, list[Path]] = {}
for p in PUB.rglob("*"):
    if not p.is_file() or p.relative_to(PUB).parts[0] in SKIP_DIRS:
        continue
    BY_ORIG.setdefault(p.name.lower(), []).append(p)
    if p.suffix.lower() == ".webp":
        BY_NAME.setdefault(p.name.lower(), []).append(p)


def human(n: float) -> str:
    return f"{n/1048576:.2f} MB" if abs(n) >= 1048576 else f"{n/1024:.0f} KB"


def text_files() -> list[tuple[Path, Path | None]]:
    """返回 `(文件, 该文件相对 public 的目录)`；第二个为 `None` 表示它是 `src/` 下的代码。"""
    out: list[tuple[Path, Path | None]] = []
    for p in sorted(PUB.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in TEXT_EXTS:
            continue
        if p.relative_to(PUB).parts[0] in SKIP_DIRS:
            continue
        out.append((p, p.parent.relative_to(PUB)))
    for p in sorted(SRC.rglob("*")):
        if p.is_file() and p.suffix.lower() in CODE_EXTS:
            out.append((p, None))
    return out


def show(p: Path) -> str:
    try:
        return str(p.relative_to(REPO)).replace("\\", "/")
    except ValueError:
        return str(p).replace("\\", "/")


def resolve(ref: str, here: Path | None) -> Path | None:
    """返回该引用应改到的 `.webp` 绝对路径；找不到 / 有歧义返回 None。"""
    e = Path(ref).suffix.lstrip(".").lower()
    stem = Path(ref).name[: -(len(e) + 1)]
    names = (f"{stem}.webp", f"{stem}__from{e}.webp")
    if here is not None:
        for name in names:                       # ① 该文件自身目录（相对引用）
            cand = PUB / here / name
            if cand.exists():
                return cand
    for name in names:                           # ② 站内绝对路径
        cand = PUB / ref.lstrip("/").rsplit("/", 1)[0] / name
        if cand.exists():
            return cand
    for name in names:                           # ③ 纯文件名唯一匹配（模板串兜底）
        hits = BY_NAME.get(name.lower(), [])
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            return None                          # ④ 歧义：不猜
    return None


def scan(files: list[tuple[Path, Path | None]]):
    """返回 `(可改写的, 死链)`。死链 = 原图也不存在（那本来就已经坏了，如实报出来）。"""
    todo: list[tuple[Path, str, Path]] = []
    dead: list[tuple[Path, str]] = []
    for f, here in files:
        txt = f.read_text(encoding="utf-8", errors="replace")
        for m in IMG_RE.finditer(txt):
            ref = m.group(1)
            same = (PUB / here / ref) if here is not None else None
            absolute = PUB / ref.lstrip("/")
            exists = (same is not None and same.exists()) or absolute.exists()
            if not exists and here is None:
                exists = bool(BY_ORIG.get(Path(ref).name.lower()))   # src 里的纯文件名模板串
            if not exists:
                dead.append((f, ref))
                continue
            dst = resolve(ref, here)
            if dst is not None and dst.suffix.lower() == ".webp" and dst.exists():
                todo.append((f, ref, dst))
    return todo, dead


def original_of(f: Path, here: Path | None, ref: str) -> Path | None:
    for c in ((PUB / here / ref) if here is not None else None,
              PUB / ref.lstrip("/")):
        if c is not None and c.exists():
            return c
    hits = BY_ORIG.get(Path(ref).name.lower(), [])
    return hits[0] if len(hits) == 1 else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只体检，不改写")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    files = text_files()
    n_pub = sum(1 for _, h in files if h is not None)
    print(f"扫描 {len(files)} 个文件（public 文本 {n_pub} + src 源码 {len(files) - n_pub}）")
    todo, dead = scan(files)

    if dead:
        # ⚠️ `src/` 里的命中**大半是噪声**：注释与文档里到处是示例路径
        #    （`xxx.jpg`、`3.png`、`Clipboard_Screenshot-2.png`、`/frames/000N.jpg`），
        #    还有 Vite 会接管的 `src/assets/...`。所以标题写「疑似」，别照单全收。
        print(f"\n❓ 疑似失效引用 {len(dead)} 条（含注释里的示例路径，src 下的多半是噪声）：")
        for f, ref in dead[:20]:
            print(f"    {show(f)}  →  {ref}")

    by_file: dict[str, list[tuple[str, Path]]] = {}
    here_of = {f: h for f, h in files}
    saved = gain = 0
    for f, ref, dst in todo:
        key = show(f)
        by_file.setdefault(key, []).append((ref, dst))
        src = original_of(f, here_of[f], ref)
        if src:
            saved += 1
            gain += src.stat().st_size - dst.stat().st_size

    print(f"\n{'=' * 66}")
    if not todo:
        print("✅ 没有「该换没换」的引用 —— 全仓图片引用都指向最优后缀")
        return 0

    print(f"可改写 {saved} 处 / {len(by_file)} 个文件，这些替换共省 {human(gain)}：")
    for k, v in sorted(by_file.items(), key=lambda t: -len(t[1])):
        ex = v[0][0]
        print(f"  {k:<52} {len(v):>3} 处   例：{ex} → {ex[: -len(Path(ex).suffix)]}.webp")

    if args.check:
        return 0

    # 先算好新内容、逐条断言新路径存在，全部通过才落盘（别写到一半发现有问题）
    # ⚠️ 后缀替换必须走**字符串**，不能用 `Path(ref).with_suffix()`：
    #    引用是 URL 形状（`/insp/media/x.png`），Path 会把它当成本地盘路径，
    #    `with_suffix` 直接产出 `\insp\media\x.webp`（丢了开头的 `/`、还带反斜杠）。
    planned: list[tuple[Path, str, str, Path]] = []
    for f, ref, dst in todo:
        assert dst.exists(), f"目标不存在：{dst}"
        new = ref[: -len(Path(ref).suffix)] + ".webp"
        assert new.lower().endswith(".webp")
        planned.append((f, ref, new, dst))

    if args.dry_run:
        print("\n（--dry-run：没有写任何文件）")
        return 0

    per_file = Counter()
    for f, old, new, _dst in planned:
        txt = f.read_text(encoding="utf-8")
        # 只替换成对出现的那个引用（用正则边界，避免 foo.png 命中 foobar.png）
        new_txt = re.sub(r"(?<![A-Za-z0-9_])" + re.escape(old) + r"(?![A-Za-z0-9])", new, txt)
        if new_txt != txt:
            f.write_text(new_txt, encoding="utf-8")
            per_file[show(f)] += 1
    print(f"\n✅ 已改写 {sum(per_file.values())} 处：")
    for k, v in sorted(per_file.items(), key=lambda t: -t[1]):
        print(f"    {k}  ×{v}")

    # JSON 仍然可解析（data.json 是运行时 fetch 的，坏了整块面板就空）
    for f, _h in files:
        if f.suffix.lower() == ".json":
            try:
                json.loads(f.read_text(encoding="utf-8"))
            except Exception as e:
                print(f"❌ {show(f)} JSON 已损坏：{e}")
                return 1
    print("✅ 所有 JSON 仍可解析")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
