import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import { useMapStateStore } from '@/modules/shared/map-state';
import { useView3dStore } from '@/modules/view3d';
import { useEarthStore } from '@/modules/earth';
import { useMap2dStore } from '@/modules/map-2d';
import { usePlaybackStore } from '../store/playback-store';

// ===== 单一 rAF 枢纽（自 view3d 帧管线拆出）=====
// 可视化视图（mainView==='three'）激活期间驱动：播放推进、地图 reconcile（mapFps 节流）、
// 每帧数据/位姿输出（view3d.applyFrameOutputs）、姿态仪渲染、纯 3D 模式主场景渲染。
// 链句柄挂 runtime.frameLoop.raf（放 runtime 而非模块级 let：HMR 换模块不丢链，防旧闭包孤儿链）。
// 渲染器互斥不变：切走销毁、切回重建；本循环只驱动当前激活的那个。
// 例外——earth 独占：整条帧管线交棒 Cesium 自身默认渲染循环（scene.preUpdate，见 earth-store
// earthSoloFrame），本链退出。earth 有自己的循环就不用外部 rAF 调它：两链并行会在瓦片加载期
// 相互挤压帧预算 + 相位交错（位置一顿一顿），独占期间只剩 Cesium 一条钟。

/** earth 独占（地球激活且主场景已销毁）时，整条可视化帧管线归 Cesium scene.preUpdate——
 * 推进/采样/位姿/姿态仪/渲染严格同一时钟，且 preUpdate 在 scene.update（visualizer 读位姿）
 * 之前触发=同帧写入同帧消费（preRender 是晚一拍的：模型 t-1 vs 相机 t，移动视角时模型来回“游”）。
 * 判定只此一处：frame-loop 与 earth-store 的 preUpdate 都引用它，杜绝两边各写一份后漂移。 */
export function isEarthSolo(): boolean {
  const map = useMapStateStore().map;
  return !runtime.view3dMain && map.active && map.renderer === 'earth';
}

export function ensureFrameLoop(): void {
  if (!runtime.frameLoop.raf) runtime.frameLoop.raf = requestAnimationFrame(frameTick);
}

export function stopFrameLoop(): void {
  if (runtime.frameLoop.raf) cancelAnimationFrame(runtime.frameLoop.raf);
  runtime.frameLoop.raf = 0;
  // 直接重建策略：链停了就没有任何路径再驱动/挂起地球——viewer 当场销毁，不留存活副本。
  // Cesium viewer 连地形/影像缓存动辄数百 MB，suspend 保留=内存下不来（实测 1G+ 不降）。
  // 离开可视化的主路径（setMainView('chart')）随后还会显式 dispose 一次，此处兜底 HMR 等
  // 边缘路径，幂等（disposeEarth 内部 rt 空守卫）。
  useEarthStore().disposeEarth();
}

function frameTick(now: number): void {
  runtime.frameLoop.raf = 0; // 本回调已出队；若继续跑，末尾重新登记
  const ui = useUiStore();
  const mapState = useMapStateStore();
  const mapActive = mapState.map.active;
  // 自停：离开可视化，或没有任何要驱动的东西（主场景/地图/姿态仪全无）。
  if (ui.ui.mainView !== 'three' || (!runtime.view3dMain && !mapActive && !runtime.view3dDial)) {
    stopFrameLoop();
    return;
  }
  // earth 独占：交棒 Cesium 自身循环。此处只负责把 viewer 建起来（el 未挂载时内部空跑，
  // 下帧重试），viewer 就位后推进/每帧输出/姿态仪/reconcile 全在其 scene.preUpdate
  // （earthSoloFrame）——本链整体退出，杜绝双 rAF 并行交错。
  if (isEarthSolo()) {
    useEarthStore().renderEarth();
    if (runtime.earthView) return; // 交棒完成：不重登记
    runtime.frameLoop.raf = requestAnimationFrame(frameTick); // 容器未就绪：下帧再试
    return;
  }
  const scene = useView3dStore();
  const pb = usePlaybackStore();
  const ts = now || performance.now();

  // dt 与推进共用 lastFrameTime 基准（paused 时 advance 也会刷新它，故 ≈ 墙钟帧间隔）。
  const realPrev = pb.playback.lastFrameTime;
  let realDt = realPrev ? (ts - realPrev) / 1000 : 0;
  if (realDt < 0 || realDt > 0.1) realDt = 0;
  // FPS 相机运动（纯 3D 自由视角；内部自守 runtime.view3dMain）：fpsDt 独立基准，越界跳过防大跳。
  if (pb.playback.fpsLastTime) {
    const fpsDt = (ts - pb.playback.fpsLastTime) / 1000;
    if (fpsDt > 0 && fpsDt < 0.1 && scene.view3d.camera.mode === 'free' && scene.view3d.camera.control === 'fps') {
      scene.advanceWalker(fpsDt);
    }
  }
  pb.playback.fpsLastTime = ts;

  // 播放推进——单时钟：earth 独占已在前面上方交棒 preRender 并退出本链，走到这里的必非独占。
  pb.advanceThreePlayback(ts);

  // 地图 reconcile（mapFps 节流；真正的 GL 渲染由 Cesium 自身循环/Leaflet DOM 完成）。
  const mapFps = mapState.map.mapFps;
  if (mapActive && (mapFps <= 0 || ts - runtime.frameLoop.lastMapRenderTs >= 1000 / mapFps)) {
    runtime.frameLoop.lastMapRenderTs = ts;
    try {
      if (mapState.map.renderer === 'earth') useEarthStore().renderEarth();
      else useMap2dStore().reconcileMap2d();
    } catch (e) { /* 渲染器异常不拖垮循环 */ }
  }

  // 每帧输出：current 数据 + 位姿应用（姿态仪/主场景）+ 曲线轴播放头。
  try { scene.applyFrameOutputs(); } catch (e) { /* 同上 */ }
  try { scene.renderDial(); } catch (e) { /* 同上 */ }

  // 主场景仅纯 3D 模式渲染（天空/水面 uniform、桨叶、覆盖层可见性 + 渲染）。
  if (runtime.view3dMain && !mapActive) {
    try { scene.renderView3dFrame(ts, realDt); } catch (e) { /* 同上 */ }
  }

  runtime.frameLoop.raf = requestAnimationFrame(frameTick);
}
