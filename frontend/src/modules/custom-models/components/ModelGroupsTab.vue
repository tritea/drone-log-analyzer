<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useCustomModelGroupsStore, type ModelGroup, type ModelGroupTile, parseTileCoords } from '@/modules/custom-models';
import { useCustomModelsStore } from '@/modules/custom-models';
import { useEarthStore } from '@/modules/earth';
import { showToast } from '@/modules/shared/ui-store';
import { tr } from '@/locales';
import { fileBaseName } from '@/modules/shared/utils/format';
import AppIcon from '@/modules/shared/components/AppIcon.vue';
import ModalShell from '@/modules/shared/components/ModalShell.vue';
import ModelNumberField from './ModelNumberField.vue';
import ModelPoseField from './ModelPoseField.vue';
import PickLocationHint from './PickLocationHint.vue';

const { t } = useI18n();
const cmg = useCustomModelGroupsStore();
const cms = useCustomModelsStore();
const earthStore = useEarthStore();
const { groups, picking } = storeToRefs(cmg);

const editingName = ref<string | null>(null);
const selected = computed<ModelGroup | null>(() =>
  editingName.value ? groups.value.find((g) => g.name === editingName.value) || null : null
);
const editingCell = ref<{ r: number; c: number } | null>(null);
const gridOpen = ref(false);
watch(editingName, () => { editingCell.value = null; gridOpen.value = false; });
const selectedTile = computed<ModelGroupTile | null>(() => {
  if (!selected.value || !editingCell.value) return null;
  return selected.value.tiles.find((t) => t.row === editingCell.value!.r && t.col === editingCell.value!.c) || null;
});

async function createGroup(): Promise<void> {
  const base = tr('customModels.group.defaultName');
  let name = base;
  let i = 1;
  while (groups.value.some((g) => g.name === name)) name = `${base}${i++}`;
  const center = earthStore.getMapCenter();
  const g: ModelGroup = {
    name, lon: center ? center.lng : 0, lat: center ? center.lat : 0, alt: 0,
    spacing: 10, rows: 4, cols: 4, yaw: 0, scale: 1, hidden: false, tiles: [],
  };
  if (await cmg.saveModelGroup(g)) {
    earthStore.syncCustomModels();
    editingName.value = name;
  }
}

function selectEdit(name: string): void {
  editingName.value = editingName.value === name ? null : name;
}

// 位姿类字段（中心·bearing·间距·缩放·高度）：改 store + 图层实时联动（不重载 GLB、不持久化）。
function patchField<K extends keyof ModelGroup>(field: K, value: ModelGroup[K]): void {
  if (!selected.value || !editingName.value) return;
  selected.value[field] = value;
  earthStore.syncGroupPose(editingName.value);
}

// 结构类字段（行列）：改 store + 过滤越界 tile + 持久化 + 全量重建。
async function patchSize(field: 'rows' | 'cols', value: number): Promise<void> {
  if (!selected.value) return;
  const v = Math.max(1, Math.floor(value) || 1);
  if (selected.value[field] === v) return;
  selected.value[field] = v;
  selected.value.tiles = selected.value.tiles.filter((t) => t.row < selected.value!.rows && t.col < selected.value!.cols);
  if (editingCell.value && (editingCell.value.r >= selected.value.rows || editingCell.value.c >= selected.value.cols)) editingCell.value = null;
  if (await cmg.saveModelGroup(selected.value)) earthStore.syncCustomModels();
}

// 完成保存（含改名：后端按名 upsert，改名 = 存新名 + 删旧名）。
async function finishEdit(): Promise<void> {
  if (!selected.value) return;
  const oldName = editingName.value;
  const newName = selected.value.name;
  if (await cmg.saveModelGroup(selected.value)) {
    if (oldName && oldName !== newName) await cmg.removeModelGroup(oldName);
    earthStore.syncCustomModels();
    editingName.value = newName;
    showToast(tr('customModels.group.saved'));
  }
}

async function remove(name: string): Promise<void> {
  await cmg.removeModelGroup(name);
  earthStore.syncCustomModels();
  if (editingName.value === name) editingName.value = null;
}

async function toggleHidden(name: string): Promise<void> {
  const g = groups.value.find((x) => x.name === name);
  if (!g) return;
  g.hidden = !g.hidden;
  if (await cmg.saveModelGroup(g)) earthStore.syncCustomModels();
}

function pickLocation(): void {
  if (editingName.value) cmg.startPicking(editingName.value);
}

// === tiles 网格 ===
// 批量导入：多选文件 → 按文件名行列号映射到网格（越界/无行列号留空）→ 持久化 + 全量重建。
async function importTiles(copy: boolean): Promise<void> {
  if (!selected.value) return;
  const files = await cmg.importTiles(copy);
  if (!files.length) return;
  const g = selected.value;
  let mapped = 0;
  let unmapped = 0;
  for (const f of files) {
    const rc = parseTileCoords(f.split(/[\\/]/).pop() || f);
    if (rc && rc.row >= 0 && rc.row < g.rows && rc.col >= 0 && rc.col < g.cols) {
      upsertTile(g, rc.row, rc.col, f);
      mapped++;
    } else unmapped++;
  }
  if (await cmg.saveModelGroup(g)) earthStore.syncCustomModels();
  showToast(tr('customModels.group.toastMapped', {
    mapped,
    extra: unmapped ? tr('customModels.group.toastUnmapped', { n: unmapped }) : '',
  }));
}

function upsertTile(g: ModelGroup, r: number, c: number, file: string): void {
  const t = g.tiles.find((x) => x.row === r && x.col === c);
  if (t) t.file = file;
  else g.tiles.push({ row: r, col: c, file, yaw: 0 });
}

async function cellClick(r: number, c: number): Promise<void> {
  editingCell.value = { r, c };
  if (!selected.value) return;
  const exists = selected.value.tiles.some((t) => t.row === r && t.col === c);
  if (!exists) await changeCellFile(r, c);
}

async function changeCellFile(r: number, c: number): Promise<void> {
  if (!selected.value) return;
  const file = await cms.pickModelFile(false);
  if (!file) return;
  upsertTile(selected.value, r, c, file);
  if (await cmg.saveModelGroup(selected.value)) earthStore.syncCustomModels();
}

async function clearCell(r: number, c: number): Promise<void> {
  if (!selected.value) return;
  selected.value.tiles = selected.value.tiles.filter((t) => !(t.row === r && t.col === c));
  editingCell.value = null;
  if (await cmg.saveModelGroup(selected.value)) earthStore.syncCustomModels();
}

function patchTileYaw(yaw: number): void {
  if (!selected.value || !selectedTile.value || !editingName.value) return;
  selectedTile.value.yaw = yaw;
  earthStore.syncGroupPose(editingName.value);
}

function tileAt(r: number, c: number): ModelGroupTile | undefined {
  if (!selected.value) return undefined;
  return selected.value.tiles.find((t) => t.row === r && t.col === c);
}
</script>

<template>
  <div class="cm-single">
    <div class="cm-import-row">
      <button class="btn btn-xs" type="button" @click="createGroup" :title="t('customModels.group.createTitle')"><AppIcon name="plus" :size="13" /> {{ t('customModels.group.create') }}</button>
    </div>

    <div class="cm-list">
      <div v-if="!groups.length" class="cm-empty">{{ t('customModels.group.empty') }}</div>
      <div
        v-for="g in groups"
        :key="g.name"
        class="cm-row"
        :class="{ active: editingName === g.name, hidden: g.hidden }"
        @click="selectEdit(g.name)"
      >
        <span class="cm-name" :title="t('customModels.group.rowTitle', { name: g.name, rows: g.rows, cols: g.cols, filled: g.tiles.length, total: g.rows * g.cols })">{{ g.name }}</span>
        <button class="btn btn-xs" type="button" @click.stop="toggleHidden(g.name)" :title="g.hidden ? t('customModels.group.show') : t('customModels.group.hide')">
          <AppIcon :name="g.hidden ? 'eye-off' : 'eye'" :size="13" />
        </button>
        <button class="btn btn-xs btn-danger" type="button" @click.stop="remove(g.name)" :title="t('common.delete')"><AppIcon name="trash" :size="13" /></button>
      </div>
    </div>

    <div v-if="selected" class="cm-edit">
      <label class="cm-field">
        <span>{{ t('customModels.group.name') }}</span>
        <input type="text" :value="selected.name" @change="selected.name = ($event.target as HTMLInputElement).value" />
      </label>
      <div class="cm-row2">
        <ModelNumberField :label="t('customModels.group.lon')" :model-value="selected.lon" :wheel-step="0.0001" @update:model-value="patchField('lon', $event)" />
        <ModelNumberField :label="t('customModels.group.lat')" :model-value="selected.lat" :wheel-step="0.0001" @update:model-value="patchField('lat', $event)" />
      </div>
      <button class="btn btn-xs cm-pick" :class="{ active: picking === selected.name }" type="button" @click="pickLocation">
        <AppIcon name="map-pin" :size="13" /> {{ picking === selected.name ? t('customModels.group.pickPlacing') : t('customModels.group.pickButton') }}
      </button>
      <ModelPoseField :label="t('customModels.group.alt')" :model-value="selected.alt" :min="-100" :max="500" :step="0.5" :wheel-step="1" @update:model-value="patchField('alt', $event)" />
      <ModelPoseField :label="t('customModels.group.bearing')" :model-value="selected.yaw" :min="-180" :max="180" :step="1" :wheel-step="5" @update:model-value="patchField('yaw', $event)" />
      <ModelPoseField :label="t('customModels.group.spacing')" :model-value="selected.spacing" :min="1" :max="500" :step="1" :wheel-step="5" @update:model-value="patchField('spacing', $event)" />
      <ModelPoseField :label="t('customModels.group.scale')" :model-value="selected.scale" :min="0.1" :max="20" :step="0.1" :wheel-step="0.1" @update:model-value="patchField('scale', $event)" />
      <div class="cm-row2">
        <ModelNumberField :label="t('customModels.group.rows')" :model-value="selected.rows" :min="1" :max="32" :step="1" commit-only @update:model-value="patchSize('rows', $event)" />
        <ModelNumberField :label="t('customModels.group.cols')" :model-value="selected.cols" :min="1" :max="32" :step="1" commit-only @update:model-value="patchSize('cols', $event)" />
      </div>

      <button class="btn btn-xs cm-grid-open" type="button" @click="gridOpen = true" :title="t('customModels.group.gridButtonTitle')">
        <AppIcon name="grid" :size="13" /> {{ t('customModels.group.gridButton', { filled: selected.tiles.length, total: selected.rows * selected.cols }) }}
      </button>

      <button class="btn btn-xs cm-save" type="button" @click="finishEdit">{{ t('customModels.group.finish') }}</button>
    </div>
  </div>

  <ModalShell
    v-if="selected"
    :open="gridOpen"
    variant="group-grid-modal"
    :title="t('customModels.group.gridTitle', { name: selected.name, rows: selected.rows, cols: selected.cols })"
    @close="gridOpen = false"
  >
    <div class="cm-grid-modal-body">
      <div class="cm-import-row">
        <button class="btn btn-xs" type="button" @click="importTiles(true)" :title="t('customModels.group.batchCopyImportTitle')"><AppIcon name="plus" :size="13" /> {{ t('customModels.group.batchCopyImport') }}</button>
        <button class="btn btn-xs" type="button" @click="importTiles(false)" :title="t('customModels.group.batchRefImportTitle')"><AppIcon name="plus" :size="13" /> {{ t('customModels.group.batchRefImport') }}</button>
      </div>
      <div class="cm-grid-hint">{{ t('customModels.group.gridHint', { filled: selected.tiles.length, total: selected.rows * selected.cols }) }}</div>
      <div class="cm-grid" :style="{ gridTemplateColumns: `repeat(${selected.cols}, 38px)` }">
        <template v-for="r in selected.rows" :key="r">
          <div
            v-for="c in selected.cols"
            :key="r + '_' + c"
            class="cm-cell"
            :class="{ filled: !!tileAt(r - 1, c - 1), sel: editingCell && editingCell.r === r - 1 && editingCell.c === c - 1 }"
            :title="tileAt(r - 1, c - 1) ? t('customModels.group.cellTitleFilled', { file: fileBaseName(tileAt(r - 1, c - 1)!.file), yaw: tileAt(r - 1, c - 1)!.yaw }) : t('customModels.group.cellTitleEmpty', { row: r, col: c })"
            @click="cellClick(r - 1, c - 1)"
          >
            <span v-if="tileAt(r - 1, c - 1)" class="cm-cell-arrow" :style="{ transform: `rotate(${tileAt(r - 1, c - 1)!.yaw}deg)` }" />
            <span v-else class="cm-cell-plus">+</span>
          </div>
        </template>
      </div>

      <div v-if="editingCell" class="cm-cell-edit">
        <div class="cm-cell-edit-head">
          <span>{{ t('customModels.group.cellHead', { row: editingCell.r + 1, col: editingCell.c + 1 }) }}</span>
          <button class="btn btn-xs" type="button" @click="changeCellFile(editingCell.r, editingCell.c)">{{ selectedTile ? t('customModels.group.changeFile') : t('customModels.group.assignFile') }}</button>
          <button v-if="selectedTile" class="btn btn-xs btn-danger" type="button" @click="clearCell(editingCell.r, editingCell.c)">{{ t('customModels.group.clearCell') }}</button>
        </div>
        <div v-if="selectedTile" class="cm-cell-file" :title="selectedTile.file"><AppIcon name="folder" :size="13" /> {{ fileBaseName(selectedTile.file) }}</div>
        <ModelPoseField v-if="selectedTile" :label="t('customModels.group.cellYaw')" :model-value="selectedTile.yaw" :min="-180" :max="180" :step="1" @update:model-value="patchTileYaw($event)" />
      </div>
    </div>
    <template #actions>
      <button class="btn btn-primary" type="button" @click="gridOpen = false">{{ t('common.done') }}</button>
    </template>
  </ModalShell>

  <PickLocationHint v-if="picking" :message="t('customModels.group.pickHint', { name: picking })" @cancel="cmg.cancelPicking()" />
</template>

<style scoped>
.cm-grid-hint { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
.cm-grid-open { width: 100%; margin-bottom: 8px; }
.cm-grid { display: grid; gap: 4px; margin-bottom: 8px; justify-content: center; }
.cm-grid-modal-body { flex: 1; min-height: 0; overflow: auto; padding: 10px 12px; }
.cm-cell {
  width: 38px; height: 38px; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; color: #9ca3af;
  overflow: hidden; background: #fff; position: relative;
}
.cm-cell-arrow { position: relative; width: 16px; height: 22px; transform-origin: 50% 50%; transition: transform 0.1s; }
.cm-cell-arrow::before {
  content: ''; position: absolute; top: 0; left: 0;
  width: 0; height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 10px solid #1e40af;
}
.cm-cell-arrow::after {
  content: ''; position: absolute; top: 9px; left: 6px;
  width: 4px; height: 12px; background: #1e40af;
}
.cm-cell-plus { font-size: 14px; }
.cm-cell:hover { background: #f3f4f6; }
.cm-cell.filled { background: #dbeafe; color: #1e40af; border-color: #93c5fd; }
.cm-cell.sel { outline: 2px solid #2563eb; }
.cm-cell-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 2px; max-width: 100%; }
.cm-cell-edit { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; background: #f9fafb; }
.cm-cell-edit-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #4b5563; gap: 4px; }
.cm-cell-edit-head span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-cell-file { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #374151; margin: 4px 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
