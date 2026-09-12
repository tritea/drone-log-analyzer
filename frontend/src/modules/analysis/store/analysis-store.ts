import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  ChartState,
  Curve,
  CurveSaveState,
  FieldEntry,
  FieldGroupItem,
  FieldGroupParams,
  FieldCurve,
  FlightMode,
  LogError,
  LogEvent,
  LogMessage,
} from '@/types';
import { configClient } from '@/services/config';
import { runtime } from '@/modules/shared/runtime';
import { tryFloat } from '@/modules/shared/utils/format';
import { showToast, useUiStore } from '@/modules/shared/ui-store';
import { nextColor } from '@/modules/shared/utils/colors';
import { useFieldsStore } from '@/modules/fields';
import type { FieldEntriesResponse } from '@/modules/fields/store/field-helpers';
import { useLogStore } from '@/modules/log';
import { useScene3dStore } from '@/modules/scene-3d';
import { useAgentStore } from '@/modules/agent';
import { SEVERITY_META } from '@/modules/agent/utils/incidents';
import { useCurveManagerStore, findIndexAt } from '@/modules/curves';
import { LineChart } from '../renderer/line-chart';
import type { LineSeries, MarkArea, MarkLine, ValueRange } from '../types';
import type { CurveBinary } from '../utils/curve-binary';
import {
  formatTime,
  formatUTCTime,
  formatDuration,
  fmtCount,
  formatParameterValue,
  formatCoord,
  pointDecimals,
} from '../utils/format';
import {
  NAMED_MODE_TINT,
  MODE_TINT_PALETTE,
  translateModeLabel,
  modeBadgeColor,
  modeAtTime,
} from '../utils/flight-modes';

/** 加入图表前的曲线种子：来自字段定义或已保存状态，字段大部分可选。 */
export interface CurveSeed extends FieldCurve {
  fieldName?: string;
  fieldGroupScale?: number;
  fieldGroupOffset?: number;
  fieldGroupScaleInput?: string;
  fieldGroupOffsetInput?: string;
}

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

const SAVE_DEBOUNCE_MS = 350;
const TOOLTIP_MSG_CAP = 200;
const MARK_LINE_CAP = 150;
/** AI 警示带 z 深度：略靠前于模式色带（-2），避免共面 z-fighting。 */
const AI_BAND_Z = -1.9;
const ESCAPE_MAP: Array<[RegExp, string]> = [[/&/g, '&amp;'], [/</g, '&lt;'], [/>/g, '&gt;']];
const escapeHtml = (s: unknown): string => ESCAPE_MAP.reduce((acc, [re, rep]) => acc.replace(re, rep), String(s));

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const isConfigError = (res: unknown): res is { error: string } =>
  !!res && typeof res === 'object' && !Array.isArray(res) && typeof (res as { error?: unknown }).error === 'string';
const microtask = (fn: () => void): Promise<void> => Promise.resolve().then(fn);

export const useAnalysisStore = defineStore('analysis', () => {
  // ═══════════════════════ 1. 状态 ═══════════════════════
  const chart = ref<ChartState>({
    activeCurves: [],
    tooltip: true,
    sampling: false,
    showErrors: true,
    showEvents: true,
    showMessages: false,
    lineWidth: 3,
    activeField: { name: '', selectedSimpleName: '', expanded: {}, groupParams: {} },
  });
  const curveState = ref<CurveSaveState>({ loading: false, restoring: false, saveTimer: null });
  /** 运行时绘制开关（不持久化）：curveId → 是否绘制；缺省视为 true。 */
  const curveDrawn = ref<Record<string, boolean>>({});
  /**
   * AI 定位问题时段时临时叠加的曲线：与用户曲线（activeCurves，持久化、进图例）
   * 彻底分开——只在渲染层合并（绘制/量程/hover），不进 activeCurves、不持久化、
   * 不进图例；点击问题卡片时整体替换，再次点击取消，清空会话/切换日志即消失。
   */
  const aiOverlay = ref<Curve[]>([]);

  // ═══════════════════════ 2. 字段组参数（纯数据读写）═══════════════════════
  function makeFieldGroupParams(source?: GroupParamSource): FieldGroupParams {
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

  function ensureFieldGroupParams(name?: string, source?: GroupParamSource): FieldGroupParams {
    if (!name) return makeFieldGroupParams(source);
    if (!chart.value.activeField.groupParams[name]) {
      chart.value.activeField.groupParams[name] = makeFieldGroupParams(source);
    }
    return chart.value.activeField.groupParams[name];
  }

  function setFieldGroupParams(name: string, source?: GroupParamSource): void {
    if (!name) return;
    chart.value.activeField.groupParams[name] = makeFieldGroupParams(source);
  }

  function collectFieldGroupParamsFromCurves(curves: Curve[]): void {
    chart.value.activeField.groupParams = {};
    for (const c of curves) {
      if (!c.fieldName || chart.value.activeField.groupParams[c.fieldName]) continue;
      setFieldGroupParams(c.fieldName, {
        scale: c.fieldGroupScale,
        offset: c.fieldGroupOffset,
        scaleInput: c.fieldGroupScaleInput,
        offsetInput: c.fieldGroupOffsetInput,
      });
    }
  }

  function pruneFieldGroupParams(): void {
    const active: Record<string, boolean> = {};
    for (const c of chart.value.activeCurves) if (c.fieldName) active[c.fieldName] = true;
    for (const name in chart.value.activeField.groupParams) if (!active[name]) delete chart.value.activeField.groupParams[name];
  }

  // ═══════════════════════ 3. 值变换与量程 ═══════════════════════
  function transformValue(val: number, curve: Curve): number {
    const own = val * curve.scale + curve.offset;
    const group = ensureFieldGroupParams(curve.fieldName);
    return own * group.scale + group.offset;
  }

  /** 渲染/hover 用的合并曲线集：用户曲线 + AI 临时叠加（同 id 剔重）。
   * 注意：主图绘制/量程/视口只用 activeCurves——AI 叠加走独立绘制通道
   *（buildAiSeries），不进任何用户曲线管线。 */
  function renderedCurves(): Curve[] {
    if (!aiOverlay.value.length) return chart.value.activeCurves;
    const ids = new Set(chart.value.activeCurves.map((c) => c.id));
    const extra = aiOverlay.value.filter((c) => !ids.has(c.id));
    return extra.length ? [...chart.value.activeCurves, ...extra] : chart.value.activeCurves;
  }

  /** 用户曲线为空时视口退化 {0,1}，AI 独立通道的曲线将永远不可见——
   * 空图时由 AI 叠加曲线撑起 X/Y 范围。 */
  function curveSource(): Curve[] {
    return chart.value.activeCurves.length ? chart.value.activeCurves : aiOverlay.value;
  }

  function calcYRange(): ValueRange {
    let gMin = Infinity;
    let gMax = -Infinity;
    for (const c of curveSource()) {
      if (!c.visible || !c.count) continue;
      let lo = transformValue(c.min, c);
      let hi = transformValue(c.max, c);
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

  function calcXRange(): ValueRange {
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

  function chartBaseTimeMs(): number {
    const base = chart.value.activeCurves.find((c) => c.visible && c.buffer && c.baseTimeMs !== undefined);
    if (base && base.baseTimeMs !== undefined) return base.baseTimeMs;
    // 用户曲线为空时退用 AI 叠加曲线的时间基准（独立通道也要有原点可依）
    const ai = aiOverlay.value.find((c) => c.buffer && c.baseTimeMs !== undefined);
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
    return chartBaseTimeMs();
  }

  // ═══════════════════════ 4. 系列与标注 ═══════════════════════
  function buildLineSeries(baseTimeMs: number): LineSeries[] {
    const out: LineSeries[] = [];
    for (const c of chart.value.activeCurves) {
      if (!c.visible || !c.buffer || !c.buffer.length) continue;
      const group = ensureFieldGroupParams(c.fieldName);
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
        visible: isCurveDrawn(c.id),
      });
    }
    return out;
  }

  function buildMarkAreas(xRange: ValueRange): MarkArea[] {
    const out: MarkArea[] = [];
    if (!xRange) return out;
    const modes = useLogStore().log.flightModes || [];
    if (modes.length) {
      const assigned: Record<string, string> = { ...NAMED_MODE_TINT };
      let paletteIdx = 0;
      const colorFor = (name: string): string => {
        const key = name.toUpperCase();
        if (!assigned[key]) {
          assigned[key] = MODE_TINT_PALETTE[paletteIdx % MODE_TINT_PALETTE.length];
          paletteIdx++;
        }
        return assigned[key];
      };

      let i = 0;
      while (i < modes.length) {
        const name = modes[i].mode;
        const rawStart = modes[i].timeMs;
        let j = i;
        while (j + 1 < modes.length && modes[j + 1].mode === name) j++;
        const rawEnd = j + 1 < modes.length ? modes[j + 1].timeMs : xRange.max;
        if (typeof rawStart === 'number' && typeof rawEnd === 'number' && rawEnd > xRange.min && rawStart < xRange.max) {
          const start = Math.max(rawStart, xRange.min);
          const end = Math.min(rawEnd, xRange.max);
          if (end > start) out.push({ startT: start, endT: end, color: colorFor(name), label: translateMode(name) });
        }
        i = j + 1;
      }
    }

    // AI 问题时段：按严重度铺半透明警示带 + 第二行标题文字（第一行是飞行模式名，错开 22px）；
    // z 略靠前于模式色带，避免共面 z-fighting 闪烁
    const incidents = useAgentStore().incidents;
    if (incidents.length) {
      const base = incidentAnchorMs();
      for (const inc of incidents) {
        const s = base + inc.startSec * 1000;
        const e = base + inc.endSec * 1000;
        if (e > xRange.min && s < xRange.max && e > s) {
          out.push({
            startT: Math.max(s, xRange.min),
            endT: Math.min(e, xRange.max),
            color: SEVERITY_META[inc.severity].band,
            label: '⚠ ' + inc.title,
            labelTop: 22,
            z: AI_BAND_Z,
          });
        }
      }
    }
    return out;
  }

  function buildMarkLines(xRange: ValueRange): MarkLine[] {
    const out: MarkLine[] = [];
    if (!xRange || !(xRange.max > xRange.min)) return out;
    const xmin = xRange.min;
    const xmax = xRange.max;

    const pushItems = <T extends { timeMs?: number }>(
      items: T[] | undefined,
      color: string,
      textColor: string,
      row: number,
      kind: string,
      makeLabel: (it: T) => string,
    ): void => {
      if (!items || !items.length) return;
      let count = 0;
      for (let i = 0; i < items.length && count < MARK_LINE_CAP; i++) {
        const it = items[i];
        const t = it && it.timeMs;
        if (typeof t !== 'number' || !isFinite(t)) continue;
        if (t < xmin || t > xmax) continue;
        out.push({ t, row, color, textColor, text: makeLabel(it), kind });
        count++;
      }
    };

    const logStore = useLogStore();
    if (chart.value.showErrors) {
      pushItems(logStore.log.errors as LogError[], '#dc2626', '#111827', 0, 'err', (e) => {
        const sub = e.subsysName || '#' + e.subsys;
        return '错误: ' + sub + ': ' + (e.description || '#' + e.eCode);
      });
    }
    if (chart.value.showEvents) {
      pushItems(logStore.log.events as LogEvent[], '#059669', '#ff0000', 1, 'ev', (ev) => '事件: ' + (ev.name || 'EV #' + ev.id));
    }
    if (chart.value.showMessages) {
      pushItems(logStore.log.messages as LogMessage[], '#2563eb', '#111827', 2, 'msg', (m) => {
        let msg = (m && m.message) || '';
        if (msg.length > 64) msg = msg.slice(0, 64) + '…';
        return '消息: ' + msg;
      });
    }

    // AI 问题时段：起点竖线标签（第 3 行，颜色按严重度），点击可定位
    const incidents = useAgentStore().incidents;
    let aiCount = 0;
    for (const inc of incidents) {
      if (aiCount >= MARK_LINE_CAP) break;
      const t = incidentAnchorMs() + inc.startSec * 1000;
      if (t < xmin || t > xmax) continue;
      const meta = SEVERITY_META[inc.severity];
      out.push({
        t,
        row: 3,
        color: meta.color,
        textColor: '#ffffff',
        text: 'AI: ' + inc.title,
        kind: 'ai',
        id: inc.id,
        detail: `【${meta.label}】${inc.desc || inc.title}${inc.fields.length ? '\n字段：' + inc.fields.join(', ') : ''}`,
      });
      aiCount++;
    }
    return out;
  }

  function buildEventMarkTooltip(items: { t: number; text: string; detail?: string }[], kind: string): string {
    const meta = kind === 'err'
      ? { title: '错误', accent: '#dc2626', prefix: '错误: ' }
      : kind === 'ev'
        ? { title: '事件', accent: '#059669', prefix: '事件: ' }
        : kind === 'ai'
          ? { title: 'AI 问题时段', accent: '#d97706', prefix: 'AI: ' }
          : { title: '消息', accent: '#2563eb', prefix: '消息: ' };

    const more = items.length > TOOLTIP_MSG_CAP ? items.length - TOOLTIP_MSG_CAP : 0;
    const shown = more ? items.slice(0, TOOLTIP_MSG_CAP) : items;
    const rows = shown
      .map((it) => {
        const txt = it.text.indexOf(meta.prefix) === 0 ? it.text.slice(meta.prefix.length) : it.text;
        const detail = it.detail
          ? '<div style="color:#64748b;font-size:11px;margin:1px 0 3px;white-space:pre-line">' + escapeHtml(it.detail) + '</div>'
          : '';
        return (
          '<div style="display:grid;grid-template-columns:62px minmax(0,1fr);gap:8px;align-items:baseline;padding:2px 0">' +
          '<span style="color:#94a3b8;font:10px/1.4 Consolas,"SF Mono",monospace;white-space:nowrap">' + formatTime(it.t, false) + '</span>' +
          '<span style="min-width:0;overflow-wrap:anywhere">' + escapeHtml(txt) + detail + '</span></div>'
        );
      })
      .join('');

    return (
      '<div style="min-width:200px;max-width:440px">' +
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:5px;padding-bottom:5px;border-bottom:1px solid #f1f5f9">' +
      '<b style="color:' + meta.accent + ';font-size:12px">' + meta.title + '</b>' +
      '<span style="color:#94a3b8;font-size:10px">' + items.length + (items.length > 1 ? ' 个重叠' : ' 条') + '</span></div>' +
      '<div style="max-height:300px;overflow-y:auto;padding-right:6px">' + rows + '</div>' +
      (more ? '<div style="color:#94a3b8;font-size:10px;margin-top:4px">还有 ' + more + ' 个…</div>' : '') +
      '</div>'
    );
  }

  function buildTooltip(targetTime: number): string {
    const cm = useCurveManagerStore();
    const mode = findModeAtTime(targetTime);
    const rows: string[] = [];

    for (const curve of renderedCurves()) {
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

      const transformed = transformValue(rawValue, curve);
      const group = ensureFieldGroupParams(curve.fieldName);
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
      html += '<span style="color:#0369a1;font-weight:700">MODE</span>: <b>' + translateMode(mode.mode) + '</b>';
      html += ' <span style="color:#999;font-size:10px">since ' + formatTime(mode.timeMs, false) + '</span><br/>';
    }
    return html + rows.join('<br/>') + '</div>';
  }

  // ═══════════════════════ 5. 图表生命周期 ═══════════════════════
  function syncThreeCurveChart(): void {
    const threeStore = useScene3dStore();
    if (threeStore.three.playback.curveAxis && useUiStore().ui.mainView === 'three') threeStore.rebuildThreeCurveChart();
  }

  /**
   * AI 临时叠加 → 独立绘制系列：有用户曲线时归一化映射到主图 Y 范围的**上半区**
   *（形状保真、不扰动用户量程/视口）；图上没有用户曲线时由 AI 曲线撑起量程
   * 并映射到全幅（否则视口退化 {0,1}，AI 曲线永远不可见）。id 加 ai- 前缀，
   * 走 LineChart 的独立叠加通道 setAiSeries。
   */
  function buildAiSeries(baseTimeMs: number): LineSeries[] {
    if (!aiOverlay.value.length) return [];
    const ids = new Set(chart.value.activeCurves.map((c) => c.id));
    const empty = chart.value.activeCurves.length === 0;
    const yRange = calcYRange();
    const span = yRange.max - yRange.min || 1;
    const bandRatio = empty ? 0.96 : 0.45; // 空图全幅；有用户曲线时上半区带
    const bandBase = empty ? yRange.min + span * 0.02 : yRange.min + span * 0.5;
    const out: LineSeries[] = [];
    for (const c of aiOverlay.value) {
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

  function applyChartOptions(): void {
    const baseTimeMs = chartBaseTimeMs();
    const xRange = calcXRange();
    runtime.mainChart.setOption({
      series: buildLineSeries(baseTimeMs),
      xRange,
      yRange: calcYRange(),
      baseTimeMs,
      markAreas: buildMarkAreas(xRange),
      markLines: buildMarkLines(xRange),
    });
    runtime.mainChart.setAiSeries(buildAiSeries(baseTimeMs));
    runtime.mainChart.resize();
    syncThreeCurveChart();
  }

  function rebuildChart(): void {
    if (runtime.mainChart) { applyChartOptions(); return; }
    microtask(() => {
      const el = document.getElementById('main-chart');
      if (!el) return;
      runtime.mainChart = new LineChart(el, {
        grid: { left: 60, right: 16, top: 38, bottom: 44 },
        clearColor: 0xffffff,
        panAxis: 'both',
        enableTooltip: chart.value.tooltip,
        enableMarkArea: true,
        enableMarkLine: true,
        enableBoxZoom: true,
        enableWheelZoom: true,
        enableDragPan: true,
        lineWidth: chart.value.lineWidth,
        resolveTooltip: (t) => (chart.value.tooltip ? buildTooltip(t) : null),
        resolveMarkTooltip: (items, kind) => buildEventMarkTooltip(items, kind),
        onMarkClick: (m) => {
          if (m.kind !== 'ai' || !m.id) return;
          const inc = useAgentStore().incidents.find((i) => i.id === m.id);
          if (inc) useAgentStore().focusIncident(inc);
        },
        formatX: (ms) => formatTime(ms, false),
      });
      applyChartOptions();
    });
  }

  /** 仅刷新曲线变换（缩放/偏移）并重算 Y 量程，保留当前 X 缩放窗口。 */
  function refreshTransform(): void {
    if (!runtime.mainChart) return;
    runtime.mainChart.setSeries(buildLineSeries(chartBaseTimeMs()));
    runtime.mainChart.refitYRange(calcYRange());
    runtime.mainChart.setAiSeries(buildAiSeries(chartBaseTimeMs()));
    syncThreeCurveChart();
  }

  // ═══════════════════════ 6. 曲线生命周期 ═══════════════════════
  function ensureCurveBinary(type: string, field: string): Promise<CurveBinary> {
    const cm = useCurveManagerStore();
    if (type === 'ERR' && field === 'ECode') void cm.get('ERR', 'Subsys').catch(() => {});
    return cm.get(type, field);
  }

  const curveKey = (type: string, field: string): string => type + '.' + field;

  function buildCurve(type: string, field: string, binary: CurveBinary, previous?: CurveSeed): Curve {
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
  async function addCurveSelection(seeds: CurveSeed[], fieldName: string): Promise<void> {
    if (!seeds.length) return;

    // 已在图中的曲线：key → 在 activeCurves 中的下标
    const indexByKey = new Map<string, number>();
    chart.value.activeCurves.forEach((c, idx) => indexByKey.set(curveKey(c.type, c.field), idx));

    const added: Curve[] = [];
    const missed: string[] = [];
    let adopted = 0;
    let updated = 0;
    let skipped = 0;

    for (const seed of seeds) {
      const key = curveKey(seed.type, seed.field);
      const existingIdx = indexByKey.get(key);
      if (existingIdx !== undefined) {
        const current = chart.value.activeCurves[existingIdx];
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
        const binary = await ensureCurveBinary(seed.type, seed.field);
        const curve = buildCurve(seed.type, seed.field, binary, { ...seed, fieldName: fieldName || '' });
        chart.value.activeCurves.push(curve);
        indexByKey.set(key, chart.value.activeCurves.length - 1);
        added.push(curve);
      } catch {
        missed.push(key);
      }
    }

    if ((added.length || adopted) && fieldName && chart.value.activeField.expanded[fieldName] === undefined) {
      chart.value.activeField.expanded[fieldName] = false;
    }
    rebuildChart();
    if (added.length || adopted || updated) scheduleCurveStateSave();
    if (missed.length) {
      showToast('缺少 ' + missed.length + ' 个字段，已自动跳过', 'info');
    } else if (fieldName) {
      let msg = added.length || adopted ? '组已添加: ' + fieldName : '组字段已在图表中';
      if (skipped && added.length) msg += '，跳过 ' + skipped + ' 个重复字段';
      showToast(msg, added.length || adopted ? 'success' : 'info');
    }
  }

  /** 全量替换曲线：清空后按种子重建（用于恢复已保存状态）。 */
  async function loadCurveSelection(seeds: CurveSeed[], fieldName: string): Promise<void> {
    if (!seeds.length) return;
    curveDrawn.value = {};

    const restored: Curve[] = [];
    const missed: string[] = [];
    for (const seed of seeds) {
      try {
        const binary = await ensureCurveBinary(seed.type, seed.field);
        restored.push(buildCurve(seed.type, seed.field, binary, seed));
      } catch {
        missed.push(seed.type + '.' + seed.field);
      }
    }

    chart.value.activeCurves = restored;
    chart.value.activeField.name = fieldName || '';
    chart.value.activeField.expanded = {};
    collectFieldGroupParamsFromCurves(restored);
    rebuildChart();
    scheduleCurveStateSave();
    if (missed.length) {
      showToast('缺少 ' + missed.length + ' 个字段，已自动跳过', 'info');
    } else if (fieldName) {
      showToast('组已应用: ' + fieldName, 'success');
    }
  }

  function restoreActiveCurves(previousCurves: CurveSeed[]): Promise<void> {
    if (!previousCurves || !previousCurves.length) return Promise.resolve();
    return loadCurveSelection(previousCurves, '');
  }

  function snapshotActiveCurves(): CurveSeed[] {
    return chart.value.activeCurves.map((c) => {
      const group = c.fieldName ? ensureFieldGroupParams(c.fieldName) : null;
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

  const isFieldActive = (type: string, field: string): boolean =>
    chart.value.activeCurves.some((c) => c.type === type && c.field === field);

  function getFieldColor(type: string, field: string): string {
    const c = chart.value.activeCurves.find((cur) => cur.type === type && cur.field === field);
    return c ? c.color : 'transparent';
  }

  function toggleField(type: string, field: string): void {
    const idx = chart.value.activeCurves.findIndex((c) => c.type === type && c.field === field);
    if (idx >= 0) removeCurve(idx);
    else void addCurve(type, field);
  }

  async function addCurve(type: string, field: string): Promise<void> {
    const logStore = useLogStore();
    logStore.log.loading = true;
    try {
      const binary = await ensureCurveBinary(type, field);
      chart.value.activeCurves.push(buildCurve(type, field, binary));
      rebuildChart();
      scheduleCurveStateSave();
    } catch (e: unknown) {
      showToast('获取失败: ' + describeError(e), 'error');
    } finally {
      logStore.log.loading = false;
    }
  }

  /**
   * AI 问题时段联动：批量加载 incident 引用的字段曲线（"分组.字段" 名，
   * 模型生成的，可能写错——失败静默跳过不弹错）。已在图中的直接视为成功。
   * 返回成功在图中的字段名；供点击问题卡片后"曲线自动加载相关异常字段"。
   */
  /**
   * AI 问题时段联动：把 incident 引用的字段加载为**临时叠加曲线**（整体替换
   * 上一次的叠加）。与用户曲线彻底分开：不进 activeCurves、不持久化、不进
   * 图例；用户图上已有的字段不重复叠加。字段名是模型生成的，可能写错——
   * 失败静默跳过不弹错。
   */
  async function loadIncidentOverlay(fieldNames: string[]): Promise<void> {
    const overlay: Curve[] = [];
    for (const name of fieldNames) {
      const dot = name.indexOf('.');
      if (dot <= 0 || dot >= name.length - 1) continue;
      const type = name.slice(0, dot);
      const field = name.slice(dot + 1);
      if (isFieldActive(type, field)) continue; // 用户图上已有：不重复叠加
      try {
        const binary = await ensureCurveBinary(type, field);
        overlay.push(buildCurve(type, field, binary));
      } catch {
        // 字段不存在（名字写错/该格式无此字段）：跳过
      }
    }
    const changed =
      overlay.length !== aiOverlay.value.length ||
      overlay.some((c, i) => c.id !== aiOverlay.value[i]?.id);
    aiOverlay.value = overlay;
    if (changed) rebuildChart();
  }

  /** 清除 AI 临时叠加曲线（取消聚焦/清空会话/切换日志时）。 */
  function clearAiOverlay(): void {
    if (!aiOverlay.value.length) return;
    aiOverlay.value = [];
    rebuildChart();
  }

  function removeCurve(idx: number): void {
    const removed = chart.value.activeCurves[idx];
    chart.value.activeCurves.splice(idx, 1);
    if (removed) {
      forgetCurveDrawn(removed.id);
    }
    pruneFieldGroupParams();
    if (!chart.value.activeCurves.length) {
      chart.value.activeField.name = '';
      chart.value.activeField.selectedSimpleName = '';
      chart.value.activeField.expanded = {};
      chart.value.activeField.groupParams = {};
    }
    rebuildChart();
    void saveCurveStateNow();
  }

  function removeCurveById(id: string): void {
    const idx = chart.value.activeCurves.findIndex((c) => c.id === id);
    if (idx >= 0) removeCurve(idx);
  }

  function clearAll(): void {
    chart.value.activeCurves = [];
    curveDrawn.value = {};
    chart.value.activeField.name = '';
    chart.value.activeField.selectedSimpleName = '';
    chart.value.activeField.expanded = {};
    chart.value.activeField.groupParams = {};
    rebuildChart();
    void saveCurveStateNow();
  }

  function toggleVisible(_curve: Curve): void {
    rebuildChart();
    scheduleCurveStateSave();
  }

  const curvePointCount = (curve: Curve | null): number => (curve ? curve.count || 0 : 0);

  // ═══════════════════════ 7. 运行时绘制开关 ═══════════════════════
  const isCurveDrawn = (id: string): boolean => curveDrawn.value[id] !== false;
  function toggleCurveDrawn(curve: Curve): void {
    const next = !isCurveDrawn(curve.id);
    curveDrawn.value = { ...curveDrawn.value, [curve.id]: next };
    if (runtime.mainChart) runtime.mainChart.setSeriesVisible(curve.id, next);
  }
  function forgetCurveDrawn(id: string): void {
    if (curveDrawn.value[id] === undefined) return;
    const next = { ...curveDrawn.value };
    delete next[id];
    curveDrawn.value = next;
  }

  // ═══════════════════════ 8. 曲线状态持久化 ═══════════════════════
  const loadCurveState = (): Promise<unknown> => configClient.getCurveState();

  async function saveCurveStateNow(): Promise<void> {
    if (curveState.value.restoring) return;
    curveState.value.loading = true;
    try {
      await configClient.saveCurveState(snapshotActiveCurves());
    } catch (e: unknown) {
      showToast('保存曲线状态失败: ' + describeError(e), 'error');
    } finally {
      curveState.value.loading = false;
    }
  }

  function scheduleCurveStateSave(): void {
    if (curveState.value.restoring) return;
    if (curveState.value.saveTimer) clearTimeout(curveState.value.saveTimer);
    curveState.value.saveTimer = setTimeout(() => {
      curveState.value.saveTimer = null;
      void saveCurveStateNow();
    }, SAVE_DEBOUNCE_MS);
  }

  async function restoreSavedCurveState(): Promise<void> {
    curveState.value.restoring = true;
    try {
      const res: unknown = await loadCurveState();
      if (isConfigError(res)) { showToast(res.error, 'error'); return; }
      const payload = res as { activeCurves?: CurveSeed[] };
      const curves = Array.isArray(payload.activeCurves) ? payload.activeCurves : [];
      if (curves.length) await loadCurveSelection(curves, '');
    } catch (e: unknown) {
      showToast('恢复曲线状态失败: ' + describeError(e), 'error');
    } finally {
      curveState.value.restoring = false;
    }
  }

  // ═══════════════════════ 9. 简单字段设置 ═══════════════════════
  function onSimpleFieldGroupParams(tmpl: FieldEntry): void {
    const fieldsStore = useFieldsStore();
    const params = fieldsStore.simpleFieldGroupParams(tmpl);
    params.scale = tryFloat(params.scaleInput, 1);
    params.offset = tryFloat(params.offsetInput, 0);
    tmpl.scale = params.scale;
    tmpl.offset = params.offset;
    tmpl.scaleInput = params.scaleInput;
    tmpl.offsetInput = params.offsetInput;
    if (fieldsStore.isFieldActive(tmpl.name)) {
      refreshTransform();
      scheduleCurveStateSave();
    }
    scheduleSimpleFieldSettingsSave(tmpl);
  }

  function resetSimpleFieldGroupParams(tmpl: FieldEntry): void {
    const params = useFieldsStore().simpleFieldGroupParams(tmpl);
    params.scale = 1;
    params.offset = 0;
    params.scaleInput = '1';
    params.offsetInput = '0';
    onSimpleFieldGroupParams(tmpl);
  }

  function scheduleSimpleFieldSettingsSave(tmpl: FieldEntry): void {
    if (!tmpl || !tmpl.name) return;
    const fieldsStore = useFieldsStore();
    if (fieldsStore.fieldList.settingsSaveTimer) clearTimeout(fieldsStore.fieldList.settingsSaveTimer);
    fieldsStore.fieldList.settingsSaveTimer = setTimeout(() => {
      fieldsStore.fieldList.settingsSaveTimer = null;
      void saveSimpleFieldSettings(tmpl);
    }, SAVE_DEBOUNCE_MS);
  }

  async function saveSimpleFieldSettings(tmpl: FieldEntry): Promise<void> {
    if (!tmpl || !tmpl.name) return;
    const fieldsStore = useFieldsStore();
    const selected = chart.value.activeField.selectedSimpleName;
    try {
      const res: unknown = await configClient.saveFieldEntry(fieldsStore.currentFieldEntryPayload(tmpl.name, tmpl.curves));
      if (isConfigError(res)) { showToast(res.error, 'error'); return; }
      fieldsStore.applyFieldsResponse(res as FieldEntriesResponse);
      chart.value.activeField.selectedSimpleName = selected;
    } catch (e: unknown) {
      showToast('保存曲线设置失败: ' + describeError(e), 'error');
    }
  }

  // ═══════════════════════ 10. 交互处理 ═══════════════════════
  function onChartTooltipToggle(): void {
    if (runtime.mainChart) runtime.mainChart.setTooltipEnabled(chart.value.tooltip);
  }

  function onLinewidthChange(w: number): void {
    chart.value.lineWidth = w;
    if (runtime.mainChart) runtime.mainChart.setLinewidth(w);
    if (runtime.threeCurveChart) runtime.threeCurveChart.setLinewidth(w);
  }

  function onEventMarkToggle(): void {
    rebuildChart();
  }

  async function onSamplingToggle(): Promise<void> {
    if (!chart.value.activeCurves.length) return;
    const logStore = useLogStore();
    logStore.log.loading = true;
    const prev = chart.value.activeCurves.slice();
    const refreshed: Curve[] = [];
    const failed: string[] = [];
    for (const curve of prev) {
      try {
        const binary = await ensureCurveBinary(curve.type, curve.field);
        refreshed.push(buildCurve(curve.type, curve.field, binary, curve));
      } catch {
        failed.push(curve.id);
      }
    }
    if (refreshed.length) chart.value.activeCurves = refreshed;
    rebuildChart();
    logStore.log.loading = false;
    if (failed.length) {
      showToast('刷新失败 ' + failed.length + ' 条曲线', 'error');
    } else {
      showToast(chart.value.sampling ? '已开启采样' : '已关闭采样，显示全量数据', 'success');
    }
  }

  /** 颜色不影响数据量程：只增量 patch 系列颜色，保留当前缩放视口。 */
  function onCurveColor(_curve: Curve): void {
    if (runtime.mainChart) runtime.mainChart.setSeries(buildLineSeries(chartBaseTimeMs()));
    syncThreeCurveChart();
    scheduleCurveStateSave();
  }

  function onCurveParams(curve: Curve): void {
    curve.scale = tryFloat(curve.scaleInput, 1);
    curve.offset = tryFloat(curve.offsetInput, 0);
    refreshTransform();
    scheduleCurveStateSave();
  }

  function resetCurveParams(curve: Curve): void {
    curve.scale = 1;
    curve.offset = 0;
    curve.scaleInput = '1';
    curve.offsetInput = '0';
    refreshTransform();
    scheduleCurveStateSave();
  }

  function onFieldGroupParams(group: { name: string }): void {
    const params = ensureFieldGroupParams(group.name);
    params.scale = tryFloat(params.scaleInput, 1);
    params.offset = tryFloat(params.offsetInput, 0);
    refreshTransform();
    scheduleCurveStateSave();
  }

  function resetFieldGroupParams(group: { name: string }): void {
    setFieldGroupParams(group.name, { scale: 1, offset: 0, scaleInput: '1', offsetInput: '0' });
    refreshTransform();
    scheduleCurveStateSave();
  }

  // ═══════════════════════ 11. 缩放 ═══════════════════════
  function setBoxZoomActive(active: boolean): void {
    if (runtime.mainChart) runtime.mainChart.setBoxZoomActive(active);
    useUiStore().ui.shiftZoomActive = !!active;
  }
  function undoZoom(): void {
    if (runtime.mainChart) runtime.mainChart.undoZoom();
  }
  function resetZoom(): void {
    if (runtime.mainChart) runtime.mainChart.resetZoom();
  }

  /** 聚焦绝对时间窗（如 AI 问题时段）：主图 X 缩放到该窗口，带边距、可撤销。返回是否成功（窗口与数据无交集则 false）。 */
  function focusChartWindow(t0: number, t1: number): boolean {
    if (!runtime.mainChart || !(t1 > t0)) return false;
    return runtime.mainChart.focusXWindow({ min: t0, max: t1 });
  }

  // ═══════════════════════ 12. 派生值与格式化 ═══════════════════════
  const visibleCurves = computed<Curve[]>(() => chart.value.activeCurves.filter((c) => c.visible));
  const visiblePointCount = computed<number>(() =>
    chart.value.activeCurves.filter((c) => c.visible).reduce((sum, c) => sum + (c.count || 0), 0),
  );
  const hiddenCurveCount = computed<number>(() => chart.value.activeCurves.length - visibleCurves.value.length);
  const totalPoints = computed<number>(() => chart.value.activeCurves.reduce((sum, c) => sum + (c.count || 0), 0));

  const activeFieldGroups = computed<FieldGroupItem[]>(() => {
    const groups: FieldGroupItem[] = [];
    const byName: Record<string, FieldGroupItem> = {};
    for (const c of chart.value.activeCurves) {
      if (!c.fieldName) continue;
      if (!byName[c.fieldName]) {
        byName[c.fieldName] = {
          name: c.fieldName,
          curves: [],
          params: ensureFieldGroupParams(c.fieldName),
        };
        groups.push(byName[c.fieldName]);
      }
      byName[c.fieldName].curves.push(c);
    }
    return groups;
  });

  const formatMessageTime = (item: LogMessage | null): string =>
    item && item.timeMs ? formatTime(item.timeMs, false) : '#' + (item ? item.lineno : '');

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

  // ═══════════════════════ 13. 飞行模式 ═══════════════════════
  function findModeAtTime(targetTime: number): FlightMode | null {
    return modeAtTime(useLogStore().log.flightModes || [], targetTime);
  }

  function currentFlightMode(): string {
    const m = findModeAtTime(useScene3dStore().three.playback.timeMs);
    return m && m.mode ? String(m.mode) : '';
  }

  function translateMode(mode: string): string {
    const summary = useLogStore().log.summary;
    return translateModeLabel(mode, !!summary && summary.vehicleType === 'Plane');
  }

  // ═══════════════════════ 导出 ═══════════════════════
  return {
    chart,
    curveState,
    curveDrawn,
    visibleCurves,
    visiblePointCount,
    hiddenCurveCount,
    totalPoints,
    activeFieldGroups,
    formatTime,
    formatMessageTime,
    formatUTCTime,
    formatDuration,
    fmtCount,
    formatParameterValue,
    formatCoord,
    pointDecimals,
    formatPointValue,
    rebuildChart,
    chartBaseTimeMs,
    incidentAnchorMs,
    buildLineSeries,
    buildMarkAreas,
    buildMarkLines,
    buildEventMarkTooltip,
    buildTooltip,
    calcYRange,
    calcXRange,
    findModeAtTime,
    currentFlightMode,
    translateMode,
    flightModeColor: modeBadgeColor,
    setBoxZoomActive,
    undoZoom,
    resetZoom,
    focusChartWindow,
    buildCurve,
    ensureCurveBinary,
    curveKey,
    addCurveSelection,
    loadCurveSelection,
    restoreActiveCurves,
    isFieldActive,
    getFieldColor,
    toggleField,
    addCurve,
    loadIncidentOverlay,
    clearAiOverlay,
    removeCurve,
    removeCurveById,
    clearAll,
    toggleVisible,
    curvePointCount,
    isCurveDrawn,
    toggleCurveDrawn,
    snapshotActiveCurves,
    onChartTooltipToggle,
    onLinewidthChange,
    onEventMarkToggle,
    onSamplingToggle,
    onCurveColor,
    onCurveParams,
    resetCurveParams,
    loadCurveState,
    saveCurveStateNow,
    scheduleCurveStateSave,
    restoreSavedCurveState,
    makeFieldGroupParams,
    ensureFieldGroupParams,
    setFieldGroupParams,
    collectFieldGroupParamsFromCurves,
    pruneFieldGroupParams,
    onFieldGroupParams,
    resetFieldGroupParams,
    onSimpleFieldGroupParams,
    resetSimpleFieldGroupParams,
    scheduleSimpleFieldSettingsSave,
    saveSimpleFieldSettings,
    transformValue,
  };
});
