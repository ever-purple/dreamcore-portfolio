/**
 * 打印 GLB 的节点 / 网格 / 材质名与各网格的局部包围盒，
 * 用来判断「哪一面是屏幕」——通常屏幕是独立网格或独立材质（带 emissive/albedo 贴图）。
 * 用法：node scripts/_glb-names.mjs public/newsstand/dvd.glb
 */
import fs from 'node:fs';

const file = process.argv[2];
const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a glb');

let off = 12;
let json = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
  off += 8 + len + ((4 - ((8 + len) % 4)) % 4);
}

console.log('asset        =', JSON.stringify(json.asset));
console.log('extensions   =', JSON.stringify(json.extensionsUsed));
console.log('nodes        =', json.nodes?.length, ' meshes =', json.meshes?.length, ' materials =', json.materials?.length);
console.log('images       =', json.images?.length, ' textures =', json.textures?.length, ' anims =', json.animations?.length ?? 0);

// 世界变换（用 node 层级 + 简单的 TRS 组合）
const parentOf = new Map();
(json.nodes || []).forEach((n, i) => (n.children || []).forEach((c) => parentOf.set(c, i)));

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
  return o;
}
function trs(n) {
  const t = n.translation || [0, 0, 0];
  const q = n.rotation || [0, 0, 0, 1];
  const s = n.scale || [1, 1, 1];
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
  if (n.matrix) return n.matrix;
  return m;
}

const posStats = (mi) => {
  const mesh = json.meshes[mi];
  const acc = json.accessors[mesh.primitives[0].attributes.POSITION];
  return { min: acc.min, max: acc.max, count: acc.count, mat: mesh.primitives[0].material };
};

console.log('\n--- 有网格的节点 ---');
(json.nodes || []).forEach((n, i) => {
  if (n.mesh === undefined) return;
  const s = posStats(n.mesh);
  const dim = s.min && s.max ? [0, 1, 2].map((k) => +(s.max[k] - s.min[k]).toFixed(4)) : null;
  console.log(
    `node[${i}] "${n.name ?? ''}" mesh=${n.mesh} meshName="${json.meshes[n.mesh].name ?? ''}" ` +
      `mat=${s.mat} matName="${json.materials?.[s.mat]?.name ?? ''}" verts=${s.count} ` +
      `dim=${JSON.stringify(dim)} min=${JSON.stringify(s.min?.map((v) => +v.toFixed(3)))} max=${JSON.stringify(s.max?.map((v) => +v.toFixed(3)))}`,
  );
});

console.log('\n--- 材质 ---');
(json.materials || []).forEach((m, i) => {
  console.log(`mat[${i}] "${m.name ?? ''}" emissive=${JSON.stringify(m.emissiveFactor)} tex=${!!m.pbrMetallicRoughness?.baseColorTexture} alpha=${m.alphaMode ?? 'OPAQUE'} doubleSided=${!!m.doubleSided}`);
});

console.log('\n--- 根节点 ---');
(json.scenes?.[0]?.nodes || []).forEach((i) => {
  console.log(`root node[${i}] "${json.nodes[i].name ?? ''}" trs=${JSON.stringify({ t: json.nodes[i].translation, r: json.nodes[i].rotation, s: json.nodes[i].scale })}`);
});
