import type { Curve, FieldCurve } from '@/types';
import { configClient } from '@/services/config';
import { tr } from '@/locales';
import { runtime } from '@/modules/shared/runtime';
import { showToast } from '@/modules/shared/ui-store';
import { tryFloat } from '@/modules/shared/utils/format';
import { nextColor } from '@/modules/shared/utils/colors';
import { useLogStore } from '@/modules/log';
import { useCurveManagerStore } from '@/modules/curves';
import type { CurveBinary } from '../../utils/curve-binary';
import type { AnalysisState } from '../state';
import type { DataApi } from '../data';
import type { ChartApi } from '../view';
import type { CurveSaveApi } from './save';
import { describeError, isConfigError } from './helpers';

/** 加入图表前的曲线种子：来自字段定义或已保存状态，字段大部分可选。 */
export interface CurveSeed extends FieldCurve {
  fieldName?: string;
  fieldGroupScale?: number;
  fieldGroupOffset?: number;
  fieldGroupScaleInput?: string;
  fieldGroupOffsetInput?: string;
}

/** 曲线集生命周期：增删/恢复/变换应用/AI 叠加/持久化恢复。 */
export interface CurveLifecycleApi {
  curveKey(type: string, field: string): string;
  addCurves(seeds: CurveSeed[], fieldName: string): Promise<void>;
  loadCurves(seeds: CurveSeed[], fieldName: string): Promise<void>;
  restoreCurves(previousCurves: CurveSeed[]): Promise<void>;
  restoreSavedCurves(): Promise<void>;
  isFieldActive(type: string, field: string): boolean;
  getFieldColor(type: string, field: string): string;
  toggleField(type: string, field: string): void;
  addCurve(type: string, field: string): Promise<void>;
  loadAiCurves(fieldNames: string[]): Promise<void>;
  clearAiCurves(): void;
  removeCurve(idx: number): void;
  removeCurveById(id: string): void;
  clearAll(): void;
  toggleCurveVisible(curve: Curve): void;
  curvePointCount(curve: Curve | null): number;
  isCurveDrawn(id: string): boolean;
  toggleCurveDrawn(curve: Curve): void;
  applySamplingToggle(): Promise<void>;
  applyCurveColor(curve: Curve): void;
  applyCurveParams(curve: Curve): void;
  resetCurveParams(curve: Curve): void;
}

export function createCurveLifecycle(
  state: AnalysisState,
  data: DataApi,
  view: ChartApi,
  save: CurveSaveApi,
): CurveLifecycleApi {
  const curveKey = (type: string, field: string): string => type + '.' + field;

  /** 取字段二进制；ERR.ECode 顺带预取 Subsys（错误码翻译需要）。 */
  function fetchCurveBinary(type: string, field: string): Promise<CurveBinary> {
    const cm = useCurveManagerStore();
    if (type === 'ERR' && field === 'ECode') void cm.get('ERR', 'Subsys').catch(() => {});
    return cm.get(type, field);
  }

  function makeCurve(type: string, field: string, binary: CurveBinary, previous?: CurveSeed): Curve {
    const prev: Partial<CurveSeed> = previous || {};
    const cm = useCurveManagerStore();
    const unit = (cm.logdefs && cm.logdefs.units[type + '.' + field]) || '';
    return {
      id: type + '.' + field,
      type,
      field,
      label: type + '.' + field,
      min: binary.min,
      max: binary.max,
      count: binary.count,
      unit,
      valueLabels: {},
      visible: prev.visible !== undefined ? prev.visible : true,
      color: prev.color || nextColor(),
      scale: prev.scale !== undefined ? prev.scale : 1,
      offset: prev.offset !== undefined ? prev.offset : 0,
      scaleInput: prev.scaleInput !== undefined ? prev.scaleInput : '1',
      offsetInput: prev.offsetInput !== undefined ? prev.offsetInput : '0',
      fieldName: prev.fieldName || (type + '.' + field),
      fieldGroupScale: prev.fieldGroupScale !== undefined ? prev.fieldGroupScale : 1,
      fieldGroupOffset: prev.fieldGroupOffset !== undefined ? prev.fieldGroupOffset : 0,
      fieldGroupScaleInput: prev.fieldGroupScaleInput !== undefined ? prev.fieldGroupScaleInput : '1',
      fieldGroupOffsetInput: prev.fieldGroupOffsetInput !== undefined ? prev.fieldGroupOffsetInput : '0',
      buffer: binary.buffer,
      baseTimeMs: binary.baseTimeMs,
      bufferCount: binary.count,
    };
  }

  /** 增量并入曲线：已存在的更新变换/颜色，缺失的按二进制构建后追加。 */
  async function addCurves(seeds: CurveSeed[], fieldName: string): Promise<void> {
    if (!seeds.length) return;

    // 已在图中的曲线：key → 在 activeCurves 中的下标
    const indexByKey = new Map<string, number>();
    state.chart.value.activeCurves.forEach((c, idx) => indexByKey.set(curveKey(c.type, c.field), idx));

    const added: Curve[] = [];
    const missed: string[] = [];
    let adopted = 0;
    let updated = 0;
    let skipped = 0;

    for (const seed of seeds) {
      const key = curveKey(seed.type, seed.field);
      const existingIdx = indexByKey.get(key);
      if (existingIdx !== undefined) {
        const current = state.chart.value.activeCurves[existingIdx];
        if (seed.visible !== undefined) current.visible = !!seed.visible;
        if (seed.color) current.color = seed.color;
        current.scale = seed.scale !== undefined ? seed.scale : tryFloat(seed.scaleInput, current.scale);
        current.offset = seed.offset !== undefined ? seed.offset : tryFloat(seed.offsetInput, current.offset);
        current.scaleInput = seed.scaleInput !== undefined ? String(seed.scaleInput) : String(current.scale);
        current.offsetInput = seed.offsetInput !== undefined ? String(seed.offsetInput) : String(current.offset);
        if (fieldName && !current.fieldName) {
          current.fieldName = fieldName;
          adopted++;
        }
        updated++;
        skipped++;
        continue;
      }
      try {
        const binary = await fetchCurveBinary(seed.type, seed.field);
        const curve = makeCurve(seed.type, seed.field, binary, { ...seed, fieldName: fieldName || '' });
        state.chart.value.activeCurves.push(curve);
        indexByKey.set(key, state.chart.value.activeCurves.length - 1);
        added.push(curve);
      } catch {
        missed.push(key);
      }
    }

    if ((added.length || adopted) && fieldName && state.chart.value.activeField.expanded[fieldName] === undefined) {
      state.chart.value.activeField.expanded[fieldName] = false;
    }
    view.refreshChart();
    if (added.length || adopted || updated) save.scheduleCurveSave();
    if (missed.length) {
      showToast(tr('analysis.toast.missingFields', { n: missed.length }), 'info');
    } else if (fieldName) {
      let msg = added.length || adopted ? tr('analysis.toast.groupAdded', { name: fieldName }) : tr('analysis.toast.groupAlreadyPresent');
      if (skipped && added.length) msg += tr('analysis.toast.skippedDup', { n: skipped });
      showToast(msg, added.length || adopted ? 'success' : 'info');
    }
  }

  /** 全量替换曲线：清空后按种子重建（用于恢复已保存状态）。 */
  async function loadCurves(seeds: CurveSeed[], fieldName: string): Promise<void> {
    if (!seeds.length) return;
    state.curveDrawn.value = {};

    const restored: Curve[] = [];
    const missed: string[] = [];
    for (const seed of seeds) {
      try {
        const binary = await fetchCurveBinary(seed.type, seed.field);
        restored.push(makeCurve(seed.type, seed.field, binary, seed));
      } catch {
        missed.push(seed.type + '.' + seed.field);
      }
    }

    state.chart.value.activeCurves = restored;
    state.chart.value.activeField.name = fieldName || '';
    state.chart.value.activeField.expanded = {};
    data.collectGroupParamsFrom(restored);
    view.refreshChart();
    save.scheduleCurveSave();
    if (missed.length) {
      showToast(tr('analysis.toast.missingFields', { n: missed.length }), 'info');
    } else if (fieldName) {
      showToast(tr('analysis.toast.groupApplied', { name: fieldName }), 'success');
    }
  }

  function restoreCurves(previousCurves: CurveSeed[]): Promise<void> {
    if (!previousCurves || !previousCurves.length) return Promise.resolve();
    return loadCurves(previousCurves, '');
  }

  async function restoreSavedCurves(): Promise<void> {
    state.curveSave.value.restoring = true;
    try {
      const res: unknown = await configClient.getCurveState();
      if (isConfigError(res)) { showToast(res.error, 'error'); return; }
      const payload = res as { activeCurves?: CurveSeed[] };
      const curves = Array.isArray(payload.activeCurves) ? payload.activeCurves : [];
      if (curves.length) await loadCurves(curves, '');
    } catch (e: unknown) {
      showToast(tr('analysis.toast.restoreCurveStateFailed', { err: describeError(e) }), 'error');
    } finally {
      state.curveSave.value.restoring = false;
    }
  }

  const isFieldActive = (type: string, field: string): boolean =>
    state.chart.value.activeCurves.some((c) => c.type === type && c.field === field);

  function getFieldColor(type: string, field: string): string {
    const c = state.chart.value.activeCurves.find((cur) => cur.type === type && cur.field === field);
    return c ? c.color : 'transparent';
  }

  function toggleField(type: string, field: string): void {
    const idx = state.chart.value.activeCurves.findIndex((c) => c.type === type && c.field === field);
    if (idx >= 0) removeCurve(idx);
    else void addCurve(type, field);
  }

  async function addCurve(type: string, field: string): Promise<void> {
    const logStore = useLogStore();
    logStore.log.loading = true;
    try {
      const binary = await fetchCurveBinary(type, field);
      state.chart.value.activeCurves.push(makeCurve(type, field, binary));
      view.refreshChart();
      save.scheduleCurveSave();
    } catch (e: unknown) {
      showToast(tr('analysis.toast.fetchFailed', { err: describeError(e) }), 'error');
    } finally {
      logStore.log.loading = false;
    }
  }

  /**
   * AI 问题时段联动：把 incident 引用的字段加载为**临时叠加曲线**（整体替换
   * 上一次的叠加）。与用户曲线彻底分开：不进 activeCurves、不持久化、不进
   * 图例；用户图上已有的字段不重复叠加。字段名是模型生成的，可能写错——
   * 失败静默跳过不弹错。
   */
  async function loadAiCurves(fieldNames: string[]): Promise<void> {
    const overlay: Curve[] = [];
    for (const name of fieldNames) {
      const dot = name.indexOf('.');
      if (dot <= 0 || dot >= name.length - 1) continue;
      const type = name.slice(0, dot);
      const field = name.slice(dot + 1);
      if (isFieldActive(type, field)) continue; // 用户图上已有：不重复叠加
      try {
        const binary = await fetchCurveBinary(type, field);
        overlay.push(makeCurve(type, field, binary));
      } catch {
        // 字段不存在（名字写错/该格式无此字段）：跳过
      }
    }
    const changed =
      overlay.length !== state.aiCurves.value.length ||
      overlay.some((c, i) => c.id !== state.aiCurves.value[i]?.id);
    state.aiCurves.value = overlay;
    if (changed) view.refreshChart();
  }

  /** 清除 AI 临时叠加曲线（取消聚焦/清空会话/切换日志时）。 */
  function clearAiCurves(): void {
    if (!state.aiCurves.value.length) return;
    state.aiCurves.value = [];
    view.refreshChart();
  }

  function removeCurve(idx: number): void {
    const removed = state.chart.value.activeCurves[idx];
    state.chart.value.activeCurves.splice(idx, 1);
    if (removed) forgetDrawn(removed.id);
    data.pruneGroupParams();
    if (!state.chart.value.activeCurves.length) {
      state.chart.value.activeField.name = '';
      state.chart.value.activeField.selectedSimpleName = '';
      state.chart.value.activeField.expanded = {};
      state.chart.value.activeField.groupParams = {};
    }
    view.refreshChart();
    void save.saveCurvesNow();
  }

  function removeCurveById(id: string): void {
    const idx = state.chart.value.activeCurves.findIndex((c) => c.id === id);
    if (idx >= 0) removeCurve(idx);
  }

  function clearAll(): void {
    state.chart.value.activeCurves = [];
    state.curveDrawn.value = {};
    state.chart.value.activeField.name = '';
    state.chart.value.activeField.selectedSimpleName = '';
    state.chart.value.activeField.expanded = {};
    state.chart.value.activeField.groupParams = {};
    view.refreshChart();
    void save.saveCurvesNow();
  }

  function toggleCurveVisible(_curve: Curve): void {
    view.refreshChart();
    save.scheduleCurveSave();
  }

  const curvePointCount = (curve: Curve | null): number => (curve ? curve.count || 0 : 0);
  const isCurveDrawn = (id: string): boolean => state.curveDrawn.value[id] !== false;

  function toggleCurveDrawn(curve: Curve): void {
    const next = !isCurveDrawn(curve.id);
    state.curveDrawn.value = { ...state.curveDrawn.value, [curve.id]: next };
    if (runtime.mainChart) runtime.mainChart.setCurveVisible(curve.id, next);
  }

  function forgetDrawn(id: string): void {
    if (state.curveDrawn.value[id] === undefined) return;
    const next = { ...state.curveDrawn.value };
    delete next[id];
    state.curveDrawn.value = next;
  }

  /** 采样模式切换后全量刷新曲线二进制（重取数据再重建）。 */
  async function applySamplingToggle(): Promise<void> {
    if (!state.chart.value.activeCurves.length) return;
    const logStore = useLogStore();
    logStore.log.loading = true;
    const prev = state.chart.value.activeCurves.slice();
    const refreshed: Curve[] = [];
    const failed: string[] = [];
    for (const curve of prev) {
      try {
        const binary = await fetchCurveBinary(curve.type, curve.field);
        refreshed.push(makeCurve(curve.type, curve.field, binary, curve));
      } catch {
        failed.push(curve.id);
      }
    }
    if (refreshed.length) state.chart.value.activeCurves = refreshed;
    view.refreshChart();
    logStore.log.loading = false;
    if (failed.length) {
      showToast(tr('analysis.toast.refreshFailed', { n: failed.length }), 'error');
    } else {
      showToast(state.chart.value.sampling ? tr('analysis.toast.samplingOn') : tr('analysis.toast.samplingOff'), 'success');
    }
  }

  /** 颜色不影响数据量程：只增量 patch 系列颜色，保留当前缩放视口。 */
  function applyCurveColor(_curve: Curve): void {
    if (runtime.mainChart) runtime.mainChart.syncCurves(data.buildCurveSeries(data.timeOriginMs()));
    view.syncThreeCurveAxis();
    save.scheduleCurveSave();
  }

  function applyCurveParams(curve: Curve): void {
    curve.scale = tryFloat(curve.scaleInput, 1);
    curve.offset = tryFloat(curve.offsetInput, 0);
    view.refreshTransforms();
    save.scheduleCurveSave();
  }

  function resetCurveParams(curve: Curve): void {
    curve.scale = 1;
    curve.offset = 0;
    curve.scaleInput = '1';
    curve.offsetInput = '0';
    view.refreshTransforms();
    save.scheduleCurveSave();
  }

  return {
    curveKey,
    addCurves,
    loadCurves,
    restoreCurves,
    restoreSavedCurves,
    isFieldActive,
    getFieldColor,
    toggleField,
    addCurve,
    loadAiCurves,
    clearAiCurves,
    removeCurve,
    removeCurveById,
    clearAll,
    toggleCurveVisible,
    curvePointCount,
    isCurveDrawn,
    toggleCurveDrawn,
    applySamplingToggle,
    applyCurveColor,
    applyCurveParams,
    resetCurveParams,
  };
}
