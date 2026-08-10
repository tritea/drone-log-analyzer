<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useCustomModelsStore, type CustomModel } from '@/modules/custom-models';
import { useMap3dStore } from '@/modules/map-3d';
import { runtime } from '@/modules/shared/runtime';
import { showToast } from '@/modules/shared/ui-store';
import AppIcon from '@/modules/shared/components/AppIcon.vue';
import ModelNumberField from './ModelNumberField.vue';
import ModelPoseField from './ModelPoseField.vue';
import PickLocationHint from './PickLocationHint.vue';

type PoseField = 'lon' | 'lat' | 'alt' | 'yaw' | 'pitch' | 'roll' | 'scale';

const cms = useCustomModelsStore();
const mapLibreStore = useMap3dStore();
const { models, picking } = storeToRefs(cms);

const editingName = ref<string | null>(null);
const selected = computed<CustomModel | null>(() =>
  editingName.value ? models.value.find((m) => m.name === editingName.value) || null : null
);

async function importModel(copy: boolean): Promise<void> {
  const file = await cms.pickModelFile(copy);
  if (!file) return;
  const baseName = file.split(/[\\/]/).pop() || file;
  let name = baseName.replace(/\.(glb|gltf|obj)$/i, '');
  let i = 1;
  while (models.value.some((m) => m.name === name)) name = `${baseName}_${i++}`;
  const center = runtime.mapLibreView?.map.getCenter();
  const m: CustomModel = {
    name, file,
    lon: center ? center.lng : 0,
    lat: center ? center.lat : 0,
    alt: 0, yaw: 0, pitch: 0, roll: 0, scale: 1, hidden: false,
  };
  if (await cms.saveCustomModel(m)) {
    mapLibreStore.syncCustomModels();
    editingName.value = name;
  }
}

function selectEdit(name: string): void {
  if (editingName.value !== name) { gizmoOn.value = false; mapLibreStore.setGizmoActive(false); }
  editingName.value = editingName.value === name ? null : name;
}

function patchName(value: string): void {
  if (selected.value) selected.value.name = value;
}

// 位姿字段变更：就地改 store 选中项 + 图层实时移动（不持久化；GCJ 由 maplibre store 转）。
function patchPose(field: PoseField, value: number): void {
  if (!selected.value || !editingName.value) return;
  selected.value[field] = value;
  const layerPatch: Partial<Record<PoseField, number>> = {};
  layerPatch[field] = value;
  mapLibreStore.updateCustomModelPose(editingName.value, layerPatch);
}

async function finishEdit(): Promise<void> {
  if (selected.value && await cms.saveCustomModel(selected.value)) {
    mapLibreStore.syncCustomModels();
    showToast('已保存');
  }
}

async function remove(name: string): Promise<void> {
  await cms.removeCustomModel(name);
  mapLibreStore.syncCustomModels();
  if (editingName.value === name) { editingName.value = null; gizmoOn.value = false; mapLibreStore.setGizmoActive(false); }
}

// 隐藏/显示切换：不删除，仅临时不渲染（hidden 持久化，下次运行仍隐藏）。
async function toggleHidden(name: string): Promise<void> {
  const m = models.value.find((x) => x.name === name);
  if (!m) return;
  m.hidden = !m.hidden;
  if (await cms.saveCustomModel(m)) mapLibreStore.syncCustomModels();
}

function pickLocation(): void {
  if (editingName.value) cms.startPicking(editingName.value);
}

// 三轴手柄移动开关：开→拦截地图手势 + 显示手柄拖动改经纬高；切模型/删除/关面板时自动关。
const gizmoOn = ref(false);
watch(() => mapLibreStore.customModelsPanelOpen, (op) => { if (!op && gizmoOn.value) { gizmoOn.value = false; mapLibreStore.setGizmoActive(false); } });
function toggleGizmo(): void {
  if (!selected.value) return;
  gizmoOn.value = !gizmoOn.value;
  mapLibreStore.setGizmoActive(gizmoOn.value, selected.value.name);
}
</script>

<template>
  <div class="cm-single">
    <div class="cm-import-row">
      <button class="btn btn-xs" type="button" @click="importModel(true)" title="拷贝到 exe 旁 models/（小模型适用，原文件删除仍可用）"><AppIcon name="plus" :size="13" /> 拷贝导入</button>
      <button class="btn btn-xs" type="button" @click="importModel(false)" title="只引用原路径（大模型适用，不占额外空间；原文件移动/删除后失效）"><AppIcon name="plus" :size="13" /> 引用导入</button>
    </div>

    <div class="cm-list">
      <div v-if="!models.length" class="cm-empty">暂无模型，点上方导入</div>
      <div
        v-for="m in models"
        :key="m.name"
        class="cm-row"
        :class="{ active: editingName === m.name, hidden: m.hidden }"
        @click="selectEdit(m.name)"
      >
        <span class="cm-name" :title="m.name">{{ m.name }}</span>
        <button class="btn btn-xs" type="button" @click.stop="toggleHidden(m.name)" :title="m.hidden ? '显示' : '隐藏'">
          <AppIcon :name="m.hidden ? 'eye-off' : 'eye'" :size="13" />
        </button>
        <button class="btn btn-xs btn-danger" type="button" @click.stop="remove(m.name)" title="删除"><AppIcon name="trash" :size="13" /></button>
      </div>
    </div>

    <div v-if="selected" class="cm-edit">
      <button class="btn btn-xs cm-gizmo" :class="{ active: gizmoOn }" type="button" @click="toggleGizmo" title="开关三轴手柄：拖轴改经纬高（开启时拦截地图操作）"><AppIcon name="move" :size="13" /> 手柄移动</button>
      <label class="cm-field">
        <span>名称</span>
        <input type="text" :value="selected.name" @change="patchName(($event.target as HTMLInputElement).value)" />
      </label>
      <div class="cm-row2">
        <ModelNumberField label="经度" :model-value="selected.lon" :wheel-step="0.0001" @update:model-value="patchPose('lon', $event)" />
        <ModelNumberField label="纬度" :model-value="selected.lat" :wheel-step="0.0001" @update:model-value="patchPose('lat', $event)" />
      </div>
      <button class="btn btn-xs cm-pick" :class="{ active: picking === selected.name }" type="button" @click="pickLocation">
        <AppIcon name="map-pin" :size="13" /> {{ picking === selected.name ? '点击地图放置…' : '点地图放置' }}
      </button>
      <ModelPoseField label="高度(m)" :model-value="selected.alt" :min="-100" :max="500" :step="0.5" :wheel-step="1" @update:model-value="patchPose('alt', $event)" />
      <ModelPoseField label="朝向(°)" :model-value="selected.yaw" :min="-180" :max="180" :step="1" :wheel-step="5" @update:model-value="patchPose('yaw', $event)" />
      <ModelPoseField label="俯仰(°)" :model-value="selected.pitch" :min="-90" :max="90" :step="0.5" :wheel-step="1" @update:model-value="patchPose('pitch', $event)" />
      <ModelPoseField label="翻滚(°)" :model-value="selected.roll" :min="-90" :max="90" :step="0.5" :wheel-step="1" @update:model-value="patchPose('roll', $event)" />
      <ModelPoseField label="缩放" :model-value="selected.scale" :min="0.1" :max="20" :step="0.1" :wheel-step="0.1" @update:model-value="patchPose('scale', $event)" />
      <button class="btn btn-xs cm-save" type="button" @click="finishEdit">完成（保存）</button>
    </div>
  </div>

  <PickLocationHint v-if="picking" :message="`点击地图放置「${picking}」`" @cancel="cms.cancelPicking()" />
</template>
