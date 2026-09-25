import * as THREE from 'three';
import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import type { QualityApi, View3dAaMode, View3dStoreCtx, View3dTier } from './types';

export function createQuality(ctx: View3dStoreCtx): QualityApi {
  const st = ctx.state;

  // GPU 档位探测：软件渲染器(swiftshader/llvmpipe/...) → low；弱核数/小内存/超高 DPR → medium；其余 high。
  function detectGpuClass(renderer?: THREE.WebGLRenderer): View3dTier {
    try {
      const gl = renderer ? renderer.getContext() : null;
      let rendererStr = '';
      if (gl) {
        const dbg = (gl as any).getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          const unmasked = (gl as any).getParameter(dbg.UNMASKED_RENDERER_WEBGL);
          if (typeof unmasked === 'string') rendererStr = unmasked.toLowerCase();
        }
        if (!rendererStr) {
          const fallback = (gl as any).getParameter(gl.RENDERER);
          if (typeof fallback === 'string') rendererStr = fallback.toLowerCase();
        }
      }
      if (/swiftshader|llvmpipe|microsoft basic render|apple software|softpipe/.test(rendererStr)) return 'low';
      const cores = navigator.hardwareConcurrency || 0;
      const mem = (navigator as any).deviceMemory || 0;
      const dpr = window.devicePixelRatio || 1;
      if ((cores && cores < 4) || (mem && mem < 4) || dpr > 2.5) return 'medium';
      return 'high';
    } catch (e) {
      return 'high';
    }
  }

  // 生效像素比 = min(DPR,2) × 分辨率倍率(0.25..1)。
  function renderPixelRatio(resolution: number): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let r = typeof resolution === 'number' && isFinite(resolution) ? resolution : 1;
    if (r < 0.25) r = 0.25; else if (r > 1) r = 1;
    return dpr * r;
  }

  // 质量设置 → 材质档：显式档直取，auto 按探测的 GPU 档。
  function currentTier(quality: string): View3dTier {
    if (quality === 'medium' || quality === 'low') return quality;
    if (quality === 'high') return 'high';
    return (runtime.view3dMain && runtime.view3dMain.gpuTier) || 'high';
  }

  // 主视图抗锯齿切换：msaa 与否改变 renderer 创建参数 → 需整体重建视图；否则直接重绘。
  function setMainAa(aa: string): void {
    const next: View3dAaMode = (aa === 'fxaa' || aa === 'off' || aa === 'msaa') ? aa : st.value.render.main.aa;
    const prev = st.value.render.main.aa;
    st.value.render.main.aa = next;
    if (!runtime.view3dMain || useUiStore().ui.mainView !== 'three') return;
    if ((prev === 'msaa') !== (next === 'msaa')) { ctx.mainView.teardownView3d(); ctx.mainView.ensureView3d(); }
    else ctx.frame.renderView3d();
  }

  function setMainResolution(resolution: number): void {
    st.value.render.main.resolution = resolution;
    if (runtime.view3dMain && useUiStore().ui.mainView === 'three') ctx.mainView.resizeView3d();
  }

  // 渲染帧率上限：0=不限（跟随 rAF）。
  function setMainFps(fps: number): void {
    st.value.render.fps = fps <= 0 ? 0 : Math.max(1, Math.round(fps));
  }

  // 姿态仪抗锯齿切换（沿用既有行为：msaa 变更触发主视图重建，姿态仪随重建链路换新）。
  function setDialAa(aa: string): void {
    const next: View3dAaMode = (aa === 'fxaa' || aa === 'off' || aa === 'msaa') ? aa : st.value.render.dial.aa;
    const prev = st.value.render.dial.aa;
    st.value.render.dial.aa = next;
    if (!runtime.view3dMain || useUiStore().ui.mainView !== 'three') return;
    if ((prev === 'msaa') !== (next === 'msaa')) { ctx.mainView.teardownView3d(); ctx.mainView.ensureView3d(); }
    else ctx.frame.renderView3d();
  }

  function setDialResolution(resolution: number): void {
    st.value.render.dial.resolution = resolution;
    if (runtime.view3dMain && useUiStore().ui.mainView === 'three') ctx.mainView.resizeView3d();
  }

  // 渲染质量切换：按档重建材质（Physical/Lambert/Basic）与天空形态（shader/烘焙背景）。
  function setQuality(value: string): void {
    const q: 'auto' | 'high' | 'medium' | 'low' =
      (value === 'high' || value === 'medium' || value === 'low') ? value : 'auto';
    st.value.render.quality = q;
    if (runtime.view3dMain) {
      const tier = currentTier(q);
      ctx.materials.applyTierToModels(tier);
      ctx.sky.applySkyQuality(tier);
    }
  }

  return {
    detectGpuClass, renderPixelRatio, currentTier, setQuality,
    setMainAa, setMainResolution, setMainFps, setDialAa, setDialResolution,
  };
}
