"""把已压好的成品 mp4 二次转码：保持分辨率/音频不变，仅把 CRF 从 18 调到 26。

背景（2026-09-30）：用户接受「CRF26 省 38%、画质轻度损失」的折中，批量压 9 个视频。
  原片已是 CRF18（1920 宽），这里**不做任何缩放**、只重编码视频流降 CRF，
  音频直接 copy（不重压），加 faststart。缩略图 jpg 不动。

用法：
    python scripts/media-recompress-crf26.py
    输出到 public/media/_crf26/ 目录，不覆盖原文件，压缩完由人工核对后再替换。
"""
import os
import subprocess
import sys

import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
MEDIA = r'C:\Users\sunchenxi\WorkBuddy\2026-09-08-21-15-22\dreamcore-loader-home\public\media'
OUT = os.path.join(MEDIA, '_crf26')
os.makedirs(OUT, exist_ok=True)

CRF = '26'
PRESET = 'medium'

# 9 个视频（与 public/media 下 *.mp4 一一对应）
SLUGS = [
    'butterfly', 'chunshanli-intro', 'chunshanli-summer', 'going-home',
    'hbn', 'qixi', 'sanlitun', 'yike-0814', 'yike-1020',
]

report = []
for slug in SLUGS:
    src = os.path.join(MEDIA, slug + '.mp4')
    if not os.path.exists(src):
        print(f'[skip] {slug}: 不存在 {src}', flush=True)
        continue
    dst = os.path.join(OUT, slug + '.mp4')

    # 只重编码视频流，音频 copy；不动分辨率、不动帧率
    cmd = [FF, '-y', '-i', src,
           '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF,
           '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
           '-c:a', 'copy', dst]
    r = subprocess.run(cmd, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print(f'[FAIL] {slug}: {r.stderr[-500:]}', flush=True)
        continue

    src_kb = os.path.getsize(src) // 1024
    dst_kb = os.path.getsize(dst) // 1024
    saved = (src_kb - dst_kb) / src_kb * 100
    report.append((slug, src_kb, dst_kb, saved))
    print(f'{slug}: {src_kb}KB -> {dst_kb}KB ({saved:.0f}%)', flush=True)

print()
print(f'{"slug":<20}{"原(KB)":>10}{"新(KB)":>10}{"省%":>8}')
for slug, s, d, p in report:
    print(f'{slug:<20}{s:>10}{d:>10}{p:>7.0f}%')
tot_s = sum(r[1] for r in report)
tot_d = sum(r[2] for r in report)
print(f'{"合计":<20}{tot_s:>10}{tot_d:>10}{(tot_s-tot_d)/tot_s*100:>7.0f}%')
