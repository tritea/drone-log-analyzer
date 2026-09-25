import { computed } from 'vue';
import { defineStore } from 'pinia';
import type { FieldGroupItem } from '@/types';
import { createAnalysisState, createCurveStats } from './state';
import { createDataApi } from './data';
import { createChartApi } from './view';
import { createCurveApi } from './curves';
import {
  formatCoord,
  formatDuration,
  formatMessageTime,
  formatParameterValue,
  formatTime,
  formatUTCTime,
  fmtCount,
  pointDecimals,
} from '../utils/format';

/**
 * analysis 装配器：组合 data（算什么）→ view（怎么画）→ curves（曲线集）三域工厂，
 * 铺开公共 API。装配链线性无环：curves 变更后经 view.refreshChart 回流。
 * 跨模块常用格式化函数在此统一再导出（消费方从 store 解构）。
 */
export const useAnalysisStore = defineStore('analysis', () => {
  const state = createAnalysisState();
  const data = createDataApi(state);
  const view = createChartApi(state, data);
  const curves = createCurveApi(state, data, view);
  view.startLocaleWatch();

  const stats = createCurveStats(state);

  /** 按字段名分组的当前曲线集（侧栏分组卡片）。 */
  const activeFieldGroups = computed<FieldGroupItem[]>(() => {
    const groups: FieldGroupItem[] = [];
    const byName: Record<string, FieldGroupItem> = {};
    for (const c of state.chart.value.activeCurves) {
      if (!c.fieldName) continue;
      if (!byName[c.fieldName]) {
        byName[c.fieldName] = { name: c.fieldName, curves: [], params: data.ensureGroupParams(c.fieldName) };
        groups.push(byName[c.fieldName]);
      }
      byName[c.fieldName].curves.push(c);
    }
    return groups;
  });

  return {
    chart: state.chart,
    curveSave: state.curveSave,
    curveDrawn: state.curveDrawn,
    aiCurves: state.aiCurves,
    visibleCurves: stats.visibleCurves,
    visiblePointCount: stats.visiblePointCount,
    hiddenCurveCount: stats.hiddenCurveCount,
    totalPoints: stats.totalPoints,
    activeFieldGroups,
    ...data,
    ...view,
    ...curves,
    formatTime,
    formatUTCTime,
    formatDuration,
    fmtCount,
    formatParameterValue,
    formatCoord,
    pointDecimals,
    formatMessageTime,
  };
});
