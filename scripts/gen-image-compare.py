#!/usr/bin/env python3
"""生成「原图 vs 新 WebP」的擦除对比页（自包含 HTML，双击即可打开）。

为什么做这个：用户对画质的要求是「肉眼看不出差别」，这是**主观**判据，不能只拿
SSIM/PSNR 交差。这个页面把两种编码的**同位置裁切**叠起来拖滑杆擦除，还能放大到
3× 盯高频细节 —— 眼睛直接投票。

画质保真上的两条讲究（否则量具本身会污染判读）：
1. **原图一侧一律转成 PNG 再内联**。JPEG 原图若「再存一次 JPEG」就是额外压一代，
   看到的差异有一半是量具自己造的。PNG 无损，等于原样搬运。
2. **新 WebP 一侧用 lossless WebP 重存**。同样是无损，且浏览器原生渲染。
   （PIL 存 WebP 的默认 quality=80，不显式写 lossless 就会偷偷再压一代。）

用法：
    python scripts/gen-image-compare.py
    python scripts/gen-image-compare.py --pick works/guanxia/p30-questionnaire,media/photo-nutrition-express
    python scripts/gen-image-compare.py --out image-compare.html
"""

from __future__ import annotations

import argparse
import base64
import io
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
PUB = REPO / "public"

CROP_W, CROP_H = 560, 350

# 默认抽样：覆盖「照片 / alpha 贴纸 / 纸张纹理 / 3D 贴图 / 品牌图」五类，
# 并优先挑体积收益最大的（差异最可能露出来的地方）。
DEFAULT_PICK = [
    "works/guanxia/p30-questionnaire",
    "works/guanxia/p25-tail",
    "works/guanxia/p11-theme",
    "works/guanxia/p07-consumer",
    "journal/editor/note-collage-tall",
    "journal/editor/sticker-swirl-blue",
    "journal/papers/paper-dotnote",
    "media/photo-nutrition-express",
    "carousel/carousel-base",
    "about/banner-visual",
]


def originals_of(w: Path) -> list[Path]:
    """给定 `.webp`，返回它在磁盘上的原图（0/1/2 个）。"""
    stem = w.stem
    if stem.endswith("__frompng"):
        return [w.parent / (stem[: -len("__frompng")] + ".png")]
    if stem.endswith("__fromjpg"):
        return [w.parent / (stem[: -len("__fromjpg")] + ".jpg")]
    return [c for c in (w.parent / (stem + e) for e in (".jpg", ".jpeg", ".png")) if c.exists()]


def all_pairs() -> list[tuple[Path, Path]]:
    out = []
    for w in sorted(PUB.rglob("*.webp")):
        if w.parent.name.startswith("frames"):
            continue
        o = [c for c in originals_of(w) if c.exists()]
        if len(o) == 1:
            out.append((o[0], w))
    return out


def detail_xy(path: Path) -> tuple[int, int]:
    """挑「细节最多」的窗口（高通能量最大处）。差异只在高频露出来，
    拿一片平坦墙做对比等于什么都没测。"""
    import numpy as np
    from scipy.ndimage import uniform_filter

    with Image.open(path) as im:
        if im.width < CROP_W + 16 or im.height < CROP_H + 16:
            return (0, 0)
        g = np.asarray(im.convert("L"), dtype=np.float32)
    hp = np.abs(g - uniform_filter(g, 8))
    ii = np.pad(hp.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    H, W = g.shape
    best = (-1.0, 0, 0)
    for y in range(0, H - CROP_H, 32):
        for x in range(0, W - CROP_W, 32):
            s = ii[y + CROP_H, x + CROP_W] - ii[y, x + CROP_W] - ii[y + CROP_H, x] + ii[y, x]
            if s > best[0]:
                best = (float(s), y, x)
    return (best[2], best[1])


def crop_box(size: tuple[int, int], xy: tuple[int, int]) -> tuple[int, int, int, int]:
    x, y = xy
    cw, ch = min(CROP_W, size[0]), min(CROP_H, size[1])
    x = max(0, min(x, size[0] - cw))
    y = max(0, min(y, size[1] - ch))
    return (x, y, x + cw, y + ch)


def uri(path: Path, box: tuple[int, int, int, int]) -> str:
    with Image.open(path) as im:
        has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        im = im.convert("RGBA" if has_alpha else "RGB").crop(box)
        buf = io.BytesIO()
        if path.suffix.lower() == ".webp":
            im.save(buf, "WEBP", lossless=True, quality=100, method=6)
            mime = "image/webp"
        else:
            im.save(buf, "PNG", optimize=True)
            mime = "image/png"
    return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode()}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pick", default=",".join(DEFAULT_PICK),
                    help="逗号分隔的 public 内相对路径（去掉扩展名）")
    ap.add_argument("--out", type=Path, default=REPO / "image-compare.html")
    args = ap.parse_args()

    pairs = all_pairs()
    by_stem = {str(w.relative_to(PUB).with_suffix("")).replace("\\", "/"): (o, w) for o, w in pairs}

    panels = []
    for key in [k.strip() for k in args.pick.split(",") if k.strip()]:
        if key not in by_stem:
            print(f"  跳过 {key}（找不到新旧配对）")
            continue
        o, w = by_stem[key]
        xy = detail_xy(o)
        with Image.open(o) as im:
            box = crop_box(im.size, xy)
        with Image.open(w) as im:
            ww, hh = im.size
        panels.append({
            "name": key, "box": box, "ow": ww, "oh": hh,
            "old": uri(o, box), "new": uri(w, box),
            "old_kb": round(o.stat().st_size / 1024, 1),
            "new_kb": round(w.stat().st_size / 1024, 1),
            "kind": o.suffix.lower().lstrip("."),
        })
        print(f"  {key}  细节窗 {xy}")

    tot_old = sum(o.stat().st_size for o, _ in pairs)
    tot_new = sum(w.stat().st_size for _, w in pairs)
    top = sorted(pairs, key=lambda t: t[0].stat().st_size - t[1].stat().st_size, reverse=True)[:18]

    h = [
        "<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width,initial-scale=1'>",
        "<title>原图 vs 新 WebP · 擦除对比</title><style>",
        """
:root{--bg:#121013;--fg:#f3ece7;--dim:#a99f9a;--line:#2f2831;--accent:#e8c07d}
*{box-sizing:border-box}
body{margin:0;padding:28px 20px 64px;background:var(--bg);color:var(--fg);
  font:14px/1.65 ui-sans-serif,"PingFang SC","Microsoft YaHei",sans-serif}
h1{font-size:20px;margin:0 0 6px;font-weight:600}
h2{font-size:15px;margin:34px 0 10px;font-weight:600;color:var(--dim)}
.sub{color:var(--dim);margin:0 0 20px;font-size:13px;max-width:820px}
.tabs{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.tab{padding:6px 13px;border:1px solid var(--line);border-radius:999px;cursor:pointer;
  background:transparent;color:var(--dim);font:inherit;font-size:12.5px}
.tab[aria-selected=true]{border-color:var(--accent);color:var(--accent)}
.stagewrap{overflow:auto;padding-bottom:8px}
/* .stage 上**不能**加 max-width:100% —— 放大靠显式 width 撑开，被夹住滑杆切了等于没切 */
.stage{position:relative;border:1px solid var(--line);border-radius:10px;overflow:hidden;
  background:#000;cursor:ew-resize;user-select:none;touch-action:none}
.stage img{display:block;width:100%;height:auto;image-rendering:pixelated}
.layer{position:absolute;inset:0}
.layer img{width:100%;height:100%;object-fit:cover}
.handle{position:absolute;top:0;bottom:0;width:2px;background:var(--accent);pointer-events:none;
  box-shadow:0 0 12px rgba(232,192,125,.75)}
.handle::after{content:'';position:absolute;top:50%;left:50%;width:30px;height:30px;
  transform:translate(-50%,-50%);border:2px solid var(--accent);border-radius:50%;
  background:rgba(18,16,19,.55)}
.badge{position:absolute;top:10px;padding:3px 9px;border-radius:6px;font-size:12px;
  background:rgba(0,0,0,.62);border:1px solid var(--line);pointer-events:none}
.badge.l{left:10px}.badge.r{right:10px}
.ctl{display:flex;gap:14px;align-items:center;margin:14px 0 4px;flex-wrap:wrap}
.ctl label{color:var(--dim);font-size:13px}
input[type=range]{flex:1;min-width:180px;accent-color:var(--accent)}
table{border-collapse:collapse;margin-top:10px;font-size:13px;width:100%;max-width:860px}
th,td{text-align:left;padding:6px 12px;border-bottom:1px solid var(--line)}
th{color:var(--dim);font-weight:500}
td.n{font-variant-numeric:tabular-nums;text-align:right}
.good{color:#8fd694}
.note{margin-top:24px;color:var(--dim);font-size:12.5px;max-width:820px}
.note b{color:var(--fg)}
""",
        "</style></head><body>",
        "<h1>原图 vs 新 WebP · 擦除对比</h1>",
        f"<p class='sub'>同一张图的同位置裁切叠在一起，拖滑杆擦除。<b>左＝原图，右＝新 WebP</b>。"
        f"两边都是无损内联（原图存 PNG、WebP 存 lossless），所以看到的差异就是编码差异本身，"
        f"不是显示环节又压了一代。</p>",
        "<div class='tabs' role='tablist'>",
    ]
    for i, p in enumerate(panels):
        sel = "true" if i == 0 else "false"
        h.append(f"<button class='tab' role='tab' aria-selected='{sel}' data-i='{i}'>"
                 f"{p['name'].split('/')[-1]} · {p['new_kb']/p['old_kb']:.0%}</button>")
    h.append("</div>")

    for i, p in enumerate(panels):
        hidden = "" if i == 0 else " style='display:none'"
        h.append(
            f"<section class='stagewrap' data-i='{i}'{hidden}>"
            f"<div class='stage'><img class='under' alt='' src='{p['old']}'>"
            f"<div class='layer'><img alt='' src='{p['new']}'></div>"
            f"<div class='layer nx' style='clip-path:inset(0 0 0 50%)'>"
            f"<img alt='' src='{p['new']}'></div>"
            f"<div class='handle' style='left:50%'></div>"
            f"<span class='badge l'>原图 {p['kind'].upper()} {p['old_kb']} KB</span>"
            f"<span class='badge r'>新 WebP {p['new_kb']} KB</span>"
            f"</div></section>"
        )

    h += [
        "<div class='ctl'><label>擦除</label><input type='range' min='0' max='100' value='50' id='wipe'>",
        "<label>放大</label><select id='zoom'>"
        "<option value='100'>1:1</option><option value='150'>1.5×</option>"
        "<option value='200'>2×</option><option value='300'>3×</option></select></div>",
        "<h2>这张对比用了什么尺寸</h2>",
        "<table><tr><th>图</th><th>原图尺寸</th><th>裁切窗</th></tr>",
    ]
    for p in panels:
        x, y, x2, y2 = p["box"]
        h.append(f"<tr><td>{p['name']}</td><td class='n'>{p['ow']}×{p['oh']}</td>"
                 f"<td class='n'>{x2 - x}×{y2 - y} @ ({x},{y})</td></tr>")
    h.append("</table>")

    h.append(f"<h2>省得最多的 18 张（共 {len(pairs)} 张成功转码）</h2>")
    h.append("<table><tr><th>图</th><th>原图</th><th>新 WebP</th><th>体积比</th></tr>")
    for o, w in top:
        ob, nb = o.stat().st_size, w.stat().st_size
        h.append(f"<tr><td>{str(w.relative_to(PUB)).replace(chr(92), '/')}</td>"
                 f"<td class='n'>{ob/1024:.1f} KB</td><td class='n'>{nb/1024:.1f} KB</td>"
                 f"<td class='n good'>{nb/ob:.0%}</td></tr>")
    h.append(f"<tr><td><b>全部 {len(pairs)} 张</b></td><td class='n'>{tot_old/1048576:.2f} MB</td>"
             f"<td class='n'>{tot_new/1048576:.2f} MB</td>"
             f"<td class='n good'>{tot_new/tot_old:.1%}</td></tr></table>")

    h += [
        "<p class='note'><b>怎么判读：</b>把滑杆拖到任意位置，两边应该看不出接缝。"
        "想抓差异就切到 3× 放大，盯着文字边缘 / 贴纸轮廓 / 渐变过渡这类高频处。"
        "<br><b>注意：</b>放大到 200% 以上看到的是「像素级差异」，而实际浏览时这些图"
        "多以缩略图或整屏铺满的形式出现，且常常在滚动中掠过 —— 放大后能察觉的轻微软化"
        "并不等于实际观看时看得见。"
        "<br><b>反过来说：</b>如果在 1:1 下就已经能一眼看出差别，那就是不合格，直接说。</p>",
        """<script>
const stages=[...document.querySelectorAll('.stagewrap')];
const wipe=document.getElementById('wipe'),zoom=document.getElementById('zoom');
let cur=0;
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
  cur=+t.dataset.i;
  document.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-selected',x===t));
  stages.forEach(s=>s.style.display=(+s.dataset.i===cur)?'':'none');
  apply();
}));
function apply(){
  const s=stages[cur],pct=wipe.value;
  s.querySelector('.handle').style.left=pct+'%';
  s.querySelector('.layer.nx').style.clipPath='inset(0 0 0 '+pct+'%)';
  const z=+zoom.value/100;
  s.querySelector('.stage').style.width=(560*z)+'px';
}
[wipe,zoom].forEach(e=>e.addEventListener('input',apply));
window.addEventListener('resize',apply);
apply();
</script></body></html>""",
    ]

    args.out.write_text("".join(h), encoding="utf-8")
    print(f"写出 {args.out}  ({args.out.stat().st_size/1048576:.2f} MB, {len(panels)} 张对比)")
    print(f"  全部 {len(pairs)} 张：{tot_old/1048576:.2f} MB → {tot_new/1048576:.2f} MB "
          f"({tot_new/tot_old:.1%})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
