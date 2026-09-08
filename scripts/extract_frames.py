import argparse
import os
import sys

try:
    import imageio.v3 as iio
    from PIL import Image
except ImportError as e:
    sys.stderr.write("Missing dependency: install imageio[ffmpeg] and Pillow.\n")
    raise


def extract_frames(video_path: str, out_dir: str, n_frames: int, width: int = 2560, quality: int = 95):
    os.makedirs(out_dir, exist_ok=True)

    meta = iio.immeta(video_path)
    fps = float(meta.get("fps", 30.0))
    duration = float(meta.get("duration", 0))
    if duration <= 0:
        # Fallback: count frames
        reader = iio.imiter(video_path)
        total_frames = sum(1 for _ in reader)
    else:
        total_frames = int(fps * duration)

    if total_frames <= 0:
        raise RuntimeError("Could not determine video frame count.")

    indices = [
        min(int(round(i * (total_frames - 1) / (n_frames - 1))), total_frames - 1)
        for i in range(n_frames)
    ]

    for i, idx in enumerate(indices):
        frame = iio.imread(video_path, index=idx)
        img = Image.fromarray(frame)
        w, h = img.size
        target_h = int(h * width / w)
        if width < w:
            img = img.resize((width, target_h), Image.LANCZOS)
        out_path = os.path.join(out_dir, f"{i + 1:04d}.jpg")
        # subsampling=0 keeps full 4:4:4 chroma → sharper text/edges at high quality
        img.save(out_path, "JPEG", quality=quality, optimize=True, subsampling=0)
        if i % 20 == 0:
            print(f"Saved {out_path} ({img.size[0]}x{img.size[1]})")

    print("Done")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract evenly spaced frames from a video.")
    parser.add_argument("video", help="Path to source video file.")
    parser.add_argument("out_dir", help="Output directory for frames.")
    parser.add_argument("count", type=int, help="Number of frames to extract.")
    parser.add_argument("--width", type=int, default=2560, help="Resize width (default 2560).")
    parser.add_argument("--quality", type=int, default=95, help="JPEG quality (default 95).")
    args = parser.parse_args()

    extract_frames(args.video, args.out_dir, args.count, args.width, args.quality)
