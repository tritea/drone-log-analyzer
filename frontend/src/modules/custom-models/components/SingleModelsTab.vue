<script setup lang="ts">
import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useCustomModelsStore, type CustomModel } from '@/modules/custom-models';
import { useEarthStore } from '@/modules/earth';
import { showToast } from '@/modules/shared/ui-store';
import { tr } from '@/locales';
import AppIcon from '@/modules/shared/components/AppIcon.vue';
import ModelNumberField from './ModelNumberField.vue';
import ModelPoseField from './ModelPoseField.vue';
import PickLocationHint from './PickLocationHint.vue';

type PoseField = 'lon' | 'lat' | 'alt' | 'yaw' | 'pitch' | 'roll' | 'scale';

const { t } = useI18n();
const cms = useCustomModelsStore();
const earthStore = useEarthStore();
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
  const center = earthStore.getMapCenter();
  const m: CustomModel = {
    name, file,
    lon: center ? center.lng : 0,
    lat: center ? center.lat : 0,
    alt: 0, yaw: 0, pitch: 0, roll: 0, scale: 1, hidden: false,
  };
  if (await cms.saveCustomModel(m)) {
    earthStore.syncCustomModels();
    editingName.value = name;
  }
}

function selectEdit(name: string): void {
  editingName.value = editingName.value === name ? null : name;
}

function patchName(value: string): void {
  if (selected.value) selected.value.name = value;
}

// 位姿字段变更：就地改 store 选中项 + 图层实时移动（不持久化；GCJ 由 earth store 转）。
function patchPose(field: PoseField, value: number): void {
  if (!selected.value || !editingName.value) return;
  selected.value[field] = value;
  const layerPatch: Partial<Record<PoseField, number>> = {};
  layerPatch[field] = value;
  earthStore.updateCustomModelPose(editingName.value, layerPatch);
}

async function finishEdit(): Promise<void> {
  if (selected.value && await cms.saveCustomModel(selected.value)) {
    earthStore.syncCustomModels();
    showToast(tr('customModels.single.saved'));
  }
}

async function remove(name: string): Promise<void> {
  await cms.removeCustomModel(name);
  earthStore.syncCustomModels();
  if (editingName.value === name) editingName.value = null;
}

// 隐藏/显示切换：不删除，仅临时不渲染（hidden 持久化，下次运行仍隐藏）。
async function toggleHidden(name: string): Promise<void> {
  const m = models.value.find((x) => x.name === name);
  if (!m) return;
  m.hidden = !m.hidden;
  if (await cms.saveCustomModel(m)) earthStore.syncCustomModels();
}

function pickLocation(): void {
  if (editingName.value) cms.startPicking(editingName.value);
}
</script>

<template>
  <div class="cm-single">
    <div class="cm-import-row">
      <button class="btn btn-xs" type="button" @click="importModel(true)" :title="t('customModels.single.copyImportTitle')"><AppIcon name="plus" :size="13" /> {{ t('customModels.single.copyImport') }}</button>
      <button class="btn btn-xs" type="button" @click="importModel(false)" :title="t('customModels.single.refImportTitle')"><AppIcon name="plus" :size="13" /> {{ t('customModels.single.refImport') }}</button>
    </div>

    <div class="cm-list">
      <div v-if="!models.length" class="cm-empty">{{ t('customModels.single.empty') }}</div>
      <div
        v-for="m in models"
        :key="m.name"
        class="cm-row"
        :class="{ active: editingName === m.name, hidden: m.hidden }"
        @click="selectEdit(m.name)"
      >
        <span class="cm-name" :title="m.name">{{ m.name }}</span>
        <button class="btn btn-xs" type="button" @click.stop="toggleHidden(m.name)" :title="m.hidden ? t('customModels.single.show') : t('customModels.single.hide')">
          <AppIcon :name="m.hidden ? 'eye-off' : 'eye'" :size="13" />
        </button>
        <button class="btn btn-xs btn-danger" type="button" @click.stop="remove(m.name)" :title="t('common.delete')"><AppIcon name="trash" :size="13" /></button>
      </div>
    </div>

    <div v-if="selected" class="cm-edit">
      <label class="cm-field">
        <span>{{ t('customModels.single.name') }}</span>
        <input type="text" :value="selected.name" @change="patchName(($event.target as HTMLInputElement).value)" />
      </label>
      <div class="cm-row2">
        <ModelNumberField :label="t('customModels.single.lon')" :model-value="selected.lon" :wheel-step="0.0001" @update:model-value="patchPose('lon', $event)" />
        <ModelNumberField :label="t('customModels.single.lat')" :model-value="selected.lat" :wheel-step="0.0001" @update:model-value="patchPose('lat', $event)" />
      </div>
      <button class="btn btn-xs cm-pick" :class="{ active: picking === selected.name }" type="button" @click="pickLocation">
        <AppIcon name="map-pin" :size="13" /> {{ picking === selected.name ? t('customModels.single.pickPlacing') : t('customModels.single.pickButton') }}
      </button>
      <ModelPoseField :label="t('customModels.single.alt')" :model-value="selected.alt" :min="-100" :max="500" :step="0.5" :wheel-step="1" @update:model-value="patchPose('alt', $event)" />
      <ModelPoseField :label="t('customModels.single.yaw')" :model-value="selected.yaw" :min="-180" :max="180" :step="1" :wheel-step="5" @update:model-value="patchPose('yaw', $event)" />
      <ModelPoseField :label="t('customModels.single.pitch')" :model-value="selected.pitch" :min="-90" :max="90" :step="0.5" :wheel-step="1" @update:model-value="patchPose('pitch', $event)" />
      <ModelPoseField :label="t('customModels.single.roll')" :model-value="selected.roll" :min="-90" :max="90" :step="0.5" :wheel-step="1" @update:model-value="patchPose('roll', $event)" />
      <ModelPoseField :label="t('customModels.single.scale')" :model-value="selected.scale" :min="0.1" :max="20" :step="0.1" :wheel-step="0.1" @update:model-value="patchPose('scale', $event)" />
      <button class="btn btn-xs cm-save" type="button" @click="finishEdit">{{ t('customModels.single.finish') }}</button>
    </div>
  </div>

  <PickLocationHint v-if="picking" :message="t('customModels.single.pickHint', { name: picking })" @cancel="cms.cancelPicking()" />
</template>
