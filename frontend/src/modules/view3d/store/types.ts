import type { Ref } from 'vue';
import type * as THREE from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import type { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { PropellerInfo } from '@/modules/shared/utils/drone-model';
import type { MissionVersion } from '@/types';

/* ==========================================================================
 * 渲染面状态（View3dState）
 *
 * 只描述「用户可调的渲染偏好」：相机/灯光/天空/水面/材质形态/渲染档位等。
 * 数据面（播放时钟/遥测采样/曲线定义）在 modules/playback，不在此处。
 * 持久化经 settings-store 的快照形状逐字段映射（键名保持旧版 three.*，与历史配置兼容）。
 * ========================================================================== */

export type View3dModelForm = 'glb' | 'lowpoly';
export type View3dTier = 'high' | 'medium' | 'low';
export type View3dAaMode = 'off' | 'msaa' | 'fxaa';

/** 相机与视口偏好（原 ThreeViewState）：控制模式、姿态/位置数据源选择、对比叠加开关。 */
export interface View3dCameraState {
  mode: 'ortho' | 'free';
  control: 'normal' | 'fps' | 'lock';
  attitudeSource: string;
  positionSource: string;
  freeSeeded: boolean;
  lockSeeded: boolean;
  compareAttitude: boolean;
  compareSource: string;
  ssao: boolean;
  fullTrajectory: boolean;
}

export interface View3dMissionState {
  versions: MissionVersion[] | null;
}

export interface View3dRcState {
  hud: boolean;
  readout: boolean;
  layout: 'side' | 'center';
}

export interface View3dLightingState {
  enabled: boolean;
  env: number;
  ambient: number;
  key: number;
}

export interface View3dSkyState {
  enabled: boolean;
  cloud: number;
}

export interface View3dGroundState {
  show: boolean;
}

export interface View3dWaterState {
  enabled: boolean;
  wave: number;
}

export interface View3dRenderSideState {
  aa: View3dAaMode;
  resolution: number;
}

export interface View3dRenderState {
  quality: 'auto' | 'high' | 'medium' | 'low';
  main: View3dRenderSideState;
  dial: View3dRenderSideState;
  fps: number;
}

export interface View3dDebugState {
  posPanel: boolean;
}

export interface View3dState {
  camera: View3dCameraState;
  mission: View3dMissionState;
  rc: View3dRcState;
  lighting: View3dLightingState;
  sky: View3dSkyState;
  droneScale: number;
  model: View3dModelForm;
  dialModel: View3dModelForm;
  ground: View3dGroundState;
  water: View3dWaterState;
  render: View3dRenderState;
  debug: View3dDebugState;
}

export function blankView3dState(): View3dState {
  return {
    camera: {
      mode: 'free', control: 'lock', attitudeSource: 'ahr2', positionSource: 'pos',
      freeSeeded: false, lockSeeded: false, ssao: false, fullTrajectory: false,
      compareAttitude: false, compareSource: 'attDes',
    },
    mission: { versions: null },
    rc: { hud: true, readout: false, layout: 'side' },
    lighting: { enabled: true, env: 1, ambient: 1, key: 1 },
    sky: { enabled: true, cloud: 0.6 },
    droneScale: 1,
    model: 'glb',
    dialModel: 'glb',
    ground: { show: true },
    water: { enabled: false, wave: 0.4 },
    render: {
      quality: 'auto',
      main: { aa: 'msaa', resolution: 1 },
      dial: { aa: 'msaa', resolution: 1 },
      fps: 0,
    },
    debug: { posPanel: false },
  };
}

/* ==========================================================================
 * runtime 运行时视图（非响应式重对象，挂 modules/shared/runtime.ts 容器）
 * ========================================================================== */

/** 单个姿态源已解析的曲线引用：euler 三轴，或 quat 四分量。 */
export type AttitudeSourceCurves =
  | { kind: 'euler'; roll: { type: string; field: string }; pitch: { type: string; field: string }; yaw: { type: string; field: string } }
  | { kind: 'quat'; q: [{ type: string; field: string }, { type: string; field: string }, { type: string; field: string }, { type: string; field: string }] };

/** 风向量曲线（NED 分量，d 可缺——退化水平风）。 */
export interface WindCurveRefs {
  n: { type: string; field: string };
  e: { type: string; field: string };
  d: { type: string; field: string } | null;
}

export interface View3dFxChain {
  composer?: EffectComposer;
  renderPass?: RenderPass;
  ssaoPass?: SSAOPass;
  fxaaPass?: ShaderPass;
  outputPass?: OutputPass;
}

/** 球坐标轨道参数（自由/锁定两套独立）。 */
export interface OrbitParams {
  yaw: number;
  pitch: number;
  distance: number;
}

/** fps 漫游相机状态。 */
export interface WalkerState {
  x: number;
  y: number;
  z: number;
  speed: number;
}

export interface WalkerKeys {
  forward: number;
  back: number;
  left: number;
  right: number;
  up: number;
  down: number;
}

/** 主 3D 视图运行时（原 ThreeView）：场景/渲染器/相机轨道/场景物件/环境/后处理全集。 */
export interface View3dMainRuntime {
  hostEl: HTMLElement;
  scene: THREE.Scene;
  renderer?: THREE.WebGLRenderer;
  camera?: THREE.PerspectiveCamera;
  activeCamera?: THREE.Camera | null;
  orbit: { free: OrbitParams; lock: OrbitParams };
  drag: { active: boolean; x: number; y: number };
  walker: WalkerState;
  keys: WalkerKeys;
  grid?: THREE.Object3D;
  ground?: THREE.Mesh;
  drone?: THREE.Object3D;
  ghost?: THREE.Object3D | null;
  modelName?: string;
  propellers?: PropellerInfo[];
  path?: { line: THREE.Line; geometry: THREE.BufferGeometry; key: string };
  mission?: { lineGroup?: THREE.Group | null; markerGroup?: THREE.Group | null; activeKey?: number };
  lights?: {
    ambient?: THREE.AmbientLight;
    key?: THREE.DirectionalLight;
    hemi?: THREE.HemisphereLight;
    fill?: THREE.DirectionalLight;
    rim?: THREE.DirectionalLight;
  };
  sky?: {
    mesh?: THREE.Mesh;
    envRt?: THREE.WebGLRenderTarget;
    noiseTex?: THREE.DataTexture;
    backdropTex?: THREE.WebGLCubeRenderTarget;
  };
  water?: { mesh?: THREE.Mesh; skyTex?: THREE.WebGLCubeRenderTarget };
  envRt?: THREE.WebGLRenderTarget;
  droneBaseScale: number;
  droneHalfHeight?: number;
  gpuTier?: View3dTier;
  materialTier?: View3dTier;
  servoMap?: { map: Record<number, number> | null; ready: boolean };
  fx?: View3dFxChain;
}

/** 右栏姿态仪运行时（原 AttitudeView）：独立 WebGL 上下文，长生命周期，不随主场景销毁。 */
export interface View3dDialRuntime {
  hostEl: HTMLElement;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  camDist?: number;
  /** 姿态侧模型去重键（机型+形态），独立于主场景的 modelName。 */
  modelName?: string;
  drone?: THREE.Object3D;
  /** 世界固连参照球（背景圆/赤道/正向环/正北标识）。 */
  reference?: THREE.Object3D | null;
  /** 本体固连机头箭头。 */
  nose?: THREE.Object3D | null;
  propellers?: PropellerInfo[];
  curves?: Record<string, AttitudeSourceCurves> | null;
  wind?: { curves: WindCurveRefs | null; arrow: THREE.Object3D | null };
  lights?: {
    key?: THREE.DirectionalLight;
    ambient?: THREE.AmbientLight;
    hemi?: THREE.HemisphereLight;
  };
  fx?: View3dFxChain;
  envRt?: THREE.WebGLRenderTarget;
}

/* ==========================================================================
 * 域工厂契约（View3dStoreCtx）
 *
 * 各域以 createXxx(ctx) 工厂接入；ctx 为按引用共享、渐进填充的对象。
 * 跨域调用必须发生在函数体内（调用时才解析 ctx.xxx），与 Pinia store 互调
 * 的惰性规则同源——创建期只定义函数，不触碰其它域，故填充顺序不敏感。
 * ========================================================================== */

export interface View3dHostEls {
  main: Ref<HTMLElement | null>;
  dial: Ref<HTMLElement | null>;
  playhead: Ref<HTMLElement | null>;
  playheadTag: Ref<HTMLElement | null>;
}

export interface QualityApi {
  detectGpuClass: (renderer?: THREE.WebGLRenderer) => View3dTier;
  renderPixelRatio: (resolution: number) => number;
  currentTier: (quality: string) => View3dTier;
  setQuality: (value: string) => void;
  setMainAa: (aa: string) => void;
  setMainResolution: (resolution: number) => void;
  setMainFps: (fps: number) => void;
  setDialAa: (aa: string) => void;
  setDialResolution: (resolution: number) => void;
}

export interface FxApi {
  ensureMainFx: () => void;
  syncMainFxPasses: () => void;
  syncMainFxSize: () => void;
  calibrateSsaoRadius: () => void;
  toggleSsao: () => void;
  ensureDialFx: () => void;
  syncDialFxPasses: () => void;
  syncDialFxSize: () => void;
  disposeMainFx: () => void;
}

export interface FrameApi {
  applyFrameOutputs: () => void;
  renderView3dFrame: (ts: number, dt: number) => void;
  renderView3d: () => void;
}

export interface CameraApi {
  applyCameraPose: () => void;
  setViewMode: (mode: string) => void;
  setCameraControl: (mode: string) => void;
  seedFreeCameraBehindDrone: () => void;
  seedLockOrbit: () => void;
  seedWalkerFromCamera: () => void;
  advanceWalker: (dtSec: number) => void;
  bindViewportInput: () => void;
  handleWalkerKey: (e: KeyboardEvent, down: boolean) => boolean;
  resetWalkerKeys: () => void;
}

export interface TrajectoryApi {
  rebuildFlightPath: () => void;
  advanceFlightPath: () => void;
  fitCameraToTrack: () => void;
  toggleWholeTrajectory: () => void;
  togglePathOverlay: () => void;
  syncOverlayVisibility: () => void;
}

export interface MissionApi {
  rebuildMissionVersions: () => void;
  missionVersionAt: (timeMs: number) => MissionVersion | null;
  missionGeoPoints: () => { lat: number; lng: number; label: string; isHome: boolean; isTakeoff: boolean; isRTL: boolean; alt: number }[] | null;
  refreshMissionOverlay: () => Promise<void>;
  toggleMissionRoute: () => Promise<void>;
  toggleWaypoints: () => Promise<void>;
  ensureMissionOverlay: () => Promise<void>;
}

export interface MainViewApi {
  ensureView3d: () => void;
  teardownView3d: () => void;
  resizeView3d: () => void;
  switchViewport: (target: 'scene' | 'map2d' | 'earth') => void;
  setPrimaryView: (view: string) => void;
  resetView3dScene: () => void;
  handleTelemetryReady: () => void;
  validateSourceSelection: () => void;
  handleAttitudeSourceChange: () => void;
  handlePositionSourceChange: () => void;
}

export interface DialApi {
  ensureDial: () => void;
  teardownDial: () => void;
  renderDial: () => void;
  preloadDialCurves: () => Promise<void>;
  attitudeAt: (source: string, t: number) => { roll: number; pitch: number; yaw: number } | null;
  /** 换装已整形的姿态模型：换下旧模型/参照球重建、收桨叶、重挂装饰、套灯光。 */
  attachDialModel: (model: THREE.Object3D, name: string) => void;
}

export interface LightingApi {
  applyMainLighting: () => void;
  applyDialLighting: () => void;
  setLightingFactor: (field: 'env' | 'ambient' | 'key', value: number) => void;
  toggleLighting: (enabled: boolean) => void;
}

export interface SkyApi {
  ensureSky: () => void;
  disposeSky: () => void;
  applySkyQuality: (tier: View3dTier) => void;
  advanceSkyUniforms: (ts: number) => void;
  toggleSky: (enabled: boolean) => void;
  setCloudAmount: (value: number) => void;
  /** 烘焙天空立方体贴图（供水面倒影）；失败返回 null。 */
  bakeSkyForReflection: () => THREE.WebGLCubeRenderTarget | null;
  /** 惰性烘焙/复用天空噪声纹理（云层 + 水面涟漪共用）。 */
  ensureNoiseTexture: () => THREE.DataTexture | null;
}

export interface WaterApi {
  ensureWater: () => void;
  disposeWater: () => void;
  anchorWaterToCamera: () => void;
  advanceWaterUniforms: (ts: number) => void;
  toggleWater: (enabled: boolean) => void;
  setWaveAmount: (value: number) => void;
}

export interface GroundApi {
  buildGroundGrid: () => THREE.Group;
  toggleGround: (show: boolean) => void;
}

export interface EnvMapApi {
  ensureMainEnvMap: () => void;
  ensureDialEnvMap: () => void;
  disposeMainEnvMap: () => void;
}

export interface DroneApi {
  refreshDroneModels: () => void;
  setModelForm: (model: string) => void;
  setDialModelForm: (model: string) => void;
  applyDroneScale: () => void;
  setDroneScale: (value: number) => void;
  alignGroundToModel: () => void;
}

export interface MaterialsApi {
  buildMaterialFor: (cfg: import('@/constants').MaterialProperties, tier: View3dTier) => THREE.Material;
  applyTierToModels: (tier: View3dTier) => void;
  /** tier-aware 归一化管线入口（材质分配/AABB 居中/base>rotation 层级）；入参可为 GLTF wrapper 或 Object3D。 */
  normalizeModel: (
    gltfResult: { scene?: THREE.Object3D } | THREE.Object3D,
    scale: { x: number; y: number; z: number },
    offsetToCenter: { x: boolean; y: boolean; z: boolean },
    name: string,
  ) => THREE.Group | undefined;
  rebuildGhost: () => void;
  disposeGhostMats: (obj: import('three').Object3D | null) => void;
  toggleAttitudeCompare: () => void;
  setCompareSource: () => void;
}

export interface PropellerApi {
  spinMainPropellers: (dt: number) => void;
}

export interface CurveAxisApi {
  rebuildCurveAxis: () => void;
  refreshPlayhead: () => void;
  onPlayheadDragStart: (e: MouseEvent) => void;
  toggleCurveAxis: () => void;
  onCurveAxisResizeStart: (e: MouseEvent) => void;
}

export interface View3dStoreCtx {
  state: Ref<View3dState>;
  els: View3dHostEls;
  quality: QualityApi;
  fx: FxApi;
  frame: FrameApi;
  camera: CameraApi;
  path: TrajectoryApi;
  mission: MissionApi;
  mainView: MainViewApi;
  dial: DialApi;
  lighting: LightingApi;
  sky: SkyApi;
  water: WaterApi;
  ground: GroundApi;
  envMap: EnvMapApi;
  drone: DroneApi;
  materials: MaterialsApi;
  propellers: PropellerApi;
  curveAxis: CurveAxisApi;
}
