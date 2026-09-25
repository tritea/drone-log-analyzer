import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Ref } from 'vue';
import { blankView3dState } from './types';
import type { View3dState, View3dStoreCtx } from './types';
import { createQuality } from './quality';
import { createMainView } from './main-view/lifecycle';
import { createCameraRig } from './camera/rig';
import { createTrajectory } from './trajectory/path';
import { createMissionRoute } from './mission/route';
import { createDialView } from './dial/view';
import { createLighting } from './environment/lighting';
import { createSky } from './environment/sky';
import { createWater } from './environment/water';
import { createGround } from './environment/ground';
import { createEnvMap } from './environment/env-map';
import { createDroneModels } from './drone/models';
import { createMaterials } from './drone/materials';
import { createPropellers } from './drone/propellers';
import { createFrameOutput } from './output/frame';
import { createPostFx } from './output/postfx';
import { createCurveAxis } from './output/curve-axis';

/**
 * 3D 可视化渲染面 store（主 3D 场景 + 右栏姿态仪 + 曲线轴叠层）。
 *
 * 组装式（蓝本 flight-metrics）：本文件只持 state 与 host 元素注册，全部行为按域拆进
 * store/ 下的域工厂（createXxx(ctx)），对外契约 = 各域 API 的并集。
 * 数据面（播放时钟/遥测采样/曲线定义）在 modules/playback；本 store 经 ctx 互调，
 * 跨域引用全部延迟到函数体内解析，域创建顺序不敏感。
 * 重对象（renderer/scene/composer）挂 modules/shared/runtime，不进响应式 state。
 */
export const useView3dStore = defineStore('view3d', () => {
  /* ---------------- state（渲染偏好，可持久化） ---------------- */
  const view3d = ref<View3dState>(blankView3dState());

  /* ---------------- host 元素注册（模板 ref 回调写入，store 内部消费） ---------------- */
  const els: {
    main: Ref<HTMLElement | null>;
    dial: Ref<HTMLElement | null>;
    playhead: Ref<HTMLElement | null>;
    playheadTag: Ref<HTMLElement | null>;
  } = {
    main: ref(null),
    dial: ref(null),
    playhead: ref(null),
    playheadTag: ref(null),
  };

  function registerMainHost(el: HTMLElement | null): void { els.main.value = el; }
  // 姿态仪独立于主 3D 场景：el 就绪即建（渲染器切换销毁主场景不影响右栏姿态）。
  function registerDialHost(el: HTMLElement | null): void {
    els.dial.value = el;
    if (el) ctx.dial.ensureDial();
  }
  function registerPlayhead(el: HTMLElement | null): void { els.playhead.value = el; }
  function registerPlayheadTag(el: HTMLElement | null): void { els.playheadTag.value = el; }

  /* ---------------- 域组装 ----------------
   * ctx 按引用共享、渐进填充：工厂创建期只定义函数（不触碰其它域），
   * 跨域调用在函数体内经 ctx.xxx 惰性解析——与 Pinia store 互调的惰性规则同源。 */
  const ctx = {} as View3dStoreCtx;
  ctx.state = view3d;
  ctx.els = els;
  ctx.quality = createQuality(ctx);
  ctx.fx = createPostFx(ctx);
  ctx.frame = createFrameOutput(ctx);
  ctx.camera = createCameraRig(ctx);
  ctx.path = createTrajectory(ctx);
  ctx.mission = createMissionRoute(ctx);
  ctx.dial = createDialView(ctx);
  ctx.lighting = createLighting(ctx);
  ctx.sky = createSky(ctx);
  ctx.water = createWater(ctx);
  ctx.ground = createGround(ctx);
  ctx.envMap = createEnvMap(ctx);
  ctx.materials = createMaterials(ctx);
  ctx.drone = createDroneModels(ctx);
  ctx.propellers = createPropellers(ctx);
  ctx.curveAxis = createCurveAxis(ctx);
  ctx.mainView = createMainView(ctx);

  /* ---------------- 本域小动作 ---------------- */
  // RC HUD 布局：右侧竖排 ↔ 底部居中。
  function toggleRcLayout(): void {
    view3d.value.rc.layout = view3d.value.rc.layout === 'center' ? 'side' : 'center';
  }

  return {
    // state
    view3d,
    // host 注册 + 小动作
    registerMainHost, registerDialHost, registerPlayhead, registerPlayheadTag,
    toggleRcLayout,
    // 生命周期 / 相机 / 轨迹 / 任务
    ...ctx.mainView,
    ...ctx.camera,
    ...ctx.path,
    ...ctx.mission,
    // 姿态仪 / 帧输出
    ...ctx.dial,
    ...ctx.frame,
    // 环境（灯光/天空/水面/地面/IBL）与质量
    ...ctx.lighting,
    ...ctx.sky,
    ...ctx.water,
    ...ctx.ground,
    ...ctx.quality,
    ...ctx.fx,
    // 模型（加载/材质/虚影）与曲线轴
    ...ctx.drone,
    ...ctx.materials,
    ...ctx.curveAxis,
  };
});
