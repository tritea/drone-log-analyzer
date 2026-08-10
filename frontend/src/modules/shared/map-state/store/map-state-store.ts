import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { MapCacheProvider, MapCacheState, MapProvider, MapState } from '@/types';
import { mapClient } from '@/services/map';
import { showToast } from '@/modules/shared/ui-store';
import { useUiStore } from '@/modules/shared/ui-store';
import { useScene3dStore } from '@/modules/scene-3d';

/** 地图客户端返回值要么是 { error }，要么是正常 payload（无 error 字段）。 */
function errorOf(res: unknown): string | null {
  if (res && typeof res === 'object' && !Array.isArray(res) && typeof (res as { error?: unknown }).error === 'string') {
    return (res as { error: string }).error;
  }
  return null;
}
const describeError = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const useMapStateStore = defineStore('map-state', () => {
  const map = ref<MapState>({
    active: false,
    renderer: '2d',
    terrainOn: true,
    followDrone: false,
    lockView: false,
    droneModel: 'lowpoly',
    droneScale: 3,
    droneShaded: true,
    mapFps: 30,
    providerId: '',
    providers: [] as MapProvider[],
    showPath: true,
    showWaypoints: true,
    showRoute: true,
    loaded: false,
    loading: false,
    error: '',
    tileError: false,
    controlBarCollapsed: false,
  });
  const cache = ref<MapCacheState>({
    dir: '',
    capBytes: 0,
    totalBytes: 0,
    providers: [] as MapCacheProvider[],
    loading: false,
    open: false,
  });

  async function loadProviders(): Promise<void> {
    map.value.loading = true;
    try {
      const data: unknown = await mapClient.providers();
      const err = errorOf(data);
      if (err) { showToast(err, 'error'); return; }
      const payload = data as { providers?: MapProvider[] };
      const providers = Array.isArray(payload.providers) ? payload.providers : [];
      map.value.providers = providers;
      if (!map.value.providerId && providers.length) map.value.providerId = providers[0].id;
      if (map.value.providerId && !providers.some((p) => p.id === map.value.providerId)) {
        map.value.providerId = providers.length ? providers[0].id : '';
      }
      map.value.loaded = true;
    } catch (e: unknown) {
      showToast('加载底图列表失败: ' + describeError(e), 'error');
    } finally {
      map.value.loading = false;
    }
  }

  async function setMapActive(on: boolean): Promise<void> {
    map.value.active = on;
    if (on) {
      useScene3dStore().ensureThreeTelemetry();
      if (!map.value.loaded) await loadProviders();
    } else if (useUiStore().ui.mainView === 'three') {
      useScene3dStore().ensureThreeView();
    }
  }

  const setProvider = (id: string): void => { map.value.providerId = id; map.value.tileError = false; };

  async function setMapRenderer(r: MapState['renderer']): Promise<void> {
    if (map.value.renderer === r) return;
    map.value.renderer = r;
    if (map.value.active) {
      useScene3dStore().ensureThreeTelemetry();
      if (!map.value.loaded) await loadProviders();
    }
  }
  const setMapTerrain = (on: boolean): void => { map.value.terrainOn = on; };
  const setMapFollow = (on: boolean): void => { map.value.followDrone = on; };
  const setMapLockView = (on: boolean): void => { map.value.lockView = on; };
  const setControlBarCollapsed = (on: boolean): void => { map.value.controlBarCollapsed = !!on; };
  const toggleControlBar = (): void => { map.value.controlBarCollapsed = !map.value.controlBarCollapsed; };
  const setMapDroneModel = (m: string): void => { map.value.droneModel = m === 'glb' || m === 'lowpoly' ? m : 'lowpoly'; };
  const setMapDroneScale = (v: number): void => { if (typeof v === 'number' && isFinite(v)) map.value.droneScale = Math.max(0.1, Math.min(20, v)); };
  const setMapDroneShaded = (on: boolean): void => { map.value.droneShaded = !!on; };
  const setMapFps = (v: number): void => { map.value.mapFps = !v || v <= 0 ? 0 : Math.max(1, Math.round(v)); };
  const terrainAllowed = (): boolean => !mapCoordNeedsGcj02();

  const currentAttribution = (): string => {
    const p = map.value.providers.find((x) => x.id === map.value.providerId);
    return (p && (p.attribution || p.name)) || '';
  };

  function mapCoordNeedsGcj02(): boolean {
    return map.value.providerId.indexOf('amap') === 0;
  }

  async function loadCacheStats(): Promise<void> {
    cache.value.loading = true;
    try {
      const data: unknown = await mapClient.cacheStats();
      const err = errorOf(data);
      if (err) { showToast(err, 'error'); return; }
      const payload = data as { dir?: string; capBytes?: number; totalBytes?: number; providers?: MapCacheProvider[] };
      cache.value.dir = payload.dir || '';
      cache.value.capBytes = payload.capBytes || 0;
      cache.value.totalBytes = payload.totalBytes || 0;
      cache.value.providers = Array.isArray(payload.providers) ? payload.providers : [];
    } catch (e: unknown) {
      showToast('读取地图缓存失败: ' + describeError(e), 'error');
    } finally {
      cache.value.loading = false;
    }
  }

  async function openCachePanel(): Promise<void> {
    cache.value.open = true;
    await loadCacheStats();
  }
  const closeCachePanel = (): void => { cache.value.open = false; };

  async function clearCacheProvider(id: string): Promise<void> {
    try {
      const err = errorOf(await mapClient.clearCacheProvider(id));
      if (err) { showToast(err, 'error'); return; }
      showToast('已清理', 'info');
      await loadCacheStats();
    } catch (e: unknown) {
      showToast('清理失败: ' + describeError(e), 'error');
    }
  }

  async function clearCacheAll(): Promise<void> {
    try {
      const err = errorOf(await mapClient.clearCache());
      if (err) { showToast(err, 'error'); return; }
      showToast('已清空全部缓存', 'info');
      await loadCacheStats();
    } catch (e: unknown) {
      showToast('清理失败: ' + describeError(e), 'error');
    }
  }

  return {
    map,
    cache,
    loadProviders,
    setMapActive,
    setProvider,
    setMapRenderer,
    setMapTerrain,
    setMapFollow,
    setMapLockView,
    setMapDroneModel,
    setMapDroneScale,
    setMapDroneShaded,
    setMapFps,
    terrainAllowed,
    setControlBarCollapsed,
    toggleControlBar,
    currentAttribution,
    mapCoordNeedsGcj02,
    loadCacheStats,
    openCachePanel,
    closeCachePanel,
    clearCacheProvider,
    clearCacheAll,
  };
});
