import type { Ref } from 'vue';
import type * as L from 'leaflet';

/* ==========================================================================
 * 2D 地图（Leaflet）运行时容器与域工厂契约。
 *
 * 重对象（L.Map / 图层 / 标记）挂 modules/shared/runtime 的 mapView 容器，不进响应式
 * state；本文件定义容器形状 MapRuntime 与各域 API（蓝本 view3d/store/types.ts）。
 * ========================================================================== */

/** Leaflet 运行时容器：basemap.mount 一次性组装，teardownMap2d 整体释放，域工厂经 runtime 读写。 */
export interface MapRuntime {
  map: L.Map;
  /** 底图瓦片层（provider 可热换）。 */
  baseLayer: L.TileLayer;
  /** 已飞轨迹线（track 域）。 */
  travelLine: L.Polyline;
  /** 无人机标记（track 域）。 */
  aircraftMarker: L.Marker;
  /** 航点标记组（mission 域）。 */
  pinGroup: L.LayerGroup;
  /** 任务航线虚线（mission 域）。 */
  planLine: L.Polyline;
  /** 当前底图 provider（换源检测）。 */
  providerId: string;
}

/** 模板 ref 注册的宿主元素（Map2dView 的 .geo-canvas）。 */
export interface Map2dHostEls {
  host: Ref<HTMLElement | null>;
}

export interface BasemapApi {
  mount: () => void;
  swapProvider: (providerId: string) => void;
}

export interface TrackApi {
  rebuildTrack: () => void;
  advanceTrack: () => void;
  centerOnDrone: () => void;
  resetTrack: () => void;
}

export interface MissionOverlaysApi {
  rebuildMissionOverlays: () => void;
}

export interface FrameSyncApi {
  reconcileMap2d: () => void;
  teardownMap2d: () => void;
}

/** 域工厂共享 ctx：按引用共享、渐进填充；跨域调用一律延迟到函数体内解析（创建顺序不敏感）。 */
export interface Map2dStoreCtx {
  els: Map2dHostEls;
  basemap: BasemapApi;
  track: TrackApi;
  mission: MissionOverlaysApi;
  frame: FrameSyncApi;
}

/** 遥测局部坐标原点（playback telemetry.meta.geoOrigin 的形状）。 */
export interface OriginFrame {
  lat0: number;
  lng0: number;
  cosLat: number;
}
