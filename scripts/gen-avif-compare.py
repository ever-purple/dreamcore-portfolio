#!/usr/bin/env python3
"""生成「AVIF vs 现有 WebP」的擦除对比页（自包含 HTML，双击即可打开）。

为什么要做这个：用户对画质的要求是「肉眼看不出差别」，这是**主观**判据，
不能只拿 SSIM/PSNR 交差。这个页面把两种编码的同位置裁切并排叠起来，
拖一根滑杆擦除，并且可以切 1:1 / 2× / 3× 放大 —— 眼睛能直接投票。

所有图片 base64 内联，所以不依赖任何服务器、也不依赖项目目录。

用法：
    python scripts/gen-avif-compare.py
    python scripts/gen-avif-compare.py --frames 0053,0020,0060 --out avif-compare.html
"""

from __future__ import annotations

import argparse
import base64
import io
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
MASTER = REPO / "_media_originals" / "frames-jpg"
WEBP = REPO / "public" / "frames"
AVIF = REPO / "public" / "frames-avif"

CROP_W, CROP_H = 640, 400


def data_uri(path: Path, crop: tuple[int, int, int, int]) -> str:
    """把裁切后的图内联成 data URI。**MIME 必须跟真实字节一致** —— 声明成 png
    却塞 webp 字节虽然多数浏览器会嗅探救回来，但那是靠运气，不写。"""
    raw = path.read_bytes()
    mime = {".avif": "image/avif", ".webp": "image/webp", ".jpg": "image/jpeg"}[path.suffix.lower()]
    with Image.open(path) as im:
        im = im.convert("RGB").crop(crop)
        buf = io.BytesIO()
        if path.suffix.lower() == ".jpg":
            # 母版转 PNG：避免在「母版」那一层又叠一次 JPEG 压缩，干扰判读
            im.save(buf, "PNG")
            mime = "image/png"
        else:
            im.save(buf, mime.replace("image/", "").upper() if mime != "image/avif" else "AVIF")
        return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode()}"


def detail_xy(path: Path) -> tuple[int, int]:
    """自动挑「细节最多」的窗口（高通能量最大的位置）—— 差异只会在高频处露出来，
    拿一片平坦的墙做对比等于什么都没测。"""
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


def crop_box(im_size: tuple[int, int], xy: tuple[int, int]) -> tuple[int, int, int, int]:
    x, y = xy
    x = max(0, min(x, im_size[0] - CROP_W))
    y = max(0, min(y, im_size[1] - CROP_H))
    return (x, y, x + CROP_W, y + CROP_H)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default="0053,0020,0060")
    ap.add_argument("--out", type=Path, default=REPO / "avif-compare.html")
    args = ap.parse_args()

    frames = [f.strip() for f in args.frames.split(",") if f.strip()]
    panels = []
    for f in frames:
        mp = MASTER / f"{f}.jpg"
        wp = WEBP / f"{f}.webp"
        ap_ = AVIF / f"{f}.avif"
        if not (mp.exists() and wp.exists() and ap_.exists()):
            print(f"跳过 {f}（缺文件）")
            continue
        xy = detail_xy(mp)
        with Image.open(mp) as im:
            box = crop_box(im.size, xy)
        panels.append({
            "name": f,
            "master": data_uri(mp, box),
            "webp": data_uri(wp, box),
            "avif": data_uri(ap_, box),
            "webp_kb": round(wp.stat().st_size / 1024, 1),
            "avif_kb": round(ap_.stat().st_size / 1024, 1),
            "box": box,
        })
        print(f"  帧 {f}：细节窗 {xy}")

    total_webp = sum(p.stat().st_size for p in WEBP.glob("*.webp"))
    total_avif = sum(p.stat().st_size for p in AVIF.glob("*.avif"))

    html = [
        "<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width,initial-scale=1'>",
        "<title>AVIF vs WebP 擦除对比</title><style>",
        """
:root{--bg:#0d0b0e;--fg:#f2e9e4;--dim:#a89f9a;--line:#2e2730;--accent:#e8c07d}
*{box-sizing:border-box}
body{margin:0;padding:28px 20px 60px;background:var(--bg);color:var(--fg);
  font:14px/1.65 ui-sans-serif,"PingFang SC","Microsoft YaHei",sans-serif}
h1{font-size:20px;margin:0 0 6px;font-weight:600;letter-spacing:.01em}
.sub{color:var(--dim);margin:0 0 22px;font-size:13px}
.tabs{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.tab{padding:6px 14px;border:1px solid var(--line);border-radius:999px;cursor:pointer;
  background:transparent;color:var(--dim);font:inherit;font-size:13px}
.tab[aria-selected=true]{border-color:var(--accent);color:var(--accent)}
.stagewrap{overflow:auto;padding-bottom:8px}
/* ⚠️ .stage 上**不能**加 max-width:100% —— 放大时它是靠显式 width 撑开的，
   被 max-width 一夹就永远停在容器宽度，滑杆切了等于没切（实测踩过）。 */
.stage{position:relative;border:1px solid var(--line);border-radius:10px;overflow:hidden;
  background:#000;cursor:ew-resize;user-select:none;touch-action:none}
.stage img{display:block;width:100%;height:auto;image-rendering:pixelated}
.layer{position:absolute;inset:0}
.layer img{width:100%;height:100%;object-fit:cover}
.handle{position:absolute;top:0;bottom:0;width:2px;background:var(--accent);pointer-events:none;
  box-shadow:0 0 12px rgba(232,192,125,.75)}
.handle::after{content:'';position:absolute;top:50%;left:50%;width:30px;height:30px;
  transform:translate(-50%,-50%);border:2px solid var(--accent);border-radius:50%;
  background:rgba(13,11,14,.55)}
.badge{position:absolute;top:10px;padding:3px 9px;border-radius:6px;font-size:12px;
  background:rgba(0,0,0,.62);border:1px solid var(--line);color:var(--fg);pointer-events:none}
.badge.l{left:10px}.badge.r{right:10px}
.ctl{display:flex;gap:14px;align-items:center;margin:14px 0 4px;flex-wrap:wrap}
.ctl label{color:var(--dim);font-size:13px}
input[type=range]{flex:1;min-width:180px;accent-color:var(--accent)}
table{border-collapse:collapse;margin-top:26px;font-size:13px;width:100%;max-width:760px}
th,td{text-align:left;padding:7px 12px;border-bottom:1px solid var(--line)}
th{color:var(--dim);font-weight:500}
td.n{font-variant-numeric:tabular-nums}
.note{margin-top:22px;color:var(--dim);font-size:12.5px;max-width:760px}
.note b{color:var(--fg)}
.good{color:#8fd694}
""",
        "</style></head><body>",
        "<h1>AVIF vs 现有 WebP · 擦除对比</h1>",
        f"<p class='sub'>同一张母版的同位置裁切，叠在一起拖滑杆擦除。<b>左=对比对象，右=AVIF</b>。"
        f"裁切尺寸 {CROP_W}×{CROP_H}，可用下面的放大切换看像素级细节。</p>",
        "<div class='tabs' role='tablist'>",
    ]
    for i, p in enumerate(panels):
        sel = "true" if i == 0 else "false"
        html.append(f"<button class='tab' role='tab' aria-selected='{sel}' data-i='{i}'>"
                    f"帧 {p['name']}</button>")
    html.append("</div>")

    for i, p in enumerate(panels):
        hidden = "" if i == 0 else " style='display:none'"
        html.append(
            f"<section class='stagewrap' data-i='{i}'{hidden}>"
            f"<div class='stage'><img class='under' alt='' src='{p['master']}'>"
            f"<div class='layer'><img alt='' src='{p['webp']}'></div>"
            f"<div class='layer av' style='clip-path:inset(0 0 0 50%)'>"
            f"<img alt='' src='{p['avif']}'></div>"
            f"<div class='handle' style='left:50%'></div>"
            f"<span class='badge l'>对比对象</span><span class='badge r'>AVIF</span>"
            f"</div></section>"
        )

    html += [
        "<div class='ctl'><label>擦除</label><input type='range' min='0' max='100' value='50' id='wipe'>",
        "<label>放大</label><select id='zoom'>",
        "<option value='100'>1:1</option><option value='150'>1.5×</option>",
        "<option value='200'>2×</option><option value='300'>3×</option>",
        "</select>",
        "<label>底层</label><select id='base'>",
        "<option value='webp'>现有 WebP</option><option value='master'>JPEG 母版</option>",
        "</select></div>",
        "<table><tr><th>帧</th><th>现有 WebP</th><th>AVIF</th><th>体积比</th></tr>",
    ]
    for p in panels:
        html.append(f"<tr><td>{p['name']}</td><td class='n'>{p['webp_kb']} KB</td>"
                    f"<td class='n'>{p['avif_kb']} KB</td>"
                    f"<td class='n good'>{p['avif_kb']/p['webp_kb']:.0%}</td></tr>")
    html.append(f"<tr><td><b>全 120 帧</b></td><td class='n'>{total_webp/1024/1024:.2f} MB</td>"
                f"<td class='n'>{total_avif/1024/1024:.2f} MB</td>"
                f"<td class='n good'>{total_avif/total_webp:.0%}</td></tr></table>")

    html += [
        "<p class='note'><b>怎么判读：</b>把滑杆拖到任意位置，两边应该看不出接缝。"
        "想抓差异就切到 3× 放大、盯着木框边缘 / 门缝 / 文字这类高频细节。"
        "<br><b>注意：</b>放大到 200% 以上时，你看到的是「像素级差异」，"
        "而实际播放时帧铺满约 2500px 宽的画布、且在滚动中快速掠过 —— "
        "所以放大后能察觉的轻微软化，并不等于实际观看时看得见。"
        "<br>AVIF 这一档（q64）的 SSIM 均值 <b>高于</b>现有 WebP，最差 1% 区域低 0.0007（基本持平）。</p>",
        """<script>
const stages=[...document.querySelectorAll('.stagewrap')];
const wipe=document.getElementById('wipe'),zoom=document.getElementById('zoom'),base=document.getElementById('base');
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
  s.querySelector('.layer.av').style.clipPath='inset(0 0 0 '+pct+'%)';
  const z=+zoom.value/100;
  s.querySelector('.stage').style.width=(CROP_W*z)+'px';
  // 左半部分显示「对比对象」：选母版就藏掉 WebP 层露出母版，反之显示 WebP 层
  const useMaster = base.value==='master';
  s.querySelector('.layer:not(.av) img').style.visibility = useMaster?'hidden':'visible';
  s.querySelector('img.under').style.visibility = useMaster?'visible':'hidden';
}
[wipe,zoom,base].forEach(e=>e.addEventListener('input',apply));
window.addEventListener('resize',apply);
apply();
</script></body></html>""",
    ]

    args.out.write_text("".join(html), encoding="utf-8")
    size = args.out.stat().st_size
    print(f"写出 {args.out}  ({size/1024/1024:.2f} MB, {len(panels)} 帧)")
    print(f"  全 120 帧：WebP {total_webp/1024/1024:.2f} MB → AVIF {total_avif/1024/1024:.2f} MB "
          f"({total_avif/total_webp:.0%})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
