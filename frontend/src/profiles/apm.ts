import { FormatProfile, registerProfile } from './profile';

const apm: FormatProfile = {
  format: 'apm',
  label: 'ArduPilot',
  attitudeSources: [
    { key: 'ahr2', label: 'AHR2', kind: 'euler', roll: { type: 'AHR2', field: 'Roll' }, pitch: { type: 'AHR2', field: 'Pitch' }, yaw: { type: 'AHR2', field: 'Yaw' } },
    { key: 'att', label: 'ATT 实际', kind: 'euler', roll: { type: 'ATT', field: 'Roll' }, pitch: { type: 'ATT', field: 'Pitch' }, yaw: { type: 'ATT', field: 'Yaw' } },
    { key: 'attDes', label: 'ATT 期望', kind: 'euler', roll: { type: 'ATT', field: 'DesRoll' }, pitch: { type: 'ATT', field: 'DesPitch' }, yaw: { type: 'ATT', field: 'DesYaw' }, isDesired: true },
  ],
  positionSources: [
    { key: 'pos', label: 'POS', kind: 'global', lat: { type: 'POS', field: 'Lat' }, lng: { type: 'POS', field: 'Lng' }, alt: { type: 'POS', field: 'Alt' }, relAlt: { type: 'POS', field: 'RelHomeAlt' } },
    { key: 'ahr2', label: 'AHR2', kind: 'global', lat: { type: 'AHR2', field: 'Lat' }, lng: { type: 'AHR2', field: 'Lng' }, alt: { type: 'AHR2', field: 'Alt' } },
    { key: 'gps', label: 'GPS', kind: 'global', lat: { type: 'GPS1', field: 'Lat' }, lng: { type: 'GPS1', field: 'Lng' }, alt: { type: 'GPS', field: 'Alt' } },
  ],
  defaultAttitude: 'ahr2',
  defaultPosition: 'pos',
  rc: { kind: 'pwmChannels', types: ['RCIN'], rollCh: 1, pitchCh: 2, throttleCh: 3, yawCh: 4 },
  motor: { type: 'RCOU', fieldPrefix: 'C', start: 1, count: 8 },
  volt: [{ type: 'BAT', field: 'Volt' }, { type: 'BAT1', field: 'Volt' }, { type: 'BAT2', field: 'Volt' }],
  speed: [{ type: 'GPS', field: 'Spd' }, { type: 'GPS', field: 'GSpd' }, { type: 'NTUN', field: 'Vel' }],
  velocity: { n: { type: 'XKF1', field: 'VN' }, e: { type: 'XKF1', field: 'VE' }, d: { type: 'XKF1', field: 'VD' } },
  verticalSpeed: [{ type: 'XKF1', field: 'VD' }],
  baroAlt: [{ type: 'BARO', field: 'Alt' }, { type: 'BARO', field: 'AltCm' }, { type: 'BARO', field: 'BAROAlt' }],
  geoInvalidEps: 1e-6,
  armedDetection: { kind: 'eventIds', ids: [10, 15] }, 
  servoFuncParamPattern: '^SERVO(\\d+)_FUNCTION$',
};

registerProfile(apm);
