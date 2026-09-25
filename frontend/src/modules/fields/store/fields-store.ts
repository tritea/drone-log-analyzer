import { defineStore } from 'pinia';
import { ref, computed, nextTick } from 'vue';
import type {
  Curve,
  FieldCurve,
  FieldEntry,
  FieldGroupParams,
  FieldListState,
  MessageType,
  PickerCurveSettings,
  SimplePickerState,
} from '@/types';
import { configClient } from '@/services/config';
import { tryFloat } from '@/modules/shared/utils/format';
import { nextColor } from '@/modules/shared/utils/colors';
import type { TemplateRefTarget } from '@/modules/shared/utils/dom';
import { showToast, useUiStore } from '@/modules/shared/ui-store';
import { useAnalysisStore } from '@/modules/analysis';
import { useLogStore } from '@/modules/log';
import { tr } from '@/locales';
import {
  buildFieldEntryPayload,
  cleanFieldEditCurves,
  fieldSummary,
  makePickerCurveSettings,
  normalizeFieldEntry,
  pickDefaultEntryName,
  suggestGroupName,
  type FieldEntriesResponse,
  type FieldEntryPayload,
} from './field-helpers';

export const useFieldsStore = defineStore('fields', () => {
  // ───────────────────────────── 1. State ─────────────────────────────

  const fieldList = ref<FieldListState>({
    items: [],
    path: '',
    loading: false,
    settingsSaveTimer: null,
    exportOpen: false,
    exportSelected: {},
    edit: {
      open: false,
      kind: 'template',
      originalName: '',
      name: '',
      curves: [],
      type: '',
      field: '',
      filter: '',
    },
    deleteTarget: null,
    deleteFromEditor: false,
  });

  const simplePicker = ref<SimplePickerState>({
    open: false,
    filter: '',
    selected: {},
    curveSettings: {},
    groupName: '',
    originalName: '',
    expanded: {},
  });

  const fieldDeleteDialogEl = ref<HTMLDialogElement | null>(null);

  // ─────────────────────────── 2. Computed ────────────────────────────

  const filteredFields = computed<FieldEntry[]>(() => fieldList.value.items);

  const exportableFieldItems = computed<FieldEntry[]>(() => fieldList.value.items);

  const filteredSimpleTypes = computed<(MessageType & { fields: string[] })[]>(() => {
    const query = (
      simplePicker.value.open ? simplePicker.value.filter : useUiStore().ui.simpleFieldFilter || ''
    ).toLowerCase();
    const messageTypes = useLogStore().log.messageTypes;
    if (!query) return messageTypes;
    return messageTypes
      .map((typeInfo) => {
        const matched = (typeInfo.fields || []).filter(
          (fieldName) =>
            typeInfo.name.toLowerCase().includes(query) ||
            String(fieldName).toLowerCase().includes(query),
        );
        return matched.length ? { ...typeInfo, fields: matched } : null;
      })
      .filter((typeInfo): typeInfo is MessageType & { fields: string[] } => typeInfo !== null);
  });

  // ───────────────────── 3. Private utilities ─────────────────────────

  function checkboxChecked(event: Event): boolean {
    return !!(event && (event.target as HTMLInputElement)?.checked);
  }

  function activeCurvesOf(entryName: string): Curve[] {
    return useAnalysisStore().chart.activeCurves.filter((curve) => curve.fieldName === entryName);
  }

  function readEntriesFromJson(text: string): FieldEntry[] {
    const raw = JSON.parse(text) as { entries?: unknown; templates?: unknown };
    const list = Array.isArray(raw) ? raw : raw.entries ?? raw.templates;
    if (!Array.isArray(list)) throw new Error(tr('fields.store.invalidConfig'));
    const entries = list
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .filter((entry) => {
        const name = String(entry.name || '').trim();
        const curves = entry.curves;
        return name && Array.isArray(curves) && (curves as unknown[]).length > 0;
      })
      .map((entry) => ({
        name: String(entry.name || '').trim(),
        curves: entry.curves as FieldCurve[],
        scale: entry.scale as number,
        offset: entry.offset as number,
        scaleInput: entry.scaleInput as string,
        offsetInput: entry.offsetInput as string,
        createdAt: (entry.createdAt as string) || '',
        updatedAt: (entry.updatedAt as string) || '',
      }));
    if (!entries.length) throw new Error(tr('fields.store.noImportable'));
    return entries;
  }

  function triggerJsonDownload(payload: unknown, fileName: string): void {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    document.body.removeChild(anchor);
  }

  // ───────────────────── 4. Field activation ──────────────────────────

  async function applyFieldEntry(entry: FieldEntry): Promise<void> {
    const analysis = useAnalysisStore();
    if (!entry || !Array.isArray(entry.curves) || !entry.curves.length) return;

    if (isFieldActive(entry.name)) {
      removeFieldCurves(entry.name);
      return;
    }
    useLogStore().log.loading = true;
    analysis.setGroupParams(entry.name, entry);
    try {
      await analysis.addCurves(entry.curves, entry.name);
    } finally {
      useLogStore().log.loading = false;
    }
  }

  function selectSimpleField(entry: FieldEntry): void {
    if (!entry || !entry.name) return;
    const analysis = useAnalysisStore();
    const current = analysis.chart.activeField.selectedSimpleName;
    analysis.chart.activeField.selectedSimpleName = current === entry.name ? '' : entry.name;
  }

  function isSimpleFieldSelected(entry: FieldEntry | null): boolean {
    return !!entry && useAnalysisStore().chart.activeField.selectedSimpleName === entry.name;
  }

  function setSimpleFieldEnabled(entry: FieldEntry | null, event: Event): void {
    const enabled = checkboxChecked(event);
    if (!entry || !entry.name || isCurveItemActive(entry) === enabled) return;
    void applyFieldEntry(entry);
  }

  // ───────────────────── 5. Field introspection ───────────────────────

  function simpleFieldGroupParams(entry: FieldEntry | null): FieldGroupParams {
    const analysis = useAnalysisStore();
    if (!entry || !entry.name) return analysis.makeGroupParams(entry);
    return analysis.ensureGroupParams(entry.name, entry);
  }

  function isFieldActive(name: string): boolean {
    return useAnalysisStore().chart.activeCurves.some((curve) => curve.fieldName === name);
  }

  function isCurveItemActive(item: FieldEntry | null): boolean {
    if (!item || !item.name) return false;
    return isFieldActive(item.name);
  }

  // ───────────────── 6. Expand & visibility state ─────────────────────

  function isFieldExpanded(name: string): boolean {
    return !!useAnalysisStore().chart.activeField.expanded[name];
  }

  function toggleFieldExpanded(name: string): void {
    const analysis = useAnalysisStore();
    analysis.chart.activeField.expanded[name] = !analysis.chart.activeField.expanded[name];
  }

  function activeFieldAllVisible(name: string): boolean {
    const curves = activeCurvesOf(name);
    return !!curves.length && curves.every((curve) => curve.visible);
  }

  function setActiveFieldVisible(name: string, event: Event): void {
    const visible = checkboxChecked(event);
    const analysis = useAnalysisStore();
    for (const curve of analysis.chart.activeCurves) {
      if (curve.fieldName === name) curve.visible = visible;
    }
    analysis.refreshChart();
    analysis.scheduleCurveSave();
  }

  // ──────────────────── 7. Active field mutation ──────────────────────

  function removeFieldCurves(name: string): void {
    const analysis = useAnalysisStore();
    analysis.chart.activeCurves = analysis.chart.activeCurves.filter(
      (curve) => curve.fieldName !== name,
    );
    if (analysis.chart.activeField.selectedSimpleName === name) {
      analysis.chart.activeField.selectedSimpleName = '';
    }
    analysis.chart.activeField.expanded[name] = false;
    delete analysis.chart.activeField.groupParams[name];
    analysis.refreshChart();
    void analysis.saveCurvesNow();
  }

  function renameActiveFieldSource(oldName: string, newName: string): void {
    if (!oldName || !newName || oldName === newName) return;
    const analysis = useAnalysisStore();
    for (const curve of analysis.chart.activeCurves) {
      if (curve.fieldName === oldName) {
        curve.fieldName = newName;
      }
    }
    if (analysis.chart.activeField.groupParams[oldName]) {
      analysis.chart.activeField.groupParams[newName] = analysis.chart.activeField.groupParams[oldName];
      delete analysis.chart.activeField.groupParams[oldName];
    }
    if (analysis.chart.activeField.expanded[oldName] !== undefined) {
      analysis.chart.activeField.expanded[newName] = analysis.chart.activeField.expanded[oldName];
      delete analysis.chart.activeField.expanded[oldName];
    }
    analysis.refreshChart();
    analysis.scheduleCurveSave();
  }

  // ─────────────────── 8. Persistence & loading ───────────────────────

  function applyFieldsResponse(response: FieldEntriesResponse): void {
    const entries = Array.isArray(response.entries) ? response.entries : [];
    fieldList.value.items = entries.map((raw) => normalizeFieldEntry(raw));
    fieldList.value.path = response.path || '';
  }

  async function loadFields(): Promise<void> {
    fieldList.value.loading = true;
    try {
      const response: FieldEntriesResponse = await configClient.listFieldEntries();
      if (response.error) {
        showToast(response.error, 'error');
        return;
      }
      applyFieldsResponse(response);
    } catch (error: unknown) {
      showToast(tr('fields.store.loadFailed', { err: (error as Error).message }), 'error');
    } finally {
      fieldList.value.loading = false;
    }
  }

  function currentFieldEntryPayload(
    name: string,
    curves: FieldCurve[],
  ): FieldEntryPayload {
    const analysis = useAnalysisStore();
    const group = analysis.ensureGroupParams(name);
    return buildFieldEntryPayload(name, curves || [], group);
  }

  function updateFieldEntry(entry: FieldEntry | null): void {
    if (!entry || !entry.name) return;
    openSimplePicker(entry);
  }

  // ───────────────────── 9. Delete flow ───────────────────────────────

  function deleteFieldEntry(entry: FieldEntry | null, fromEditor?: boolean): void {
    if (!entry || !entry.name) return;
    if (fromEditor) {
      void performDeleteFieldEntry(entry, true);
      return;
    }
    fieldList.value.deleteTarget = entry;
    fieldList.value.deleteFromEditor = false;
    nextTick(() => openFieldDeleteDialog());
  }

  function registerFieldDeleteDialog(el: TemplateRefTarget): void {
    fieldDeleteDialogEl.value = el instanceof HTMLDialogElement ? el : null;
  }

  function openFieldDeleteDialog(): void {
    const dialog = fieldDeleteDialogEl.value;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
      return;
    }
    dialog.setAttribute('open', 'open');
  }

  function closeFieldDeleteDialog(): void {
    const dialog = fieldDeleteDialogEl.value;
    if (dialog && dialog.open && typeof dialog.close === 'function') dialog.close();
    else if (dialog) dialog.removeAttribute('open');
    fieldList.value.deleteTarget = null;
    fieldList.value.deleteFromEditor = false;
  }

  function confirmFieldDelete(): void {
    const target = fieldList.value.deleteTarget;
    const fromEditor = fieldList.value.deleteFromEditor;
    closeFieldDeleteDialog();
    void performDeleteFieldEntry(target, fromEditor);
  }

  function fieldDeleteKindLabel(_entry: FieldEntry | null): string {
    return tr('fields.kind.group');
  }

  async function performDeleteFieldEntry(
    entry: FieldEntry | null,
    fromEditor: boolean,
  ): Promise<void> {
    const analysis = useAnalysisStore();
    if (!entry || !entry.name) return;
    if (isCurveItemActive(entry)) await applyFieldEntry(entry);
    fieldList.value.loading = true;
    try {
      const response: FieldEntriesResponse = await configClient.deleteFieldEntry(entry.name);
      if (response.error) {
        showToast(response.error, 'error');
        return;
      }
      applyFieldsResponse(response);
      if (analysis.chart.activeField.name === entry.name) {
        analysis.chart.activeField.name = '';
        analysis.chart.activeField.expanded[entry.name] = false;
      }
      removeFieldCurves(entry.name);
      if (fromEditor) fieldList.value.edit.open = false;
      showToast(tr('fields.store.deleted', { kind: fieldDeleteKindLabel(entry) }), 'success');
    } catch (error: unknown) {
      showToast(tr('fields.store.deleteFailed', { err: (error as Error).message }), 'error');
    } finally {
      fieldList.value.loading = false;
    }
  }

  // ─────────────────── 10. Export & import ────────────────────────────

  function exportFields(): void {
    const items = exportableFieldItems.value;
    if (!items.length) {
      showToast(tr('fields.store.nothingToExport'), 'error');
      return;
    }
    fieldList.value.exportSelected = {};
    for (const item of items) fieldList.value.exportSelected[item.name] = true;
    fieldList.value.exportOpen = true;
  }

  function setAllFieldExportSelected(selected: boolean): void {
    for (const item of exportableFieldItems.value) {
      fieldList.value.exportSelected[item.name] = selected;
    }
  }

  function selectedFieldsForExport(): FieldEntry[] {
    const selected = fieldList.value.exportSelected || {};
    return exportableFieldItems.value.filter((item) => !!selected[item.name]);
  }

  function confirmExportFields(): void {
    const chosen = selectedFieldsForExport();
    if (!chosen.length) {
      showToast(tr('fields.store.selectAtLeastOne'), 'error');
      return;
    }
    triggerJsonDownload({ exportedAt: new Date().toISOString(), entries: chosen }, 'curve_groups_v1.json');
    fieldList.value.exportOpen = false;
    showToast(tr('fields.store.exported', { n: chosen.length }), 'success');
  }

  function importFields(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      let entries: FieldEntry[];
      try {
        entries = readEntriesFromJson(String(reader.result || ''));
      } catch (error: unknown) {
        showToast(tr('fields.store.importFailed', { err: (error as Error).message }), 'error');
        input.value = '';
        return;
      }

      fieldList.value.loading = true;
      let lastResponse: FieldEntriesResponse | null = null;
      try {
        for (const entry of entries) {
          const response: FieldEntriesResponse = await configClient.saveFieldEntry(entry);
          if (response.error) throw new Error(entry.name + ': ' + response.error);
          lastResponse = response;
        }
        if (lastResponse) applyFieldsResponse(lastResponse);
        showToast(tr('fields.store.imported', { n: entries.length }), 'success');
      } catch (error: unknown) {
        showToast(tr('fields.store.importFailed', { err: (error as Error).message }), 'error');
        await loadFields();
      } finally {
        fieldList.value.loading = false;
        input.value = '';
      }
    };
    reader.onerror = () => {
      showToast(tr('fields.store.readFileFailed'), 'error');
      input.value = '';
    };
    reader.readAsText(file);
  }

  // ─────────────────── 11. Simple picker ──────────────────────────────

  function openSimplePicker(group?: FieldEntry | null): void {
    const analysis = useAnalysisStore();
    simplePicker.value.selected = {};
    simplePicker.value.curveSettings = {};
    simplePicker.value.filter = '';
    simplePicker.value.expanded = {};
    simplePicker.value.originalName = group && group.name ? group.name : '';
    simplePicker.value.groupName = group && group.name ? group.name : '';
    const curves = group && Array.isArray(group.curves) ? group.curves : [];
    for (const curve of curves) {
      const key = analysis.curveKey(curve.type, curve.field);
      simplePicker.value.selected[key] = true;
      simplePicker.value.curveSettings[key] = makePickerCurveSettings(curve);
    }
    simplePicker.value.open = true;
  }

  function findExistingCurveSettings(type: string, field: string): PickerCurveSettings {
    const analysis = useAnalysisStore();
    const key = analysis.curveKey(type, field);
    const match = analysis.chart.activeCurves.find(
      (curve) => analysis.curveKey(curve.type, curve.field) === key,
    );
    return match ? makePickerCurveSettings(match) : makePickerCurveSettings();
  }

  function isSimplePickerSelected(type: string, field: string): boolean {
    return !!simplePicker.value.selected[useAnalysisStore().curveKey(type, field)];
  }

  function isSimplePickerTypeOpen(type: string): boolean {
    if (simplePicker.value.filter) return true;
    return !!simplePicker.value.expanded[type];
  }

  function toggleSimplePickerType(type: string): void {
    const next = { ...simplePicker.value.expanded };
    if (next[type]) delete next[type];
    else next[type] = true;
    simplePicker.value.expanded = next;
  }

  function countSimplePickerSelectedInType(type: string, fields: string[]): number {
    const selected = simplePicker.value.selected || {};
    const analysis = useAnalysisStore();
    let count = 0;
    for (const field of fields || []) {
      if (selected[analysis.curveKey(type, field)]) count++;
    }
    return count;
  }

  function toggleSimplePickerField(type: string, field: string): void {
    const analysis = useAnalysisStore();
    const key = analysis.curveKey(type, field);
    const nowSelected = !simplePicker.value.selected[key];
    simplePicker.value.selected[key] = nowSelected;
    if (nowSelected && !simplePicker.value.curveSettings[key]) {
      simplePicker.value.curveSettings[key] = findExistingCurveSettings(type, field);
    }
  }

  function selectedSimplePickerCurves(): FieldCurve[] {
    const analysis = useAnalysisStore();
    const selected = simplePicker.value.selected || {};
    const settings = simplePicker.value.curveSettings || {};
    const curves: FieldCurve[] = [];
    for (const typeInfo of useLogStore().log.messageTypes) {
      for (const field of typeInfo.fields || []) {
        const key = analysis.curveKey(typeInfo.name, field);
        if (!selected[key]) continue;
        if (!settings[key]) settings[key] = makePickerCurveSettings();
        const s = settings[key];
        curves.push({
          type: typeInfo.name,
          field,
          visible: s.visible,
          color: s.color,
          scale: tryFloat(s.scaleInput, s.scale),
          offset: tryFloat(s.offsetInput, s.offset),
          scaleInput: s.scaleInput,
          offsetInput: s.offsetInput,
        });
      }
    }
    return curves;
  }

  function onSimplePickerCurveParams(curve: FieldCurve): void {
    const key = useAnalysisStore().curveKey(curve.type, curve.field);
    if (!simplePicker.value.curveSettings[key]) {
      simplePicker.value.curveSettings[key] = makePickerCurveSettings(curve);
    }
    const settings = simplePicker.value.curveSettings[key];
    settings.scale = tryFloat(settings.scaleInput, 1);
    settings.offset = tryFloat(settings.offsetInput, 0);
  }

  function onSimplePickerCurveColor(curve: FieldCurve): void {
    const key = useAnalysisStore().curveKey(curve.type, curve.field);
    if (!simplePicker.value.curveSettings[key]) {
      simplePicker.value.curveSettings[key] = makePickerCurveSettings(curve);
    }
  }

  function resetSimplePickerCurveParams(curve: FieldCurve): void {
    const key = useAnalysisStore().curveKey(curve.type, curve.field);
    simplePicker.value.curveSettings[key] = makePickerCurveSettings({
      visible: curve.visible,
      color: curve.color,
      scale: 1,
      offset: 0,
      scaleInput: '1',
      offsetInput: '0',
    });
  }

  async function confirmSimplePickerSelection(): Promise<void> {
    const analysis = useAnalysisStore();
    const curves = selectedSimplePickerCurves();
    if (!curves.length) {
      showToast(tr('fields.store.selectAtLeastOneField'), 'error');
      return;
    }

    const originalName = simplePicker.value.originalName;
    const name = String(simplePicker.value.groupName || '').trim() || defaultSimpleItemName(curves);
    if (!name) {
      showToast(tr('fields.store.nameRequired'), 'error');
      return;
    }

    fieldList.value.loading = true;
    const shouldDeleteOld = originalName && originalName !== name;
    try {
      if (shouldDeleteOld) await configClient.deleteFieldEntry(originalName);
      const response: FieldEntriesResponse = await configClient.saveFieldEntry(
        currentFieldEntryPayload(name, curves),
      );
      if (response.error) {
        showToast(response.error, 'error');
        return;
      }
      applyFieldsResponse(response);
      if (originalName) removeFieldCurves(originalName);
      analysis.setGroupParams(name, { scale: 1, offset: 0, scaleInput: '1', offsetInput: '0' });
      await analysis.addCurves(curves, name);
      simplePicker.value.open = false;
      showToast(tr('fields.store.saved'), 'success');
    } catch (error: unknown) {
      showToast(tr('fields.store.saveFailed', { err: (error as Error).message }), 'error');
    } finally {
      fieldList.value.loading = false;
    }
  }

  // ─────────── 12. Public surface (names are the contract) ────────────

  function nextGroupName(): string {
    return suggestGroupName(fieldList.value.items);
  }

  function defaultSimpleItemName(curves: FieldCurve[]): string {
    return pickDefaultEntryName(curves, fieldList.value.items);
  }

  return {
    // state
    fieldList,
    simplePicker,
    fieldDeleteDialogEl,
    // computed
    filteredFields,
    exportableFieldItems,
    filteredSimpleTypes,
    // activation
    applyFieldEntry,
    selectSimpleField,
    isSimpleFieldSelected,
    setSimpleFieldEnabled,
    // introspection
    simpleFieldGroupParams,
    isFieldActive,
    isCurveItemActive,
    fieldSummary,
    // expand & visibility
    isFieldExpanded,
    toggleFieldExpanded,
    activeFieldAllVisible,
    setActiveFieldVisible,
    // mutation
    removeFieldCurves,
    renameActiveFieldSource,
    // persistence
    applyFieldsResponse,
    loadFields,
    currentFieldEntryPayload,
    updateFieldEntry,
    normalizeFieldEntry,
    cleanFieldEditCurves,
    // delete flow
    deleteFieldEntry,
    registerFieldDeleteDialog,
    openFieldDeleteDialog,
    closeFieldDeleteDialog,
    confirmFieldDelete,
    fieldDeleteKindLabel,
    performDeleteFieldEntry,
    // export & import
    exportFields,
    setAllFieldExportSelected,
    selectedFieldsForExport,
    confirmExportFields,
    importFields,
    // simple picker
    openSimplePicker,
    makePickerCurveSettings,
    findExistingCurveSettings,
    nextGroupName,
    defaultSimpleItemName,
    isSimplePickerSelected,
    isSimplePickerTypeOpen,
    toggleSimplePickerType,
    countSimplePickerSelectedInType,
    toggleSimplePickerField,
    selectedSimplePickerCurves,
    onSimplePickerCurveParams,
    onSimplePickerCurveColor,
    resetSimplePickerCurveParams,
    confirmSimplePickerSelection,
  };
});
