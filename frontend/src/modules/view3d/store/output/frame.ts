import type * as THREE from 'three';
import { runtime } from '@/modules/shared/runtime';
import { usePlaybackStore } from '@/modules/playback';
import { makeDroneQuaternion } from '@/modules/shared/utils/drone-model';
import type { TelemetrySample } from '@/types';
import { aimWindPointer, syncNosePointer } from '../dial/reference';
import type { FrameApi, View3dStoreCtx } from '../types';

/* ===== 每帧输出钩子（由 modules/playback/loop/frame-loop 驱动；earth 独占时由
 * earth-store 的 Cesium preUpdate 驱动同一对入口）。===== */

export function createFrameOutput(ctx: View3dStoreCtx): FrameApi {
  const st = ctx.state;

  // 每帧数据+位姿输出：曲线轴播放头 + current 数据（playback store）+ 姿态仪/主场景模型位姿。
  // earth 模式下 earth 端无人机位姿在 scene.preRender 直接写（不经过这里），姿态仪/主场景照常。
  function applyFrameOutputs(): void {
    const pb = usePlaybackStore();
    if (pb.playback.curveAxis) ctx.curveAxis.refreshPlayhead();
    const sample = pb.updateCurrentData();
    if (!sample) return;
    const t = pb.playback.timeMs;
    const att = ctx.dial.attitudeAt(st.value.camera.attitudeSource, t);
    // 姿态仪（独立视图）任何渲染器模式下都跟随姿态；主场景部分仅纯 3D 模式存在。
    if (runtime.view3dDial) {
      poseDrone(runtime.view3dDial.drone, sample, false, att);
      syncNosePointer();
      aimWindPointer(t);
    }
    if (runtime.view3dMain) {
      poseDrone(runtime.view3dMain.drone, sample, true, att);
      poseGhost(t);
      ctx.path.advanceFlightPath();
    }
  }

  // 模型位姿：usePosition=主场景（位置+姿态），否则仅姿态（姿态仪原地转）。
  function poseDrone(obj: THREE.Object3D | undefined, sample: TelemetrySample | null, usePosition: boolean, att?: { roll: number; pitch: number; yaw: number } | null): void {
    if (!obj || !sample) return;
    if (usePosition) obj.position.set(sample.x, sample.y, sample.z);
    obj.quaternion.copy(makeDroneQuaternion(att || sample));
  }

  // 姿态对比虚影：位置/缩放随主模型，姿态按第二源实时取值。
  function poseGhost(t: number): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.ghost || !tv.drone) return;
    const att = ctx.dial.attitudeAt(st.value.camera.compareSource, t);
    if (!att) return;
    tv.ghost.position.copy(tv.drone.position);
    tv.ghost.scale.copy(tv.drone.scale);
    tv.ghost.quaternion.copy(makeDroneQuaternion(att));
  }

  // 纯 3D 模式主场景帧渲染：天空/水面 uniform、桨叶、覆盖层可见性 + 渲染（渲染节流在 renderView3d 内）。
  function renderView3dFrame(ts: number, dt: number): void {
    if (!runtime.view3dMain) return;
    ctx.sky.advanceSkyUniforms(ts);
    ctx.water.advanceWaterUniforms(ts);
    ctx.water.anchorWaterToCamera();
    ctx.propellers.spinMainPropellers(dt);
    ctx.path.syncOverlayVisibility();
    renderView3d();
  }

  // 主场景渲染（render.fps 节流）：fxaa/ssao 开启走后处理链，否则直渲染。
  function renderView3d(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.camera) return;
    ctx.mainView.resizeView3d();
    const now = performance.now();
    const mainFps = st.value.render.fps;
    if (tv.activeCamera && (mainFps <= 0 || now - runtime.frameLoop.lastMainRenderTs >= 1000 / mainFps)) {
      runtime.frameLoop.lastMainRenderTs = now;
      if (st.value.render.main.aa === 'fxaa' || st.value.camera.ssao) {
        ctx.fx.ensureMainFx();
        ctx.fx.syncMainFxPasses();
        ctx.fx.calibrateSsaoRadius();
        if (tv.fx?.composer) tv.fx.composer.render();
      } else if (tv.renderer) {
        tv.renderer.render(tv.scene, tv.activeCamera);
      }
    }
  }

  return { applyFrameOutputs, renderView3dFrame, renderView3d };
}
