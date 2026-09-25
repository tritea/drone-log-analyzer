import { defineStore } from 'pinia';
import { ref } from 'vue';
import { configClient } from '@/services/config';
import { hostClient } from '@/services/log';
import { showToast } from '@/modules/shared/ui-store';
import { tr } from '@/locales';

const describeError = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface Tileset {
  name: string;
  dir: string;
  url: string;
  heightOffset: number;
  scale: number;
  lon: number;   // 手动定位经度(度)；lon=0 & lat=0 = 用瓦片原生 georef
  lat: number;   // 手动定位纬度(度)
  yaw: number;   // 三轴旋转：偏航(度)，绕局部「上」轴；显示朝向错误时微调
  pitch: number; // 三轴旋转：俯仰(度)
  roll: number;  // 三轴旋转：翻滚(度)
  hidden: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// 是否启用手动定位：lon/lat 任一非零即视为手动定位模式（测绘数据落在经纬 0,0 几无可能）。
export function tilesetHasManualPosition(t: Tileset): boolean {
  return t.lon !== 0 || t.lat !== 0;
}

// 3D Tiles 入口 URL：远程走自身 url（Cesium Ion / 外部）；本地走后端 /tiles/<name>/tileset.json 目录服务。
export function tilesetEntryUrl(t: Tileset): string {
  const u = (t.url || '').trim();
  if (u) return u;
  return `tiles/${encodeURIComponent(t.name)}/tileset.json`;
}

export const useTilesetsStore = defineStore('tilesets', () => {
  const tilesets = ref<Tileset[]>([]);
  const loaded = ref(false);
  const panelOpen = ref(false);

  function togglePanel(): void {
    panelOpen.value = !panelOpen.value;
  }
  function openPanel(): void {
    panelOpen.value = true;
  }
  function closePanel(): void {
    panelOpen.value = false;
  }

  // 启动加载全部 3D Tiles（首次进入测绘地图前 earth store 触发）。
  async function loadTilesets(): Promise<void> {
    try {
      const r: unknown = await configClient.listTilesets();
      const payload = r as { tilesets?: Tileset[] };
      tilesets.value = Array.isArray(payload.tilesets) ? payload.tilesets : [];
      loaded.value = true;
    } catch (e: unknown) {
      showToast(tr('tilesets.store.loadFailed', { err: describeError(e) }));
    }
  }

  // 弹原生目录选择框（选含 tileset.json 的文件夹）。copy=true 拷到 exe/tilesets/（返回绝对路径）；false 只引用原目录。
  async function importTilesetDir(copy: boolean): Promise<string> {
    const dir = await hostClient.importTileset(copy);
    return dir || '';
  }

  // 新建/更新（同名覆盖）；成功后用后端返回的最新列表刷新。返回是否成功。
  async function saveTileset(t: Tileset): Promise<boolean> {
    try {
      const r: unknown = await configClient.saveTileset(t);
      const payload = r as { tilesets?: Tileset[] };
      tilesets.value = Array.isArray(payload.tilesets) ? payload.tilesets : tilesets.value;
      return true;
    } catch (e: unknown) {
      showToast(tr('tilesets.store.saveFailed', { err: describeError(e) }));
      return false;
    }
  }

  // 按名删除；成功后用后端返回的最新列表刷新。
  async function removeTileset(name: string): Promise<void> {
    try {
      const r: unknown = await configClient.deleteTileset(name);
      const payload = r as { tilesets?: Tileset[] };
      tilesets.value = Array.isArray(payload.tilesets) ? payload.tilesets : tilesets.value;
    } catch (e: unknown) {
      showToast(tr('tilesets.store.removeFailed', { err: describeError(e) }));
    }
  }

  // === 地图点选拾取位置 ===
  // picking = 当前正为其拾取位置的 tileset 名（null=非拾取）。earth store 的 pick handler 读它。
  const picking = ref<string | null>(null);
  function startPicking(name: string): void { picking.value = name; }
  function cancelPicking(): void { picking.value = null; }
  // 地图点击回调（earth store 调）：就地更新该 tileset lon/lat + 清拾取。不持久化——用户点「完成」才 save。
  function applyPickedPosition(name: string, lon: number, lat: number): void {
    const t = tilesets.value.find((x) => x.name === name);
    if (t) { t.lon = lon; t.lat = lat; }
    picking.value = null;
  }

  return {
    tilesets,
    loaded,
    panelOpen,
    picking,
    togglePanel,
    openPanel,
    closePanel,
    loadTilesets,
    importTilesetDir,
    saveTileset,
    removeTileset,
    startPicking,
    cancelPicking,
    applyPickedPosition,
  };
});
