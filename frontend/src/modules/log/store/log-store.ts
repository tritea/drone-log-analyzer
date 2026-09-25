import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';
import type { LogMessage, LogState } from '@/types';
import { showToast, useUiStore } from '@/modules/shared/ui-store';
import { hostClient, logClient } from '@/services/log';
import { configClient } from '@/services/config';
import { useAnalysisStore } from '@/modules/analysis';
import { useParametersStore } from '@/modules/parameters';
import { useCommandsStore, useMAVLinkCommandsStore } from '@/modules/commands';
import { useFieldsStore } from '@/modules/fields';
import { useFlightMetricsStore } from '@/modules/flight-metrics';
import { useView3dStore } from '@/modules/view3d';
import { usePlaybackStore } from '@/modules/playback';
import { useCurveManagerStore } from '@/modules/curves';
import { tr } from '@/locales';

interface LoadedSummary {
  format?: string;
  filename?: string;
  fileName?: string;
}

interface ModeChangeRow {
  timeMs: number;
  mode?: unknown;
  lineno?: number;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isModeChangeRow(row: unknown): row is ModeChangeRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return typeof r.timeMs === 'number' && isFinite(r.timeMs) && !!r.mode;
}

// 取路径末段作为展示名（兼容 / 与 \）。
function basename(path: string): string {
  const trimmed = String(path || '').trim();
  if (!trimmed) return '';
  const segments = trimmed.split(/[\\/]+/);
  return segments[segments.length - 1] || trimmed;
}

export const useLogStore = defineStore('log', () => {
  const log = reactive({
    loading: false,
    loadStage: '',
    loaded: false,
    summary: null,
    fileName: '',
    messageTypes: [],
    messages: [],
    errors: [],
    events: [],
    flightModes: [],
    messageFilter: '',
  }) as LogState;

  // ===== computed =====
  const currentLogFileName = computed<string>(() =>
    basename(log.fileName || (log.summary && (log.summary.filename || log.summary.fileName)) || ''),
  );

  const filteredMessages = computed<LogMessage[]>(() => {
    const needle = log.messageFilter.trim().toLowerCase();
    if (!needle) return log.messages;
    const analysis = useAnalysisStore();
    return log.messages.filter(
      (m: LogMessage) =>
        String(m.message || '').toLowerCase().includes(needle) ||
        analysis.formatMessageTime(m).toLowerCase().includes(needle) ||
        String(m.lineno || '').includes(needle),
    );
  });

  // ===== 子集加载（互不依赖，可并行拉取）=====
  async function loadMessages(): Promise<void> {
    try {
      const res: unknown = await logClient.messages();
      log.messages = Array.isArray(res) ? (res as LogMessage[]) : [];
    } catch {
      log.messages = [];
    }
  }

  async function loadErrors(): Promise<void> {
    try {
      const res: unknown = await logClient.errors();
      log.errors = Array.isArray(res) ? (res as LogState['errors']) : [];
    } catch {
      log.errors = [];
    }
  }

  async function loadEvents(): Promise<void> {
    try {
      const res: unknown = await logClient.events();
      log.events = Array.isArray(res) ? (res as LogState['events']) : [];
    } catch {
      log.events = [];
    }
  }

  // 飞行模式序列：丢弃无 timeMs/mode 的脏行，再按时间（同时间按行号）排序。
  async function loadModes(): Promise<void> {
    try {
      const res: unknown = await logClient.modeChanges();
      if (!Array.isArray(res)) {
        log.flightModes = [];
        return;
      }
      log.flightModes = (res as unknown[])
        .filter(isModeChangeRow)
        .sort((a, b) => (a.timeMs === b.timeMs ? (a.lineno || 0) - (b.lineno || 0) : a.timeMs - b.timeMs)) as LogState['flightModes'];
    } catch {
      log.flightModes = [];
    }
  }

  function endLoading(): void {
    log.loading = false;
    log.loadStage = '';
  }

  // ===== 主加载流程 =====
  async function openLogFile(): Promise<void> {
    if (log.loadStage) return; // 已在加载中，防重入
    let path: string;
    try {
      path = await hostClient.pickLogPath();
    } catch (error) {
      showToast(tr('log.loadFailed', { err: describeError(error) }), 'error');
      return;
    }
    if (!path) return;

    log.loading = true;
    // loadStage 存稳定 key，由 LogLoadingOverlay 按当前语言解析渲染
    log.loadStage = 'parsing';
    // 切格式时尝试保留当前曲线；仅同格式或首次加载才真正沿用。
    const oldFormat = log.summary?.format;
    const carryable = oldFormat ? useAnalysisStore().snapshotCurves() : undefined;
    try {
      const summary: unknown = await logClient.load({ path });
      if (!summary) return;
      const newFormat = (summary as LoadedSummary)?.format;
      const carryCurves = !oldFormat || !newFormat || oldFormat === newFormat ? carryable : undefined;
      await applyLoadedLog(summary, carryCurves);
    } catch (error) {
      showToast(tr('log.loadFailed', { err: describeError(error) }), 'error');
    } finally {
      endLoading();
    }
  }

  /**
   * 应用一份刚解析完的日志：复位所有派生 store、按新格式重建图表，
   * 拉取消息类型/消息/模式/错误/事件，最后按携带或已存曲线恢复主图。
   */
  async function applyLoadedLog(summary: unknown, previousCurves?: unknown): Promise<void> {
    const analysis = useAnalysisStore();
    const s = (summary || {}) as LoadedSummary;

    log.summary = summary as LogState['summary'];
    log.fileName = (s.filename || s.fileName) || '';
    log.loaded = true;
    await configClient.setFormat(s.format || 'apm');

    // 复位各派生 store，避免旧日志数据残留。
    void useFieldsStore().loadFields();
    void useFlightMetricsStore().loadFlightMetricsConfig();
    analysis.chart.activeCurves = [];
    useCurveManagerStore().clear();
    useParametersStore().parameters.items = [];
    useParametersStore().parameters.filter = '';
    useCommandsStore().commands.items = [];
    useCommandsStore().commands.loaded = false;
    useCommandsStore().commands.filter = '';
    useMAVLinkCommandsStore().mavlinkCommands.items = [];
    useMAVLinkCommandsStore().mavlinkCommands.loaded = false;
    log.flightModes = [];
    log.errors = [];
    log.events = [];
    usePlaybackStore().resetTelemetry();
    useView3dStore().resetView3dScene();
    useView3dStore().validateSourceSelection();
    analysis.refreshChart();
    showToast(tr('log.loadSuccess'), 'success');

    log.loadStage = 'loading';
    const types: unknown = await logClient.messageTypes();
    if (types) log.messageTypes = types as LogState['messageTypes'];
    await Promise.all([loadMessages(), loadModes(), loadErrors(), loadEvents()]);
    if (useUiStore().ui.mainView === 'three') usePlaybackStore().ensureThreeTelemetry();

    log.loadStage = 'curves';
    const restore = previousCurves !== undefined ? previousCurves : analysis.snapshotCurves();
    if (Array.isArray(restore) && restore.length) await analysis.restoreCurves(restore);
    else await analysis.restoreSavedCurves();
  }

  return {
    log,
    currentLogFileName,
    filteredMessages,
    loadMessages,
    loadErrors,
    loadEvents,
    loadModes,
    openLogFile,
    endLoading,
    applyLoadedLog,
  };
});
