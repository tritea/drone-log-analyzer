<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useFlightMetricsStore } from '@/modules/flight-metrics';
import { useLogStore } from '@/modules/log';
import { conversionPresets } from '@/modules/flight-metrics/utils/flight-fields';
import { tryFloat } from '@/modules/shared/utils/format';
import AppButton from '@/modules/shared/components/AppButton.vue';
import ModalShell from '@/modules/shared/components/ModalShell.vue';
import type { MessageType, MetricBarOrient, MetricFieldSettings, MetricRender } from '@/types';

const { t } = useI18n();
const metricsStore = useFlightMetricsStore();
const logStore = useLogStore();
const { flightMetrics } = storeToRefs(metricsStore);
const { log } = storeToRefs(logStore);

// ===== 对话框开关 / 标题 =====
const open = computed(() => flightMetrics.value.picker.open);
const isEdit = computed(() => !!flightMetrics.value.picker.editingId);
const title = computed(() =>
  isEdit.value
    ? t('flightMetrics.dialog.editTitle', { name: flightMetrics.value.picker.name || t('flightMetrics.dialog.fallbackName') })
    : t('flightMetrics.dialog.addTitle'),
);

// ===== 已选字段及类型提示 =====
const selectedFields = computed(() => metricsStore.selectedPickerFields());
const selectedCount = computed(() => selectedFields.value.length);
const kindHint = computed(() => {
  const n = selectedCount.value;
  if (n === 0) return t('flightMetrics.dialog.kindHint.none');
  if (n === 1) return t('flightMetrics.dialog.kindHint.single');
  return t('flightMetrics.dialog.kindHint.group');
});

// ===== 字段树（按搜索词过滤类型/字段） =====
const hasFilter = computed(() => flightMetrics.value.picker.filter.trim().length > 0);
const filteredTypes = computed<MessageType[]>(() => {
  const needle = flightMetrics.value.picker.filter.trim().toLowerCase();
  const types = log.value.messageTypes || [];
  if (!needle) return types;
  const out: MessageType[] = [];
  for (const mt of types) {
    const typeHit = mt.name.toLowerCase().indexOf(needle) >= 0;
    const fields = (mt.fields || []).filter((fld) => typeHit || fld.toLowerCase().indexOf(needle) >= 0);
    if (typeHit || fields.length) out.push({ name: mt.name, count: mt.count, fields });
  }
  return out;
});
const noLog = computed(() => !log.value.messageTypes || log.value.messageTypes.length === 0);

function isGroupOpen(name: string): boolean {
  return !!flightMetrics.value.picker.expanded[name];
}
function splitKey(key: string): { type: string; field: string } {
  const i = key.indexOf('.');
  return i >= 0 ? { type: key.slice(0, i), field: key.slice(i + 1) } : { type: '', field: key };
}

// ===== 字段设置读取 =====
function settingsOf(key: string): MetricFieldSettings {
  return flightMetrics.value.picker.fieldSettings[key] || metricsStore.makeFieldSettings();
}
function presetsOf(key: string) {
  return conversionPresets(settingsOf(key).origUnit);
}

// ===== 单位换算模式（原始 / 预设 / 自定义） =====
// 自定义模式用独立 ref 标记，以便切回预设/原始时恢复受控输入。
const customChosen = ref<Record<string, boolean>>({});
watch(
  () => flightMetrics.value.picker.open,
  (isOpen) => {
    if (!isOpen) return;
    const next: Record<string, boolean> = {};
    for (const key of metricsStore.selectedPickerFields()) {
      const fs = settingsOf(key);
      const isOriginal = fs.unitMul === 1 && (!fs.unit || fs.unit === fs.origUnit);
      const isPreset = conversionPresets(fs.origUnit).some((p) => p.mul === fs.unitMul && p.unit === fs.unit);
      next[key] = !isOriginal && !isPreset;
    }
    customChosen.value = next;
  },
);

function convModeFor(key: string): string {
  if (customChosen.value[key]) return 'custom';
  const fs = settingsOf(key);
  if (fs.unitMul === 1 && (!fs.unit || fs.unit === fs.origUnit)) return 'original';
  const match = presetsOf(key).find((p) => p.mul === fs.unitMul && p.unit === fs.unit);
  return match ? match.key : 'custom';
}
function onConvMode(key: string, e: Event): void {
  const v = (e.target as HTMLSelectElement).value;
  const fs = settingsOf(key);
  customChosen.value = { ...customChosen.value, [key]: v === 'custom' };
  if (v === 'original') {
    metricsStore.setPickerFieldConversion(key, 1, fs.origUnit);
  } else if (v !== 'custom') {
    const p = presetsOf(key).find((pp) => pp.key === v);
    if (p) metricsStore.setPickerFieldConversion(key, p.mul, p.unit);
  }
}
function onMul(key: string, e: Event): void {
  metricsStore.setPickerFieldConversion(key, tryFloat((e.target as HTMLInputElement).value, 1), settingsOf(key).unit);
}
function onUnit(key: string, e: Event): void {
  const cur = settingsOf(key);
  metricsStore.setPickerFieldConversion(key, isFinite(cur.unitMul) ? cur.unitMul : 1, (e.target as HTMLInputElement).value);
}
function onMin(key: string, e: Event): void {
  metricsStore.setPickerFieldMinMax(key, (e.target as HTMLInputElement).value, settingsOf(key).maxInput);
}
function onMax(key: string, e: Event): void {
  metricsStore.setPickerFieldMinMax(key, settingsOf(key).minInput, (e.target as HTMLInputElement).value);
}

// ===== 项元信息（名称/渲染/方向） =====
function onName(e: Event): void {
  metricsStore.setPickerName((e.target as HTMLInputElement).value);
}
function onRender(e: Event): void {
  metricsStore.setPickerRender((e.target as HTMLSelectElement).value as MetricRender);
}
function onOrient(e: Event): void {
  metricsStore.setPickerOrient((e.target as HTMLSelectElement).value as MetricBarOrient);
}

// ===== 动作 =====
function close(): void {
  metricsStore.closePicker();
}
function confirm(): void {
  void metricsStore.confirmPicker();
}
function onDelete(): void {
  const id = flightMetrics.value.picker.editingId;
  if (id) metricsStore.removeItem(id);
  metricsStore.closePicker();
}
</script>

<template>
  <ModalShell :open="open" variant="metric-dialog-modal" :title="title" @close="close">
    <div class="field-edit-toolbar metric-dialog-toolbar">
      <label class="param-row">
        <span class="param-tag">{{ t('flightMetrics.dialog.name') }}</span>
        <input class="param-input" :value="flightMetrics.picker.name" @input="onName" :placeholder="t('flightMetrics.dialog.namePlaceholder')" />
      </label>
      <label class="param-row">
        <span class="param-tag">{{ t('flightMetrics.dialog.render') }}</span>
        <select class="param-input" :value="flightMetrics.picker.render" @change="onRender">
          <option value="number">{{ t('flightMetrics.dialog.renderNumber') }}</option>
          <option value="bar">{{ t('flightMetrics.dialog.renderBar') }}</option>
        </select>
      </label>
      <label v-if="selectedCount > 1 && flightMetrics.picker.render === 'bar'" class="param-row">
        <span class="param-tag">{{ t('flightMetrics.dialog.orient') }}</span>
        <select class="param-input" :value="flightMetrics.picker.orient" @change="onOrient">
          <option value="vertical">{{ t('flightMetrics.dialog.orientVertical') }}</option>
          <option value="horizontal">{{ t('flightMetrics.dialog.orientHorizontal') }}</option>
        </select>
      </label>
      <span class="field-edit-count">{{ selectedCount }} selected · {{ kindHint }}</span>
    </div>

    <div class="field-edit-body">
      <div class="field-edit-picker">
        <div class="field-edit-picker-head">
          <strong>{{ t('flightMetrics.dialog.fieldsTitle') }}</strong>
          <input class="input-sm" v-model="flightMetrics.picker.filter" :placeholder="t('common.search')" />
        </div>
        <div class="field-edit-picker-list">
          <div v-if="noLog" class="empty-hint">{{ t('flightMetrics.dialog.noLog') }}</div>
          <div v-for="mt in filteredTypes" :key="'pick-' + mt.name" class="tree-group">
            <div
              class="simple-picker-type"
              :class="{ 'is-open': isGroupOpen(mt.name) || hasFilter }"
              @click="metricsStore.togglePickerGroup(mt.name)"
            >
              <span class="caret" :class="{ 'is-open': isGroupOpen(mt.name) || hasFilter }">▶</span>
              <span class="simple-picker-type-name">{{ mt.name }}</span>
              <span class="simple-picker-type-meta">{{ mt.fields.length }}</span>
            </div>
            <div v-show="isGroupOpen(mt.name) || hasFilter" class="simple-picker-fields">
              <label
                v-for="fld in mt.fields"
                :key="'pick-' + mt.name + '.' + fld"
                class="simple-picker-field"
                :class="{ 'is-active': !!flightMetrics.picker.selected[mt.name + '.' + fld] }"
              >
                <input
                  type="checkbox"
                  :checked="!!flightMetrics.picker.selected[mt.name + '.' + fld]"
                  @change="metricsStore.togglePickerField(mt.name + '.' + fld)"
                />
                <span>{{ fld }}</span>
              </label>
            </div>
          </div>
          <div v-if="!noLog && !filteredTypes.length" class="empty-hint">{{ t('flightMetrics.dialog.noMatch') }}</div>
        </div>
      </div>

      <div class="field-edit-selected">
        <div class="field-edit-selected-head">
          <strong>{{ t('flightMetrics.dialog.selectedTitle') }}</strong>
          <span>{{ t('flightMetrics.dialog.selectedHint', { n: selectedCount }) }}</span>
        </div>
        <div v-if="selectedCount" class="metric-field-row metric-field-head" :class="{ 'mf-row-bar': flightMetrics.picker.render === 'bar' }">
          <span class="metric-field-key">{{ t('flightMetrics.dialog.colField') }}</span>
          <template v-if="flightMetrics.picker.render === 'bar'">
            <span class="mf-cell mf-min">{{ t('flightMetrics.dialog.colMin') }}</span>
            <span class="mf-cell mf-max">{{ t('flightMetrics.dialog.colMax') }}</span>
          </template>
          <span class="mf-cell">{{ t('flightMetrics.dialog.colConv') }}</span>
          <span class="mf-cell mf-unit">{{ t('flightMetrics.dialog.colUnit') }}</span>
          <span class="mf-cell mf-mul">{{ t('flightMetrics.dialog.colMul') }}</span>
          <span class="mf-cell mf-x"></span>
        </div>
        <div v-for="key in selectedFields" :key="'sel-' + key" class="metric-field-row" :class="{ 'mf-row-bar': flightMetrics.picker.render === 'bar' }">
          <span class="metric-field-key" :title="key">
            <small>{{ splitKey(key).type }}</small>
            <span>{{ splitKey(key).field }}</span>
          </span>
          <template v-if="flightMetrics.picker.render === 'bar'">
            <input class="config-input mf-min" :value="settingsOf(key).minInput" @input="onMin(key, $event)" />
            <input class="config-input mf-max" :value="settingsOf(key).maxInput" @input="onMax(key, $event)" />
          </template>
          <select
            class="param-input mf-mode"
            :value="convModeFor(key)"
            :title="t('flightMetrics.dialog.originalUnitTitle', { unit: settingsOf(key).origUnit || '—' })"
            @change="onConvMode(key, $event)"
          >
            <option value="original">{{ t('flightMetrics.dialog.convOriginal') }}</option>
            <option v-for="p in presetsOf(key)" :key="p.key" :value="p.key">{{ p.label }}</option>
            <option value="custom">{{ t('flightMetrics.dialog.convCustom') }}</option>
          </select>
          <input
            class="config-input mf-unit"
            :value="settingsOf(key).unit"
            :disabled="convModeFor(key) !== 'custom'"
            @input="onUnit(key, $event)"
          />
          <input
            class="config-input mf-mul"
            :value="String(settingsOf(key).unitMul)"
            :disabled="convModeFor(key) !== 'custom'"
            @input="onMul(key, $event)"
          />
          <AppButton ghost variant="danger" icon-only icon="close" :icon-size="12" class="mf-x" :title="t('flightMetrics.dialog.remove')" @click="metricsStore.togglePickerField(key)" />
        </div>
        <div v-if="!selectedCount" class="empty-hint">{{ t('flightMetrics.dialog.pickHint') }}</div>
      </div>
    </div>

    <template #actions>
      <div class="modal-actions">
        <template v-if="isEdit">
          <AppButton size="xs" @click="metricsStore.moveItem(flightMetrics.picker.editingId, -1)">{{ t('flightMetrics.dialog.moveUp') }}</AppButton>
          <AppButton size="xs" @click="metricsStore.moveItem(flightMetrics.picker.editingId, 1)">{{ t('flightMetrics.dialog.moveDown') }}</AppButton>
          <AppButton size="xs" variant="danger" @click="onDelete">{{ t('common.delete') }}</AppButton>
        </template>
        <span class="modal-actions-spacer"></span>
        <AppButton @click="close">{{ t('common.cancel') }}</AppButton>
        <AppButton variant="primary" :disabled="selectedCount === 0" @click="confirm">{{ isEdit ? t('common.done') : t('common.add') }}</AppButton>
      </div>
    </template>
  </ModalShell>
</template>
