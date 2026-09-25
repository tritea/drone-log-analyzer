import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import { useLogStore } from '@/modules/log';
import { THREE_UNITS_PER_METER, THREE_DEFAULT_DRONE_MODEL } from '@/constants';
import {
  buildLowpolyDroneModel,
  resolveDroneModelName,
  collectPropellers,
  computeDronePhysicalScale,
} from '@/modules/shared/utils/drone-model';
import { disposeObjectTree } from '../../utils/dispose';
import type { DroneApi, View3dModelForm, View3dStoreCtx } from '../types';

/** 姿态小模型归一化目标尺度：与机型/GLB 原始大小无关，缩进参照球并留边距。 */
const DIAL_MODEL_EXTENT = 1.4;

export function createDroneModels(ctx: View3dStoreCtx): DroneApi {
  const st = ctx.state;

  // 模型加载（主场景与姿态仪各自独立去重/加载——姿态仪不随主场景销毁）。
  // 机型由日志 summary 解析（VTOL/HEXA/OCTO/QUAD），形态 glb/lowpoly 各自可选。
  function refreshDroneModels(): void {
    const summary = useLogStore().log.summary;
    const modelName = resolveDroneModelName(summary && summary.frame, summary && summary.airframe);
    // 主模型：key=机型+形态，挂在主视图 runtime（主场景销毁后无主模型）。
    const tv = runtime.view3dMain;
    if (tv) {
      const key = modelName + '@main:' + st.value.model;
      if (tv.modelName !== key) {
        loadModelForTarget('main', modelName, st.value.model);
        tv.modelName = key;
      }
    }
    // 姿态仪模型：key 独立挂姿态 runtime（任何渲染器模式下都保持加载）。
    const dv = runtime.view3dDial;
    if (dv) {
      const akey = modelName + '@dial:' + st.value.dialModel;
      if (dv.modelName !== akey) {
        loadModelForTarget('dial', modelName, st.value.dialModel);
        dv.modelName = akey;
      }
    }
  }

  // 按 target(main/dial) 与形态(glb/lowpoly) 加载无人机模型。
  // lowpoly → buildLowpolyDroneModel 同步建模；glb → GLTFLoader 异步加载，失败回退默认机型 QUAD-X。
  function loadModelForTarget(target: 'main' | 'dial', name: string, mode: View3dModelForm): void {
    if (mode === 'lowpoly') {
      const scene = buildLowpolyDroneModel(name);
      if (target === 'main') mountMainModel({ scene }, name);
      else mountDialModel({ scene }, name);
      return;
    }
    const loader = new GLTFLoader();
    loader.load(`vendor/${name}.glb`,
      function (geometry: any) {
        if (target === 'main') mountMainModel(geometry, name);
        else mountDialModel(geometry, name);
      },
      undefined,
      function () {
        if (name !== THREE_DEFAULT_DRONE_MODEL) loadModelForTarget(target, THREE_DEFAULT_DRONE_MODEL, mode);
      },
    );
  }

  // 主模型挂载：归一化 → 换下旧模型(含纹理整体释放) → 收桨叶 → 套光照/物理缩放 → 按需重建虚影。
  function mountMainModel(geometry: any, name: string): void {
    const tv = runtime.view3dMain;
    if (!tv) return; // GLB 异步回调落在主场景销毁之后：直接丢弃
    const droneModel = ctx.materials.normalizeModel(geometry, { x: 0.01, y: 0.01, z: 0.01 }, { x: false, y: true, z: true }, name);
    if (!droneModel) return;

    if (tv.drone) {
      tv.scene.remove(tv.drone);
      disposeObjectTree(tv.drone, true); // 含 GLB 纹理，否则换机型/形态累积泄漏
    }

    tv.drone = droneModel;
    tv.propellers = collectPropellers(droneModel, name);
    tv.scene.add(tv.drone);
    // 新载入的主模型套用当前光照倍率（envMapIntensity）。
    ctx.lighting.applyMainLighting();
    // 模型就位：按物理尺寸算基础缩放并应用(内部会 alignGroundToModel)；几何未就绪时沿用默认。
    applyDroneScale();
    // 主模型(重)载后，若姿态对比开启，重建虚影(clone 新模型)。
    if (st.value.camera.compareAttitude) ctx.materials.rebuildGhost();
  }

  // 姿态模型整形：归一化 → 定尺度(DIAL_MODEL_EXTENT) → 材质降级 medium；
  // 挂进姿态场景的编排(ctx.dial.attachDialModel)归 dial 域。
  function mountDialModel(geometry: any, name: string): void {
    const dv = runtime.view3dDial;
    if (!dv) return; // GLB 异步回调落在姿态仪销毁之后：直接丢弃
    const model = ctx.materials.normalizeModel(geometry, { x: 0.025, y: 0.025, z: 0.025 }, { x: false, y: false, z: true }, name);
    if (!model) return;

    // 归一化到固定尺度：与机型/GLB 原始大小无关，缩到参照球内并留出边距，
    // 足够大以直观判读方向、又不会撑满姿态球。
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const ext = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    if (isFinite(ext) && ext > 0) model.scale.multiplyScalar(DIAL_MODEL_EXTENT / ext);

    // 姿态小模型材质降级：右下角姿态仪只需判读姿态方向，无需 PBR/envMap 高光。
    // 强制 medium（MeshLambertMaterial + 简单光照 + 微自发光防阴影面死黑），能清晰显示即可，省 GPU。
    model.traverse((child: any) => {
      if (!child.isMesh) return;
      const cfg = child.userData._apmMatConfig;
      if (!cfg) return; // 非机身 mesh（桨叶等）保持载入态材质
      child.material = ctx.materials.buildMaterialFor(cfg, 'medium');
    });

    ctx.dial.attachDialModel(model, name);
  }

  // 机型模型形态切换（glb/lowpoly）：重载主模型（姿态仪形态独立，不受影响）。
  function setModelForm(model: string): void {
    const next: View3dModelForm = model === 'lowpoly' ? 'lowpoly' : 'glb';
    if (st.value.model === next) return;
    st.value.model = next;
    const tv = runtime.view3dMain;
    if (tv) {
      tv.modelName = ''; // 清去重键，强制重载
      refreshDroneModels();
    }
  }

  // 姿态仪模型形态独立切换（与主模型解耦）：只重载姿态侧。
  function setDialModelForm(model: string): void {
    const next: View3dModelForm = model === 'lowpoly' ? 'lowpoly' : 'glb';
    if (st.value.dialModel === next) return;
    st.value.dialModel = next;
    const dv = runtime.view3dDial;
    if (dv) {
      dv.modelName = ''; // 清去重键，强制重载
      refreshDroneModels();
    }
  }

  // 模型物理基础缩放（米 → 场景单位）：让模型 ≈ 真实物理尺寸（vtol 1.7m / 其余 0.65m）。
  function physicalDroneScale(): number | null {
    const tv = runtime.view3dMain;
    if (!tv || !tv.drone) return null;
    const summary = useLogStore().log.summary;
    const r = computeDronePhysicalScale(tv.drone, summary && summary.airframe);
    return r ? r.scale * THREE_UNITS_PER_METER : null;
  }

  // 应用模型缩放：基础缩放(物理) × 用户倍率；随后把网格对齐到机身底部。
  function applyDroneScale(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.drone) return;
    const baseScale = physicalDroneScale();
    if (baseScale) tv.droneBaseScale = baseScale;
    const visScale = (tv.droneBaseScale || 1) * (st.value.droneScale || 1);
    tv.drone.scale.set(visScale, visScale, visScale);
    alignGroundToModel();
  }

  // 网格贴机身底部：grid.position.y = 模型局部底缘；顺带记录机身半高（水面下沉台阶用）。
  function alignGroundToModel(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.grid || !tv.drone) return;
    tv.drone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tv.drone);
    const localBottom = box.min.y - (tv.drone.position.y || 0);
    if (isFinite(localBottom)) tv.grid.position.y = localBottom;
    const height = box.max.y - box.min.y;
    if (isFinite(height) && height > 0) tv.droneHalfHeight = height / 2;
  }

  // 用户倍率滑杆：基础缩放 × 倍率即时应用。
  function setDroneScale(value: number): void {
    st.value.droneScale = value;
    const tv = runtime.view3dMain;
    if (tv && tv.drone && tv.droneBaseScale) {
      const s = tv.droneBaseScale * value;
      tv.drone.scale.set(s, s, s);
      alignGroundToModel();
    }
    if (useUiStore().ui.mainView === 'three') ctx.frame.renderView3d();
  }

  return {
    refreshDroneModels, setModelForm, setDialModelForm,
    applyDroneScale, setDroneScale, alignGroundToModel,
  };
}
