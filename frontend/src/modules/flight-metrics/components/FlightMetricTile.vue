<script setup lang="ts">
import { computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { MetricItem } from '@/types';
import { useFlightMetricsStore } from '@/modules/flight-metrics';
import { formatPwm, motorSaturated, motorBarPct } from '@/modules/view3d/utils/rc-hud';
import { usePlaybackStore } from '@/modules/playback';
import { useAnalysisStore } from '@/modules/analysis';
import { barPct, metricDisplayName } from '@/modules/flight-metrics/utils/flight-fields';

const props = defineProps<{ item: MetricItem }>();

const metrics = useFlightMetricsStore();
const playbackStore = usePlaybackStore();
const analysis = useAnalysisStore();

// 默认项按当前语言显示名称；用户改名过的项原样（tr 读 locale，切换即时生效）
const displayName = computed(() => metricDisplayName(props.item));

const { flightMetrics } = storeToRefs(metrics);

// 项的字段曲线可能尚未登记：挂载/字段变化时补登记，保证取值不落空。
watch(
  () => props.item.fields,
  () => {
    for (const f of props.item.fields) metrics.ensureField(f);
  },
  { immediate: true, deep: true },
);

const kindMode = props.item.builtin === 'mode';
const kindMotor = props.item.builtin === 'motor';
const isGroup = computed(() => props.item.kind === 'group');
const isExpanded = computed(() => flightMetrics.value.picker.editingId === props.item.id);
const unit = computed(() => props.item.unit);
const motorMeta = computed(() => playbackStore.telemetry.meta?.motor || '');

const singleValue = computed(() => metrics.fieldValue(props.item.fields[0] || ''));
const motorValues = computed(() => metrics.fieldValues(props.item.fields[0] || ''));
const groupValues = computed(() => metrics.groupFieldValues(props.item));

const modeName = computed(() => analysis.modeLabel(analysis.modeNow()) || '—');
const modeColor = computed(() => analysis.modeColor(analysis.modeNow()));
const modeStyle = computed(() => (kindMode ? { '--mode-color': modeColor.value } : {}));

const unitMul = computed(() => (isFinite(props.item.unitMul) ? props.item.unitMul : 1));

// 单值换算：乘以项级 unitMul。
function mulValue(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !isFinite(v as number)) return null;
  return (v as number) * unitMul.value;
}

// 字段组中某通道的换算：每个字段可有独立 unitMul。
function mulGroupValue(channel: { key: string; value: number | null }): number | null {
  const v = channel.value;
  if (v === null || v === undefined || !isFinite(v)) return null;
  const fs = metrics.fieldSettingsFor(props.item, channel.key);
  return v * (isFinite(fs.unitMul) ? fs.unitMul : 1);
}
function unitFor(key: string): string {
  return metrics.fieldSettingsFor(props.item, key).unit;
}
function pctFor(key: string, value: number | null): number {
  const fs = metrics.fieldSettingsFor(props.item, key);
  return barPct(value, fs.min, fs.max);
}

const tileClass = computed<Record<string, boolean>>(() => {
  const cls: Record<string, boolean> = {};
  if (kindMode) cls['metric-mode'] = true;
  if (kindMotor) cls['metric-motors'] = true;
  if (!kindMode && !kindMotor && isGroup.value) {
    cls['metric-group'] = true;
    if (props.item.render === 'bar') cls['metric-wide'] = true;
  }
  if (isExpanded.value) cls['metric-expanded'] = true;
  return cls;
});

function openEditor(): void {
  metrics.openEditor(props.item.id);
}
</script>

<template>
  <div class="metric-tile" :class="tileClass" :style="modeStyle">
    <template v-if="kindMode">
      <span>{{ displayName }}</span>
      <strong>{{ modeName }}</strong>
    </template>

    <template v-else-if="kindMotor">
      <span class="metric-motors-head">{{ displayName }}<small>{{ motorMeta }}</small></span>
      <div class="motor-bars">
        <div class="motor-bar" v-for="m in motorValues" :key="'mot-' + m.label" :title="'C' + m.label + ': ' + formatPwm(m.value)">
          <div class="motor-bar-track">
            <div class="motor-bar-fill" :class="{ saturated: motorSaturated(m.value) }" :style="{ height: motorBarPct(m.value) + '%' }"></div>
          </div>
          <div class="motor-bar-label">{{ m.label }}</div>
        </div>
      </div>
    </template>

    <template v-else-if="item.kind === 'field' && item.render === 'number'">
      <button class="metric-main" type="button" @click="openEditor"><span>{{ displayName }}</span></button>
      <strong>{{ playbackStore.formatMetric(mulValue(singleValue), unit) }}</strong>
    </template>

    <template v-else-if="item.kind === 'field' && item.render === 'bar'">
      <button class="metric-main" type="button" @click="openEditor"><span>{{ displayName }}</span></button>
      <div class="bar-h-track">
        <div class="bar-h-fill" :style="{ width: barPct(singleValue, item.min, item.max) + '%' }"></div>
      </div>
    </template>

    <template v-else-if="item.kind === 'group' && item.render === 'number'">
      <button class="metric-main metric-group-head" type="button" @click="openEditor"><span>{{ displayName }}</span></button>
      <div class="metric-group-channels">
        <div class="metric-channel" v-for="c in groupValues" :key="item.id + '-' + c.key">
          <small v-if="c.label">{{ c.label }}</small>
          <strong>{{ playbackStore.formatMetric(mulGroupValue(c), unitFor(c.key)) }}</strong>
        </div>
      </div>
    </template>

    <template v-else-if="item.kind === 'group' && item.render === 'bar' && item.orient === 'vertical'">
      <button class="metric-main metric-group-head" type="button" @click="openEditor"><span>{{ displayName }}</span></button>
      <div class="motor-bars">
        <div class="motor-bar" v-for="c in groupValues" :key="item.id + '-' + c.key">
          <div class="motor-bar-track">
            <div class="bar-v-fill" :style="{ height: pctFor(c.key, c.value) + '%' }"></div>
          </div>
          <div class="motor-bar-label">{{ c.label }}</div>
        </div>
      </div>
    </template>

    <template v-else-if="item.kind === 'group' && item.render === 'bar' && item.orient === 'horizontal'">
      <button class="metric-main metric-group-head" type="button" @click="openEditor"><span>{{ displayName }}</span></button>
      <div class="bar-h-stack">
        <div class="bar-h-row" v-for="c in groupValues" :key="item.id + '-' + c.key">
          <small>{{ c.label }}</small>
          <div class="bar-h-track">
            <div class="bar-h-fill" :style="{ width: pctFor(c.key, c.value) + '%' }"></div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
