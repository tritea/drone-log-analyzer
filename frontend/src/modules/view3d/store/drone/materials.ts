import * as THREE from 'three';
import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import type { MaterialProperties } from '@/constants';
import { THREE_MODEL_MATERIAL, BODY_MATERIAL } from '@/constants';
import { normalizeLoadedDroneModel } from '@/modules/shared/utils/drone-model';
import type { MaterialsApi, View3dStoreCtx, View3dTier } from '../types';

export function createMaterials(ctx: View3dStoreCtx): MaterialsApi {
  const st = ctx.state;

  // 按材质档构造一个材质实例：High=MeshPhysicalMaterial(PBR+清漆)，Medium=MeshLambertMaterial(+自发光底)，
  // Low=MeshBasicMaterial(平涂)。Lambert/Basic 只取 color；Lambert 加 emissive=color*0.05 防阴影面死黑。
  function buildMaterialFor(cfg: MaterialProperties, tier: View3dTier): THREE.Material {
    if (tier === 'low') return new THREE.MeshBasicMaterial({ color: cfg.color });
    if (tier === 'medium') {
      return new THREE.MeshLambertMaterial({
        color: cfg.color,
        emissive: new THREE.Color(cfg.color).multiplyScalar(0.05),
      });
    }
    return new THREE.MeshPhysicalMaterial({
      color: cfg.color,
      metalness: cfg.metalness,
      roughness: cfg.roughness,
      clearcoat: cfg.clearcoat,
      clearcoatRoughness: cfg.clearcoatRoughness,
    });
  }

  // tier-aware 归一化管线入口：材质分配/AABB 居中/base>rotation 层级抽在共享
  // normalizeLoadedDroneModel（与 earth 共用），此处注入 tier-aware 材质构建器，
  // 保持按 render.quality 热切换材质的原行为。
  // 入参接受 GLTFLoader 结果（{scene} wrapper）或 lowpoly Group——先解包到真正的 Object3D。
  function normalizeModel(
    gltfResult: { scene?: THREE.Object3D } | THREE.Object3D,
    scale: { x: number; y: number; z: number },
    offsetToCenter: { x: boolean; y: boolean; z: boolean },
    name: string,
  ): THREE.Group | undefined {
    const source = (gltfResult as { scene?: THREE.Object3D }).scene || (gltfResult as THREE.Object3D);
    return normalizeLoadedDroneModel(
      source, scale, offsetToCenter, name,
      THREE_MODEL_MATERIAL, BODY_MATERIAL,
      (cfg: MaterialProperties) => buildMaterialFor(cfg, ctx.quality.currentTier(st.value.render.quality)),
    );
  }

  // 按 tier 重建所有无人机实例（主/姿态/虚影）的材质：从 userData._apmMatConfig 取配置，
  // dispose 旧、按 tier 建新。仅在 tier 变更(setQuality)时调用；模型载入时 normalizeModel 已按当前 tier 建。
  // 重建后重设虚影半透明、姿态机固定 Lambert；末尾 applyMainLighting 让 Physical 档恢复金属/envMap。
  function applyTierToModels(tier: View3dTier): void {
    const tv = runtime.view3dMain;
    if (tv) {
      tv.materialTier = tier;
      applyTierToRoot(
        [
          { root: tv.drone, isGhost: false, isAttitude: false },
          { root: tv.ghost, isGhost: true, isAttitude: false },
        ],
        tier,
      );
    }
    // 姿态仪固定 medium（Lambert）——不走 PBR/envMap，与 mountDialModel 一致。
    const dv = runtime.view3dDial;
    if (dv) applyTierToRoot([{ root: dv.drone, isGhost: false, isAttitude: true }], tier);
    ctx.lighting.applyMainLighting();
    ctx.lighting.applyDialLighting();
    if (useUiStore().ui.mainView === 'three') ctx.frame.renderView3d();
  }

  function applyTierToRoot(
    roots: Array<{ root: THREE.Object3D | undefined | null; isGhost: boolean; isAttitude: boolean }>,
    tier: View3dTier,
  ): void {
    for (let i = 0; i < roots.length; i++) {
      const r = roots[i];
      if (!r.root) continue;
      r.root.traverse(function (child: any) {
        if (!child.isMesh) return;
        const cfg: MaterialProperties | undefined = child.userData._apmMatConfig;
        if (!cfg) return; // 非机身 mesh 保持载入态材质
        // dispose 旧材质（防御 Material | Material[]）
        if (child.material) {
          const oldMats = Array.isArray(child.material) ? child.material : [child.material];
          for (let k = 0; k < oldMats.length; k++) { try { oldMats[k].dispose(); } catch (e) { /* noop */ } }
        }
        // 姿态小模型固定 medium（Lambert）：不走 PBR/envMap，与 mountDialModel 一致。
        const m: any = buildMaterialFor(cfg, r.isAttitude ? 'medium' : tier);
        if (r.isGhost) {
          // 虚影覆盖（与 rebuildGhost 一致）：半透明、不写深度。
          m.transparent = true;
          m.opacity = 0.3;
          m.depthWrite = false;
        }
        child.material = m;
      });
    }
  }

  // 仅释放虚影的克隆材质；几何与主无人机共享，不可 dispose(否则毁主无人机)。
  function disposeGhostMats(obj: THREE.Object3D | null): void {
    if (!obj) return;
    obj.traverse(function (child: any) {
      if (child.material) {
        const m = child.material;
        if (Array.isArray(m)) { for (let i = 0; i < m.length; i++) { try { m[i].dispose(); } catch (e) { /* noop */ } } }
        else { try { m.dispose(); } catch (e) { /* noop */ } }
      }
    });
  }

  // 重建虚影：克隆主无人机、材质改半透明。位置/缩放随主无人机，方向由 poseGhost 每帧设。
  function rebuildGhost(): void {
    const tv = runtime.view3dMain;
    if (!tv) return;
    if (tv.ghost) {
      tv.scene.remove(tv.ghost);
      disposeGhostMats(tv.ghost);
      tv.ghost = null;
    }
    if (!st.value.camera.compareAttitude || !tv.drone) return;
    const ghost = tv.drone.clone(true);
    ghost.traverse(function (child: any) {
      if (child.isMesh && child.material) {
        const src = Array.isArray(child.material) ? child.material[0] : child.material;
        const m = src.clone();
        m.transparent = true;
        m.opacity = 0.3;
        m.depthWrite = false;
        child.material = m;
      }
    });
    ghost.name = 'view3d-ghost';
    tv.ghost = ghost;
    tv.scene.add(ghost);
  }

  // 开关姿态对比：开 → 建虚影(姿态曲线已由 preloadDialCurves 预载)；关 → 移除虚影。
  function toggleAttitudeCompare(): void {
    const tv = runtime.view3dMain;
    if (st.value.camera.compareAttitude) {
      rebuildGhost();
    } else if (tv && tv.ghost) {
      tv.scene.remove(tv.ghost);
      disposeGhostMats(tv.ghost);
      tv.ghost = null;
    }
  }

  // 切换第二姿态源：实时按 curves 取值（attitudeAt 每帧读 compareSource），无需重载。
  function setCompareSource(): void {
    // no-op：帧输出每帧按 compareSource 取值。
  }

  return { buildMaterialFor, applyTierToModels, normalizeModel, rebuildGhost, disposeGhostMats, toggleAttitudeCompare, setCompareSource };
}
