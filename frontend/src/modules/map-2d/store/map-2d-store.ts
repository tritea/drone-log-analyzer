import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { TemplateRefTarget } from '@/modules/shared/utils/dom';
import { createBasemap } from './basemap';
import { createTrack } from './track';
import { createMissionOverlays } from './mission';
import { createFrameSync } from './frame';
import type { Map2dHostEls, Map2dStoreCtx } from './types';

/**
 * 2D 地图渲染面 store（Leaflet）。
 *
 * 组装式（蓝本 view3d）：本文件只持宿主元素注册，行为按域拆进 store/ 下的域工厂
 * （basemap/track/mission/frame + markers/geometry 纯工具），域间经 ctx 互调
 * （跨域调用延迟到函数体内解析，创建顺序不敏感）；重对象（L.Map/图层）挂
 * modules/shared/runtime 的 mapView 容器，不进响应式 state。
 * 对外契约只暴露四个动作：宿主绑定 / 帧同步 / 销毁 / 聚焦无人机
 * （Map2dView、playback frame-loop、view3d 生命周期消费）。
 */
export const useMap2dStore = defineStore('map-2d', () => {
  /* ---------------- host 元素注册（模板 ref 回调写入，basemap 域消费） ---------------- */
  const els: Map2dHostEls = { host: ref(null) };

  function bindMapHost(el: TemplateRefTarget): void {
    els.host.value = el instanceof HTMLElement ? el : null;
  }

  /* ---------------- 域组装 ---------------- */
  const ctx = {} as Map2dStoreCtx;
  ctx.els = els;
  ctx.basemap = createBasemap(ctx);
  ctx.track = createTrack();
  ctx.mission = createMissionOverlays();
  ctx.frame = createFrameSync(ctx);

  /* ---------------- 对外契约 ---------------- */
  return {
    bindMapHost,
    centerOnDrone: ctx.track.centerOnDrone,
    reconcileMap2d: ctx.frame.reconcileMap2d,
    teardownMap2d: ctx.frame.teardownMap2d,
  };
});
