import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';

/** 主图交互动作：框选开关/撤销/复位/聚焦时间窗（键盘与 Agent 联动的落点）。 */
export interface ChartActionsApi {
  setRectZoomActive(active: boolean): void;
  undoZoom(): void;
  resetZoom(): void;
  /** 聚焦绝对时间窗（如 AI 问题时段）：X 缩放到该窗口，带边距、可撤销。
   * 返回是否成功（窗口与数据无交集则 false）。 */
  zoomToWindow(t0: number, t1: number): boolean;
}

export function createChartActions(): ChartActionsApi {
  function setRectZoomActive(active: boolean): void {
    if (runtime.mainChart) runtime.mainChart.setRectZoomActive(active);
    useUiStore().ui.shiftZoomActive = !!active;
  }

  function undoZoom(): void {
    if (runtime.mainChart) runtime.mainChart.undoZoom();
  }

  function resetZoom(): void {
    if (runtime.mainChart) runtime.mainChart.resetView();
  }

  function zoomToWindow(t0: number, t1: number): boolean {
    if (!runtime.mainChart || !(t1 > t0)) return false;
    return runtime.mainChart.zoomToWindow(t0, t1);
  }

  return { setRectZoomActive, undoZoom, resetZoom, zoomToWindow };
}
