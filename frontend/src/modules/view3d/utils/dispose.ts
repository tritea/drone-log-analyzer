import * as THREE from 'three';

/**
 * 遍历释放 Object3D 树上的几何/材质（可选连纹理一起）。
 * withTextures 时对同一 geometry/material/texture 只释放一次（Set 去重），
 * 供 GLB 模型整体卸载（换机型/形态）避免显存累积泄漏。
 */
export function disposeObjectTree(obj: THREE.Object3D | null, withTextures: boolean = false): void {
  if (!obj) return;
  const seen = withTextures ? new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>() : null;
  obj.traverse(function (child: any) {
    if (child.geometry && (!seen || !seen.has(child.geometry))) {
      try { child.geometry.dispose(); } catch (e) { /* noop */ }
      seen?.add(child.geometry);
    }
    if (!child.material) return;
    const mats: THREE.Material[] = Array.isArray(child.material) ? child.material : [child.material];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!m || (seen && seen.has(m))) continue;
      if (withTextures && seen) {
        for (const key of Object.keys(m)) {
          const v = (m as any)[key];
          if (v && v.isTexture && !seen.has(v)) { try { v.dispose(); } catch (e) { /* noop */ } seen.add(v); }
          if (Array.isArray(v)) {
            for (const t of v) if (t && t.isTexture && !seen.has(t)) { try { t.dispose(); } catch (e) { /* noop */ } seen.add(t); }
          }
        }
      }
      try { m.dispose(); } catch (e) { /* noop */ }
      seen?.add(m);
    }
  });
}
