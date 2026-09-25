import { FormatProfile, registerProfile } from './profile';

const motorFields = Array.from({ length: 8 }, (_, i) => `Servo${i + 1}Raw`);

// BATTERY_STATUS 各 cell 电压字段：Voltages[0..9] + VoltagesExt[0..3]（均 mV，UINT16_MAX=65535 表无效）。
// currentVoltage 按 QGC 公式顺序累加、遇无效即停，×0.001(mV→V) 得总压（单位 V）。
const voltCellFields = [
  ...Array.from({ length: 10 }, (_, i) => `Voltages[${i}]`),
  ...Array.from({ length: 4 }, (_, i) => `VoltagesExt[${i}]`),
];

const tlog: FormatProfile = {
  format: 'tlog',
  label: 'MAVLink',
  attitudeSources: [
    {
      key: 'attitude',
      label: 'ATTITUDE',
      kind: 'euler',
      roll: { type: 'ATTITUDE', field: 'Roll' },
      pitch: { type: 'ATTITUDE', field: 'Pitch' },
      yaw: { type: 'ATTITUDE', field: 'Yaw' },
    },
    {
      key: 'ahrs2',
      label: 'AHRS2',
      kind: 'euler',
      roll: { type: 'AHRS2', field: 'Roll' },
      pitch: { type: 'AHRS2', field: 'Pitch' },
      yaw: { type: 'AHRS2', field: 'Yaw' },
    },
    {
      key: 'simstate',
      label: 'SIMSTATE',
      kind: 'euler',
      roll: { type: 'SIMSTATE', field: 'Roll' },
      pitch: { type: 'SIMSTATE', field: 'Pitch' },
      yaw: { type: 'SIMSTATE', field: 'Yaw' },
    },
  ],
  positionSources: [
    {
      key: 'global',
      label: 'GLOBAL_POSITION_INT',
      kind: 'global',
      lat: { type: 'GLOBAL_POSITION_INT', field: 'Lat' },
      lng: { type: 'GLOBAL_POSITION_INT', field: 'Lon' },
      alt: { type: 'GLOBAL_POSITION_INT', field: 'Alt' }, // 绝对海拔 AMSL（mm→m）
      relAlt: { type: 'GLOBAL_POSITION_INT', field: 'RelativeAlt' }, // 起飞点相对高（mm→m）
    },
    {
      key: 'gps',
      label: 'GPS_RAW_INT',
      kind: 'global',
      lat: { type: 'GPS_RAW_INT', field: 'Lat' },
      lng: { type: 'GPS_RAW_INT', field: 'Lon' },
      alt: { type: 'GPS_RAW_INT', field: 'Alt' }, // GPS 海拔 AMSL（mm→m）
    },
  ],
  defaultAttitude: 'attitude',
  defaultPosition: 'global',
  // RC_CHANNELS：Chan1Raw..Chan18Raw（PWM μs）。rollCh/pitchCh/throttleCh/yawCh 为 1 起的通道号。
  rc: {
    kind: 'pwmChannels',
    types: ['RC_CHANNELS'],
    chFieldPrefix: 'Chan',
    chFieldSuffix: 'Raw',
    rollCh: 1,
    pitchCh: 2,
    throttleCh: 3,
    yawCh: 4,
  },
  // SERVO_OUTPUT_RAW：MotorSource 无 suffix 字段，用显式 fields 列表（Servo1Raw..Servo8Raw）。
  motor: { type: 'SERVO_OUTPUT_RAW', fields: motorFields },
  // 电压：BATTERY_STATUS 各 cell（Voltages[0..9]+VoltagesExt[0..3]，mV）按 QGC 公式顺序累加、
  // 遇无效即停，×0.001 → 总压（V）。不取 SYS_STATUS.VoltageBattery（其为 mV 原值，单位不符）。
  voltCells: { type: 'BATTERY_STATUS', fields: voltCellFields, invalid: 65535, scale: 0.001 },
  speed: [{ type: 'VFR_HUD', field: 'Groundspeed' }],
  velocity: {
    n: { type: 'GLOBAL_POSITION_INT', field: 'Vx' }, // NED cm/s（v1：原值）
    e: { type: 'GLOBAL_POSITION_INT', field: 'Vy' },
    d: { type: 'GLOBAL_POSITION_INT', field: 'Vz' },
  },
  verticalSpeed: [{ type: 'VFR_HUD', field: 'Climb' }],
  geoInvalidEps: 1e-6,
  // armed 检测暂缺：HEARTBEAT.BaseMode 的 armed 位是位掩码，profile 的 field+armedValue 走相等判定不便表达。
};

registerProfile(tlog);
