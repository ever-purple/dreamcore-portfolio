"""生成封面图响应式变体（保留原图）。

对 public/works 下所有 *.jpg：
  - <name>-w1600.jpg  max 宽 1600（首屏大图 + 详情页步骤图用，2x 视网膜够清晰）
  - <name>-w640.jpg   max 宽 640 （木马相框 frameTexture 源，画进 512px canvas 绰绰有余）

原图不动。变体文件名带后缀，代码里改指向即可。
"""
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), 'public', 'works')
SIZES = {'w1600': 1600, 'w640': 640}


def make_variant(src, max_w, qual):
    name, ext = os.path.splitext(src)
    out = f'{name}-w{max_w}{ext}'
    if os.path.exists(out):
        return 'skip'
    with Image.open(src) as im:
        im = im.convert('RGB')
        if im.width > max_w:
            h = round(im.height * max_w / im.width)
            im = im.resize((max_w, h), Image.LANCZOS)
        im.save(out, 'JPEG', quality=qual, optimize=True, progressive=True)
    return 'ok'


def main():
    total = 0
    made = 0
    for dp, _, fns in os.walk(ROOT):
        for fn in fns:
            if not fn.lower().endswith('.jpg') or '-w' in fn:
                continue
            src = os.path.join(dp, fn)
            total += 1
            for tag, w in SIZES.items():
                r = make_variant(src, w, 82 if w >= 1600 else 80)
                if r == 'ok':
                    made += 1
    print(f'done: scanned={total} variants_generated={made}')


if __name__ == '__main__':
    main()
