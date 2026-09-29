/**
 * 把根目录 `link-meta.ts` 的实现同步进 `api/link-meta.ts` 的标记区间。
 *
 * 为什么是「同步」而不是直接 import：
 *   Vercel 对 /api 下的函数按文件独立转译，跨文件 import 在部分管线下解析不到
 *   （项目里踩过：FUNCTION_INVOCATION_FAILED 且无日志，见 api/visit.ts 顶部）。
 *   所以线上函数必须自包含；但识别逻辑又不能维护两份 —— 于是让构建负责搬运。
 *
 *   用法：
 *     node scripts/sync-link-meta.mjs           写入（默认，已挂在 npm run build 最前）
 *     node scripts/sync-link-meta.mjs --check   只校验是否一致（CI / 本地自检用）
 *
 * 单一事实来源永远是根目录的 `link-meta.ts`，别手改 api/link-meta.ts 里那段副本。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'link-meta.ts');
const DST = resolve(root, 'api/link-meta.ts');
const BEGIN = '// @@LINK-META-CORE:BEGIN@@';
const END = '// @@LINK-META-CORE:END@@';

const lf = (s) => s.replace(/\r\n/g, '\n');
const src = lf(readFileSync(SRC, 'utf8')).replace(/\s+$/, '');
const dst = lf(readFileSync(DST, 'utf8'));

const b = dst.indexOf(BEGIN);
const e = dst.indexOf(END);
if (b < 0 || e < 0 || e < b) {
  console.error(`[sync-link-meta] ${DST} 里找不到 ${BEGIN} / ${END} 标记，无法同步`);
  process.exit(1);
}
// 标记行自身保留，区间内部整体替换
const head = dst.slice(0, b + BEGIN.length);
const tail = dst.slice(e);
const next = `${head}\n${src}\n${tail}`;

if (process.argv.includes('--check')) {
  if (next !== dst) {
    console.error('[sync-link-meta] api/link-meta.ts 与 link-meta.ts 不同步，跑一下 node scripts/sync-link-meta.mjs');
    process.exit(1);
  }
  console.log('[sync-link-meta] 一致 ✓');
  process.exit(0);
}

if (next === dst) {
  console.log('[sync-link-meta] 已是最新，无需改动');
} else {
  writeFileSync(DST, next, 'utf8');
  console.log(`[sync-link-meta] 已同步 link-meta.ts → api/link-meta.ts（${src.split('\n').length} 行）`);
}
