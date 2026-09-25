import { nextTick } from 'vue';
import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import { useAnalysisStore, CurveChart } from '@/modules/analysis';
import { usePlaybackStore } from '@/modules/playback';
import type { CurveAxisApi, View3dStoreCtx } from '../types';

/* ===== 曲线轴叠层（可视化视图底部时间曲线 + 播放头）=====
 * CurveChart 实例挂 runtime.view3dCurve（重对象不进 Pinia state）；
 * DOM 节点 id=three-curve-chart（样式既有约定）。 */

export function createCurveAxis(ctx: View3dStoreCtx): CurveAxisApi {
  const st = ctx.state;
  const els = ctx.els;

  function bindCurveAxisEvents(): void {
    const chart = runtime.view3dCurve;
    if (!chart) return;
    chart.off('viewport');
    chart.off('reset');
    chart.on('viewport', function () {
      const z = chart.visibleWindow();
      const w = { min: z.min, max: z.max, span: Math.max(1, z.max - z.min) };
      usePlaybackStore().playback.timeWindow = w;
      if (usePlaybackStore().playback.timeMs < w.min) usePlaybackStore().playback.timeMs = w.min;
      if (usePlaybackStore().playback.timeMs > w.max) usePlaybackStore().playback.timeMs = w.max;
      refreshPlayhead();
    });
    chart.on('reset', function () {
      const xr = useAnalysisStore().dataXRange();
      usePlaybackStore().playback.timeWindow = { min: xr.min, max: xr.max, span: Math.max(1, xr.max - xr.min) };
      refreshPlayhead();
    });
  }

  function rebuildCurveAxis(): void {
    nextTick(function () {
      if (!usePlaybackStore().playback.curveAxis) return;
      const el = document.getElementById('three-curve-chart');
      if (!el) return;
      if (!runtime.view3dCurve) {
        runtime.view3dCurve = new CurveChart(el, {
          bgColor: 0xf3f4f6,
          margins: { left: 56, right: 12, top: 10, bottom: 24 },
          panAxis: 'both',
          wheelZoom: true,
          dragPan: true,
          strokeWidth: useAnalysisStore().chart.lineWidth,
          formatX: function (ms: number) { return useAnalysisStore().formatTime(ms, false); },
        });
        bindCurveAxisEvents();
        if (typeof ResizeObserver !== 'undefined') {
          new ResizeObserver(function () { refreshPlayhead(); }).observe(el);
        }
      }
      const chartStore = useAnalysisStore();
      const xRange = chartStore.dataXRange();
      const yRange = chartStore.dataYRange();
      const baseTimeMs = chartStore.timeOriginMs();
      runtime.view3dCurve.load({
        series: chartStore.buildCurveSeries(baseTimeMs),
        xRange: xRange,
        yRange: yRange,
        baseTimeMs: baseTimeMs,
      });
      runtime.view3dCurve.resize();
      usePlaybackStore().playback.timeWindow = { min: xRange.min, max: xRange.max, span: Math.max(1, xRange.max - xRange.min) };
      refreshPlayhead();
    });
  }

  function pixelForTime(time: number): number | null {
    if (!runtime.view3dCurve) return null;
    const px = runtime.view3dCurve.timeToX(time);
    return isFinite(px) ? px : null;
  }

  function timeForPixel(px: number): number | null {
    if (!runtime.view3dCurve) return null;
    const t = runtime.view3dCurve.xToTime(px);
    return isFinite(t) ? t : null;
  }

  // 播放头定位：时间→像素 x，标签显示绝对 UTC 时刻；越界隐藏。
  function refreshPlayhead(): void {
    if (!usePlaybackStore().playback.curveAxis || !runtime.view3dCurve) return;
    const el = els.playhead.value;
    if (!el) return;
    const x = pixelForTime(usePlaybackStore().playback.timeMs);
    if (x == null || !isFinite(x)) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.transform = 'translateX(' + x + 'px)';
    const tag = els.playheadTag.value;
    if (tag) tag.textContent = useAnalysisStore().formatUTCTime(usePlaybackStore().playback.timeMs);
  }

  // 播放头拖拽：按住即暂停，跟随指针跳转时刻。
  function onPlayheadDragStart(e: MouseEvent): void {
    if (!runtime.view3dCurve) return;
    e.preventDefault();
    e.stopPropagation();
    usePlaybackStore().playback.playing = false;
    const move = function (ev: MouseEvent) { seekByClientX(ev.clientX); };
    const up = function () {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    seekByClientX(e.clientX);
  }

  function seekByClientX(clientX: number): void {
    if (!runtime.view3dCurve) return;
    const el = document.getElementById('three-curve-chart');
    if (!el) return;
    const px = clientX - el.getBoundingClientRect().left;
    let time = timeForPixel(px);
    if (time == null || !isFinite(time)) return;
    const w = usePlaybackStore().threePlaybackRange;
    if (time < w.min) time = w.min;
    if (time > w.max) time = w.max;
    usePlaybackStore().playback.timeMs = time;
    ctx.frame.applyFrameOutputs();
    if (useUiStore().ui.mainView === 'three') ctx.frame.renderView3d();
  }

  // 开关曲线轴：开 → 建图并同步时间窗；关 → 释放图、回到全程时间轴。
  function toggleCurveAxis(): void {
    const pb = usePlaybackStore();
    pb.playback.curveAxis = !pb.playback.curveAxis;
    if (pb.playback.curveAxis) {
      const xr = useAnalysisStore().dataXRange();
      pb.playback.timeWindow = { min: xr.min, max: xr.max, span: Math.max(1, xr.max - xr.min) };
      if (pb.playback.timeMs < xr.min) pb.playback.timeMs = xr.min;
      if (pb.playback.timeMs > xr.max) pb.playback.timeMs = xr.max;
      rebuildCurveAxis();
    } else {
      pb.playback.timeWindow = null;
      const r = pb.threeTimeRange;
      if (pb.playback.timeMs < r.min) pb.playback.timeMs = r.min;
      if (pb.playback.timeMs > r.max) pb.playback.timeMs = r.max;
      if (runtime.view3dCurve) {
        try { runtime.view3dCurve.dispose(); } catch (e) { /* noop */ }
        runtime.view3dCurve = null;
      }
    }
  }

  // 曲线轴高度拖拽调整（80px 下限，视口 -220px 上限）。
  function onCurveAxisResizeStart(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = usePlaybackStore().playback.curveHeight;
    const minH = 80;
    const maxH = Math.max(minH, (window.innerHeight || 800) - 220);
    const move = function (ev: MouseEvent) {
      usePlaybackStore().playback.curveHeight = Math.max(minH, Math.min(maxH, startH + (startY - ev.clientY)));
    };
    const up = function () {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  return { rebuildCurveAxis, refreshPlayhead, onPlayheadDragStart, toggleCurveAxis, onCurveAxisResizeStart };
}
