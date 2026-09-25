import * as THREE from 'three';
import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import { useMapStateStore } from '@/modules/shared/map-state';
import { usePlaybackStore } from '@/modules/playback';
import { TRAJ_MAX_POINTS } from '@/constants';
import { disposeObjectTree } from '../../utils/dispose';
import type { TrajectoryApi, View3dStoreCtx } from '../types';

export function createTrajectory(ctx: View3dStoreCtx): TrajectoryApi {
  const st = ctx.state;

  // 重建飞行轨迹线：samples 数/maxRadius 变化（换日志/换位置源）才重建，否则只推进 drawRange。
  // 重建后按轨迹半径自适应相机距离与网格缩放。
  function rebuildFlightPath(): void {
    const tv = runtime.view3dMain;
    if (!tv || !usePlaybackStore().telemetry.samples.length) return;
    const key = usePlaybackStore().telemetry.samples.length + '|' + usePlaybackStore().telemetry.meta.maxRadius;
    if (tv.path?.key === key) {
      advanceFlightPath();
      return;
    }

    if (tv.path) {
      tv.scene.remove(tv.path.line);
      disposeObjectTree(tv.path.line);
      tv.path = undefined;
    }
    const positions: number[] = [];
    for (let i = 0; i < usePlaybackStore().telemetry.samples.length; i++) {
      const s = usePlaybackStore().telemetry.samples[i];
      positions.push(s.x, s.y, s.z);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeBoundingSphere();
    geom.setDrawRange(0, 1);
    const mat = new THREE.LineBasicMaterial({ color: 0x2563eb, linewidth: 5 });
    const line = new THREE.Line(geom, mat);
    line.visible = useMapStateStore().map.showPath;
    tv.scene.add(line);
    tv.path = { line, geometry: geom, key };
    fitCameraToTrack();
    advanceFlightPath();
    void ctx.mission.refreshMissionOverlay();
  }

  // 推进轨迹 drawRange 到当前播放时刻：全程模式画整段，否则只画最近 TRAJ_MAX_POINTS 个点。
  function advanceFlightPath(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.path || !usePlaybackStore().telemetry.samples.length) return;
    const idx = usePlaybackStore().currentThreeSampleIndex(usePlaybackStore().playback.timeMs);
    if (!st.value.camera.fullTrajectory) {
      const start = Math.max(0, idx + 1 - TRAJ_MAX_POINTS);
      tv.path.geometry.setDrawRange(start, idx + 1 - start);
    } else {
      tv.path.geometry.setDrawRange(0, Math.max(1, idx + 1));
    }
    void ctx.mission.refreshMissionOverlay();
  }

  // 相机/网格按轨迹半径自适应：自由视角距离 = 2.45×radius，网格整体缩放 = radius/90（下限 0.55）。
  function fitCameraToTrack(): void {
    const tv = runtime.view3dMain;
    if (!tv) return;
    const radius = Math.max(12, usePlaybackStore().telemetry.meta.maxRadius || 60);
    tv.orbit.free.distance = radius * 2.45;
    if (tv.grid) tv.grid.scale.set(Math.max(0.55, radius / 90), 1, Math.max(0.55, radius / 90));
    ctx.drone.applyDroneScale();
    ctx.camera.applyCameraPose();
  }

  function toggleWholeTrajectory(): void {
    st.value.camera.fullTrajectory = !st.value.camera.fullTrajectory;
  }

  // 轨迹线显隐（与 2D/地球地图共享 map.showPath 标志）。
  function togglePathOverlay(): void {
    const m = useMapStateStore().map;
    m.showPath = !m.showPath;
    const tv = runtime.view3dMain;
    if (tv && tv.path) {
      tv.path.line.visible = m.showPath;
      if (useUiStore().ui.mainView === 'three') ctx.frame.renderView3d();
    }
  }

  // 每帧同步覆盖层可见性（轨迹线/航线/航点，随地图开关实时生效）。
  function syncOverlayVisibility(): void {
    const tv = runtime.view3dMain;
    if (!tv) return;
    const m = useMapStateStore().map;
    if (tv.path) tv.path.line.visible = m.showPath;
    if (tv.mission?.lineGroup) tv.mission.lineGroup.visible = m.showRoute;
    if (tv.mission?.markerGroup) tv.mission.markerGroup.visible = m.showWaypoints;
  }

  return { rebuildFlightPath, advanceFlightPath, fitCameraToTrack, toggleWholeTrajectory, togglePathOverlay, syncOverlayVisibility };
}
