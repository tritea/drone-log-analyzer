import { watch } from 'vue';
import type { Ref } from 'vue';
import type { ChartState } from '@/types';
import { i18n } from '@/locales';
import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import { useView3dStore } from '@/modules/view3d';
import { usePlaybackStore } from '@/modules/playback';
import { useAgentStore } from '@/modules/agent';
import { CurveChart } from '../../renderer/curve-chart';
import { formatTime } from '../../utils/format';
import type { DataApi } from '../data';

const microtask = (fn: () => void): Promise<void> => Promise.resolve().then(fn);

/** 主图生命周期：挂载/装载数据集/变换刷新/语言切换重建。 */
export interface ChartLifecycleApi {
  /** 主入口：图表未建则挂载（microtask 等 DOM），已建则整体重装载。 */
  refreshChart(): void;
  /** 仅刷新曲线变换（缩放/偏移）并重算 Y 量程，保留当前 X 缩放窗口。 */
  refreshTransforms(): void;
  /** 3D 视图底部的曲线轴（同源数据）按需重建。 */
  syncThreeCurveAxis(): void;
  applyTooltipToggle(): void;
  /** 错误/事件/消息标注开关切换后重建标注（整体重装载）。 */
  applyTagToggles(): void;
  applyLineWidth(w: number): void;
  /** 语言切换后重建：标注文案/飞行模式标签/AI 警示带在构建期烘焙，需按新语言重算。 */
  startLocaleWatch(): void;
}

export function createChartLifecycle(
  chart: Ref<ChartState>,
  data: DataApi,
): ChartLifecycleApi {
  /** 组装完整数据集装载到主图（曲线 + 量程 + 标注 + AI 叠加）。 */
  function renderDataset(): void {
    const baseTimeMs = data.timeOriginMs();
    const xRange = data.dataXRange();
    runtime.mainChart.load({
      series: data.buildCurveSeries(baseTimeMs),
      xRange,
      yRange: data.dataYRange(),
      baseTimeMs,
      bands: data.buildBands(xRange),
      tags: data.buildEventTags(xRange),
    });
    runtime.mainChart.setOverlayCurves(data.buildOverlaySeries(baseTimeMs));
    runtime.mainChart.resize();
    syncThreeCurveAxis();
  }

  function mountChart(): void {
    const el = document.getElementById('main-chart');
    if (!el) return;
    runtime.mainChart = new CurveChart(el, {
      bgColor: 0xffffff,
      margins: { left: 56, right: 12, top: 8, bottom: 24 },
      panAxis: 'both',
      tooltip: chart.value.tooltip,
      bands: true,
      tags: true,
      rectZoom: true,
      wheelZoom: true,
      dragPan: true,
      strokeWidth: chart.value.lineWidth,
      resolveTip: (t) => (chart.value.tooltip ? data.buildDataTip(t) : null),
      resolveTagTip: (items, kind) => data.buildTagTooltip(items, kind),
      onTagClick: (tag) => {
        if (tag.kind !== 'ai' || !tag.id) return;
        const inc = useAgentStore().incidents.find((i) => i.id === tag.id);
        if (inc) useAgentStore().focusIncident(inc);
      },
      formatX: (ms) => formatTime(ms, false),
    });
    // 框选初始态跟 ui.shiftZoomActive（默认关：拖拽=平移）；cfg.rectZoom
    // 只是能力开关，构造器不再默认激活。
    runtime.mainChart.setRectZoomActive(useUiStore().ui.shiftZoomActive);
    renderDataset();
  }

  function refreshChart(): void {
    if (runtime.mainChart) {
      renderDataset();
      return;
    }
    microtask(mountChart);
  }

  function refreshTransforms(): void {
    if (!runtime.mainChart) return;
    runtime.mainChart.syncCurves(data.buildCurveSeries(data.timeOriginMs()));
    runtime.mainChart.refitY(data.dataYRange());
    runtime.mainChart.setOverlayCurves(data.buildOverlaySeries(data.timeOriginMs()));
    syncThreeCurveAxis();
  }

  function syncThreeCurveAxis(): void {
    const threeStore = useView3dStore();
    if (usePlaybackStore().playback.curveAxis && useUiStore().ui.mainView === 'three') threeStore.rebuildCurveAxis();
  }

  function applyTooltipToggle(): void {
    if (runtime.mainChart) runtime.mainChart.setTooltipEnabled(chart.value.tooltip);
  }

  function applyTagToggles(): void {
    refreshChart();
  }

  function applyLineWidth(w: number): void {
    chart.value.lineWidth = w;
    if (runtime.mainChart) runtime.mainChart.setStrokeWidth(w);
    if (runtime.view3dCurve) runtime.view3dCurve.setStrokeWidth(w);
  }

  function startLocaleWatch(): void {
    watch(
      () => i18n.global.locale.value,
      () => {
        if (!runtime.mainChart) return;
        refreshChart();
      },
    );
  }

  return { refreshChart, refreshTransforms, syncThreeCurveAxis, applyTooltipToggle, applyTagToggles, applyLineWidth, startLocaleWatch };
}
