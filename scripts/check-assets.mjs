/**
 * 构建期素材守卫 —— 拦住「代码引用了 public/ 里不存在的素材」这类事故。
 *
 * 为什么要它（2026-09-28 线上事故复盘）：
 * ---------------------------------------------------------------------------
 * `src/App.tsx` 把序列帧从 `/frames/0001.jpg` 改成了 `/frames/0001.webp`，
 * 代码提交了，但那 120 个 **.webp 文件从没入库**（原来的 .jpg 还在库里）。
 * 于是线上：代码要 .webp → 全部 404 → 加载页把「请求失败」也当成「加载完成」
 * → 很快放行 → canvas 一帧都没有 → **首页纯黑，只在控制台里有 120 条 404**。
 * 整个过程没有任何一步会报错，纯靠人眼发现「背景怎么没了」。
 *
 * 这个脚本把那一步补上：**在 build 之前先把「代码承诺要有的文件」逐个点一遍**，
 * 缺任何一个就 exit(1)，部署直接失败。宁可构建红，也不要线上黑。
 *
 * 覆盖面：
 *   A. 序列帧目录完整性（**动态拼出来的 URL，静态扫描抓不到，所以单独查**）
 *   B. src/ 里写死的 `/xxx.ext` 字面量路径（best-effort，能抓到海报 / GLB 这类）
 *
 * 用法：node scripts/check-assets.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const problems = [];

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ── A. 序列帧目录完整性 ───────────────────────────────────────────────────
const appSrc = read('src/App.tsx');

const total = Number((appSrc.match(/const\s+TOTAL_FRAMES\s*=\s*(\d+)/) || [])[1]);
if (!total) problems.push('src/App.tsx 里读不到 TOTAL_FRAMES');

// FRAME_DIR 的三元表达式两侧就是目录名
const dirs = [...appSrc.matchAll(/return\s+shortSide[\s\S]{0,120}?\?\s*'([^']+)'\s*:\s*'([^']+)'/g)].flatMap(
  (m) => [m[1], m[2]],
);
const frameDirs = dirs.length ? [...new Set(dirs)] : [];
if (!frameDirs.length) problems.push('src/App.tsx 里读不到 FRAME_DIR 的两个候选目录名');

// 扩展名后面可能跟 query —— 帧 URL 带 `?v=${FRAME_VERSION}` 做长缓存失效
// （vercel.json 给 /frames 配了 immutable），所以不能要求反引号紧跟在扩展名后面。
const ext = (appSrc.match(/`\/\$\{FRAME_DIR\}\/.*?\.(\w+)(?:\?[^`]*)?`/) || [])[1];
if (!ext) problems.push('src/App.tsx 里读不到帧文件扩展名');

if (total && frameDirs.length && ext) {
  for (const dir of frameDirs) {
    const abs = join(PUBLIC, dir);
    if (!existsSync(abs)) {
      problems.push(`帧目录缺失：public/${dir}/（代码会请求 /${dir}/0001.${ext}）`);
      continue;
    }
    const files = readdirSync(abs);
    const want = new Set(
      Array.from({ length: total }, (_, i) => String(i + 1).padStart(4, '0') + '.' + ext),
    );
    const missing = [...want].filter((f) => !files.includes(f));
    if (missing.length) {
      const shown = missing.slice(0, 5).join('、');
      problems.push(
        `public/${dir}/ 缺 ${missing.length} 个帧（共需 ${total} 个 .${ext}）：${shown}${
          missing.length > 5 ? ' …' : ''
        }`,
      );
    }
    // 同名不同扩展的残留（比如 .jpg 没删干净）会让仓库白白胖一倍
    const stray = files.filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f) && !f.endsWith('.' + ext));
    if (stray.length) {
      problems.push(
        `public/${dir}/ 里有 ${stray.length} 个旧格式残留（如 ${stray[0]}）—— 确认没用就删掉，别白白推上去`,
      );
    }
  }
  console.log(
    `[check-assets] 帧集：${frameDirs.map((d) => `${d}(.${ext}×${total})`).join(' + ')}`,
  );
}

// ── B. src/ 里写死的素材路径 ────────────────────────────────────────────
const ASSET_EXT = /\.(webp|jpg|jpeg|png|gif|svg|glb|gltf|mp4|webm|mov|mp3|wav|ogg|woff2?|pdf|vtt)$/i;
/** 匹配 'BASE_URL}/about/x.glb' 与 '/studio/x.jpg' 两种写法 */
const LITERAL = /['"`][^'"`]*?([A-Za-z0-9_][A-Za-z0-9_\-./%]*\/[A-Za-z0-9_\-./%]+\.[A-Za-z0-9]{2,5})['"`]/g;

/** 递归收集 src 下的 ts/tsx */
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const srcFiles = existsSync(join(ROOT, 'src')) ? walk(join(ROOT, 'src')) : [];
const checked = new Set();
const skipped = [];
for (const f of srcFiles) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(LITERAL)) {
    let p = m[1];
    // 去掉可能的前导噪音（BASE_URL 那类是 `${import.meta.env.BASE_URL}about/x.glb`）
    p = p.replace(/^[^/]*?\/\//, '').split('?')[0];
    if (!ASSET_EXT.test(p)) continue;
    if (p.startsWith('/api/') || p.startsWith('http')) continue;
    // 注释里常写仓库路径 `public/xxx`，去掉这层前缀再按站点路径核对
    p = p.replace(/^public\//, '');
    // 占位/示例路径：注释里用 xxx / NNN / 000N 表示"这里填第几个"，不是真文件
    const base = p.split('/').pop() ?? '';
    if (/xxx|yyy|\bnote\b|todo|example/i.test(base) || /\d*N\./i.test(base)) {
      skipped.push(`${p}  (${f.replace(ROOT + '\\', '')})`);
      continue;
    }
    if (checked.has(p)) continue;
    checked.add(p);
    if (!existsSync(join(PUBLIC, p))) {
      problems.push(`代码引用了 public/ 里不存在的素材：${p}   （${f.replace(ROOT + '\\', '')}）`);
    }
  }
}
console.log(`[check-assets] 字面量素材路径：扫了 ${srcFiles.length} 个源文件，核对 ${checked.size} 条`);
if (skipped.length) {
  console.log(`[check-assets] 跳过 ${skipped.length} 条占位写法（注释示例，不是真引用）`);
}

// ── 结论 ────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error('\n❌ 素材守卫未通过：\n');
  problems.forEach((p) => console.error('  · ' + p));
  console.error(
    '\n这类问题在浏览器里不会报错：请求 404 会被当成"加载完成"，' +
      '页面照样进得去，只是素材是空的（曾经因此上线过一个纯黑首页）。\n',
  );
  process.exit(1);
}
console.log('[check-assets] ✅ 素材齐全');
