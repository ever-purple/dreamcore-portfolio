"""把 KSI 实习项目的 4 条原始视频压成网页能直接用的版本。

原始素材问题：
  · 全是 HEVC(Main10) —— 浏览器支持不一致，必须转 H.264
  · 共 333MB —— 必须压，否则仓库和构建都扛不住
  · 横竖混排（2 条 9:16 竖版 / 2 条 16:9 横版），所以按长边统一到 1080，短边自适应

产出（每条 3 个文件）：
  <slug>.mp4          完整版：1080 长边、CRF 26、带音频、faststart
  <slug>-preview.mp4  列表预览：960 长边、CRF 26、**无音轨**（静音循环用）
  <slug>.jpg          封面图：15% 处抽帧

⚠️ 预览**不能压太小**：列表里横版卡片实测显示到 835×470（1440 视口），
   早期用 540 长边 + CRF 32 会被放大 1.5 倍再叠压缩块，糊得不能看（2026-09-15 用户反馈）。
   960 长边略高于显示宽度，等于轻微降采样，是清晰度和体积的折中。

跑完直接看结尾的表格，确认体积达标。
只重出预览（完整版已经压好、只想提清晰度时）：
    python scripts/media-compress.py --preview-only
"""
import os
import re
import subprocess
import sys

import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
OUT = r'C:\Users\sunchenxi\WorkBuddy\2026-09-08-21-15-22\dreamcore-loader-home\public\media'
os.makedirs(OUT, exist_ok=True)
PREVIEW_ONLY = '--preview-only' in sys.argv

JOBS = [
    ('qixi', r'E:\KSI实习项目\七夕活动花絮.mp4'),
    ('yike-1020', r'E:\KSI实习项目\翼氪计划-香港实习生视频\1020 1920.mp4'),
    ('yike-0814', r'E:\KSI实习项目\翼氪计划-香港实习生视频\8月14日.mp4'),
    ('sanlitun', r'E:\KSI实习项目\三里屯 外交官 照片背后的故事\7月30日.mp4'),
]


def probe(path):
    r = subprocess.run([FF, '-i', path], capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    m = re.search(r'Video:.*? (\d{2,5})x(\d{2,5})', r.stderr)
    d = re.search(r'Duration: (\d+):(\d+):([\d.]+)', r.stderr)
    w, h = int(m.group(1)), int(m.group(2))
    secs = int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3))
    return w, h, secs


def run(args):
    subprocess.run(args, check=True, capture_output=True)


report = []
for slug, src in JOBS:
    w, h, secs = probe(src)
    vert = h > w
    # 长边 1080；竖版限高、横版限宽。-2 保证偶数（H.264 要求）
    full_vf = 'scale=-2:1080' if vert else 'scale=1080:-2'
    # 预览长边 960 —— 见文件头注释：再小列表里就糊了
    prev_vf = 'scale=-2:960' if vert else 'scale=960:-2'

    full = os.path.join(OUT, slug + '.mp4')
    prev = os.path.join(OUT, slug + '-preview.mp4')
    post = os.path.join(OUT, slug + '.jpg')

    if not PREVIEW_ONLY:
        # 完整版（--preview-only 时跳过：它已经压好了，重编要几分钟）
        run([FF, '-y', '-i', src,
             '-vf', full_vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '26',
             '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
             '-c:a', 'aac', '-b:a', '128k', full])

    run([FF, '-y', '-i', full, '-an',
         '-vf', prev_vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '26',
         '-pix_fmt', 'yuv420p', '-movflags', '+faststart', prev])

    # 封面：跳过片头黑场，取 15% 处
    run([FF, '-y', '-ss', str(secs * 0.15), '-i', full,
         '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', post])

    report.append((slug, vert, f'{w}x{h}', f'{secs:.0f}s',
                   os.path.getsize(full) // 1024,
                   os.path.getsize(prev) // 1024,
                   os.path.getsize(post) // 1024))
    print(slug, 'done', flush=True)

print()
print(f'{"slug":<12}{"方向":<6}{"原始":<12}{"时长":<6}{"full(KB)":>10}{"prev(KB)":>10}{"jpg(KB)":>9}')
for r in report:
    print(f'{r[0]:<12}{"竖" if r[1] else "横":<6}{r[2]:<12}{r[3]:<6}{r[4]:>10}{r[5]:>10}{r[6]:>9}')
print('总 MB:', sum(r[4] + r[5] + r[6] for r in report) // 1024)
