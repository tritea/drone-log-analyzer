import { configClient } from '@/services/config';
import { showToast } from '@/modules/shared/ui-store';
import { tr } from '@/locales';
import type { AnalysisState } from '../state';
import type { DataApi } from '../data';
import { describeError } from './helpers';
import type { CurveSeed } from './lifecycle';

const SAVE_DEBOUNCE_MS = 350;

/** 曲线集合持久化：快照/防抖保存（防抖句柄挂 curveSave.saveTimer，卸载时清理）。 */
export interface CurveSaveApi {
  snapshotCurves(): CurveSeed[];
  saveCurvesNow(): Promise<void>;
  scheduleCurveSave(): void;
}

export function createCurveSave(
  state: AnalysisState,
  data: DataApi,
): CurveSaveApi {
  function snapshotCurves(): CurveSeed[] {
    return state.chart.value.activeCurves.map((c) => {
      const group = c.fieldName ? data.ensureGroupParams(c.fieldName) : null;
      return {
        type: c.type,
        field: c.field,
        visible: c.visible,
        color: c.color,
        scale: c.scale,
        offset: c.offset,
        scaleInput: c.scaleInput,
        offsetInput: c.offsetInput,
        fieldName: c.fieldName || '',
        fieldGroupScale: group ? group.scale : 1,
        fieldGroupOffset: group ? group.offset : 0,
        fieldGroupScaleInput: group ? group.scaleInput : '1',
        fieldGroupOffsetInput: group ? group.offsetInput : '0',
      };
    });
  }

  async function saveCurvesNow(): Promise<void> {
    if (state.curveSave.value.restoring) return;
    state.curveSave.value.loading = true;
    try {
      await configClient.saveCurveState(snapshotCurves());
    } catch (e: unknown) {
      showToast(tr('analysis.toast.saveCurveStateFailed', { err: describeError(e) }), 'error');
    } finally {
      state.curveSave.value.loading = false;
    }
  }

  function scheduleCurveSave(): void {
    if (state.curveSave.value.restoring) return;
    if (state.curveSave.value.saveTimer) clearTimeout(state.curveSave.value.saveTimer);
    state.curveSave.value.saveTimer = setTimeout(() => {
      state.curveSave.value.saveTimer = null;
      void saveCurvesNow();
    }, SAVE_DEBOUNCE_MS);
  }

  return { snapshotCurves, saveCurvesNow, scheduleCurveSave };
}
