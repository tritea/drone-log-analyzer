import type { Ref } from 'vue';
import type { Curve } from '@/types';
import type { CurveSeries } from '../../types';
import type { RangesApi } from './ranges';
import type { TransformApi } from './transform';

/** 渲染系列组装：曲线（Curve）→ 图表输入（CurveSeries），含 AI 叠加通道的归一化映射。 */
export interface SeriesApi {
  /** 用户曲线 → 主绘制系列（含变换、绘制开关）。 */
  buildCurveSeries(baseTimeMs: number): CurveSeries[];
  /** AI 临时叠加 → 独立绘制系列（归一化映射，不扰动用户量程）。 */
  buildOverlaySeries(baseTimeMs: number): CurveSeries[];
  /** 渲染/hover 用的合并曲线集：用户曲线 + AI 临时叠加（同 id 剔重）。 */
  renderedCurves(): Curve[];
}

export function createSeries(
  chart: Ref<{ activeCurves: Curve[] }>,
  aiCurves: Ref<Curve[]>,
  curveDrawn: Ref<Record<string, boolean>>,
  transform: TransformApi,
  ranges: RangesApi,
): SeriesApi {
  function buildCurveSeries(baseTimeMs: number): CurveSeries[] {
    const out: CurveSeries[] = [];
    for (const c of chart.value.activeCurves) {
      if (!c.visible || !c.buffer || !c.buffer.length) continue;
      const group = transform.ensureGroupParams(c.fieldName);
      const scaleY = c.scale * group.scale;
      const offsetY = c.offset * group.scale + group.offset;
      out.push({
        id: c.id,
        color: c.color,
        buffer: c.buffer,
        count: c.buffer.length / 2,
        scaleY,
        offsetY,
        xOffset: (c.baseTimeMs !== undefined ? c.baseTimeMs : baseTimeMs) - baseTimeMs,
        visible: curveDrawn.value[c.id] !== false,
      });
    }
    return out;
  }

  /**
   * AI 临时叠加 → 独立绘制系列：有用户曲线时归一化映射到主图 Y 范围的**上半区**
   *（形状保真、不扰动用户量程/视口）；图上没有用户曲线时由 AI 曲线撑起量程
   * 并映射到全幅（否则视口退化 {0,1}，AI 曲线永远不可见）。id 加 ai- 前缀，
   * 走 CurveChart 的独立叠加通道 setOverlayCurves。
   */
  function buildOverlaySeries(baseTimeMs: number): CurveSeries[] {
    if (!aiCurves.value.length) return [];
    const ids = new Set(chart.value.activeCurves.map((c) => c.id));
    const empty = chart.value.activeCurves.length === 0;
    const yRange = ranges.dataYRange();
    const span = yRange.max - yRange.min || 1;
    const bandRatio = empty ? 0.96 : 0.45; // 空图全幅；有用户曲线时上半区带
    const bandBase = empty ? yRange.min + span * 0.02 : yRange.min + span * 0.5;
    const out: CurveSeries[] = [];
    for (const c of aiCurves.value) {
      if (ids.has(c.id) || !c.buffer || !c.buffer.length) continue; // 用户已有同字段：不重复叠
      const cSpan = c.max - c.min;
      const scale = cSpan > 0 ? (span * bandRatio) / cSpan : 1;
      const offsetY = bandBase - c.min * scale;
      out.push({
        id: 'ai-' + c.id,
        color: c.color,
        buffer: c.buffer,
        count: c.count,
        scaleY: scale,
        offsetY,
        xOffset: (c.baseTimeMs !== undefined ? c.baseTimeMs : baseTimeMs) - baseTimeMs,
      });
    }
    return out;
  }

  function renderedCurves(): Curve[] {
    if (!aiCurves.value.length) return chart.value.activeCurves;
    const ids = new Set(chart.value.activeCurves.map((c) => c.id));
    const extra = aiCurves.value.filter((c) => !ids.has(c.id));
    return extra.length ? [...chart.value.activeCurves, ...extra] : chart.value.activeCurves;
  }

  return { buildCurveSeries, buildOverlaySeries, renderedCurves };
}
