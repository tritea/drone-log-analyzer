
export interface FieldSource {
  type: string;
  field: string;
}

export interface AttitudeSource {
  key: string;
  label: string;
  kind: 'euler' | 'quat';
  roll?: FieldSource;
  pitch?: FieldSource;
  yaw?: FieldSource;
  quat?: [FieldSource, FieldSource, FieldSource, FieldSource];
  isDesired?: boolean;
}

export interface PositionSource {
  key: string;
  label: string;
  kind: 'global' | 'local';
  lat?: FieldSource;
  lng?: FieldSource;
  /** 绝对海拔高度（MSL，米）——地形渲染基准，须与 DEM 同基准 */
  alt?: FieldSource;
  /** 相对 home 点高度（米）——无地形时近地面显示与 HUD 口径 */
  relAlt?: FieldSource;
  px?: FieldSource;
  py?: FieldSource;
  pz?: FieldSource;
}

export interface RcSource {
  kind: 'pwmChannels' | 'normalized';
  types: string[];
  chFieldPrefix?: string;
  chFieldSuffix?: string;
  rollCh?: number;
  pitchCh?: number;
  throttleCh?: number;
  yawCh?: number;
  roll?: FieldSource;
  pitch?: FieldSource;
  throttle?: FieldSource;
  yaw?: FieldSource;
}

export interface MotorSource {
  type: string;
  fieldPrefix?: string;
  start?: number;
  count?: number;
  fields?: string[];
}

export type ArmedDetection =
  | { kind: 'eventIds'; ids: number[] }
  | { kind: 'field'; source: FieldSource; armedValue: number };

export interface FormatProfile {
  format: string; 
  label: string;
  attitudeSources: AttitudeSource[];
  positionSources: PositionSource[];
  defaultAttitude: string;
  defaultPosition: string;
  rc?: RcSource;
  motor?: MotorSource;
  volt?: FieldSource[];
  voltCells?: { type: string; fields: string[]; invalid?: number; scale?: number };
  speed?: FieldSource[];
  velocity?: { n?: FieldSource; e?: FieldSource; d?: FieldSource };
  verticalSpeed?: FieldSource[];
  baroAlt?: FieldSource[];
  geoInvalidEps?: number; 
  armedDetection?: ArmedDetection;
  homePosition?: { lat: FieldSource; lng: FieldSource; alt: FieldSource };
  servoFuncParamPattern?: string;
}

const profiles = new Map<string, FormatProfile>();

export function registerProfile(p: FormatProfile): void {
  profiles.set(p.format, p);
}

export function getProfile(format: string): FormatProfile | undefined {
  return profiles.get(format);
}

export function listProfiles(): FormatProfile[] {
  return [...profiles.values()];
}
