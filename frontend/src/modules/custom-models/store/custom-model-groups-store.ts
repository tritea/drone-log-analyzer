import { defineStore } from 'pinia';
import { ref } from 'vue';
import { configClient } from '@/services/config';
import { hostClient } from '@/services/log';
import { showToast } from '@/modules/shared/ui-store';
import { tr } from '@/locales';
import type { CustomModelSpec } from '@/modules/custom-models/types';

const describeError = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface ModelGroupTile {
  row: number;
  col: number;
  file: string; 
  yaw: number; 
}

export interface ModelGroup {
  name: string;
  lon: number; 
  lat: number; 
  alt: number; 
  spacing: number; 
  rows: number; 
  cols: number; 
  yaw: number; 
  scale: number; 
  hidden: boolean; 
  tiles: ModelGroupTile[]; 
  createdAt?: string;
  updatedAt?: string;
}

const METERS_PER_DEG_LAT = 110540;
const METERS_PER_DEG_LON = 111320;

export function tileName(groupName: string, row: number, col: number): string {
  return `${groupName}#${row}_${col}`;
}
// 虚拟锚点（组中心）spec 名前缀：锚点 url='' 不加载 GLB、不渲染，但存在于图层 customModels
// 列表，供电图层 gizmo / 拾取「按名查找」定位组中心——复用单个模型的 gizmo 机制，渲染层零改。
export const ANCHOR_PREFIX = '__grp_';
export function anchorName(groupName: string): string {
  return ANCHOR_PREFIX + groupName;
}
// 反解：若 name 是组锚点名，返回组名；否则 null。
export function groupNameOfAnchor(name: string): string | null {
  return name.startsWith(ANCHOR_PREFIX) ? name.slice(ANCHOR_PREFIX.length) : null;
}

// 文件名→网格行列：去扩展名后取前两个整数，第一个=row 第二个=col；不足两个→null（留空手动补）。
// 覆盖 tile_2_3 / r2_c3 / row2_col3 / 2_3 等命名。越界(≥rows/cols)由调用方过滤。
export function parseTileCoords(fileName: string): { row: number; col: number } | null {
  const stem = fileName.replace(/\.[^.]+$/, '');
  const nums = stem.match(/\d+/g);
  if (!nums || nums.length < 2) return null;
  const row = parseInt(nums[0], 10);
  const col = parseInt(nums[1], 10);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { row, col };
}

// 算一个 tile 相对组中心的绝对经纬度（WGS-84，平面小区域近似）+ 组 bearing 旋转。
// row 0 在最北；bearing 从北顺时针。纯函数（expandGroupToSpecs / maplibre store syncGroupPose 共用）。
export function tileLatLng(
  g: Pick<ModelGroup, 'lon' | 'lat' | 'spacing' | 'rows' | 'cols' | 'yaw'>,
  row: number,
  col: number,
): { lon: number; lat: number } {
  const halfR = (g.rows - 1) / 2;
  const halfC = (g.cols - 1) / 2;
  const eL = (col - halfC) * g.spacing; // 局部东向米
  const nL = (halfR - row) * g.spacing; // 局部北向米（row 0 在最北）
  const b = (g.yaw * Math.PI) / 180; // bearing 从北顺时针
  const eW = eL * Math.cos(b) + nL * Math.sin(b);
  const nW = -eL * Math.sin(b) + nL * Math.cos(b);
  const cosLat = Math.cos((g.lat * Math.PI) / 180) || 1e-6;
  return {
    lon: g.lon + eW / (cosLat * METERS_PER_DEG_LON),
    lat: g.lat + nW / METERS_PER_DEG_LAT,
  };
}

// 展开一个组为图层 CustomModelSpec[]：每格 tile 一个 spec + 末尾虚拟锚点 spec。
// 坐标为 WGS-84；GCJ-02 转换由 maplibre store 在 syncCustomModels 逐 spec 做（与单个模型一致）。
// modelUrlFn 注入（复用 custom-models store.modelUrl = `model-file?path=...`），保持纯函数。
export function expandGroupToSpecs(
  g: ModelGroup,
  modelUrlFn: (file: string) => string,
): CustomModelSpec[] {
  const specs: CustomModelSpec[] = [];
  for (const t of g.tiles) {
    if (!t.file) continue;
    const { lon, lat } = tileLatLng(g, t.row, t.col);
    specs.push({
      name: tileName(g.name, t.row, t.col),
      url: modelUrlFn(t.file),
      lon, lat, alt: g.alt,
      yaw: t.yaw, pitch: 0, roll: 0,
      scale: g.scale,
      hidden: !!g.hidden,
    });
  }
  // 虚拟锚点：组中心位置 + 组 scale（gizmo 尺寸用），url='' 不加载/不渲染。
  specs.push({
    name: anchorName(g.name),
    url: '',
    lon: g.lon, lat: g.lat, alt: g.alt,
    yaw: 0, pitch: 0, roll: 0,
    scale: g.scale,
    hidden: !!g.hidden,
  });
  return specs;
}

export const useCustomModelGroupsStore = defineStore('custom-model-groups', () => {
  const groups = ref<ModelGroup[]>([]);
  const loaded = ref(false);

  // 启动加载全部组（app 启动或首次进入 3D 地图前调一次）。
  async function loadModelGroups(): Promise<void> {
    try {
      const r: unknown = await configClient.listModelGroups();
      const payload = r as { groups?: ModelGroup[] };
      groups.value = Array.isArray(payload.groups) ? payload.groups : [];
      loaded.value = true;
    } catch (e: unknown) {
      showToast(tr('customModels.store.groupLoadFailed', { err: describeError(e) }));
    }
  }

  // 新建/更新组（同名覆盖）；成功后用后端返回的最新列表刷新。返回是否成功。
  async function saveModelGroup(g: ModelGroup): Promise<boolean> {
    try {
      const r: unknown = await configClient.saveModelGroup(g);
      const payload = r as { groups?: ModelGroup[] };
      groups.value = Array.isArray(payload.groups) ? payload.groups : groups.value;
      return true;
    } catch (e: unknown) {
      showToast(tr('customModels.store.groupSaveFailed', { err: describeError(e) }));
      return false;
    }
  }

  // 按名删除组；成功后用后端返回的最新列表刷新。
  async function removeModelGroup(name: string): Promise<void> {
    try {
      const r: unknown = await configClient.deleteModelGroup(name);
      const payload = r as { groups?: ModelGroup[] };
      groups.value = Array.isArray(payload.groups) ? payload.groups : groups.value;
    } catch (e: unknown) {
      showToast(tr('customModels.store.groupRemoveFailed', { err: describeError(e) }));
    }
  }

  // 批量多选模型文件（组导入用）；返回绝对路径数组（用户取消返回空数组）。
  async function importTiles(copy: boolean): Promise<string[]> {
    try {
      return await hostClient.importModels(copy);
    } catch (e: unknown) {
      showToast(tr('customModels.store.importFailed', { err: describeError(e) }));
      return [];
    }
  }

  // === 组中心点选拾取位置 ===（仿 custom-models store）
  // picking = 当前正为其拾取组中心的组名（null=非拾取）。maplibre store 的地图 click handler 读它。
  const picking = ref<string | null>(null);
  function startPicking(name: string): void { picking.value = name; }
  function cancelPicking(): void { picking.value = null; }
  // 地图点击回调（maplibre store 调）：就地更新该组 lon/lat + 清拾取。不持久化——用户点「完成」才 save。
  function applyPickedPosition(name: string, lon: number, lat: number): void {
    const g = groups.value.find((x) => x.name === name);
    if (g) { g.lon = lon; g.lat = lat; }
    picking.value = null;
  }

  return {
    groups,
    loaded,
    picking,
    loadModelGroups,
    saveModelGroup,
    removeModelGroup,
    importTiles,
    startPicking,
    cancelPicking,
    applyPickedPosition,
  };
});
