import type { Ref } from 'vue';
import type { ChartState, Curve, FieldGroupParams } from '@/types';
import { tryFloat } from '@/modules/shared/utils/format';

/** 字段组参数来源：兼容 scale/offset 与 fieldGroup* 两套字段名。 */
interface GroupParamSource {
  scale?: number;
  offset?: number;
  scaleInput?: string;
  offsetInput?: string;
  fieldGroupScale?: number;
  fieldGroupOffset?: number;
  fieldGroupScaleInput?: string;
  fieldGroupOffsetInput?: string;
}

/** 值变换与字段组参数：数据域最底层（量程/系列/提示都依赖它）。 */
export interface TransformApi {
  /** 原始值 → 显示值：曲线自身变换 × 字段组变换。 */
  displayValue(val: number, curve: Curve): number;
  makeGroupParams(source?: GroupParamSource): FieldGroupParams;
  ensureGroupParams(name?: string, source?: GroupParamSource): FieldGroupParams;
  setGroupParams(name: string, source?: GroupParamSource): void;
  collectGroupParamsFrom(curves: Curve[]): void;
  pruneGroupParams(): void;
}

export function createTransform(chart: Ref<ChartState>): TransformApi {
  function makeGroupParams(source?: GroupParamSource): FieldGroupParams {
    const src = source || {};
    const scale = src.scale !== undefined ? src.scale : src.fieldGroupScale;
    const offset = src.offset !== undefined ? src.offset : src.fieldGroupOffset;
    const scaleInput = src.scaleInput !== undefined ? src.scaleInput : src.fieldGroupScaleInput;
    const offsetInput = src.offsetInput !== undefined ? src.offsetInput : src.fieldGroupOffsetInput;
    const resolvedScale = scale !== undefined ? scale : 1;
    const resolvedOffset = offset !== undefined ? offset : 0;
    return {
      scale: tryFloat(scaleInput !== undefined ? scaleInput : resolvedScale, resolvedScale === 0 ? 1 : resolvedScale),
      offset: tryFloat(offsetInput !== undefined ? offsetInput : resolvedOffset, resolvedOffset),
      scaleInput: scaleInput !== undefined ? String(scaleInput) : String(resolvedScale),
      offsetInput: offsetInput !== undefined ? String(offsetInput) : String(resolvedOffset),
    };
  }

  function ensureGroupParams(name?: string, source?: GroupParamSource): FieldGroupParams {
    if (!name) return makeGroupParams(source);
    const params = chart.value.activeField.groupParams[name];
    if (params) return params;
    const created = makeGroupParams(source);
    chart.value.activeField.groupParams[name] = created;
    return created;
  }

  function setGroupParams(name: string, source?: GroupParamSource): void {
    if (!name) return;
    chart.value.activeField.groupParams[name] = makeGroupParams(source);
  }

  function collectGroupParamsFrom(curves: Curve[]): void {
    chart.value.activeField.groupParams = {};
    for (const c of curves) {
      if (!c.fieldName || chart.value.activeField.groupParams[c.fieldName]) continue;
      setGroupParams(c.fieldName, {
        scale: c.fieldGroupScale,
        offset: c.fieldGroupOffset,
        scaleInput: c.fieldGroupScaleInput,
        offsetInput: c.fieldGroupOffsetInput,
      });
    }
  }

  function pruneGroupParams(): void {
    const active: Record<string, boolean> = {};
    for (const c of chart.value.activeCurves) if (c.fieldName) active[c.fieldName] = true;
    for (const name in chart.value.activeField.groupParams) if (!active[name]) delete chart.value.activeField.groupParams[name];
  }

  function displayValue(val: number, curve: Curve): number {
    const own = val * curve.scale + curve.offset;
    const group = ensureGroupParams(curve.fieldName);
    return own * group.scale + group.offset;
  }

  return { displayValue, makeGroupParams, ensureGroupParams, setGroupParams, collectGroupParamsFrom, pruneGroupParams };
}
