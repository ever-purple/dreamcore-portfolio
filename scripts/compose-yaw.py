"""把 _yaw_{tag}_{yaw}.png 拼成「一行四角度」对比图并标注角度。

配合 scripts/yawscan-device-facing.mjs 使用：先跑扫描出图，再跑本脚本拼图。
用法：python scripts/compose-yaw.py
输出：_yawgrid_{dvd,dv,mp3}.jpg
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
YAW = [0, 90, 180, 270]
DEVICES = [("dvd", "DVD player"), ("dv", "DV camcorder"), ("mp3", "MP3 player")]
TILE_H = 620

for tag, name in DEVICES:
    tiles = []
    for yaw in YAW:
        p = os.path.join(ROOT, f"_yaw_{tag}_{yaw}.png")
        if not os.path.exists(p):
            print("missing", p)
            continue
        im = Image.open(p).convert("RGB")
        w = max(1, round(im.width * TILE_H / im.height))
        tiles.append((yaw, im.resize((w, TILE_H), Image.LANCZOS)))
    if not tiles:
        continue

    PAD, LABEL = 14, 54
    total_w = sum(t[1].width for t in tiles) + PAD * (len(tiles) + 1)
    total_h = TILE_H + PAD * 2 + LABEL
    grid = Image.new("RGB", (total_w, total_h), (22, 22, 26))
    d = ImageDraw.Draw(grid)
    d.text((PAD, 16), f"{name}  -- rotate about Y (front facing?)", fill=(255, 235, 120))
    x = PAD
    for yaw, im in tiles:
        d.text((x + 8, PAD + LABEL - 30), f"yaw = {yaw}", fill=(140, 230, 180))
        grid.paste(im, (x, PAD + LABEL))
        x += im.width + PAD

    out = os.path.join(ROOT, f"_yawgrid_{tag}.jpg")
    grid.save(out, quality=90)
    print(out, grid.size, os.path.getsize(out), "bytes", f"({name})")
