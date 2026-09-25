import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { runtime } from '@/modules/shared/runtime';
import type { EnvMapApi, View3dStoreCtx } from '../types';

/* 工作室 IBL：RoomEnvironment 是一组中性柔光箱 + 顶部点光，PMREMGenerator.fromScene
 * 把它烘焙成预过滤环境贴图。赋给 scene.environment 后，场景内所有 PBR 材质（金属机身）
 * 从任意角度都能获得漫反射 + 高光——相当于"无限多个柔光源"却只多一次纹理采样。
 * 主/姿态两个 renderer 是独立 WebGL 上下文，纹理不可跨上下文共享，需各烘焙一份。 */
export function createEnvMap(_ctx: View3dStoreCtx): EnvMapApi {

  function bakeStudioEnv(renderer: THREE.WebGLRenderer | null): THREE.WebGLRenderTarget | null {
    if (!renderer) return null;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = new RoomEnvironment(); // r160：默认 intensity=5，与本项目 useLegacyLights=true 的旧光照模型匹配
      const rt = pmrem.fromScene(env, 0.04);
      pmrem.dispose();
      // RoomEnvironment 内含几何/材质，烘焙完成后释放，避免 WebGL 资源泄漏。
      env.traverse(function (o: any) {
        if (o.geometry) { try { o.geometry.dispose(); } catch (e) { /* noop */ } }
        if (o.material) {
          const mm = o.material;
          if (Array.isArray(mm)) { for (let i = 0; i < mm.length; i++) { try { mm[i].dispose(); } catch (e) { /* noop */ } } }
          else { try { mm.dispose(); } catch (e) { /* noop */ } }
        }
      });
      return rt;
    } catch (e) {
      return null;
    }
  }

  function ensureMainEnvMap(): void {
    const tv = runtime.view3dMain;
    if (!tv) return;
    // Low 档不烘焙 IBL（Basic 不采样 envMap，applyMainLighting 会摘 scene.environment，省启动开销）。
    if (tv.materialTier === 'low') return;
    if (!tv.envRt) {
      tv.envRt = bakeStudioEnv(tv.renderer ?? null);
      if (tv.envRt) tv.scene.environment = tv.envRt.texture;
    }
  }

  // 姿态仪 IBL（独立 GL 上下文各烘焙一份）。
  function ensureDialEnvMap(): void {
    const dv = runtime.view3dDial;
    if (!dv) return;
    if (!dv.envRt) {
      dv.envRt = bakeStudioEnv(dv.renderer);
      if (dv.envRt) dv.scene.environment = dv.envRt.texture;
    }
  }

  function disposeMainEnvMap(): void {
    const tv = runtime.view3dMain;
    if (!tv) return;
    if (tv.envRt) { try { tv.envRt.dispose(); } catch (e) { /* noop */ } tv.envRt = undefined; }
    tv.scene.environment = null;
  }

  return { ensureMainEnvMap, ensureDialEnvMap, disposeMainEnvMap };
}
