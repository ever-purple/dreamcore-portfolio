#!/usr/bin/env bash
# 三个 78~84MB / 150 万面 原始 GLB → 网页可用体积。
#
# 踩过的坑：
#  ① `resize` **不支持 --slots**（只有 webp 支持），所以贴图只能整体统一尺寸。
#  ② **meshopt 必须是最后一步**：gltf-transform 读 meshopt 文件时会解码，
#     之后任何写命令都会输出未压缩结果 —— 上一版被 prune 坑了，1.41MB 变回 2.77MB。
#  ③ 贴图尺寸取 768 就够：设备在屏幕上约 60px 高（世界单位 0.25 / 相机视野 3.32），
#     768 已是 12 倍富余；再大只是白烧显存和流量。
set -u
export PATH="/c/Program Files/Git/usr/bin:$PATH"
NODE="C:/Users/sunchenxi/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
CLI="C:/Users/sunchenxi/.workbuddy/binaries/node/workspace/node_modules/@gltf-transform/cli/bin/cli.js"
OUT="C:/Users/sunchenxi/WorkBuddy/2026-09-08-21-15-22/dreamcore-loader-home/public/newsstand"
W="C:/Users/sunchenxi/WorkBuddy/2026-09-08-21-15-22/dreamcore-loader-home/_work"

run () { "$NODE" "$CLI" "$@" || { echo "!! FAILED: $*"; exit 1; }; }

for name in dvd dv mp3; do
  echo "=========== $name ==========="
  echo "[1/3] resize 全部贴图 -> 768"
  run resize "$W/$name.2.glb" "$W/$name.r.glb" --width 768 --height 768
  echo "[2/3] webp 全部贴图 q85"
  run webp "$W/$name.r.glb" "$W/$name.w.glb" --quality 85
  echo "[3/3] prune -> meshopt（meshopt 必须最后！）"
  run prune "$W/$name.w.glb" "$W/$name.p.glb"
  run meshopt "$W/$name.p.glb" "$OUT/$name.glb"
  ls -la "$OUT/$name.glb"
done
echo "ALL DONE"
