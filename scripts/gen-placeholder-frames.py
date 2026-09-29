"""把「首页首帧」/「工作室海报」/「About 底色图案」压成 WebP 并 base64 内联。

目的：用户明确要求「垫一帧」——图还没从网络下来时，画布/背景层必须有一个
零延迟的兜底画面，而不是黑屏或纯色。

⚠️ **这不是一次性脚本，是素材生成器。** 改了 `public/` 里的对应源图，或者改了下面
SPECS 的尺寸/质量，都要重跑它来重生成 `src/lib/placeholderFrames.ts`。

-------------------------------------------------------------------------------
2026-09-29 第二轮：用户报「垫一帧也太糊了」—— 三张图的分辨率全部上调
-------------------------------------------------------------------------------
第一版压得很小（首页 480×271 q48，合计 12.5KB），理由是「反正只是过渡一下」。
这个理由**站不住**：用户的实际画布是 **2506px 宽**（CSS 1253 × dpr 2），
480px 的图拉满屏是 **5.2 倍上采样**，糊得非常明显；而且兜底图在慢网下不是
「闪一下」，是**真·要看上一段时间**（工作室那条 2.48MB 的视频线上只有 ~30KB/s）。

实测（上采样回 2560 宽、与源图比 PSNR）：

    首页首帧   480×271  q48   3.2 KB   35.1 dB   ← 糊
               1920×1082 q52  18.6 KB  43.1 dB   ← 只多 15KB，+8dB
    工作室海报  480×270  q48   5.2 KB   34.0 dB
               1280×720  q55  22.9 KB  38.0 dB   （源图本身只有 1280×720，38dB 已是上限）
     About图案  480×270  q48   1.3 KB   37.7 dB
               1280×719  q55   7.1 KB   40.6 dB

结论：**分辨率是糊的原因，不是质量参数。** 这些帧是暗调、低细节的画面，WebP
在低质量参数下依然压得极狠 —— 把宽度提 4 倍只要 15KB，把 q 从 48 提到 55 几乎不要钱。
所以现在的策略是「**宽度给足、q 给到刚好**」。
"""
import base64
import io
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "placeholderFrames.ts")

SPECS = [
    # (源文件, 输出宽度, 质量, 导出的常量名, 注释)
    # 宽度按「用户画布 2506px」定：给到 1920/1600 这一档，剩下的 1.3~1.6 倍
    # 交给浏览器上采样（这个倍率下几乎看不出软），同时把内联总量压在 ~60KB。
    ("public/frames/0001.webp", 1920, 52, "HOME_FIRST_FRAME",
     "首页序列帧第 1 帧的缩略版（真实帧到位前铺在 canvas 上）"),
    ("public/studio/studio-poster.jpg", 1600, 55, "STUDIO_POSTER",
     "工作室海报缩略版（video 缓冲期间铺在背景层上）"),
    ("public/about/bg-pattern.webp", 1280, 55, "ABOUT_BG_PATTERN",
     "About 页底色图案缩略版（真实图案 174KB 到位前的兜底）"),
]


def encode(rel_path: str, width: int, quality: int) -> tuple[str, int, int, int]:
    src = os.path.join(ROOT, rel_path)
    im = Image.open(src).convert("RGB")
    ow, oh = im.size
    height = max(1, round(oh * width / ow))
    im = im.resize((width, height), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6)
    raw = buf.getvalue()
    b64 = base64.b64encode(raw).decode("ascii")
    return b64, len(raw), width, height


def main() -> None:
    lines = [
        "/* 由 scripts/gen-placeholder-frames.py 生成，请勿手改 —— 改图请改脚本后重跑。",
        " *",
        " * 为什么内联而不是放 public/ 走网络：",
        " * 线上实测跨境链路只有约 430 KB/s（单帧 108 KB 要 0.99 s）。首屏/背景层",
        " * 在真实素材到位前的这段时间里，如果什么都不画就是黑屏或纯色空白 ——",
        " * 用户报的「背景出不来」正是这一段。内联进 bundle 的图随 JS 一起到达，",
        " * 零请求、零等待，可以立刻铺上，随后被真实帧自然覆盖。",
        " */",
        "",
    ]

    total_raw = 0
    for rel, width, quality, name, note in SPECS:
        b64, raw_len, w, h = encode(rel, width, quality)
        total_raw += raw_len
        lines.append(f"/** {note} —— {rel} → {w}×{h} WebP q{quality}，{raw_len / 1024:.1f} KB */")
        lines.append(f"export const {name} = 'data:image/webp;base64,{b64}';")
        lines.append("")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    size = os.path.getsize(OUT)
    print(f"写入 {OUT}")
    print(f"  内联原始字节合计 {total_raw} B ({total_raw / 1024:.1f} KB)")
    print(f"  产出的 TS 文件 {size} B ({size / 1024:.1f} KB)，base64 膨胀率 {size / total_raw:.2f}x")


if __name__ == "__main__":
    main()
