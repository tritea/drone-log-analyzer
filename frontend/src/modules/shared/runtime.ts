import type * as Cesium from 'cesium';
import type { CurveChart } from '@/modules/analysis';
import type { CustomModelSpec } from '@/modules/custom-models';
import type { View3dMainRuntime, View3dDialRuntime } from '@/modules/view3d/store/types';
import type { MapRuntime } from '@/modules/map-2d/store/types';

// 主 3D 视图（View3dMainRuntime）与右栏姿态仪（View3dDialRuntime）的运行时接口
// 定义在 modules/view3d/store/types.ts，2D 地图（MapRuntime）在 modules/map-2d/store/types.ts
// （域私有类型归位）；此处仅作容器持有实例。
// 姿态仪是独立于主 3D 场景的长生命周期渲染器，不随渲染器切换（纯3D/2D/3D地图）销毁。

// 地球锁定模式鼠标交互（接管拖拽/滚轮，仿 3D 主场景；原 MapLibre 3D 移除后仅 earth 使用，更名归位）。
export interface EarthLockHandlers {
  canvas: HTMLCanvasElement
  onDown: (e: PointerEvent) => void
  onMove: (e: PointerEvent) => void
  onUp: (e: PointerEvent) => void
  onWheel: (e: WheelEvent) => void
  onCtx: (e: Event) => void
}

// 地球自由视角交互（非锁定模式）：球坐标模型——左/右键拖拽绕屏幕中心地表锚点改 heading/pitch，
// 滚轮/中键改 range；应用走 camera.setView（不锁 transform）。
export interface EarthOrbitHandlers {
  canvas: HTMLCanvasElement;
  onDown: (e: PointerEvent) => void;
  onMove: (e: PointerEvent) => void;
  onUp: (e: PointerEvent) => void;
  onWheel: (e: WheelEvent) => void;
}

// 自由视角球坐标状态（度数制，与锁定视角同口径）；惰性建立、flyTo/锁定后置 null 重建。
export interface EarthFreeOrbit {
  center: Cesium.Cartesian3;
  heading: number;
  pitch: number;
  range: number;
}

export interface CustomModelPropHandle {
  pos: Cesium.ConstantPositionProperty;
  ori?: Cesium.ConstantProperty;
  scaleProp?: Cesium.ConstantProperty;
}

export interface EarthRuntime {
  viewer: Cesium.Viewer;
  droneEntity: Cesium.Entity | null;
  droneModelName: string;
  // 模型重建 in-flight 标志：rebuildDroneEntity 是 async，await lowpoly GLB 导出期间置 true，
  // 防止 render 循环在「同机型首次冷缓存」时每帧重复触发（droneEntity 此时仍为 null）。
  droneModelInFlight?: boolean;
  // 当前模型形态（'glb'|'lowpoly'）：与 map.droneModel 同步，用于检测形态切换触发重建 + await 后 stale 守卫。
  droneModelMode?: string;
  // GLB 原生尺寸归一化（对齐 map-3d 的「真实物理尺寸」渲染）：droneModelUri 为本次测量的 uri（换模型/dispose 失效用），
  // droneBaseScale = physBase/maxDim（droneScale=1 时让模型 ≈ 1.5m/1.7m 的缩放，0=未量完→effectiveScale=0 仅 minimumPixelSize 兜底），
  // droneLiftPerScale = max(0,-minY)×baseScale（droneScale=1 时的 halfH 抬升，让模型坐落不陷地）。
  droneModelUri: string;
  droneBaseScale: number;
  droneLiftPerScale: number;
  // 螺旋桨 SERVO 功能号（MOTORx=33..；throttle=70）：earth 端读真实电机 PWM 时，按功能号映射到 RCOU 通道。
  propellerFuncs: number[];
  removeDroneEntity: (() => void) | null;
  trackEntity: Cesium.Entity | null;
  routeEntity: Cesium.Entity | null;
  waypointEntities: Cesium.Entity[];
  customModelEntities: Map<string, Cesium.Entity>;
  customModelSpecs: Map<string, CustomModelSpec>;
  customModelProps: Map<string, CustomModelPropHandle>;
  pickHandler: Cesium.ScreenSpaceEventHandler | null;
  trackCoordsFull: number[][];
  homeGroundElev: number;
  providerId: string;
  terrainOn: boolean;
  lockActive: boolean;
  lockHeading: number;
  lockPitch: number;
  lockRange: number;
  // 锁定相机上次已应用参数（精确比较）。旧版用 0.1m/0.01° 量化的字符串 key 去重——相机实际以
  // 「速度×10Hz」步进跟随，而模型每帧插值全速走，屏上模型被相机甩来甩去（慢速段更明显，
  // 即"拉回去又拉回来"）。pos 置 null = 强制下一帧重应用（手势/进锁后）。
  lockAppliedPos: Cesium.Cartesian3 | null;
  lockAppliedHeading: number;
  lockAppliedPitch: number;
  lockAppliedRange: number;
  lockHandlers: EarthLockHandlers | null;
  orbitHandlers: EarthOrbitHandlers | null;
  freeOrbit: EarthFreeOrbit | null;
  lastTimeMs: number;
  lastTeleKey: string;
  lastMissionKey: number;
  // 3D Tiles（测绘模型）：primitive 实例 + 加载中标记 + 每个 tileset 的基准经纬度（弧度，加载时取 boundingSphere 中心，
  // 用于 heightOffset 平移的稳定锚点——避免随当前 modelMatrix 叠加偏移）。
  tilesetPrimitives: Map<string, Cesium.Cesium3DTileset>;
  tilesetLoading: Set<string>;
  tilesetBaseCarto: Map<string, { lon: number; lat: number }>;
  // 手动定位模式的初始包围球中心（ECEF Cartesian3，加载时取，含 tileset 自带高度）；
  // 缩放/平移以此 为锚，避免读 live boundingSphere（会随 modelMatrix 漂移）致调整无效/乱跳。
  tilesetBaseCenter: Map<string, Cesium.Cartesian3>;
  // 手动定位目标点的地形高度缓存（sampleTerrainMostDetailed 异步采样结果）；applyTilesetTransform 用它
  // 作基准高度，让模型落到地表而非椭球面（开地形时避免陷地）。
  tilesetGroundH: Map<string, number>;
  // 螺旋桨旋转（Cesium nodeTransformations 驱动）：按 GLB 桨叶节点名（M1~M4/throttle）施加绕本地 Y 的旋转。
  // 角度由 scene.preRender 监听按 wall-clock dt 推进，rotation 的 CallbackProperty 每帧读累积角度返回四元数。
  propellerNodes: string[];
  propellerDirs: number[];
  propellerAngles: number[];
  propellerOmegas: number[];
  propellerLastTick: number;
  removePropRender: (() => void) | null;
  /** preRender 位姿/相机同步监听的移除函数（无人机位姿 + 锁定相机按渲染帧同步，防双 rAF 交错闪动） */
  removeLiveSync: (() => void) | null;
}

// 单一 rAF 帧循环状态（modules/playback/loop/frame-loop 所有）：
// raf=链句柄；三个 *RenderTs=地图(mapFps)/主场景(render.fps)/姿态仪(30fps)渲染节流时间戳。
// 挂 runtime 而非模块级 let：HMR 换模块不产生旧闭包孤儿链。
export interface FrameLoopState {
  raf: number;
  lastMapRenderTs: number;
  lastMainRenderTs: number;
  lastAttitudeRenderTs: number;
}

export const runtime: {
  mainChart: CurveChart | null;
  view3dMain: View3dMainRuntime | null;
  view3dDial: View3dDialRuntime | null;
  view3dCurve: CurveChart | null;
  chartInteractionsBound: boolean;
  mapView: MapRuntime | null;
  earthView: EarthRuntime | null;
  frameLoop: FrameLoopState;
} = {
  mainChart: null,
  view3dMain: null,
  view3dDial: null,
  view3dCurve: null,
  chartInteractionsBound: false,
  mapView: null,
  earthView: null,
  frameLoop: { raf: 0, lastMapRenderTs: 0, lastMainRenderTs: 0, lastAttitudeRenderTs: 0 },
};
