import type { ComputedRef, Ref } from 'vue';
import { nextTick, watch } from 'vue';
import type { FlightMetricsConfig, MetricItem } from '@/types';
import { configClient } from '@/services/config';
import { showToast } from '@/modules/shared/ui-store';
import { useCurveManagerStore } from '@/modules/curves';
import { usePlaybackStore } from '@/modules/playback';
import { ensureBuiltinMetrics, makeDefaultMetricItems, normalizeMetricItem } from '../utils/flight-fields';
import type { MetricState, MetricsLoadResult } from './types';

interface SyncDeps {
  ensureField: (typeField: string) => void;
  reloadAllFields: () => void;
}

const SAVE_DEBOUNCE_MS = 350;

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object';
}

/**
 * 配置生命周期：从磁盘载入 → 版本迁移/补全内置项 → 防抖持久化 → 监听变化触发保存。
 * 还负责日志加载后回填字段单位、登记曲线。
 */
export function createConfigSync(state: Ref<MetricState>, config: ComputedRef<FlightMetricsConfig>, deps: SyncDeps) {
  const { ensureField, reloadAllFields } = deps;

  // 日志定义就绪后，给字段设置补上原始单位（旧配置可能没有）。
  function enrichFieldUnits(): void {
    const units = useCurveManagerStore().logdefs?.units;
    if (!units) return;
    let changed = false;
    const next = state.value.items.map((it) => {
      if (!it.fieldSettings) return it;
      let fsChanged = false;
      const fs = { ...it.fieldSettings };
      for (const f of it.fields) {
        const entry = fs[f];
        const unit = units[f];
        if (entry && !entry.origUnit && unit) {
          fs[f] = { ...entry, origUnit: unit, unit: entry.unit || unit };
          fsChanged = true;
        }
      }
      if (!fsChanged) return it;
      changed = true;
      return { ...it, fieldSettings: fs };
    });
    if (changed) state.value.items = next;
  }

  function applyConfig(doc: { items: unknown[]; version?: number }): void {
    if (!Array.isArray(doc.items)) return;
    let items: MetricItem[] = [];
    for (const raw of doc.items) {
      const metric = normalizeMetricItem(raw);
      if (metric) items.push(metric);
    }
    items = ensureBuiltinMetrics(items);
    // v1 配置缺非内置默认项：按默认表补齐（插到电机项之前）。
    if (!doc.version || doc.version < 2) {
      const present = new Set(items.map((i) => i.fields.join(',')));
      for (const d of makeDefaultMetricItems()) {
        if (d.builtin || present.has(d.fields.join(','))) continue;
        const motorIdx = items.findIndex((i) => i.builtin === 'motor');
        if (motorIdx >= 0) items.splice(motorIdx, 0, d);
        else items.push(d);
      }
    }
    state.value.items = items;
    enrichFieldUnits();
    const curves = useCurveManagerStore();
    if (!curves.logdefs) {
      void curves.ensureLogDefs().then(() => enrichFieldUnits()).catch(() => {
        /* logdefs 拉取失败：单位回填跳过，不影响展示。 */
      });
    }
    for (const it of state.value.items) {
      for (const f of it.fields) ensureField(f);
    }
  }

  async function saveNow(): Promise<void> {
    try {
      await configClient.saveFlightMetrics(config.value);
    } catch {
      /* 持久化失败不阻断 UI：下次变更会再次尝试。 */
    }
  }

  function scheduleSave(): void {
    if (state.value.restoring) return;
    if (state.value.saveTimer) clearTimeout(state.value.saveTimer);
    state.value.saveTimer = setTimeout(() => {
      state.value.saveTimer = null;
      void saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  function flushSave(): void {
    if (!state.value.saveTimer) return;
    clearTimeout(state.value.saveTimer);
    state.value.saveTimer = null;
    void saveNow();
  }

  // 首次载入后注册：config 深度变化 → 防抖保存；日志就绪 → 登记全部字段曲线。
  function startWatching(): void {
    if (state.value.started) return;
    state.value.started = true;
    watch(
      () => config.value,
      () => {
        if (!state.value.restoring) scheduleSave();
      },
      { deep: true },
    );
    const pb = usePlaybackStore();
    if (pb.telemetry.loaded) reloadAllFields();
    else watch(() => pb.telemetry.loaded, (loaded) => { if (loaded) reloadAllFields(); });
  }

  async function loadFlightMetricsConfig(): Promise<void> {
    state.value.restoring = true;
    try {
      const res: unknown = await configClient.getFlightMetrics();
      const doc = isRecord(res) ? (res as MetricsLoadResult) : null;
      if (doc?.error) {
        showToast(doc.error, 'error');
        return; // 出错直接返回：finally 复位 restoring，但不启动监听。
      }
      if (doc?.metrics) {
        applyConfig(doc.metrics);
      } else {
        state.value.items = makeDefaultMetricItems();
        for (const it of state.value.items) {
          for (const f of it.fields) ensureField(f);
        }
      }
      await nextTick();
    } catch {
      /* 载入失败：保留默认项，继续启动监听。 */
    } finally {
      state.value.restoring = false;
    }
    startWatching();
  }

  return { applyConfig, enrichFieldUnits, loadFlightMetricsConfig, scheduleSave, saveNow, startWatching, flushSave };
}
