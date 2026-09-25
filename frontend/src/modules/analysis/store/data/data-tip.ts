import type { Curve } from '@/types';
import { useCurveManagerStore, findIndexAt } from '@/modules/curves';
import { formatTime, pointDecimals } from '../../utils/format';
import type { ModesApi } from './modes';
import type { SeriesApi } from './series';
import type { TransformApi } from './transform';

/** 悬停数据提示：某时刻各曲线取值 + 飞行模式上下文，拼 HTML。 */
export interface DataTipApi {
  buildDataTip(targetTime: number): string;
  /** 原始值 → 展示文本（ERR/EV/Subsys 附语义名）。 */
  formatPointValue(value: number, curve: Curve | null, label?: string): string;
}

export function createDataTip(
  series: SeriesApi,
  transform: TransformApi,
  modes: ModesApi,
): DataTipApi {
  function formatPointValue(value: number, curve: Curve | null, label?: string): string {
    const text = value.toFixed(pointDecimals(curve));
    if (label) return text + ' (' + label + ')';
    if (!curve) return text;
    const d = useCurveManagerStore().logdefs;
    if (d) {
      if (curve.type === 'EV' && curve.field === 'Id') {
        const evName = d.eventNames[String(Math.round(value))];
        if (evName) return text + ' (' + evName + ')';
      } else if (curve.type === 'ERR' && curve.field === 'Subsys') {
        const subName = d.errorSubsystems[String(Math.round(value))];
        if (subName) return text + ' (' + subName + ')';
      }
    }
    return text;
  }

  function buildDataTip(targetTime: number): string {
    const cm = useCurveManagerStore();
    const mode = modes.modeAt(targetTime);
    const rows: string[] = [];

    for (const curve of series.renderedCurves()) {
      if (!curve.visible) continue;
      const bin = cm.peek(curve.type, curve.field);
      if (!bin) continue;
      const idx = findIndexAt(bin, targetTime);
      if (idx < 0) continue;
      const pointT = bin.baseTimeMs + bin.buffer[idx * 2];
      const rawValue = bin.buffer[idx * 2 + 1];

      let label: string | undefined;
      if (curve.type === 'ERR' && curve.field === 'ECode') {
        const subsysBin = cm.peek('ERR', 'Subsys');
        if (subsysBin && idx * 2 + 1 < subsysBin.buffer.length) {
          label = cm.errCodeLabel(subsysBin.buffer[idx * 2 + 1], rawValue);
        }
      }

      const transformed = transform.displayValue(rawValue, curve);
      const group = transform.ensureGroupParams(curve.fieldName);
      const hasCurveTransform = curve.scale !== 1 || curve.offset !== 0;
      const hasGroupTransform = group.scale !== 1 || group.offset !== 0;

      let row = '<span style="color:' + curve.color + '">■ </span>' + curve.label + ': <b>' + formatPointValue(rawValue, curve, label) + '</b>';
      if (hasCurveTransform || hasGroupTransform) {
        row += ' <span style="color:#475569;font-size:10px">显示 <b>' + transformed.toFixed(pointDecimals(curve)) + '</b></span>';
      }
      if (hasCurveTransform) {
        row += ' <span style="color:#999;font-size:10px">(×' + curve.scale + (curve.offset >= 0 ? '+' : '') + curve.offset + ')</span>';
      }
      if (hasGroupTransform) {
        row += ' <span style="color:#999;font-size:10px">(group x' + group.scale + (group.offset >= 0 ? '+' : '') + group.offset + ')</span>';
      }
      row += ' <span style="color:#999;font-size:10px">@ ' + formatTime(pointT, false) + '</span>';
      rows.push(row);
    }

    let html = '<div style="font-size:12px;min-width:220px;max-width:380px"><b>' + formatTime(targetTime, true) + '</b><br/>';
    if (mode) {
      html += '<span style="color:#0369a1;font-weight:700">MODE</span>: <b>' + modes.modeLabel(mode.mode) + '</b>';
      html += ' <span style="color:#999;font-size:10px">since ' + formatTime(mode.timeMs, false) + '</span><br/>';
    }
    return html + rows.join('<br/>') + '</div>';
  }

  return { buildDataTip, formatPointValue };
}
