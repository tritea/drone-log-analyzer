import * as L from 'leaflet';
import { runtime } from '@/modules/shared/runtime';
import { useMapStateStore } from '@/modules/shared/map-state';
import { aircraftMarkerIcon } from './markers';
import type { BasemapApi, Map2dStoreCtx } from './types';

/* 底图域：Leaflet 实例与瓦片层的建/换。runtime.mapView 容器在此一次性组装
 * （含 track/mission 域的图层实例，各域经 runtime 直接操作，容器字段见 types.ts）。 */

/** 高德系 provider 坐标为 GCJ-02（换源跨制度时，轨迹/航点须按新制度重算）。 */
export function isGcj02Provider(providerId: string): boolean {
  return providerId.indexOf('amap') === 0;
}

export function createBasemap(ctx: Map2dStoreCtx): BasemapApi {

  // 瓦片层走本地代理路由（MBTiles 缓存管线，见 docs/map-tiles.md）；
  // tileerror/tileload 维护地图顶栏的瓦片失败告警标志。
  function buildTileLayer(providerId: string): L.TileLayer {
    const mapState = useMapStateStore();
    const layer = L.tileLayer(`/map/provider/${providerId}/{z}/{x}/{y}`, {
      maxZoom: 21,
      maxNativeZoom: 18,
      attribution: mapState.currentAttribution(),
    });
    layer.on('tileerror', () => { mapState.map.tileError = true; });
    layer.on('tileload', () => { if (mapState.map.tileError) mapState.map.tileError = false; });
    return layer;
  }

  // 按需建图（激活边沿调用，幂等）：容器已存在或宿主元素未就绪则跳过。
  // zoomAnimation 关闭：容器 v-show 切换时尺寸抖动会触发残影动画。
  function mount(): void {
    if (runtime.mapView) return;
    const host = ctx.els.host.value;
    if (!host) return;
    const mapState = useMapStateStore();
    const map = L.map(host, {
      center: [30, 120],
      zoom: 13,
      zoomControl: true,
      zoomAnimation: false,
      preferCanvas: true,
      attributionControl: true,
    });
    map.attributionControl.setPrefix(false);

    const providerId = mapState.map.providerId || 'amap_vector';
    const baseLayer = buildTileLayer(providerId);
    baseLayer.addTo(map);
    const travelLine = L.polyline([], { color: '#2563eb', weight: 2, opacity: 0.9, lineJoin: 'round' }).addTo(map);
    const pinGroup = L.layerGroup();
    if (mapState.map.showWaypoints) pinGroup.addTo(map);
    const planLine = L.polyline([], { color: '#ea580c', weight: 2, opacity: 0.8, dashArray: '6,4', lineJoin: 'round' });
    if (mapState.map.showRoute) planLine.addTo(map);
    const aircraftMarker = L.marker([30, 120], { icon: aircraftMarkerIcon, zIndexOffset: 1000 }).addTo(map);
    runtime.mapView = { map, baseLayer, travelLine, aircraftMarker, pinGroup, planLine, providerId };
  }

  // 换底图源：摘旧瓦片层、建新挂上并记录 providerId；坐标系制度变化的重算由 frame 域编排。
  function swapProvider(providerId: string): void {
    const view = runtime.mapView;
    if (!view || view.providerId === providerId) return;
    view.map.removeLayer(view.baseLayer);
    view.baseLayer = buildTileLayer(providerId);
    view.baseLayer.addTo(view.map);
    view.providerId = providerId;
  }

  return { mount, swapProvider };
}
