import * as L from 'leaflet';
import { runtime } from '@/modules/shared/runtime';
import { useMapStateStore } from '@/modules/shared/map-state';
import { useView3dStore } from '@/modules/view3d';
import { usePlaybackStore } from '@/modules/playback';
import { wgs84ToGcj02 } from '@/modules/shared/utils/geo/gcj02';
import { TRAJ_CLOSE_METERS, TRAJ_MAX_POINTS } from '@/constants';
import { firstIndexAtLeast, firstIndexExceeding, sampleToLatLng, thinBySpacing } from './geometry';
import type { TrackApi } from './types';

/* 轨迹域：已飞轨迹线（全程/滑窗两模式）+ 无人机标记位姿。
 * 全量 LatLng 缓存与按地面间距抽稀的缓存都收在本域闭包（旧版为模块级 let，HMR 换模块
 * 即成孤儿状态）；teardown / 重建一处置零。 */

export function createTrack(): TrackApi {
  const cache = {
    /** 全量轨迹点（含 GCJ-02 换算后）。 */
    full: [] as L.LatLng[],
    /** 按间距抽稀后的轨迹点（滑窗模式画这个）。 */
    thin: [] as L.LatLng[],
    /** thin[i] 对应 full 的原始采样下标（滑窗按播放时刻下标二分取段）。 */
    thinIdx: [] as number[],
    /** 滑窗模式最近一次已画段 [drawnFrom, drawnTo)。 */
    drawnFrom: -1,
    drawnTo: -1,
    /** 帧去重：上次推进的播放时刻与全程标志。 */
    stampMs: -1,
    whole: false,
  };

  function resetTrack(): void {
    cache.full = [];
    cache.thin = [];
    cache.thinIdx = [];
    cache.drawnFrom = -1;
    cache.drawnTo = -1;
    cache.stampMs = -1;
  }

  // 全量重建（换遥测/坐标系制度）：重算 LatLng 缓存与抽稀，fitBounds 取初始视野。
  function rebuildTrack(): void {
    const view = runtime.mapView;
    if (!view) return;
    const playback = usePlaybackStore();
    const samples = playback.telemetry.samples;
    const origin = playback.telemetry.meta.geoOrigin;
    if (!samples.length || !origin) {
      resetTrack();
      view.travelLine.setLatLngs([]);
      return;
    }
    const wantsGcj = useMapStateStore().mapCoordNeedsGcj02();
    cache.full = samples.map((s) => {
      const ll = sampleToLatLng(s, origin);
      if (!wantsGcj) return ll;
      const shifted = wgs84ToGcj02(ll.lat, ll.lng);
      return L.latLng(shifted[0], shifted[1]);
    });
    if (cache.full.length > 1) view.map.fitBounds(L.latLngBounds(cache.full).pad(0.15));
    const thinned = thinBySpacing(cache.full, TRAJ_CLOSE_METERS);
    cache.thin = thinned.kept;
    cache.thinIdx = thinned.sourceIdx;
    cache.drawnFrom = -1;
    cache.drawnTo = -1;
    cache.stampMs = -1;
  }

  // 每帧推进：全程模式画整段前缀；滑窗模式只画最近 TRAJ_MAX_POINTS 个采样对应的抽稀段，
  // 段界与上帧相同则跳过重画。末尾同步无人机标记位置与机头朝向。
  function advanceTrack(): void {
    const view = runtime.mapView;
    if (!view) return;
    const playback = usePlaybackStore();
    const samples = playback.telemetry.samples;
    const origin = playback.telemetry.meta.geoOrigin;
    const stampMs = playback.playback.timeMs;
    if (!samples.length || !origin || !cache.full.length) return;
    const whole = useView3dStore().view3d.camera.fullTrajectory;
    if (stampMs === cache.stampMs && whole === cache.whole) return;
    cache.stampMs = stampMs;
    cache.whole = whole;
    const idx = playback.currentThreeSampleIndex(stampMs);
    if (whole) {
      view.travelLine.setLatLngs(cache.full.slice(0, Math.max(1, idx + 1)));
      cache.drawnFrom = -1;
      cache.drawnTo = -1;
    } else {
      const oldest = Math.max(0, idx + 1 - TRAJ_MAX_POINTS);
      const to = firstIndexExceeding(cache.thinIdx, idx);
      const from = firstIndexAtLeast(cache.thinIdx, oldest);
      if (from !== cache.drawnFrom || to !== cache.drawnTo) {
        cache.drawnFrom = from;
        cache.drawnTo = to;
        view.travelLine.setLatLngs(to > from ? cache.thin.slice(from, to) : []);
      }
    }
    const sample = playback.sampleAtTime(stampMs) || samples[idx];
    view.aircraftMarker.setLatLng(cache.full[idx]);

    const host = view.aircraftMarker.getElement();
    const arrow = host && (host.firstElementChild as HTMLElement | null);
    if (arrow) arrow.style.transform = 'rotate(' + (sample.yaw || 0) + 'deg)';
  }

  // 视角聚焦无人机：只放大不缩小（至少 16 级）。
  function centerOnDrone(): void {
    const view = runtime.mapView;
    if (!view) return;
    const playback = usePlaybackStore();
    if (!playback.telemetry.samples.length || !playback.telemetry.meta.geoOrigin || !cache.full.length) return;
    const idx = playback.currentThreeSampleIndex(playback.playback.timeMs);
    const spot = cache.full[idx];
    if (!spot) return;
    view.map.setView(spot, Math.max(view.map.getZoom(), 16));
  }

  return { rebuildTrack, advanceTrack, centerOnDrone, resetTrack };
}
