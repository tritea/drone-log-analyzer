import type { AnalysisState } from '../state';
import type { DataApi } from '../data';
import type { ChartApi } from '../view';
import { createCurveSave } from './save';
import { createCurveLifecycle } from './lifecycle';
import { createCurveGroups } from './groups';

/**
 * 曲线域：集合生命周期 + 分组参数 + 持久化。
 * 装配顺序 save → lifecycle → groups（后两者消费 save 的防抖保存，单向无环）。
 */
export function createCurveApi(state: AnalysisState, data: DataApi, view: ChartApi) {
  const save = createCurveSave(state, data);
  const lifecycle = createCurveLifecycle(state, data, view, save);
  const groups = createCurveGroups(state, data, view, save);
  return { ...save, ...lifecycle, ...groups };
}

export type CurveApi = ReturnType<typeof createCurveApi>;
