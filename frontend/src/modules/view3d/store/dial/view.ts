import * as THREE from 'three';
import { runtime } from '@/modules/shared/runtime';
import { useLogStore } from '@/modules/log';
import { usePlaybackStore } from '@/modules/playback';
import { resolveDroneModelName, collectPropellers } from '@/modules/shared/utils/drone-model';
import { disposeObjectTree } from '../../utils/dispose';
import type { DialApi, View3dDialRuntime, View3dStoreCtx } from '../types';
import { buildDialReference, rebuildNosePointer, rebuildWindPointer } from './reference';
import { preloadDialCurves, attitudeAt } from './curves';

/** 姿态仪渲染节流（fps）。 */
const DIAL_RENDER_FPS = 30;

export function createDialView(ctx: View3dStoreCtx): DialApi {
  const st = ctx.state;
  const els = ctx.els;

  // 可传局部 dv：ensureDial 在 runtime.view3dDial 赋值【之前】就要摆好相机——
  // 否则此处拿到 null 直接空跑，相机留在 (0,0,0)，姿态球构建时 camDir 走兜底 (0,0,1)，
  // 背景圆/正向环朝 +Z 烘死，与真实斜上位相机错位（参考环偏心 bug 的根因）。
  function aimDialCamera(dvParam?: View3dDialRuntime): void {
    const dv = dvParam || runtime.view3dDial;
    if (!dv || !dv.camera) return;
    const d = dv.camDist || 3.0;
    dv.camera.position.set(-d * 0.4, d * 0.34, d * 0.85);
    dv.camera.up.set(0, 1, 0);
    dv.camera.lookAt(0, 0, 0);
    dv.camera.updateProjectionMatrix();
  }

  // ===== 姿态仪独立视图（右栏）=====
  // 长生命周期：独立 WebGL 上下文/场景/灯光/模型，不随主 3D 场景销毁（渲染器互斥只作用于
  // 主场景与地图）。el 就绪即建（registerDialHost），渲染由 playback frame-loop 无条件驱动。
  function ensureDial(): void {
    if (runtime.view3dDial) return;
    const el = els.dial.value;
    if (!el) return;
    const dv: View3dDialRuntime = {
      hostEl: el,
      scene: new THREE.Scene(),
      renderer: null as unknown as THREE.WebGLRenderer,
      camera: new THREE.PerspectiveCamera(45, 1, 0.1, 100),
      camDist: 3.1,
      curves: null,
      wind: { curves: null, arrow: null },
    };
    dv.scene.background = new THREE.Color(0xeef1f5);
    dv.renderer = new THREE.WebGLRenderer({ antialias: st.value.render.dial.aa === 'msaa', alpha: false });
    dv.renderer.useLegacyLights = true;
    dv.renderer.setClearColor(0xeef1f5, 1);
    dv.renderer.setPixelRatio(ctx.quality.renderPixelRatio(st.value.render.dial.resolution));
    el.appendChild(dv.renderer.domElement);
    if (String(dv.renderer.render).length < 30) {
      // WebGL 上下文创建失败（渲染器降级）：右栏姿态仪不可用，清理退出（不阻断其他视图）。
      usePlaybackStore().telemetry.error = '浏览器/WebView 不支持 WebGL —— 姿态仪不可用。请换用 Chrome/Edge，或在浏览器设置里开启硬件加速。';
      try { dv.renderer.dispose(); } catch (e) { /* noop */ }
      return;
    }
    if (!dv.lights) dv.lights = {};
    dv.lights.key = new THREE.DirectionalLight(0xffffff, 0.9);
    dv.lights.key.position.set(-8, 5, 6);
    dv.lights.ambient = new THREE.AmbientLight(0xffffff, 0.5);
    dv.lights.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x2a3a50, 0.45);
    dv.scene.add(dv.lights.ambient);
    dv.scene.add(dv.lights.hemi);
    dv.scene.add(dv.lights.key);
    aimDialCamera(dv); // 传局部 dv：此刻 runtime.view3dDial 尚未赋值
    runtime.view3dDial = dv;
    ctx.envMap.ensureDialEnvMap();
    // 模型与姿态曲线：遥测就绪则立即加载（否则 loadThreeTelemetry 完成时触发）。
    // 姿态仪独立于主 3D 场景：el 就绪即建（含离开可视化销毁后的重建——组件 v-show 常驻，不会再触发注册）。
    ctx.drone.refreshDroneModels();
    ctx.lighting.applyDialLighting();
    if (usePlaybackStore().telemetry.loaded) void preloadDialCurves();
  }

  // 换装已整形的姿态模型：换下旧模型(含纹理)与旧参照球 → 收桨叶 → 重建装饰 → 套灯光。
  function attachDialModel(model: THREE.Object3D, name: string): void {
    const dv = runtime.view3dDial;
    if (!dv) return;
    if (dv.drone) {
      // 旧姿态模型挂在 dial scene（非主 scene），须从 dial scene 移除——
      // 否则切换形态/机型重建后旧模型残留，姿态仪里会出现两个模型。
      dv.scene.remove(dv.drone);
      disposeObjectTree(dv.drone, true); // 含 GLB 纹理
    }
    // 重建时一并移除并释放上一份姿态球。
    if (dv.reference) {
      dv.scene.remove(dv.reference);
      disposeObjectTree(dv.reference);
      dv.reference = null;
    }

    dv.drone = model;
    dv.propellers = collectPropellers(model, name);
    const sphere = buildDialReference();
    if (sphere) {
      dv.reference = sphere;
      dv.scene.add(sphere);
    }
    // 机头箭头（本体固连，与世界环叠合显示姿态偏移；与姿态球一起构建/重建）。
    rebuildNosePointer();
    // 风向箭头（世界固连，无风数据时隐藏；方向每帧由 aimWindPointer 更新）。
    rebuildWindPointer();
    dv.scene.add(dv.drone);
    // 新载入的姿态模型套用当前光照倍率（envMapIntensity 等）。
    ctx.lighting.applyDialLighting();
  }

  // 右栏姿态仪渲染（独立于主场景，30fps 节流）：尺寸同步 + fxaa 链 / 直渲染。
  // 由 playback frame-loop 无条件调用——主场景销毁（渲染器互斥）时右栏姿态照常显示。
  function renderDial(): void {
    const dv = runtime.view3dDial;
    if (!dv) return;
    const dialPR = ctx.quality.renderPixelRatio(st.value.render.dial.resolution);
    if (dv.renderer && dv.renderer.getPixelRatio() !== dialPR) dv.renderer.setPixelRatio(dialPR);
    const aw = Math.max(1, dv.hostEl.clientWidth);
    const ah = Math.max(1, dv.hostEl.clientHeight);
    dv.renderer.setSize(aw, ah, false);
    ctx.fx.syncDialFxSize();
    dv.camera.aspect = aw / ah;
    aimDialCamera();
    const now = performance.now();
    if (now - runtime.frameLoop.lastAttitudeRenderTs < 1000 / DIAL_RENDER_FPS) return;
    runtime.frameLoop.lastAttitudeRenderTs = now;
    if (st.value.render.dial.aa === 'fxaa') {
      ctx.fx.ensureDialFx();
      ctx.fx.syncDialFxPasses();
      if (dv.fx?.composer) dv.fx.composer.render();
    } else {
      dv.renderer.render(dv.scene, dv.camera);
    }
  }

  // 销毁右栏姿态仪（独立 WebGL 上下文）：随「离开可视化」与应用退出释放（用户决策——
  // 曲线视图下整个不可见，常驻只是白占上下文）；渲染器互斥切换不调用，可视化内常驻。
  // 重进可视化由 ensureView3d → ensureDial 重建（组件 v-show 常驻，不会重触发注册）。
  function teardownDial(): void {
    const dv = runtime.view3dDial;
    if (!dv) return;
    runtime.frameLoop.lastAttitudeRenderTs = 0;
    if (dv.fx?.composer) { try { dv.fx.composer.dispose(); } catch (e) { /* noop */ } }
    if (dv.envRt) { try { dv.envRt.dispose(); } catch (e) { /* noop */ } }
    disposeObjectTree(dv.scene, true); // 姿态球/箭头/风标/模型含纹理
    try { dv.renderer.dispose(); } catch (e) { /* noop */ }
    const de = dv.renderer.domElement;
    if (de && de.parentNode) de.parentNode.removeChild(de);
    runtime.view3dDial = null;
  }

  return { ensureDial, teardownDial, renderDial, preloadDialCurves, attitudeAt, attachDialModel };
}

