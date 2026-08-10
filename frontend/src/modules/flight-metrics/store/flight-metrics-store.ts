import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { FlightMetricsConfig } from '@/types';
import { cloneItem, makeDefaultMetricItems } from '../utils/flight-fields';
import { blankPicker, type MetricState } from './types';
import { createConfigSync } from './config-sync';
import { createFieldResolution } from './field-resolution';
import { createItemOps } from './item-ops';
import { createPickerOps } from './picker-ops';

/**
 * 飞行数据面板 store。
 *
 * 组装式：把单一巨型 setup 拆成四个聚焦的域工厂（字段解析 / 项操作 / 选择器 / 配置同步），
 * 这里只持有 state、computed，并按依赖顺序把它们接起来。对外公共契约（hook 名 + 全部导出方法名）
 * 与旧版一致，组件侧无感。
 */
export const useFlightMetricsStore = defineStore('flightMetrics', () => {
  const state = ref<MetricState>({
    items: makeDefaultMetricItems(),
    restoring: false,
    saveTimer: null,
    started: false,
    picker: blankPicker(),
  });

  // 持久化文档：深拷贝项（断开响应式引用）+ 版本号。
  const config = computed<FlightMetricsConfig>(() => ({
    items: state.value.items.map(cloneItem),
    version: 3,
  }));

  // 依赖顺序：字段解析（无依赖）→ 项操作 → 选择器（依赖前两者）→ 配置同步（依赖字段解析）。
  const resolution = createFieldResolution(state);
  const itemOps = createItemOps(state);
  const pickerOps = createPickerOps(state, {
    ensureField: resolution.ensureField,
    makeFieldSettings: itemOps.makeFieldSettings,
  });
  const configSync = createConfigSync(state, config, {
    ensureField: resolution.ensureField,
    reloadAllFields: resolution.reloadAllFields,
  });

  return {
    flightMetrics: state,
    config,
    ...resolution,
    ...itemOps,
    ...pickerOps,
    ...configSync,
  };
});
