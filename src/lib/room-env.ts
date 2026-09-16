import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * RoomEnvironment 的 PMREM 环境贴图，按 renderer 缓存一份。
 *
 * 动机：
 *  · 旋转木马 / 报刊亭展架 / 3D 小人三个场景各自 `new` 自己的 WebGLRenderer，
 *    但 RoomEnvironment 模块抽到这里后，Rollup 会把它提进公共 chunk ——
 *    两个重 3D 分包各自少打一份 RoomEnvironment 代码，全站只解析一次。
 *  · 同一个 renderer 重复进场景（离开再回来）也只烘焙一次。
 *
 * ⚠️ 返回的 RT 归本缓存所有，调用方**不要 dispose 它**：
 *    renderer 被 GC 后，这条 WeakMap 记录随之一起回收。
 */
const cache = new WeakMap<THREE.WebGLRenderer, THREE.WebGLRenderTarget>();

export function getRoomEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  let rt = cache.get(renderer);
  if (!rt) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    rt = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    cache.set(renderer, rt);
  }
  return rt.texture;
}
