import type * as THREE from 'three';
import type * as L from 'leaflet';
import type * as Cesium from 'cesium';
import type { Map as MLMap, Marker as MLMarker } from 'maplibre-gl';
import type { LineChart } from '@/modules/analysis';
import type { ThreeMaterialTier } from '@/types';
import type { DroneLayerHandle, CustomModelSpec } from '@/modules/map-3d/renderer/drone-layer';

export type AttitudeLive =
  | { kind: 'euler'; roll: { type: string; field: string }; pitch: { type: string; field: string }; yaw: { type: string; field: string } }
  | { kind: 'quat'; q: [{ type: string; field: string }, { type: string; field: string }, { type: string; field: string }, { type: string; field: string }] };

export interface ThreeView {
  mainEl: HTMLElement;
  attitudeEl: HTMLElement;
  scene: THREE.Scene;
  attitudeScene: THREE.Scene;
  renderer?: THREE.WebGLRenderer;
  attitudeRenderer?: THREE.WebGLRenderer;
  grid?: THREE.Object3D;
  perspectiveCamera?: THREE.PerspectiveCamera;
  attitudeCamera?: THREE.PerspectiveCamera;
  activeCamera?: THREE.Camera | null;
  freeYaw: number;
  freePitch: number;
  freeDistance: number;
  lockYaw: number;
  lockPitch: number;
  lockDistance: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
  pathKey: string;
  pathLine?: THREE.Line;
  pathGeometry?: THREE.BufferGeometry;
  droneBaseScale: number;
  drone?: THREE.Object3D;
  attitudeDrone?: THREE.Object3D;
  ghostDrone?: THREE.Object3D | null;
  attitudeCurves?: Record<string, AttitudeLive> | null;
  windCurves?: { n: { type: string; field: string }; e: { type: string; field: string }; d: { type: string; field: string } | null } | null;
  windArrow?: THREE.Object3D | null;
  attitudeReference?: THREE.Object3D | null;
  attitudeAxes?: THREE.Object3D | null;
  attitudeCamDist?: number;
  droneModelName?: string;
  mainPropellers?: Array<{ mesh: THREE.Object3D; dir: number; func: number }>;
  attitudePropellers?: Array<{ mesh: THREE.Object3D; dir: number; func: number }>;
  servoFuncMap?: Record<number, number> | null;
  servoFuncMapSet?: boolean;
  attitudeLight?: THREE.DirectionalLight;
  mainAmbient?: THREE.AmbientLight;
  attitudeAmbient?: THREE.AmbientLight;
  mainKeyLight?: THREE.DirectionalLight;
  mainHemi?: THREE.HemisphereLight;
  mainFill?: THREE.DirectionalLight;
  mainRim?: THREE.DirectionalLight;
  attitudeHemi?: THREE.HemisphereLight;
  fps: { x: number; y: number; z: number; speed: number };
  keys: { forward: number; back: number; left: number; right: number; up: number; down: number };
  raf?: number;
  missionLineGroup?: THREE.Group | null;
  missionMarkerGroup?: THREE.Group | null;
  missionActiveKey?: number;
  mainComposer?: any;
  mainRenderPass?: any;
  mainSsaoPass?: any;
  mainFxaaPass?: any;
  mainOutputPass?: any;
  attitudeComposer?: any;
  attitudeRenderPass?: any;
  attitudeFxaaPass?: any;
  attitudeOutputPass?: any;
  sky?: any;
  skyEnvRt?: any;
  skyNoiseTex?: THREE.DataTexture;
  skyBackgroundTex?: any;
  ground?: any;
  droneHalfHeight?: number;
  water?: any;
  waterSkyTex?: any;
  envRt?: any;
  attitudeEnvRt?: any;
  gpuTier?: ThreeMaterialTier;
  materialTier?: ThreeMaterialTier;
}

export interface MapRuntime {
  map: L.Map;
  tileLayer: L.TileLayer;
  traveledPoly: L.Polyline;   
  droneMarker: L.Marker;      
  waypointLayer: L.LayerGroup; 
  wpLine: L.Polyline;         
  raf: number;                
  providerId: string;         
  samplesKey: string;         
}

export interface MapLibreRuntime {
  map: MLMap;
  drone: DroneLayerHandle | null;     
  droneLayerId: string;               
  droneModelName: string;             
  waypointMarkers: MLMarker[];        
  trackCoordsFull: number[][];
  lastTimeMs: number;                 
  lastElev: number;                   
  lastTeleKey: string;                
  lastMissionKey: number;             
  providerId: string;                 
  terrainOn: boolean;                 
  lockActive: boolean;                
  lockBearing: number;                
  lockPitch: number;                  
  lockCamDist: number;                
  lockZoomAnchor: { z0: number; L0: number } | null; 
  lockAppliedKey: string;             
  lockHandlers: MapLibreLockHandlers | null; 
  gizmoActive: boolean;                
  gizmoTarget: string | null;          
  gizmoHandlers: MapLibreLockHandlers | null; 
}

export interface MapLibreLockHandlers {
  canvas: HTMLCanvasElement
  onDown: (e: PointerEvent) => void
  onMove: (e: PointerEvent) => void
  onUp: (e: PointerEvent) => void
  onWheel: (e: WheelEvent) => void
  onCtx: (e: Event) => void
}

// 地球右键「绕点击点旋转」交互（非锁定模式）：右键按下射线 pick 地表点为锚，拖动改 heading/pitch 绕锚转。
export interface EarthOrbitHandlers {
  canvas: HTMLCanvasElement;
  onDown: (e: PointerEvent) => void;
  onMove: (e: PointerEvent) => void;
  onUp: (e: PointerEvent) => void;
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
  lockAppliedKey: string;
  lockHandlers: MapLibreLockHandlers | null;
  orbitHandlers: EarthOrbitHandlers | null;
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
}

export const runtime: {
  mainChart: LineChart | null; 
  threeView: ThreeView | null;
  threeCurveChart: LineChart | null; 
  chartInteractionsBound: boolean;
  mapView: MapRuntime | null;
  mapLibreView: MapLibreRuntime | null;
  earthView: EarthRuntime | null;
} = {
  mainChart: null,
  threeView: null,
  threeCurveChart: null,
  chartInteractionsBound: false,
  mapView: null,
  mapLibreView: null,
  earthView: null,
};
