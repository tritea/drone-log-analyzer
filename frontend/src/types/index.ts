
import type { ToRefs } from 'vue'

export interface MessageType {
  name: string;
  count?: number;
  fields: string[];
}

export interface Curve {
  id: string;
  type: string;
  field: string;
  label: string;
  min: number;
  max: number;
  count: number;
  unit: string;
  valueLabels: Record<string, string>;
  visible: boolean;
  color: string;
  scale: number;
  offset: number;
  scaleInput: string;
  offsetInput: string;
  fieldName: string;
  fieldGroupScale: number;
  fieldGroupOffset: number;
  fieldGroupScaleInput: string;
  fieldGroupOffsetInput: string;
  buffer?: Float32Array;
  baseTimeMs?: number;
  bufferCount?: number;
}

export interface FieldCurve {
  type: string;
  field: string;
  visible?: boolean;
  color?: string;
  scale?: number;
  offset?: number;
  scaleInput?: string;
  offsetInput?: string;
}

export interface FieldEntry {
  name: string;
  curves: FieldCurve[];
  scale: number;
  offset: number;
  scaleInput: string;
  offsetInput: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FieldGroupParams {
  scale: number;
  offset: number;
  scaleInput: string;
  offsetInput: string;
}

export interface FieldGroupItem {
  name: string;
  curves: Curve[];
  params: FieldGroupParams;
}

export interface FlightMode {
  timeMs: number;
  mode: string;
  lineno?: number;
}

export interface TelemetrySample {
  t: number;
  x: number;
  y: number;
  z: number;
  north: number;
  east: number;
  down: number;
  roll: number;
  pitch: number;
  yaw: number;
  speed: number | null;
  verticalSpeed: number | null;
  altitude: number | null;
  baroAlt: number | null;
  rcRoll: number | null;
  rcPitch: number | null;
  rcThrottle: number | null;
  rcYaw: number | null;
}

export interface ThreeCurrent {
  speed: number | null;
  verticalSpeed: number | null;
  altitude: number | null;
  baroAlt: number | null;
  rcRoll: number | null;
  rcPitch: number | null;
  rcThrottle: number | null;
  rcYaw: number | null;
  x: number | null;
  y: number | null;
  z: number | null;
  north: number | null;
  east: number | null;
  down: number | null;
}

export interface NamedCurve {
  label: string;
  type: string;
  field: string;
}

export interface Parameter {
  name: string;
  value: number | string;
}

export interface ParametersState {
  items: Parameter[];
  filter: string;
  open: boolean;
  loading: boolean;
}

export interface LogMessage {
  lineno: number;
  timeMs?: number;
  message: string;
}

export interface LogError {
  lineno?: number;
  timeMs: number;
  subsys: number | string;
  subsysName?: string;
  eCode: number | string;
  description?: string;
}

export interface LogEvent {
  lineno?: number;
  timeMs: number;
  id: number;
  name?: string;
}

export interface MissionCommand {
  timeMs: number;
  sequence: number;
  command: number;
  commandName?: string;
  param1?: number;
  param2?: number;
  param3?: number;
  param4?: number;
  frame: number;
  frameName?: string;
  latitude: number;
  longitude: number;
  altitude: number;
}

export interface CommandsState {
  items: MissionCommand[];
  loaded: boolean;
  filter: string;
  open: boolean;
  loading: boolean;
}

export interface MAVLinkCommand {
  timeMs: number;
  targetSystem: number;
  targetComponent: number;
  sourceSystem: number;
  sourceComponent: number;
  frame: number;
  frameName?: string;
  command: number;
  commandName?: string;
  param1?: number;
  param2?: number;
  param3?: number;
  param4?: number;
  latitude: number;
  longitude: number;
  altitude: number;
  result: number;
  resultName?: string;
  wasCommandLong: boolean;
}

export interface MAVLinkCommandsState {
  items: MAVLinkCommand[];
  loaded: boolean;
  filter: string;
  open: boolean;
  loading: boolean;
}

export interface ToastState {
  msg: string;
  type: string;
}

export interface ThreeTelemetryMeta {
  position?: string;
  attitude?: string;
  speed?: string;
  verticalSpeed?: string;
  altitude?: string;
  baroAlt?: string;
  rc?: string;
  volt?: string;
  motor?: string;
  maxRadius?: number;
  scale?: number;
  rcKind?: 'pwm' | 'normalized';
  geoOrigin?: { lat0: number; lng0: number; alt0: number; cosLat: number } | null;
  posSource?: {
    useGeo: boolean; geoExact: boolean;
    lat: { type: string; field: string; key: string } | null;
    lng: { type: string; field: string; key: string } | null;
    alt: { type: string; field: string; key: string } | null;
    px: { type: string; field: string; key: string } | null;
    py: { type: string; field: string; key: string } | null;
    pz: { type: string; field: string; key: string } | null;
  } | null;
}

export interface ApiError {
  error: string;
}

export interface TimeWindow {
  min: number;
  max: number;
  span: number;
}

export interface MissionVersion {
  startTime: number;
  points: MissionCommand[];
}

export interface RcInvert {
  roll: boolean;
  pitch: boolean;
}

export interface ThreeViewState {
  mode: 'ortho' | 'free';
  cameraMode: 'normal' | 'fps' | 'lock';
  attitudeSource: string;
  positionSource: string;
  cameraSeeded: boolean;
  lockSeeded: boolean;
  compareAttitude: boolean;
  compareSource: string;
  ssao: boolean;
  fullTrajectory: boolean;
}

export interface ThreePlaybackState {
  timeMs: number;
  playing: boolean;
  rate: number;
  lastFrameTime: number;
  timeWindow: TimeWindow | null;
  fpsLastTime: number;
  curveAxis: boolean;
  curveHeight: number;
}

export interface ThreeTelemetryState {
  loaded: boolean;
  samples: TelemetrySample[];
  meta: ThreeTelemetryMeta;
  loading: boolean;
  error: string;
}

export interface ThreeMissionState {
  versions: MissionVersion[] | null;
}

export interface ThreeRcState {
  hud: boolean;
  readout: boolean;
  layout: 'side' | 'center';
  invert: RcInvert;
}

export interface ThreeCurvesState {
  volt: NamedCurve[];
  motor: NamedCurve[];
}

export type MetricRender = 'number' | 'bar';

export type MetricBarOrient = 'vertical' | 'horizontal';

export type MetricKind = 'field' | 'group';

export interface MetricFieldSettings {
  min: number;
  max: number;
  minInput: string;
  maxInput: string;
  unit: string;
  origUnit: string;
  unitMul: number;
}

export interface MetricItem {
  id: string;
  name: string;
  kind: MetricKind;
  fields: string[];
  render: MetricRender;
  min: number;
  max: number;
  minInput: string;
  maxInput: string;
  orient: MetricBarOrient;
  builtin: '' | 'mode' | 'motor';
  unit: string;
  origUnit: string;
  unitMul: number;
  fieldSettings?: Record<string, MetricFieldSettings>;
}

export interface FlightMetricsConfig {
  items: MetricItem[];
  version: number;
}

export type ThreeAaMethod = 'off' | 'msaa' | 'fxaa';

export interface ThreeRenderSide {
  aa: ThreeAaMethod;
  resolution: number;
}

export interface ThreeState {
  view: ThreeViewState;
  playback: ThreePlaybackState;
  telemetry: ThreeTelemetryState;
  mission: ThreeMissionState;
  rc: ThreeRcState;
  curves: ThreeCurvesState;
  current: ThreeCurrent;
  lighting: ThreeLightingState;
  sky: ThreeSkyState;
  droneScale: number;
  model: 'glb' | 'lowpoly';
  attitudeModel: 'glb' | 'lowpoly';
  ground: { show: boolean };
  water: { enabled: boolean; wave: number };
  render: { quality: 'auto' | 'high' | 'medium' | 'low'; main: ThreeRenderSide; attitude: ThreeRenderSide; fps: number };
  debug: { posPanel: boolean };
}

export type ThreeMaterialTier = 'high' | 'medium' | 'low';

export interface ThreeLightingState {
  enabled: boolean;
  env: number;
  ambient: number;
  key: number;
}

export interface ThreeSkyState {
  enabled: boolean;
  cloud: number;
}

export interface PickerCurveSettings {
  visible: boolean;
  color: string;
  scale: number;
  offset: number;
  scaleInput: string;
  offsetInput: string;
}

export interface SimplePickerState {
  open: boolean;
  filter: string;
  selected: Record<string, boolean>;
  curveSettings: Record<string, PickerCurveSettings>;
  groupName: string;
  originalName: string;
  expanded: Record<string, boolean>;
}

export interface FieldEditState {
  open: boolean;
  kind: string;
  originalName: string;
  name: string;
  curves: FieldCurve[];
  type: string;
  field: string;
  filter: string;
}

export interface FieldListState {
  items: FieldEntry[];
  path: string;
  loading: boolean;
  settingsSaveTimer: ReturnType<typeof setTimeout> | null;
  exportOpen: boolean;
  exportSelected: Record<string, boolean>;
  edit: FieldEditState;
  deleteTarget: FieldEntry | null;
  deleteFromEditor: boolean;
}


export interface LogSummary {
  filename?: string;
  fileName?: string;
  vehicleType?: string;
  firmwareVersion?: string;
  durationSecs?: number;
  frame?: string | number;
  airframe?: string;
  [key: string]: unknown;
}

export interface LogState {
  loading: boolean;
  loadStage: string; 
  loaded: boolean;
  summary: LogSummary | null;
  fileName: string;
  messageTypes: MessageType[];
  messages: LogMessage[];
  errors: LogError[];
  events: LogEvent[];
  flightModes: FlightMode[];
  messageFilter: string;
}

export interface ActiveFieldState {
  name: string;
  selectedSimpleName: string;
  expanded: Record<string, boolean>;
  groupParams: Record<string, FieldGroupParams>;
}

export interface ChartState {
  activeCurves: Curve[];
  tooltip: boolean;
  sampling: boolean;
  showErrors: boolean;
  showEvents: boolean;
  showMessages: boolean;
  lineWidth: number;
  activeField: ActiveFieldState;
}

export interface UiState {
  mainView: 'chart' | 'three';
  simpleFieldFilter: string;
  dragOver: boolean;
  dragDepth: number;
  shiftZoomActive: boolean;
  shiftZoomActivatedByKey: boolean;
  toast: ToastState | null;
  recordOpen: boolean;
  recordTab: RecordTab;
}

export type RecordTab = 'messages' | 'commands' | 'mavlink' | 'parameters';

export interface CurveSaveState {
  loading: boolean;
  restoring: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null;
}

export interface MapProvider {
  id: string;
  name: string;
  attribution?: string;
}

export interface MapState {
  active: boolean;
  renderer: '2d' | '3d' | 'earth';
  terrainOn: boolean;
  followDrone: boolean;
  lockView: boolean;
  droneModel: 'glb' | 'lowpoly';
  droneScale: number;
  droneShaded: boolean;
  mapFps: number;
  providerId: string;
  providers: MapProvider[];
  showPath: boolean;
  showWaypoints: boolean;
  showRoute: boolean;
  loaded: boolean;
  loading: boolean;
  error: string;
  tileError: boolean;
  controlBarCollapsed: boolean;
}

export interface MapCacheProvider {
  id: string;
  name: string;
  sizeBytes: number;
  tileCount: number;
}

export interface MapCacheState {
  dir: string;
  capBytes: number;
  totalBytes: number;
  providers: MapCacheProvider[];
  loading: boolean;
  open: boolean;
}
