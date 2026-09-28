/**
 * GLB 压缩脚本 —— 以后换模型/重压都跑这个。
 *
 *   npm run compress:glb              # 按 scripts/glb.config.json 里的清单压
 *   node scripts/compress-glb.mjs 输入.glb 输出.glb [选项]
 *
 * 选项：
 *   --tex              连贴图一起转 WebP（默认开，除非 --notex）
 *   --lossless         WebP 无损。默认开 —— 实测 sharp 的 quality:100 不是无损，
 *                      只有显式 lossless:true 才是像素级一致（PSNR 99dB）
 *   --q 92             有损模式的画质，默认 92
 *   --nogeo            不动几何（只 dedup/weld/prune）
 *   --mode meshopt|draco
 *
 * 依赖（只在本地压模型时才需要，不影响网站运行）：
 *   npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions \
 *            draco3dgltf meshoptimizer sharp
 *
 * ── 踩过的坑，改脚本前先看 ──────────────────────────────────────────
 * 1. meshopt() 要传 MeshoptEncoder / MeshoptSimplifier（具体那两个导出），
 *    传整个 `import * as meshoptimizer` 会报 "encoder.reorderMesh is not a function"。
 * 2. 写入时也要 'meshopt.encoder'，光给解码器会在 prewrite 炸在 encodeFilterOct。
 * 3. sharp 的 webp `quality:100` 仍然有损（PSNR 36dB），要 lossless:true 才 99dB。
 * 4. 压几何对「本来就是 meshopt+量化过的」模型几乎不省体积 —— rack.glb 原来
 *    17.9MB → 17.14MB。它的大头是贴图（15.5MB / 17.9MB），所以真正的杠杆是贴图。
 * ──────────────────────────────────────────────────────────────────
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const { NodeIO } = await import('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP } = await import(
  '@gltf-transform/extensions'
);
const { dedup, prune, weld, draco, meshopt, textureCompress } = await import('@gltf-transform/functions');
const draco3d = (await import('draco3dgltf')).default;
const { MeshoptEncoder, MeshoptSimplifier } = await import('meshoptimizer');
const sharp = (await import('sharp')).default;
// three 自带的 meshopt 解码器（线上就是这个在解码），直接当依赖注入，省得再装包
const { MeshoptDecoder } = await import(
  pathToFileURL(
    path.join(projectRoot, 'node_modules/three/examples/jsm/libs/meshopt_decoder.module.js'),
  ).href
);

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const [input, output] = args.filter((a) => !a.startsWith('--'));

/* ---------------- 读配置清单 ---------------- */
const configPath = path.join(here, 'glb.config.json');
const useConfig = fs.existsSync(configPath) && !input;
const config = useConfig ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : null;
const jobs = config?.models ?? [];

const opt = {
  tex: flags.includes('--notex') ? false : true,
  lossless: !flags.includes('--lossless-off'),
  q: Number(args[args.indexOf('--q') + 1] ?? 92),
  nogeo: flags.includes('--nogeo'),
  mode: flags.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'meshopt',
};

const io = new NodeIO()
  .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });

function report(name, before, after, doc) {
  const root = doc.getRoot();
  let tris = 0;
  let verts = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      verts += pos.getCount();
      tris += (prim.getIndices() || pos).getCount() / 3;
    }
  }
  const texBytes = root
    .listTextures()
    .reduce((s, t) => s + (t.getImage()?.byteLength ?? 0), 0);
  const ratio = after / before;
  console.log(`\n===== ${name} =====`);
  console.log(`  输入 ${(before / 1048576).toFixed(2)}MB  →  输出 ${(after / 1048576).toFixed(2)}MB`);
  console.log(`  体积比 ${ratio.toFixed(3)}（${((1 - ratio) * 100).toFixed(1)}% ↓）`);
  console.log(`  三角形 ${tris.toLocaleString()}  顶点 ${verts.toLocaleString()}  贴图 ${(texBytes / 1048576).toFixed(2)}MB`);
  console.log(`  ${after < before ? '✅ 变小了' : '⚠️ 没变小，建议别替换原文件'}`);
}

async function runOne(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`跳过（文件不存在）：${src}`);
    return;
  }
  const before = fs.statSync(src).size;
  const doc = await io.read(src);

  const steps = [dedup(), weld({ tolerance: 1e-6 }), prune({ keepAttributes: false })];
  if (opt.tex) {
    steps.push(
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        quality: opt.q,
        lossless: opt.lossless,
      }),
    );
  }
  if (opt.mode === 'draco') steps.push(draco({ method: 'edgebreaker' }));
  else if (!opt.nogeo) steps.push(meshopt({ encoder: MeshoptEncoder, simplifier: MeshoptSimplifier, level: 'high' }));

  await doc.transform(...steps);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await io.write(dest, doc);
  report(path.basename(src), before, fs.statSync(dest).size, doc);
}

if (jobs.length > 0) {
  for (const m of jobs) await runOne(path.join(projectRoot, m.from), path.join(projectRoot, m.to));
} else if (input && output) {
  await runOne(input, output);
} else {
  console.error('用法：node scripts/compress-glb.mjs <输入.glb> <输出.glb> [...]');
  console.error('或配置 scripts/glb.config.json 里的 models 清单直接跑。');
  process.exit(1);
}
