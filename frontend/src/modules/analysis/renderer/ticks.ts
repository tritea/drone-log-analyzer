/** 数值刻度步长：1/2/5 × 10^n 里挑最接近 span/count 的。 */
export function niceNumberStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

/** 时间刻度步长：秒级起步的 1-2-5 序列里挑最接近 span/count 的。 */
export function niceTimeStep(span: number, count: number): number {
  const target = span / Math.max(1, count);
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000,
    60000, 120000, 300000, 600000, 1800000, 3600000, 7200000, 10800000, 21600000, 43200000, 86400000, 604800000];
  for (let i = 0; i < steps.length; i++) if (steps[i] >= target) return steps[i];
  return steps[steps.length - 1];
}

/** [min, max] 内对齐 step 的刻度值序列。 */
export function ticksInRange(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  if (!(step > 0)) return out;
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 0.001; v += step) out.push(v);
  return out;
}

/** 刻度值文字：小数位数由步长量级决定。 */
export function formatTickNumber(v: number, step: number): string {
  if (!isFinite(v)) return '';
  const decimals = step >= 1 ? 0 : Math.min(7, Math.ceil(-Math.log10(step)));
  return v.toFixed(decimals);
}

/** 候选刻度排序去重：相邻间距小于 minGap 的丢弃（边界刻度防挤在一起）。 */
export function dedupeTicks(candidates: number[], minGap: number): number[] {
  const sorted = [...candidates].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (!out.length || v - out[out.length - 1] > minGap) out.push(v);
  }
  return out;
}
