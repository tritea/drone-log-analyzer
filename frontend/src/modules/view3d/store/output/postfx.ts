import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import type { FxApi, View3dStoreCtx } from '../types';

// 自定义标记位：跟踪上次 setSize 的尺寸与 SSAO 是否已按机型校准（挂在 composer 上）。
declare module 'three/examples/jsm/postprocessing/EffectComposer.js' {
  interface EffectComposer {
    _v3dW?: number;
    _v3dH?: number;
    _v3dSsaoCalibrated?: boolean;
  }
}

export function createPostFx(ctx: View3dStoreCtx): FxApi {
  const st = ctx.state;

  /* ===== 主视图后处理链 =====
   * RenderPass → [SSAOPass] → [FXAA ShaderPass] → OutputPass。
   * FXAA(默认) 或 SSAO 任一开启即走 composer；各 pass 用 enabled 开关，运行时切换无需重建视图。
   * OutputPass 恒定收尾：负责 linear→sRGB + tone mapping 写屏（FXAAShader 不做色彩转换，
   * 必须由 OutputPass 编码，否则画面发暗）。主透视相机在 normal/lock/fps 间是同一实例、仅位姿变，
   * 构建时绑定一次。 */
  function ensureMainFx(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.renderer || !tv.scene || !tv.camera) return;
    if (tv.fx?.composer) return;
    const w = Math.max(1, tv.hostEl.clientWidth);
    const h = Math.max(1, tv.hostEl.clientHeight);
    const composer = new EffectComposer(tv.renderer);
    const renderPass = new RenderPass(tv.scene, tv.camera);
    const ssaoPass = new SSAOPass(tv.scene, tv.camera, w, h);
    ssaoPass.output = SSAOPass.OUTPUT.Default; // 美图 × AO
    const fxaaPass = new ShaderPass(FXAAShader);
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(ssaoPass);
    composer.addPass(fxaaPass);
    composer.addPass(outputPass);
    composer._v3dW = 0;
    composer._v3dH = 0;
    composer._v3dSsaoCalibrated = false;
    tv.fx = { composer, renderPass, ssaoPass, fxaaPass, outputPass };
    // 首次构建即按 drawing buffer 对齐 RT + FXAA uniform（resizeView3d 每帧也会同步）。
    syncMainFxSize();
  }

  // 按 main.aa / camera.ssao 置主链各 pass 的 enabled：末端 OutputPass 恒开。
  function syncMainFxPasses(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.fx?.composer) return;
    if (tv.fx.ssaoPass) tv.fx.ssaoPass.enabled = !!st.value.camera.ssao;
    if (tv.fx.fxaaPass) tv.fx.fxaaPass.enabled = st.value.render.main.aa === 'fxaa';
  }

  // 主链 RT 钉到 drawing buffer 尺寸（= cssW × pixelRatio），FXAA resolution uniform 同步。
  // 仅尺寸变化时 setSize（render target 重分配昂贵；每帧调用故做缓存比对）。
  function syncMainFxSize(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.renderer || !tv.fx?.composer) return;
    const composer = tv.fx.composer;
    const canvas = tv.renderer.domElement;
    const dbW = Math.max(1, canvas.width || 1);
    const dbH = Math.max(1, canvas.height || 1);
    if (composer._v3dW !== dbW || composer._v3dH !== dbH) {
      composer.setSize(dbW, dbH);
      composer._v3dW = dbW;
      composer._v3dH = dbH;
    }
    if (tv.fx.fxaaPass) tv.fx.fxaaPass.material.uniforms['resolution'].value.set(1 / dbW, 1 / dbH);
  }

  // 首次拿到无人机模型后，按其世界包围球校准 SSAO 采样半径（场景为 GPS 米制，机身经缩放后
  // 仅几单位，upstream 默认 kernelRadius=8 会让采样飞离表面、AO 失效）。
  // 取包围球对角线的 8% 作半径，仅校准一次。
  function calibrateSsaoRadius(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.fx?.composer || tv.fx.composer._v3dSsaoCalibrated || !tv.drone) return;
    const box = new THREE.Box3().setFromObject(tv.drone);
    if (isFinite(box.min.x) && box.max.x > box.min.x) {
      const size = box.getSize(new THREE.Vector3()).length();
      if (tv.fx.ssaoPass) tv.fx.ssaoPass.kernelRadius = Math.max(0.05, size * 0.08);
      tv.fx.composer._v3dSsaoCalibrated = true;
    }
  }

  function toggleSsao(): void {
    st.value.camera.ssao = !st.value.camera.ssao;
    // SSAO 开启需要 composer；视图内即构建（pass.enabled 由下帧 renderView3d→syncMainFxPasses 置位）。
    if (st.value.camera.ssao && useUiStore().ui.mainView === 'three') {
      ctx.mainView.ensureView3d();
      ensureMainFx();
    }
  }

  /* ===== 姿态仪后处理链 =====
   * RenderPass → [FXAA ShaderPass] → OutputPass（无 SSAO，画布小）。dial.aa==='fxaa' 时走链。 */
  function ensureDialFx(): void {
    const dv = runtime.view3dDial;
    if (!dv || dv.fx?.composer || !dv.renderer || !dv.scene || !dv.camera) return;
    const composer = new EffectComposer(dv.renderer);
    const renderPass = new RenderPass(dv.scene, dv.camera);
    const fxaaPass = new ShaderPass(FXAAShader);
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(fxaaPass);
    composer.addPass(outputPass);
    composer._v3dW = 0;
    composer._v3dH = 0;
    dv.fx = { composer, renderPass, fxaaPass, outputPass };
    syncDialFxSize();
  }

  function syncDialFxPasses(): void {
    const dv = runtime.view3dDial;
    if (!dv || !dv.fx?.composer) return;
    // 姿态仪仅 FXAA 可开关（OutputPass 恒开）。
    if (dv.fx.fxaaPass) dv.fx.fxaaPass.enabled = st.value.render.dial.aa === 'fxaa';
  }

  function syncDialFxSize(): void {
    const dv = runtime.view3dDial;
    if (!dv || !dv.fx?.composer) return;
    const composer = dv.fx.composer;
    const canvas = dv.renderer.domElement;
    const dbW = Math.max(1, canvas.width || 1);
    const dbH = Math.max(1, canvas.height || 1);
    if (composer._v3dW !== dbW || composer._v3dH !== dbH) {
      composer.setSize(dbW, dbH);
      composer._v3dW = dbW;
      composer._v3dH = dbH;
    }
    if (dv.fx.fxaaPass) dv.fx.fxaaPass.material.uniforms['resolution'].value.set(1 / dbW, 1 / dbH);
  }

  // 销毁主场景后处理资源（composer 与各 pass 的 render target/材质），由 teardownView3d 调用；
  // 姿态仪链常驻（dial 不随主场景销毁），不在此释放。
  function disposeMainFx(): void {
    const tv = runtime.view3dMain;
    if (!tv) return;
    if (tv.fx?.composer) { try { tv.fx.composer.dispose(); } catch (e) { /* noop */ } }
    if (tv.fx?.ssaoPass) { try { tv.fx.ssaoPass.dispose(); } catch (e) { /* noop */ } }
    tv.fx = undefined;
  }

  return {
    ensureMainFx, syncMainFxPasses, syncMainFxSize, calibrateSsaoRadius, toggleSsao,
    ensureDialFx, syncDialFxPasses, syncDialFxSize, disposeMainFx,
  };
}
