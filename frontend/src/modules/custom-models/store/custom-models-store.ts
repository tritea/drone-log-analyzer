import { defineStore } from 'pinia';
import { ref } from 'vue';
import { configClient } from '@/services/config';
import { hostClient } from '@/services/log';
import { showToast } from '@/modules/shared/ui-store';

const describeError = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface CustomModel {
  name: string;
  file: string; 
  lon: number;
  lat: number;
  alt: number; 
  yaw: number; 
  pitch: number; 
  roll: number; 
  scale: number; 
  hidden: boolean; 
  createdAt?: string;
  updatedAt?: string;
}

export const useCustomModelsStore = defineStore('custom-models', () => {
  const models = ref<CustomModel[]>([]);
  const loaded = ref(false);

  function modelUrl(file: string): string {
    return `model-file?path=${encodeURIComponent(file)}`;
  }

  // 启动加载全部模型（app 启动或首次进入 3D 地图前调一次）。
  async function loadCustomModels(): Promise<void> {
    try {
      const r: unknown = await configClient.listCustomModels();
      const payload = r as { models?: CustomModel[] };
      models.value = Array.isArray(payload.models) ? payload.models : [];
      loaded.value = true;
    } catch (e: unknown) {
      showToast('加载自定义模型失败：' + describeError(e));
    }
  }

  // 弹原生对话框选 .glb。copy=true 拷贝到 exe/models/（返回绝对路径）；false 只引用原路径。
  async function pickModelFile(copy: boolean): Promise<string> {
    const file = await hostClient.importModel(copy);
    return file || '';
  }

  // 新建/更新模型（同名覆盖）；成功后用后端返回的最新列表刷新。返回是否成功。
  async function saveCustomModel(model: CustomModel): Promise<boolean> {
    try {
      const r: unknown = await configClient.saveCustomModel(model);
      const payload = r as { models?: CustomModel[] };
      models.value = Array.isArray(payload.models) ? payload.models : models.value;
      return true;
    } catch (e: unknown) {
      showToast('保存模型失败：' + describeError(e));
      return false;
    }
  }

  // 按名删除模型；成功后用后端返回的最新列表刷新。
  async function removeCustomModel(name: string): Promise<void> {
    try {
      const r: unknown = await configClient.deleteCustomModel(name);
      const payload = r as { models?: CustomModel[] };
      models.value = Array.isArray(payload.models) ? payload.models : models.value;
    } catch (e: unknown) {
      showToast('删除模型失败：' + describeError(e));
    }
  }

  // === 地图点选拾取位置 ===
  // picking = 当前正为其拾取位置的模型名（null=非拾取模式）。maplibre store 的地图 click handler 读它。
  const picking = ref<string | null>(null);
  function startPicking(name: string): void { picking.value = name; }
  function cancelPicking(): void { picking.value = null; }
  // 地图点击回调（maplibre store 调）：就地更新该模型 lon/lat + 清拾取。不持久化——用户点「完成」才 save。
  function applyPickedPosition(name: string, lon: number, lat: number): void {
    const m = models.value.find((x) => x.name === name);
    if (m) { m.lon = lon; m.lat = lat; }
    picking.value = null;
  }

  return {
    models,
    loaded,
    picking,
    modelUrl,
    loadCustomModels,
    pickModelFile,
    saveCustomModel,
    removeCustomModel,
    startPicking,
    cancelPicking,
    applyPickedPosition,
  };
});
