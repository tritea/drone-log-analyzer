import * as THREE from 'three';
import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import { isEditableTarget } from '@/modules/shared/utils/dom';
import { usePlaybackStore } from '@/modules/playback';
import type { CameraApi, View3dStoreCtx } from '../types';

/* 轨道距离钳制（自由/锁定共享下限，滚轮缩放范围）。 */
const MIN_ORBIT_DISTANCE = 1;
const MAX_ORBIT_DISTANCE = 2000;

export function createCameraRig(ctx: View3dStoreCtx): CameraApi {
  const st = ctx.state;

  // 按当前相机控制模式摆相机：fps=漫游位姿；lock=绕无人机球坐标（未种子则先算轨道）；
  // normal(free)=绕原点球坐标。aspect/up 每次同步（容器尺寸可能已变）。
  function applyCameraPose(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.camera) return;
    const cam = tv.camera;
    const aspect = Math.max(1, tv.hostEl.clientWidth) / Math.max(1, tv.hostEl.clientHeight);
    cam.aspect = aspect;
    cam.up.set(0, 1, 0);
    const mode = st.value.camera.control;
    if (mode === 'fps') {
      cam.position.set(tv.walker.x, tv.walker.y, tv.walker.z);
    } else {
      const isLock = mode === 'lock';
      if (isLock && !st.value.camera.lockSeeded && tv.drone && usePlaybackStore().telemetry.samples.length) {
        seedLockOrbit();
      }
      let d = isLock ? tv.orbit.lock.distance : tv.orbit.free.distance;
      const yaw = isLock ? tv.orbit.lock.yaw : tv.orbit.free.yaw;
      const pitch = isLock ? tv.orbit.lock.pitch : tv.orbit.free.pitch;
      let tx = 0, ty = 0, tz = 0;
      if (isLock && tv.drone) {
        tx = tv.drone.position.x;
        ty = tv.drone.position.y;
        tz = tv.drone.position.z;
        d = Math.max(MIN_ORBIT_DISTANCE, d);
      }
      cam.position.set(tx + Math.sin(yaw) * Math.cos(pitch) * d, ty - Math.sin(pitch) * d, tz + Math.cos(yaw) * Math.cos(pitch) * d);
      cam.lookAt(tx, ty, tz);
    }
    cam.updateProjectionMatrix();
    tv.activeCamera = cam;
  }

  // 视图模式（ortho 固定视角 / free 自由视角）切换：离开 free+fps 时清漫游键位。
  function setViewMode(mode: string): void {
    const next: 'ortho' | 'free' = mode === 'free' ? 'free' : 'ortho';
    if (next !== 'free' && st.value.camera.control === 'fps') resetWalkerKeys();
    st.value.camera.mode = next;
    if (next === 'free' && !st.value.camera.freeSeeded) seedFreeCameraBehindDrone();
    applyCameraPose();
  }

  // 相机控制（normal 环绕 / lock 锁定无人机 / fps 漫游）切换：进出 fps 摆位/清键位，进 lock 先种子轨道。
  function setCameraControl(mode: string): void {
    if (mode !== 'fps' && mode !== 'lock') mode = 'normal';
    const prev = st.value.camera.control;
    if (prev === 'fps' && mode !== 'fps') resetWalkerKeys();
    if (mode === 'fps' && prev !== 'fps') seedWalkerFromCamera();
    if (mode === 'lock' && !st.value.camera.lockSeeded) seedLockOrbit();
    st.value.camera.control = mode as 'normal' | 'fps' | 'lock';
    applyCameraPose();
  }

  // 进 fps：从当前相机位姿接力漫游起点（速度回落默认）。
  function seedWalkerFromCamera(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.camera) return;
    tv.walker.x = tv.camera.position.x;
    tv.walker.y = tv.camera.position.y;
    tv.walker.z = tv.camera.position.z;
    tv.walker.speed = 2;
  }

  // 自由视角种子：无人机后方斜上位（沿机头反向后退 + 抬高，距离随机型尺度放大）。
  // 依赖无人机位姿已就位——调用前先跑一帧位姿输出（applyFrameOutputs）。
  function seedFreeCameraBehindDrone(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.camera || !usePlaybackStore().telemetry.samples.length) return;
    ctx.frame.applyFrameOutputs();
    const drone = tv.drone;
    if (!drone) return;
    const dronePos = drone.position.clone();
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(drone.quaternion);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
    forward.normalize();
    const s = tv.droneBaseScale || 1;
    const backDist = Math.max(14, 9 * s);
    const heightDist = Math.max(7, 4.5 * s);
    const camPos = dronePos.clone()
      .add(forward.multiplyScalar(-backDist))
      .add(new THREE.Vector3(0, heightDist, 0));
    const cam = tv.camera;
    cam.position.copy(camPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(dronePos);
    tv.walker.x = camPos.x;
    tv.walker.y = camPos.y;
    tv.walker.z = camPos.z;
    st.value.camera.freeSeeded = true;
  }

  // 锁定轨道种子：按模型包围盒尺寸算后退距离/俯角，绕到机头正后方。
  function seedLockOrbit(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.drone || !usePlaybackStore().telemetry.samples.length) return;
    ctx.frame.applyFrameOutputs();
    const drone = tv.drone;
    if (!drone) return;
    drone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(drone);
    let dim = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    if (!isFinite(dim) || dim <= 0) dim = 1;
    const back = 2.8 * dim;
    const height = 0.6 * dim;
    tv.orbit.lock.pitch = -Math.atan2(height, back);
    tv.orbit.lock.distance = Math.sqrt(back * back + height * height);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(drone.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();
    tv.orbit.lock.yaw = Math.atan2(-fwd.x, -fwd.z);
    st.value.camera.lockSeeded = true;
  }

  // fps 漫游推进：WASD/QE/方向键沿相机本体轴移动，步长=速度×dt。
  function advanceWalker(dtSec: number): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.camera) return;
    const f = tv.walker;
    const k = tv.keys;
    const mf = (k.forward ? 1 : 0) - (k.back ? 1 : 0);
    const mr = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    const mu = (k.up ? 1 : 0) - (k.down ? 1 : 0);
    if (!mf && !mr && !mu) return;
    const axes = walkerAxes(tv.camera.quaternion);
    const fwd = axes.forward.normalize();
    const right = axes.right.normalize();
    const up = axes.up.normalize();
    let mx = fwd.x * mf + right.x * mr + up.x * mu;
    let my = fwd.y * mf + right.y * mr + up.y * mu;
    let mz = fwd.z * mf + right.z * mr + up.z * mu;
    const len = Math.sqrt(mx * mx + my * my + mz * mz);
    if (len > 0) { mx /= len; my /= len; mz /= len; }
    const step = f.speed * dtSec;
    f.x += mx * step;
    f.y += my * step;
    f.z += mz * step;
  }

  // 画布交互：拖拽改轨道 yaw/pitch（lock 夹 ±85°、free 夹 [-77°,-9°]）；
  // fps 模式请求指针锁 + movement 增量视角；滚轮缩放轨道距离 / fps 调速度。
  function bindViewportInput(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.renderer) return;
    const canvas = tv.renderer.domElement;
    canvas.addEventListener('pointerdown', function (e: PointerEvent) {
      if (st.value.camera.mode !== 'free') return;
      if (st.value.camera.control === 'fps') {
        if (document.pointerLockElement !== canvas) {
          try { canvas.requestPointerLock(); } catch (_) { /* noop */ }
        }
        return;
      }
      tv.drag.active = true;
      tv.drag.x = e.clientX;
      tv.drag.y = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e: PointerEvent) {
      if (!tv.drag.active) return;
      const dx = e.clientX - tv.drag.x;
      const dy = e.clientY - tv.drag.y;
      tv.drag.x = e.clientX;
      tv.drag.y = e.clientY;
      const isLock = st.value.camera.control === 'lock';
      const orbit = isLock ? tv.orbit.lock : tv.orbit.free;
      orbit.yaw -= dx * 0.006;
      const pMin = isLock ? -1.5 : -1.35;
      const pMax = isLock ? 1.5 : -0.15;
      orbit.pitch = Math.max(pMin, Math.min(pMax, orbit.pitch - dy * 0.006));
      applyCameraPose();
    });
    canvas.addEventListener('pointerup', function (e: PointerEvent) {
      tv.drag.active = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    });
    canvas.addEventListener('mouseenter', function (e: MouseEvent) {
      tv.drag.x = e.clientX;
      tv.drag.y = e.clientY;
    });
    canvas.addEventListener('mousemove', function (e: MouseEvent) {
      if (st.value.camera.mode !== 'free' || st.value.camera.control !== 'fps') {
        tv.drag.x = e.clientX;
        tv.drag.y = e.clientY;
        return;
      }

      if (document.pointerLockElement !== canvas)
        return;

      let dx: number, dy: number;
      if (document.pointerLockElement === canvas) {
        dx = e.movementX || 0;
        dy = e.movementY || 0;
      } else {
        dx = e.clientX - tv.drag.x;
        dy = e.clientY - tv.drag.y;
        tv.drag.x = e.clientX;
        tv.drag.y = e.clientY;
      }
      applyWalkerLook(dx, dy);
      applyCameraPose();
    });
    canvas.addEventListener('wheel', function (e: WheelEvent) {
      if (st.value.camera.mode !== 'free') return;
      e.preventDefault();
      if (st.value.camera.control === 'fps') {
        tv.walker.speed = Math.max(2, Math.min(3000, tv.walker.speed * (e.deltaY > 0 ? 0.85 : 1.18)));
        return;
      }
      const orbit = st.value.camera.control === 'lock' ? tv.orbit.lock : tv.orbit.free;
      orbit.distance = Math.max(MIN_ORBIT_DISTANCE, Math.min(MAX_ORBIT_DISTANCE, orbit.distance * (e.deltaY > 0 ? 1.1 : 0.9)));
      applyCameraPose();
    }, { passive: false });
  }

  // 全局键盘钩子（lifecycle 捕获阶段调用）：W/S/A/D + 方向键=平移，Q/E/Space/C=升降。
  function handleWalkerKey(e: KeyboardEvent, down: boolean): boolean {
    if (useUiStore().ui.mainView !== 'three' || st.value.camera.mode !== 'free' || st.value.camera.control !== 'fps' || !runtime.view3dMain) return false;
    if (isEditableTarget(e.target)) return false;
    const lower = String(e.key || '').toLowerCase();
    const code = e.code || '';
    const k = runtime.view3dMain.keys;
    let used = false;
    const set = function (name: 'forward' | 'back' | 'left' | 'right' | 'up' | 'down') { (k as any)[name] = down ? 1 : 0; used = true; };
    if (lower === 'w' || code === 'ArrowUp') set('forward');
    else if (lower === 's' || code === 'ArrowDown') set('back');
    else if (lower === 'a' || code === 'ArrowLeft') set('left');
    else if (lower === 'd' || code === 'ArrowRight') set('right');
    else if (lower === ' ' || code === 'Space' || lower === 'e') set('up');
    else if (lower === 'q' || lower === 'c') set('down');
    if (used) e.preventDefault();
    return used;
  }

  function resetWalkerKeys(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.keys) return;
    const k = tv.keys;
    k.forward = k.back = k.left = k.right = k.up = k.down = 0;
  }

  function walkerAxes(q: THREE.Quaternion): { forward: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 } {
    return {
      forward: new THREE.Vector3(0, 0, -1).applyQuaternion(q),
      right: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(q)
    };
  }

  // fps 视角：yaw 绕世界 Y、pitch 夹 ±85°，四元数 premultiply 保证世界系旋转。
  function applyWalkerLook(dx: number, dy: number): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.camera) return;
    const q = tv.camera.quaternion;
    const sens = 0.0025;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const curPitch = Math.asin(Math.max(-1, Math.min(1, forward.y)));
    const newPitch = Math.max(-1.5, Math.min(1.5, curPitch - dy * sens));
    const pitchDelta = newPitch - curPitch;
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * sens);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchDelta);
    q.premultiply(qYaw);
    q.multiply(qPitch);
    q.normalize();
  }

  return {
    applyCameraPose, setViewMode, setCameraControl,
    seedFreeCameraBehindDrone, seedLockOrbit, seedWalkerFromCamera,
    advanceWalker, bindViewportInput, handleWalkerKey, resetWalkerKeys,
  };
}
