import * as THREE from 'three';
import { nextTick } from 'vue';
import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import { useMapStateStore } from '@/modules/shared/map-state';
import { useMap2dStore } from '@/modules/map-2d';
import { useEarthStore } from '@/modules/earth';
import { usePlaybackStore, currentProfile, ensureFrameLoop, stopFrameLoop } from '@/modules/playback';
import { disposeObjectTree } from '../../utils/dispose';
import type { MainViewApi, View3dMainRuntime, View3dStoreCtx } from '../types';

/* 主 3D 视图生命周期：按需建/销毁、尺寸同步、渲染器互斥切换、可视化进出编排。 */

export function createMainView(ctx: View3dStoreCtx): MainViewApi {
  const st = ctx.state;
  const els = ctx.els;

  // 视图按需建：进入可视化/遥测就绪时调用。姿态仪 el 就绪即建（独立于主场景）；
  // 渲染器互斥：地图模式不建主场景（切换时已销毁释放），只保证渲染循环活着（驱动地图渲染）。
  function ensureView3d(): void {
    if (useUiStore().ui.mainView !== 'three') return;
    ctx.dial.ensureDial();
    if (useMapStateStore().map.active) {
      ensureFrameLoop();
      return;
    }
    // WebGL 能力预检：不支持时给出可操作的错误提示，不再往下建渲染器。
    const tc = document.createElement('canvas');
    const gl = tc.getContext('webgl') || tc.getContext('experimental-webgl');
    if (!gl) {
      usePlaybackStore().telemetry.error = '浏览器/WebView 不支持 WebGL —— 3D 无法渲染。请换用 Chrome/Edge，或在浏览器设置里开启硬件加速。';
      return;
    }
    try {
      if (!runtime.view3dMain) buildView3d();
      const tv = runtime.view3dMain!;
      if (tv.renderer && String(tv.renderer.render).length < 30) {
        usePlaybackStore().telemetry.error = 'WebGL 上下文创建失败（渲染器降级）。请更新显卡驱动或在浏览器里启用硬件加速后重试。';
        teardownView3d();
        return;
      }
      ctx.path.rebuildFlightPath();
      if (st.value.camera.mode === 'free' && !st.value.camera.freeSeeded) ctx.camera.seedFreeCameraBehindDrone();
      if (st.value.camera.control === 'lock' && !st.value.camera.lockSeeded) ctx.camera.seedLockOrbit();
      resizeView3d();
      ctx.camera.applyCameraPose();
      ensureFrameLoop(); // 单一 rAF 链（modules/playback），幂等
      ctx.frame.renderView3d();
    } catch (e) {
      usePlaybackStore().telemetry.error = '3D初始化失败: ' + (e && (e as Error).message ? (e as Error).message : e);
      teardownView3d();
    }
  }

  // 建主视图 runtime：场景/渲染器/网格/天空/水面/灯光/相机，随后挂交互、载模型、套灯光。
  function buildView3d(): void {
    const mainEl = els.main.value;
    if (!mainEl) return;
    const tv: View3dMainRuntime = {
      hostEl: mainEl,
      scene: new THREE.Scene(),
      orbit: {
        free: { yaw: -0.65, pitch: -0.65, distance: 180 },
        lock: { yaw: 0, pitch: -0.46, distance: 0 },
      },
      drag: { active: false, x: 0, y: 0 },
      walker: { x: 0, y: 0, z: 0, speed: 40 },
      keys: { forward: 0, back: 0, left: 0, right: 0, up: 0, down: 0 },
      droneBaseScale: 1,
      lights: {},
      sky: {},
      water: {},
      mission: {},
      servoMap: { map: null, ready: false },
    };
    runtime.view3dMain = tv;
    tv.scene.background = new THREE.Color(0xf3f4f6);
    tv.renderer = new THREE.WebGLRenderer({ antialias: st.value.render.main.aa === 'msaa' });
    tv.renderer.useLegacyLights = true;
    tv.renderer.setClearColor(0xf3f4f6, 1);
    tv.renderer.setPixelRatio(ctx.quality.renderPixelRatio(st.value.render.main.resolution));
    mainEl.appendChild(tv.renderer.domElement);
    tv.gpuTier = ctx.quality.detectGpuClass(tv.renderer);
    tv.materialTier = ctx.quality.currentTier(st.value.render.quality);

    ctx.envMap.ensureMainEnvMap();

    tv.grid = ctx.ground.buildGroundGrid();
    tv.scene.add(tv.grid);

    if (st.value.sky.enabled) ctx.sky.ensureSky();

    if (st.value.water.enabled) {
      ctx.water.ensureWater();
    }

    tv.lights!.ambient = new THREE.AmbientLight(0xffffff, 0.3);
    tv.scene.add(tv.lights!.ambient);
    tv.lights!.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x2a3a50, 0.4);
    tv.scene.add(tv.lights!.hemi);

    const keyLight = new THREE.DirectionalLight(0xfff4e0, 0.85);
    keyLight.position.set(90, 140, 70);
    tv.lights!.key = keyLight;
    tv.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xd6e4ff, 0.35);
    fillLight.position.set(-90, 100, 50);
    tv.lights!.fill = fillLight;
    tv.scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
    rimLight.position.set(0, 90, -130);
    tv.lights!.rim = rimLight;
    tv.scene.add(rimLight);

    tv.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
    ctx.camera.bindViewportInput();

    ctx.drone.refreshDroneModels();

    ctx.lighting.applyMainLighting();
  }

  function resizeView3d(): void {
    const tv = runtime.view3dMain;
    if (!tv) return;
    const mainPR = ctx.quality.renderPixelRatio(st.value.render.main.resolution);
    if (tv.renderer && tv.renderer.getPixelRatio() !== mainPR) tv.renderer.setPixelRatio(mainPR);
    const w = Math.max(1, tv.hostEl.clientWidth);
    const h = Math.max(1, tv.hostEl.clientHeight);
    tv.renderer?.setSize(w, h, false);
    ctx.fx.syncMainFxSize();
    ctx.camera.applyCameraPose();
  }

  // 渲染器互斥切换：激活哪个只渲染哪个——切走的渲染器销毁（释放 GPU/实例），切回从头重建
  // （主场景相机种子复位、地图 fitToTrack 初始视角）。三选一：scene=纯 3D / map2d / earth。
  // 切换即复位播放：不自动推进——切走的视图不在后台继续跑数据，切入的从头开始（想看手动播放）。
  function switchViewport(target: 'scene' | 'map2d' | 'earth'): void {
    usePlaybackStore().resetPlaybackToStart();
    const mapStore = useMapStateStore();
    if (target === 'scene') {
      useEarthStore().disposeEarth();
      useMap2dStore().teardownMap2d();
      void mapStore.setMapActive(false); // 内部 mainView=three 时 ensureView3d 重建（若已销毁）
    } else if (target === 'earth') {
      useMap2dStore().teardownMap2d();
      teardownView3d();
      void mapStore.setMapRenderer('earth');
      void mapStore.setMapActive(true);
      ensureFrameLoop(); // teardownView3d 后循环可能已无驱动对象，重启循环驱动地图渲染
    } else {
      useEarthStore().disposeEarth();
      teardownView3d();
      void mapStore.setMapRenderer('2d');
      void mapStore.setMapActive(true);
      ensureFrameLoop();
    }
  }

  // 销毁主视图（释放 GPU 资源；姿态仪不随此销毁——右栏姿态常驻，见 teardownDial）。
  function teardownView3d(): void {
    const tv = runtime.view3dMain;
    if (!tv) return;
    // rAF 链归 playback frame-loop 所有（单链，不随主场景销毁停——地图/姿态仪还要它驱动）。
    ctx.camera.resetWalkerKeys();
    usePlaybackStore().playback.fpsLastTime = 0;
    ctx.fx.disposeMainFx();
    ctx.envMap.disposeMainEnvMap();
    ctx.sky.disposeSky();
    ctx.water.disposeWater();
    if (tv.grid) {
      disposeObjectTree(tv.grid);
      tv.grid = undefined;
      tv.ground = undefined;
    }
    if (tv.drone) { disposeObjectTree(tv.drone, true); tv.drone = undefined; }
    if (tv.ghost) { ctx.materials.disposeGhostMats(tv.ghost); tv.ghost = null; }
    if (tv.mission?.lineGroup) { disposeObjectTree(tv.mission.lineGroup, true); tv.mission.lineGroup = null; }
    if (tv.mission?.markerGroup) { disposeObjectTree(tv.mission.markerGroup, true); tv.mission.markerGroup = null; }
    if (tv.path) { disposeObjectTree(tv.path.line); tv.path = undefined; }
    if (tv.renderer) {
      tv.renderer.dispose();
      if (tv.renderer.domElement && tv.renderer.domElement.parentNode) tv.renderer.domElement.parentNode.removeChild(tv.renderer.domElement);
    }
    // 姿态仪（runtime.view3dDial）不随主场景销毁——渲染器切换后右栏姿态照常
    // （仅离开可视化 setPrimaryView('chart')/应用退出时销毁，见 teardownDial）。
    runtime.view3dMain = null;
    if (runtime.view3dCurve) {
      try { runtime.view3dCurve.dispose(); } catch (e) { /* noop */ }
      runtime.view3dCurve = null;
    }
  }

  // 进出可视化总开关：进=按需拉遥测+建视图；出=全链路释放（停循环/销毁三视图/释放遥测派生数据）。
  function setPrimaryView(view: string): void {
    useUiStore().ui.mainView = view === 'three' ? 'three' : 'chart';
    if (useUiStore().ui.mainView === 'three') {
      // 按需加载：进入可视化才拉遥测（离开时已释放，重进重建——曲线数据在 CurveManager 缓存，很快）。
      usePlaybackStore().ensureThreeTelemetry();
      nextTick(() => {
        ensureView3d();
        if (usePlaybackStore().playback.curveAxis) ctx.curveAxis.rebuildCurveAxis();
      });
    } else {
      // 离开可视化：全部释放——停循环（连带挂起 Cesium 默认渲染循环）、销毁主场景/姿态仪/
      // 当前地图渲染器、释放遥测派生数据（防内存常驻）。map.active 不动：保留渲染器选择记忆，重进回原渲染器。
      stopFrameLoop();
      usePlaybackStore().playback.playing = false;
      if (st.value.camera.control === 'fps') ctx.camera.resetWalkerKeys();
      usePlaybackStore().playback.fpsLastTime = 0;
      teardownView3d();
      ctx.dial.teardownDial();
      const ms = useMapStateStore().map;
      if (ms.active && ms.renderer === 'earth') useEarthStore().disposeEarth();
      else if (ms.active) useMap2dStore().teardownMap2d();
      usePlaybackStore().releaseTelemetry();
      nextTick(() => { if (runtime.mainChart) runtime.mainChart.resize(); });
    }
  }

  // 换日志：复位渲染侧（主场景销毁、相机种子复位、任务版本清空、姿态仪换机型重载）。
  // 数据面复位在 playback.resetTelemetry（log-store applyLoadedLog 编排两者）。
  function resetView3dScene(): void {
    st.value.camera.freeSeeded = false;
    st.value.camera.lockSeeded = false;
    st.value.mission.versions = null;
    teardownView3d();
    // 姿态仪常驻：换日志清旧曲线（loadThreeTelemetry 完成时重载）+ 按新机型重载姿态侧模型。
    const dv = runtime.view3dDial;
    if (dv) {
      dv.curves = null;
      if (dv.wind) dv.wind.curves = null;
      ctx.drone.refreshDroneModels();
    }
  }

  // 遥测就绪回调（playback.loadThreeTelemetry 完成）：预载姿态源曲线（供实时切源）+ 建视图。
  function handleTelemetryReady(): void {
    void ctx.dial.preloadDialCurves();
    nextTick(() => ensureView3d());
  }

  // 换日志/换格式后校正姿态/位置/对比源：若当前选中 key 不在新格式 profile 的源列表里，
  // 回退到 profile 默认。保证下拉总有合法选中项（如 APM→PX4 时 'ahr2' 不存在 → 改
  // 'vehicle_attitude'）。在 log-store applyLoadedLog 调用。
  function validateSourceSelection(): void {
    const profile = currentProfile();
    const aSrcs = profile.attitudeSources || [];
    const pSrcs = profile.positionSources || [];
    const aKeys = aSrcs.map(function (s) { return s.key; });
    const pKeys = pSrcs.map(function (s) { return s.key; });
    if (aKeys.indexOf(st.value.camera.attitudeSource) < 0) st.value.camera.attitudeSource = profile.defaultAttitude || aKeys[0] || '';
    if (pKeys.indexOf(st.value.camera.positionSource) < 0) st.value.camera.positionSource = profile.defaultPosition || pKeys[0] || '';
    if (aKeys.indexOf(st.value.camera.compareSource) < 0) {
      // 对比源默认：首个期望(isDesired)源，否则主姿态源。
      const des = aSrcs.filter(function (s) { return s.isDesired; })[0];
      st.value.camera.compareSource = des ? des.key : (profile.defaultAttitude || aKeys[0] || '');
    }
  }

  // 姿态源切换：曲线已预载所有源，帧输出实时按新源取值(attitudeAt)，
  // 不再重载遥测、不重置播放位置。遥测尚未加载时走原加载流程。
  function handleAttitudeSourceChange(): void {
    if (!usePlaybackStore().telemetry.loaded) usePlaybackStore().ensureThreeTelemetry();
  }

  // 位置源切换改变轨迹几何(x/y/z)，重新抓取 lat/lng/alt 曲线并重建采样。
  // 不重置播放时刻与相机：buildThreeSamples 保留当前 timeMs；相机角度保持，网格/缩放由
  // rebuildFlightPath→fitCameraToTrack 按新 maxRadius 自适应（int32+飞点清洗后尺度已正常）。
  function handlePositionSourceChange(): void {
    const tv = runtime.view3dMain;
    if (tv && tv.path) tv.path.key = ''; // 强制轨迹重建
    usePlaybackStore().telemetry.loaded = false;
    usePlaybackStore().ensureThreeTelemetry();
  }

  return {
    ensureView3d, teardownView3d, resizeView3d, switchViewport, setPrimaryView,
    resetView3dScene, handleTelemetryReady, validateSourceSelection,
    handleAttitudeSourceChange, handlePositionSourceChange,
  };
}
