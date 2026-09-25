<script setup lang="ts">
import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useTilesetsStore, type Tileset } from '@/modules/tilesets';
import { useEarthStore } from '@/modules/earth';
import { showToast } from '@/modules/shared/ui-store';
import { tr } from '@/locales';
import AppIcon from '@/modules/shared/components/AppIcon.vue';
import ModelPoseField from '@/modules/custom-models/components/ModelPoseField.vue';
import PickLocationHint from '@/modules/custom-models/components/PickLocationHint.vue';

const { t } = useI18n();
const cts = useTilesetsStore();
const earthStore = useEarthStore();
const { tilesets, picking } = storeToRefs(cts);

const editingName = ref<string | null>(null);
const selected = computed<Tileset | null>(() =>
  editingName.value ? tilesets.value.find((t) => t.name === editingName.value) || null : null
);

// 弹目录选择框导入 3D Tiles（含 tileset.json）。copy=true 拷到 exe/tilesets/；false 原位引用。
async function importTileset(copy: boolean): Promise<void> {
  const dir = await cts.importTilesetDir(copy);
  if (!dir) return;
  const baseName = dir.split(/[\\/]/).pop() || dir;
  let name = baseName;
  let i = 1;
  while (tilesets.value.some((t) => t.name === name)) name = `${baseName}_${i++}`;
  const t: Tileset = { name, dir, url: '', heightOffset: 0, scale: 1, lon: 0, lat: 0, yaw: 0, pitch: 0, roll: 0, hidden: false };
  if (await cts.saveTileset(t)) {
    earthStore.syncTilesets();
    editingName.value = name;
  }
}

function selectEdit(name: string): void {
  editingName.value = editingName.value === name ? null : name;
}

function patchName(value: string): void {
  if (selected.value) selected.value.name = value;
}

// heightOffset 即时改 modelMatrix（不重载瓦片）；不持久化——点「完成」才 save。
function patchHeightOffset(value: number): void {
  if (!selected.value || !editingName.value) return;
  selected.value.heightOffset = value;
  earthStore.updateTilesetTransform(editingName.value);
}

// 经度/纬度/缩放即时改 modelMatrix（手动定位模式）；不持久化——点「完成」才 save。
function patchLon(value: number): void {
  if (!selected.value || !editingName.value) return;
  selected.value.lon = value;
  earthStore.updateTilesetTransform(editingName.value);
}
function patchLat(value: number): void {
  if (!selected.value || !editingName.value) return;
  selected.value.lat = value;
  earthStore.updateTilesetTransform(editingName.value);
}
function patchScale(value: number): void {
  if (!selected.value || !editingName.value) return;
  selected.value.scale = value;
  earthStore.updateTilesetTransform(editingName.value);
}

// 朝向/俯仰/翻滚即时改 modelMatrix（绕模型中心旋转，两种定位模式均生效）；不持久化——点「完成」才 save。
function patchYaw(value: number): void {
  if (!selected.value || !editingName.value) return;
  selected.value.yaw = value;
  earthStore.updateTilesetTransform(editingName.value);
}
function patchPitch(value: number): void {
  if (!selected.value || !editingName.value) return;
  selected.value.pitch = value;
  earthStore.updateTilesetTransform(editingName.value);
}
function patchRoll(value: number): void {
  if (!selected.value || !editingName.value) return;
  selected.value.roll = value;
  earthStore.updateTilesetTransform(editingName.value);
}

function pickLocation(): void {
  if (editingName.value) cts.startPicking(editingName.value);
}

async function finishEdit(): Promise<void> {
  if (selected.value && await cts.saveTileset(selected.value)) {
    showToast(tr('tilesets.panel.saved'));
  }
}

async function remove(name: string): Promise<void> {
  await cts.removeTileset(name);
  earthStore.syncTilesets();
  if (editingName.value === name) editingName.value = null;
}

// 隐藏/显示：不删除，仅临时不渲染（hidden 持久化）。
async function toggleHidden(name: string): Promise<void> {
  const t = tilesets.value.find((x) => x.name === name);
  if (!t) return;
  t.hidden = !t.hidden;
  if (await cts.saveTileset(t)) earthStore.syncTilesets();
}

function locate(name: string): void {
  earthStore.focusTileset(name);
}
</script>

<template>
  <div class="custom-models-panel tilesets-panel">
    <div class="cm-head">
      <strong>{{ t('tilesets.panel.title') }}</strong>
      <button class="btn-icon" type="button" @click="cts.closePanel()" :title="t('tilesets.panel.closeTitle')">
        <AppIcon name="close" :size="15" />
      </button>
    </div>

    <div class="cm-import-row">
      <button class="btn btn-xs" type="button" @click="importTileset(false)" :title="t('tilesets.panel.importDirTitle')"><AppIcon name="plus" :size="13" /> {{ t('tilesets.panel.importDir') }}</button>
      <button class="btn btn-xs" type="button" @click="importTileset(true)" :title="t('tilesets.panel.copyImportTitle')"><AppIcon name="plus" :size="13" /> {{ t('tilesets.panel.copyImport') }}</button>
    </div>

    <div class="cm-list">
      <div v-if="!tilesets.length" class="cm-empty">{{ t('tilesets.panel.empty') }}</div>
      <div
        v-for="ts in tilesets"
        :key="ts.name"
        class="cm-row"
        :class="{ active: editingName === ts.name, hidden: ts.hidden }"
        @click="selectEdit(ts.name)"
      >
        <span class="cm-name" :title="ts.name">{{ ts.name }}</span>
        <button class="btn btn-xs" type="button" @click.stop="locate(ts.name)" :title="t('tilesets.panel.locateTitle')"><AppIcon name="map-pin" :size="13" /></button>
        <button class="btn btn-xs" type="button" @click.stop="toggleHidden(ts.name)" :title="ts.hidden ? t('tilesets.panel.show') : t('tilesets.panel.hide')">
          <AppIcon :name="ts.hidden ? 'eye-off' : 'eye'" :size="13" />
        </button>
        <button class="btn btn-xs btn-danger" type="button" @click.stop="remove(ts.name)" :title="t('common.delete')"><AppIcon name="trash" :size="13" /></button>
      </div>
    </div>

    <div v-if="selected" class="cm-edit">
      <label class="cm-field">
        <span>{{ t('tilesets.panel.name') }}</span>
        <input type="text" :value="selected.name" @change="patchName(($event.target as HTMLInputElement).value)" />
      </label>
      <div class="cm-row2">
        <label class="cm-field">
          <span>{{ t('tilesets.panel.lon') }}</span>
          <input type="number" step="0.0001" :value="selected.lon" @change="patchLon(parseFloat(($event.target as HTMLInputElement).value) || 0)" />
        </label>
        <label class="cm-field">
          <span>{{ t('tilesets.panel.lat') }}</span>
          <input type="number" step="0.0001" :value="selected.lat" @change="patchLat(parseFloat(($event.target as HTMLInputElement).value) || 0)" />
        </label>
      </div>
      <button class="btn btn-xs cm-pick" :class="{ active: picking === selected.name }" type="button" @click="pickLocation">
        <AppIcon name="map-pin" :size="13" /> {{ picking === selected.name ? t('tilesets.panel.pickPlacing') : t('tilesets.panel.pickButton') }}
      </button>
      <label class="cm-field">
        <span>{{ t('tilesets.panel.heightOffset') }}</span>
        <input type="number" step="1" :value="selected.heightOffset" @change="patchHeightOffset(parseFloat(($event.target as HTMLInputElement).value) || 0)" />
      </label>
      <label class="cm-field">
        <span>{{ t('tilesets.panel.scale') }}</span>
        <input type="number" step="0.1" min="0.1" :value="selected.scale" @change="patchScale(parseFloat(($event.target as HTMLInputElement).value) || 0)" />
      </label>
      <ModelPoseField :label="t('tilesets.panel.yaw')" :model-value="selected.yaw" :min="-180" :max="180" :step="1" :wheel-step="5" @update:model-value="patchYaw($event)" />
      <ModelPoseField :label="t('tilesets.panel.pitch')" :model-value="selected.pitch" :min="-90" :max="90" :step="0.5" :wheel-step="1" @update:model-value="patchPitch($event)" />
      <ModelPoseField :label="t('tilesets.panel.roll')" :model-value="selected.roll" :min="-90" :max="90" :step="0.5" :wheel-step="1" @update:model-value="patchRoll($event)" />
      <p class="cm-hint">{{ t('tilesets.panel.hint') }}</p>
      <button class="btn btn-xs cm-save" type="button" @click="finishEdit">{{ t('tilesets.panel.finish') }}</button>
    </div>
    <PickLocationHint v-if="picking" :message="t('tilesets.panel.pickHint', { name: picking })" @cancel="cts.cancelPicking()" />
  </div>
</template>

<style scoped>
.cm-hint { margin: 6px 0 0; font-size: 11px; color: #9ca3af; line-height: 1.4; }
</style>
