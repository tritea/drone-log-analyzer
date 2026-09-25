import * as THREE from 'three';
import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import type { LightingApi, View3dStoreCtx } from '../types';

/* 灯光强度基准（用户倍率 lighting.ambient/key 在此基础上缩放）。 */
const MAIN_AMBIENT_INTENSITY = 0.3;
const DIAL_AMBIENT_INTENSITY = 0.5;
const MAIN_KEY_INTENSITY = 0.85;
const DIAL_KEY_INTENSITY = 0.9;

export function createLighting(ctx: View3dStoreCtx): LightingApi {
  const st = ctx.state;

  // 主场景灯光/IBL 总开关应用：low 档整体关灯（Basic 材质不采样光照/IBL）；
  // environment 在「天空 IBL → 工作室 IBL → 无」间决策，辅光(hemi/fill/rim)随开关显隐，
  // ambient/key 按倍率缩放；PBR 材质的 metalness/envMapIntensity 同步覆写（关灯时金属度归零防黑镜面）。
  function applyMainLighting(): void {
    const tv = runtime.view3dMain;
    if (!tv) return;
    const L = st.value.lighting;
    let on = L.enabled !== false;
    if (tv.materialTier === 'low') on = false;

    const skyOn = st.value.sky.enabled !== false && !!tv.sky?.envRt;
    tv.scene.environment = on
      ? (skyOn ? tv.sky!.envRt!.texture : (tv.envRt ? tv.envRt.texture : null))
      : null;
    if (tv.lights?.hemi) tv.lights.hemi.visible = on;
    if (tv.lights?.fill) tv.lights.fill.visible = on;
    if (tv.lights?.rim) tv.lights.rim.visible = on;
    if (tv.lights?.ambient) tv.lights.ambient.intensity = MAIN_AMBIENT_INTENSITY * L.ambient;
    if (tv.lights?.key) tv.lights.key.intensity = MAIN_KEY_INTENSITY * L.key;
    const envVal = on ? L.env : 0;
    tv.scene.traverse(function (o: any) {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (m.isMeshPhysicalMaterial || m.isMeshStandardMaterial) {
          if (m.userData._apmBaseMetal === undefined) m.userData._apmBaseMetal = m.metalness;
          m.metalness = on ? m.userData._apmBaseMetal : 0;
          m.envMapIntensity = envVal;
        }
      }
    });
    if (useUiStore().ui.mainView === 'three') ctx.frame.renderView3d();
  }

  // 姿态仪灯光（独立于主场景：主场景销毁/地图模式下右栏姿态仪照常受灯光开关控制）。
  function applyDialLighting(): void {
    const dv = runtime.view3dDial;
    if (!dv) return;
    const L = st.value.lighting;
    const on = L.enabled !== false;
    dv.scene.environment = (on && dv.envRt) ? dv.envRt.texture : null;
    if (dv.lights?.hemi) dv.lights.hemi.visible = on;
    if (dv.lights?.ambient) dv.lights.ambient.intensity = DIAL_AMBIENT_INTENSITY * L.ambient;
    if (dv.lights?.key) dv.lights.key.intensity = DIAL_KEY_INTENSITY * L.key;
  }

  function setLightingFactor(field: 'env' | 'ambient' | 'key', value: number): void {
    st.value.lighting[field] = value;
    applyMainLighting();
    applyDialLighting();
  }

  function toggleLighting(enabled: boolean): void {
    st.value.lighting.enabled = enabled;
    applyMainLighting();
    applyDialLighting();
  }

  return { applyMainLighting, applyDialLighting, setLightingFactor, toggleLighting };
}
