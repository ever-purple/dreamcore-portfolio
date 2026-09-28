"""把原始视频压成网页能直接用的版本（画质优先）。

原始素材问题：
  · 全是 HEVC(Main/Main10) —— 浏览器支持不一致，必须转 H.264
  · 动辄几百 MB —— 必须压，否则仓库和构建都扛不住
  · 横竖混排，所以横版限宽、竖版限高

产出（每条 **2** 个文件）：
  <slug>.mp4   横版 1920×? / 竖版 ?×1440，CRF 18，带音频，faststart
  <slug>.jpg   封面图：1280 长边，15% 处抽帧

⚠️ 2026-09-21 画质整改（用户：「怎么这么模糊，不要压缩画质」）
  旧版有**两个错误**，都在这条脚本里：
    ① 分辨率算错：注释写"长边 1080"，横版实际是 **宽 1080 ≈ 540p**。
       而卡片在 1440 视口下显示到 856 CSS px，画布按 DPR 2 分配背板 = **1712px** ——
       等于把 540p 放大 1.6 倍再看，这是"糊"的主因。
    ② 码率太低：CRF 26 压出 618~1188 kb/s（AI 那条 4K 源最惨，只有 618 kb/s）。
  现在：横版 1920 宽（真 1080p，略高于 1712 背板，始终降采样）、CRF 18（视觉近无损）。

⚠️ 取消了 `-preview.mp4`：那条"960 长边 + CRF 26 的静音预览"是低画质第二来源。
   现在列表里循环播放的**就是完整版本身**（静音），点播放只是解除静音、不再换源
   —— 少一半文件、少一次加载，且切播放时不会重新缓冲。

跑完直接看结尾的表格，确认体积达标。
只压某一条：
    python scripts/media-compress.py --only going-home
"""
import os
import re
import subprocess
import sys

import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
OUT = r'C:\Users\sunchenxi\WorkBuddy\2026-09-08-21-15-22\dreamcore-loader-home\public\media'
os.makedirs(OUT, exist_ok=True)

JOBS = [
    ('qixi', r'E:\KSI实习项目\七夕活动花絮.mp4'),
    ('yike-1020', r'E:\KSI实习项目\翼氪计划-香港实习生视频\1020 1920.mp4'),
    ('yike-0814', r'E:\KSI实习项目\翼氪计划-香港实习生视频\8月14日.mp4'),
    ('sanlitun', r'E:\KSI实习项目\三里屯 外交官 照片背后的故事\7月30日.mp4'),
    # AI 影像频道第一条（2026-09-21，channel:'ai'）—— HEVC 3874x2160
    ('going-home', r'C:\Users\sunchenxi\Desktop\今天不一起走了\明天也一起回家吧.mp4'),
]

# 只压某一条（其余已压好、别全部重跑时用）
ONLY = None
if '--only' in sys.argv:
    ONLY = sys.argv[sys.argv.index('--only') + 1]

# 画质参数 —— CRF 20 是"看着还是原片"和"体积能上线"的平衡点。
# 实测 CRF 18（1920 宽）会把 56s 的片子压到 50MB ≈ 7Mbps，5 条共 186MB：仓库和网络都扛不住；
# CRF 20 大约降到它的 60%，肉眼几乎无差。**要更狠的画质就把这里改成 18**，别动分辨率。
CRF = '20'
PRESET = 'medium'


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
jobs = [j for j in JOBS if ONLY is None or j[0] == ONLY]
if ONLY and not jobs:
    sys.exit(f'--only {ONLY}: JOBS 里没有这条（现有: {", ".join(j[0] for j in JOBS)}）')

for slug, src in jobs:
    if not os.path.exists(src):
        print(f'[skip] {slug}: 源片不存在 {src}', flush=True)
        continue
    w, h, secs = probe(src)
    vert = h > w
    # 横版限宽 1920（= 真 1080p，略高于画布背板 1712px，始终降采样 → 不糊）；
    # 竖版限高 1080：竖版卡在 1440 视口下只有约 250 CSS px 宽（背板 ~506px），
    # 再往上纯粹是浪费体积（1440 高实测让两条竖片各涨到 21/30MB，降到 1080 掉一半）。
    vf = 'scale=-2:1080' if vert else 'scale=1920:-2'

    full = os.path.join(OUT, slug + '.mp4')
    post = os.path.join(OUT, slug + '.jpg')

    run([FF, '-y', '-i', src,
         '-vf', vf, '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF,
         '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
         '-c:a', 'aac', '-b:a', '192k', full])

    # 封面：跳过片头黑场，取 15% 处
    run([FF, '-y', '-ss', str(secs * 0.15), '-i', full,
         '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', post])

    report.append((slug, vert, f'{w}x{h}', f'{secs:.0f}s',
                   os.path.getsize(full) // 1024,
                   os.path.getsize(post) // 1024))
    print(slug, 'done', flush=True)

print()
print(f'{"slug":<12}{"方向":<6}{"原始":<12}{"时长":<6}{"mp4(KB)":>10}{"jpg(KB)":>9}')
for r in report:
    print(f'{r[0]:<12}{"竖" if r[1] else "横":<6}{r[2]:<12}{r[3]:<6}{r[4]:>10}{r[5]:>9}')
print('总 MB:', sum(r[4] + r[5] for r in report) // 1024)
