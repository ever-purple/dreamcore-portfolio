#!/usr/bin/env python3
"""
手账编辑器 · 相框类素材生成器
=============================================================================
用户 2026-09-23：「这个不是便签纸，是照片边框，适合放多张照片的场景」
—— 原素材库把 `gen-polaroid-frame.png`（拍立得白框）塞在「便签纸」组里，
   而且只有单张的。这里补上多格相框，并统一到新的「相框」组。

配色与 `gen-polaroid-frame.png` 对齐（实测采样）：
  · 卡纸白 #FBF9F4（该图底部留白 251,249,244）
  · 照片占位暖灰 #E2DCD0 → #D8D2C6（该图内框 226,220,208 → 218,212,200）
  · 柔和投影 rgba(28,19,12,.35)

输出（透明底 PNG，直接当贴纸拖进手账）：
  gen-frame-duo.png      双联相框 —— 左右两张竖构图
  gen-frame-quad.png     四格相框 —— 2×2 网格（一次放四张）
  gen-film-strip.png     胶片条相框 —— 横排三格 + 齿孔

用法：python scripts/gen-diary-frames.py
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "journal", "editor")

SS = 4  # 超采样倍数：PIL 没有抗锯齿，放大画完再缩小是最稳的

CARD = (251, 249, 244, 255)
SLOT_TOP = (230, 224, 212, 255)
SLOT_BOT = (214, 208, 196, 255)
SHADOW = (28, 19, 12, 86)
FILM_BODY = (38, 34, 30, 255)
FILM_HOLE = (251, 249, 244, 255)


def _rounded(size, radius, fill):
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=fill)
    return im


def _slot(size, radius, top=SLOT_TOP, bot=SLOT_BOT):
    """照片占位：上浅下深的竖向渐变，看起来像"这里有张照片"。"""
    grad = Image.new("RGBA", (1, size[1]))
    px = grad.load()
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        px[0, y] = tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(4))
    grad = grad.resize(size, Image.BILINEAR)
    mask = _rounded(size, radius, (255, 255, 255, 255)).getchannel("A")
    grad.putalpha(mask)
    return grad


def _drop_shadow(shape, blur, offset, color=SHADOW):
    """按 shape 的 alpha 生成投影，返回一层同尺寸 RGBA。"""
    a = shape.getchannel("A").point(lambda v: min(255, int(v * color[3] / 255)))
    sh = Image.new("RGBA", shape.size, color[:3] + (0,))
    sh.putalpha(a)
    pad = blur * 3
    big = Image.new("RGBA", (shape.size[0] + pad * 2, shape.size[1] + pad * 2), (0, 0, 0, 0))
    big.alpha_composite(sh, (pad, pad))
    big = big.filter(ImageFilter.GaussianBlur(blur))
    out = Image.new("RGBA", shape.size, (0, 0, 0, 0))
    out.alpha_composite(big, (-pad + offset[0], -pad + offset[1]))
    return out


def _compose(card_box, radius, slots):
    """card_box: (w,h) 卡纸尺寸；slots: [(x,y,w,h,r), …] 在卡纸坐标系里（不带投影外扩）。"""
    pad = 26                      # 给投影留的外扩
    W, H = card_box
    full = (W + pad * 2, H + pad * 2)

    card = _rounded((W * SS, H * SS), radius * SS, CARD).resize((W, H), Image.LANCZOS)
    shadow = _drop_shadow(card, blur=5, offset=(0, 3))

    layer = Image.new("RGBA", full, (0, 0, 0, 0))
    layer.alpha_composite(shadow, (pad, pad))
    layer.alpha_composite(card, (pad, pad))
    for (x, y, w, h, r) in slots:
        s = _slot((w * SS, h * SS), r * SS).resize((w, h), Image.LANCZOS)
        layer.alpha_composite(s, (pad + x, pad + y))
    return layer


def make_duo():
    """双联相框：左右两张**竖构图**，中间一条卡纸白缝。"""
    w, h, pad, gap = 520, 352, 22, 18
    sw = (w - pad * 2 - gap) // 2
    sh = h - pad * 2
    return _compose((w, h), 8, [(pad, pad, sw, sh, 2), (pad + sw + gap, pad, sw, sh, 2)])


def make_quad():
    """四格相框：2×2，一次放四张（最常用的多图排版）。"""
    w, h, pad, gap = 480, 480, 22, 14
    sw = (w - pad * 2 - gap) // 2
    sh = (h - pad * 2 - gap) // 2
    slots = [(pad, pad, sw, sh, 2), (pad + sw + gap, pad, sw, sh, 2),
             (pad, pad + sh + gap, sw, sh, 2), (pad + sw + gap, pad + sh + gap, sw, sh, 2)]
    return _compose((w, h), 8, slots)


def make_film_strip():
    """胶片条：横排三格 + 上下齿孔，很有手账味。"""
    pad, top = 18, 26
    per_w, per_h, gap = 176, 128, 12
    w = pad * 2 + per_w * 3 + gap * 2
    h = top * 3 + per_h
    slots = [(pad + i * (per_w + gap), top + (h - top * 2 - per_h) // 2, per_w, per_h, 2) for i in range(3)]
    layer = _compose((w, h), 6, [])

    body = _rounded((w, h), 6, FILM_BODY)
    shadow = _drop_shadow(body, blur=5, offset=(0, 3))
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    out.alpha_composite(shadow, (26, 26))
    out.alpha_composite(body, (26, 26))

    holes = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(holes)
    hw, hh, step = 12, 9, 26
    n = (w - pad * 2) // step
    for i in range(n):
        x = 26 + pad + i * step + (w - pad * 2 - (n - 1) * step) // 2
        for y in (8, h - 8 - hh):
            hd.rounded_rectangle([x, 26 + y, x + hw, 26 + y + hh], radius=2, fill=FILM_HOLE)
    out.alpha_composite(holes)

    slots_img = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    for (x, y, sw_, sh_, r) in slots:
        s = _slot((sw_ * SS, sh_ * SS), r * SS).resize((sw_, sh_), Image.LANCZOS)
        slots_img.alpha_composite(s, (26 + x, 26 + y))
    out.alpha_composite(slots_img)
    return out


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    jobs = {
        "gen-frame-duo.png": make_duo,
        "gen-frame-quad.png": make_quad,
        "gen-film-strip.png": make_film_strip,
    }
    for name, fn in jobs.items():
        im = fn()
        path = os.path.join(OUT_DIR, name)
        im.save(path)
        print(f"  {name}  {im.width}×{im.height}")


if __name__ == "__main__":
    main()
