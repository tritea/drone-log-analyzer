import type { Ref } from 'vue';
import type { Curve } from '@/types';
import { useLogStore } from '@/modules/log';
import { useCurveManagerStore } from '@/modules/curves';
import type { ValueRange } from '../../types';
import type { TransformApi } from './transform';

/** 量程与时间基准：数据全域的 X/Y 量程、统一时间原点、AI 问题时段的绝对锚点。 */
export interface RangesApi {
  dataXRange(): ValueRange;
  dataYRange(): ValueRange;
  timeOriginMs(): number;
  incidentAnchorMs(): number;
}

export function createRanges(
  chart: Ref<{ activeCurves: Curve[] }>,
  aiCurves: Ref<Curve[]>,
  transform: TransformApi,
): RangesApi {
  /** 用户曲线为空时视口退化 {0,1}，AI 独立通道的曲线将永远不可见——
   * 空图时由 AI 叠加曲线撑起 X/Y 范围。 */
  function curveSource(): Curve[] {
    return chart.value.activeCurves.length ? chart.value.activeCurves : aiCurves.value;
  }

  function dataYRange(): ValueRange {
    let gMin = Infinity;
    let gMax = -Infinity;
    for (const c of curveSource()) {
      if (!c.visible || !c.count) continue;
      let lo = transform.displayValue(c.min, c);
      let hi = transform.displayValue(c.max, c);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue; // NaN/Inf 元数据防护：跳过该曲线
      if (lo > hi) { const tmp = lo; lo = hi; hi = tmp; }
      if (lo < gMin) gMin = lo;
      if (hi > gMax) gMax = hi;
    }
    if (gMin === Infinity) { gMin = 0; gMax = 1; }
    const span = gMax - gMin || 1;
    const pad = span * 0.02;
    return { min: gMin - pad, max: gMax + pad };
  }

  function dataXRange(): ValueRange {
    let gMin = Infinity;
    let gMax = -Infinity;
    for (const c of curveSource()) {
      if (!c.visible || !c.buffer || !c.buffer.length || c.baseTimeMs === undefined) continue;
      let first = c.baseTimeMs + c.buffer[0];
      let last = c.baseTimeMs + c.buffer[c.buffer.length - 2];
      if (!Number.isFinite(first) || !Number.isFinite(last)) continue;
      if (first > last) { const tmp = first; first = last; last = tmp; }
      if (first < gMin) gMin = first;
      if (last > gMax) gMax = last;
    }
    if (gMin === Infinity) return { min: 0, max: 1 };
    const span = gMax - gMin;
    if (span <= 0) {
      const singlePad = Math.max(Math.abs(gMin) * 0.02, 1000);
      return { min: gMin >= 0 ? Math.max(0, gMin - singlePad) : gMin - singlePad, max: gMax + singlePad };
    }
    const pad = Math.max(span * 0.005, 1);
    return { min: gMin >= 0 ? Math.max(0, gMin - pad) : gMin - pad, max: gMax + pad };
  }

  /** 统一时间原点：首个可见用户曲线的 baseTimeMs；空图退用 AI 叠加曲线原点。 */
  function timeOriginMs(): number {
    const base = chart.value.activeCurves.find((c) => c.visible && c.buffer && c.baseTimeMs !== undefined);
    if (base && base.baseTimeMs !== undefined) return base.baseTimeMs;
    const ai = aiCurves.value.find((c) => c.buffer && c.baseTimeMs !== undefined);
    return ai && ai.baseTimeMs !== undefined ? ai.baseTimeMs : 0;
  }

  /**
   * AI 问题时段相对秒 → 曲线轴绝对 ms 的锚点。
   * 后端工具输出的秒 = (TypeBody.BaseTimeMs - 日志最早原点 startMs)/1000，0 点是
   * "日志内**最早** type 的 BaseTimeMs"——含 FILE 等头部 type（可能比飞行数据
   * 早数百秒，模型报告的"t≈445s 起飞"正源于此），与曲线轴同一量纲。
   * 优先用后端 summary.startTimeMs（= startMs，精确）；缺失时退化为已拉取
   * type body 原点最小值（不含未拉取的头部 type，可能偏晚）。
   */
  function incidentAnchorMs(): number {
    const sum = useLogStore().log.summary;
    if (sum && Number.isFinite(sum.startTimeMs) && sum.startTimeMs > 0) return sum.startTimeMs;
    const cm = useCurveManagerStore();
    let min = Infinity;
    for (const name in cm.typeBodies) {
      const b = cm.typeBodies[name];
      if (b && Number.isFinite(b.baseTimeMs) && b.baseTimeMs < min) min = b.baseTimeMs;
    }
    if (min !== Infinity) return min;
    return timeOriginMs();
  }

  return { dataXRange, dataYRange, timeOriginMs, incidentAnchorMs };
}
