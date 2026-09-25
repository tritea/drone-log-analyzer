import type { AnalysisState } from '../state';
import type { DataApi } from '../data';
import { createChartLifecycle } from './lifecycle';
import { createChartActions } from './actions';

/**
 * 视图域（「怎么画」）：主图 CurveChart 的挂载、数据集装载与交互动作。
 * 依赖数据域（组装输入），不依赖曲线域——曲线域变更后调 refreshChart 回来。
 */
export function createChartApi(state: AnalysisState, data: DataApi) {
  const lifecycle = createChartLifecycle(state.chart, data);
  const actions = createChartActions();
  return { ...lifecycle, ...actions };
}

export type ChartApi = ReturnType<typeof createChartApi>;
