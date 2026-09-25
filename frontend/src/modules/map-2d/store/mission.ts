import * as L from 'leaflet';
import { runtime } from '@/modules/shared/runtime';
import { useMapStateStore } from '@/modules/shared/map-state';
import { useView3dStore } from '@/modules/view3d';
import { wgs84ToGcj02 } from '@/modules/shared/utils/geo/gcj02';
import { waypointPinIcon } from './markers';
import type { MissionOverlaysApi } from './types';

/* 任务覆盖层域：航点圆点标记组（pinGroup）+ 航线虚线（planLine）。
 * 数据源 view3d missionGeoPoints（当前生效任务版本）；高德底图须把 WGS-84 航点
 * 转 GCJ-02 再落点。无跨帧缓存，整体重画（航点数量级小）。 */

export function createMissionOverlays(): MissionOverlaysApi {

  // 重建航点与航线：任务版本 / 命令列表 / 坐标系制度变化时由 frame 域触发。
  function rebuildMissionOverlays(): void {
    const view = runtime.mapView;
    if (!view) return;
    view.pinGroup.clearLayers();
    const points = useView3dStore().missionGeoPoints();
    if (!points || !points.length) {
      view.planLine.setLatLngs([]);
      return;
    }
    const wantsGcj = useMapStateStore().mapCoordNeedsGcj02();
    const linePoints: L.LatLng[] = [];
    for (const p of points) {
      const c = wantsGcj ? wgs84ToGcj02(p.lat, p.lng) : [p.lat, p.lng];
      linePoints.push(L.latLng(c[0], c[1]));
      if (!p.label) continue;
      L.marker([c[0], c[1]], { icon: waypointPinIcon(p.label, p.isHome) }).addTo(view.pinGroup);
    }
    view.planLine.setLatLngs(linePoints);
  }

  return { rebuildMissionOverlays };
}
