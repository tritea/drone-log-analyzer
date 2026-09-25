import type { FieldEntry } from '@/types';
import { configClient } from '@/services/config';
import { tr } from '@/locales';
import { showToast } from '@/modules/shared/ui-store';
import { tryFloat } from '@/modules/shared/utils/format';
import { useFieldsStore } from '@/modules/fields';
import type { FieldEntriesResponse } from '@/modules/fields/store/field-helpers';
import type { AnalysisState } from '../state';
import type { DataApi } from '../data';
import type { ChartApi } from '../view';
import type { CurveSaveApi } from './save';
import { describeError, isConfigError } from './helpers';

const SAVE_DEBOUNCE_MS = 350;

/** 字段组参数应用与持久化：组 scale/offset 调整 + 简单字段设置保存。 */
export interface CurveGroupsApi {
  applyGroupParams(group: { name: string }): void;
  resetGroupParams(group: { name: string }): void;
  applySimpleFieldParams(tmpl: FieldEntry): void;
  resetSimpleFieldParams(tmpl: FieldEntry): void;
}

export function createCurveGroups(
  state: AnalysisState,
  data: DataApi,
  view: ChartApi,
  save: CurveSaveApi,
): CurveGroupsApi {
  function applyGroupParams(group: { name: string }): void {
    const params = data.ensureGroupParams(group.name);
    params.scale = tryFloat(params.scaleInput, 1);
    params.offset = tryFloat(params.offsetInput, 0);
    view.refreshTransforms();
    save.scheduleCurveSave();
  }

  function resetGroupParams(group: { name: string }): void {
    data.setGroupParams(group.name, { scale: 1, offset: 0, scaleInput: '1', offsetInput: '0' });
    view.refreshTransforms();
    save.scheduleCurveSave();
  }

  function applySimpleFieldParams(tmpl: FieldEntry): void {
    const fieldsStore = useFieldsStore();
    const params = fieldsStore.simpleFieldGroupParams(tmpl);
    params.scale = tryFloat(params.scaleInput, 1);
    params.offset = tryFloat(params.offsetInput, 0);
    tmpl.scale = params.scale;
    tmpl.offset = params.offset;
    tmpl.scaleInput = params.scaleInput;
    tmpl.offsetInput = params.offsetInput;
    if (fieldsStore.isFieldActive(tmpl.name)) {
      view.refreshTransforms();
      save.scheduleCurveSave();
    }
    scheduleFieldSettingsSave(tmpl);
  }

  function resetSimpleFieldParams(tmpl: FieldEntry): void {
    const params = useFieldsStore().simpleFieldGroupParams(tmpl);
    params.scale = 1;
    params.offset = 0;
    params.scaleInput = '1';
    params.offsetInput = '0';
    applySimpleFieldParams(tmpl);
  }

  function scheduleFieldSettingsSave(tmpl: FieldEntry): void {
    if (!tmpl || !tmpl.name) return;
    const fieldsStore = useFieldsStore();
    if (fieldsStore.fieldList.settingsSaveTimer) clearTimeout(fieldsStore.fieldList.settingsSaveTimer);
    fieldsStore.fieldList.settingsSaveTimer = setTimeout(() => {
      fieldsStore.fieldList.settingsSaveTimer = null;
      void saveFieldSettings(tmpl);
    }, SAVE_DEBOUNCE_MS);
  }

  async function saveFieldSettings(tmpl: FieldEntry): Promise<void> {
    if (!tmpl || !tmpl.name) return;
    const fieldsStore = useFieldsStore();
    const selected = state.chart.value.activeField.selectedSimpleName;
    try {
      const res: unknown = await configClient.saveFieldEntry(fieldsStore.currentFieldEntryPayload(tmpl.name, tmpl.curves));
      if (isConfigError(res)) { showToast(res.error, 'error'); return; }
      fieldsStore.applyFieldsResponse(res as FieldEntriesResponse);
      state.chart.value.activeField.selectedSimpleName = selected;
    } catch (e: unknown) {
      showToast(tr('analysis.toast.saveCurveSettingsFailed', { err: describeError(e) }), 'error');
    }
  }

  return { applyGroupParams, resetGroupParams, applySimpleFieldParams, resetSimpleFieldParams };
}
