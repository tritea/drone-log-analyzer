import type { AnalysisState } from '../state';
import { createTransform } from './transform';
import { createRanges } from './ranges';
import { createSeries } from './series';
import { createModes } from './modes';
import { createMarks } from './marks';
import { createDataTip } from './data-tip';

/**
 * 数据域（「算什么」）：量程/系列/标注/提示的纯计算工厂组合。
 * 只读 state 与外部 store（惰性调用），不依赖 view/curves 域——装配链最底层。
 */
export function createDataApi(state: AnalysisState) {
  const transform = createTransform(state.chart);
  const ranges = createRanges(state.chart, state.aiCurves, transform);
  const series = createSeries(state.chart, state.aiCurves, state.curveDrawn, transform, ranges);
  const modes = createModes();
  const marks = createMarks(state.chart, ranges, modes);
  const tip = createDataTip(series, transform, modes);
  return {
    ...transform,
    ...ranges,
    ...series,
    ...modes,
    ...marks,
    ...tip,
  };
}

export type DataApi = ReturnType<typeof createDataApi>;
