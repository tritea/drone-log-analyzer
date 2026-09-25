import { computed, ref } from 'vue';
import type { Ref } from 'vue';
import type { ChartState, Curve, CurveSaveState } from '@/types';

/**
 * analysis 域核心状态：各域工厂共享的读写面。
 * chart 的字段名是持久化契约（用户已存配置），不可随重构改名。
 */
export interface AnalysisState {
  chart: Ref<ChartState>;
  curveSave: Ref<CurveSaveState>;
  /** 运行时绘制开关（不持久化）：curveId → 是否绘制；缺省视为 true。 */
  curveDrawn: Ref<Record<string, boolean>>;
  /** AI 定位问题时段时临时叠加的曲线：与用户曲线（activeCurves，持久化、进图例）
   * 彻底分开——只在渲染层合并（绘制/量程/hover），不进 activeCurves、不持久化。 */
  aiCurves: Ref<Curve[]>;
}

export function createAnalysisState(): AnalysisState {
  return {
    chart: ref<ChartState>({
      activeCurves: [],
      tooltip: true,
      sampling: false,
      showErrors: true,
      showEvents: true,
      showMessages: false,
      lineWidth: 3,
      activeField: { name: '', selectedSimpleName: '', expanded: {}, groupParams: {} },
    }),
    curveSave: ref<CurveSaveState>({ loading: false, restoring: false, saveTimer: null }),
    curveDrawn: ref<Record<string, boolean>>({}),
    aiCurves: ref<Curve[]>([]),
  };
}

/** 派生：用户曲线可见性统计（图例/顶栏计数用）。 */
export function createCurveStats(state: AnalysisState) {
  const visibleCurves = computed<Curve[]>(() => state.chart.value.activeCurves.filter((c) => c.visible));
  const visiblePointCount = computed<number>(() =>
    state.chart.value.activeCurves.filter((c) => c.visible).reduce((sum, c) => sum + (c.count || 0), 0),
  );
  const hiddenCurveCount = computed<number>(() => state.chart.value.activeCurves.length - visibleCurves.value.length);
  const totalPoints = computed<number>(() => state.chart.value.activeCurves.reduce((sum, c) => sum + (c.count || 0), 0));
  return { visibleCurves, visiblePointCount, hiddenCurveCount, totalPoints };
}
