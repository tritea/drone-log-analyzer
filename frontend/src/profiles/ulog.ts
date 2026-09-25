import { FormatProfile, registerProfile } from './profile';

const motorFields = Array.from({ length: 16 }, (_, i) => `output[${i}]`);

const ulog: FormatProfile = {
  format: 'ulog',
  label: 'PX4',
  attitudeSources: [
    {
      key: 'vehicle_attitude', label: 'vehicle_attitude', kind: 'quat',
      quat: [
        { type: 'vehicle_attitude', field: 'q[0]' },
        { type: 'vehicle_attitude', field: 'q[1]' },
        { type: 'vehicle_attitude', field: 'q[2]' },
        { type: 'vehicle_attitude', field: 'q[3]' },
      ],
    },
  ],
  positionSources: [
    { key: 'global', label: 'Global', kind: 'global', lat: { type: 'vehicle_global_position', field: 'lat' }, lng: { type: 'vehicle_global_position', field: 'lon' }, alt: { type: 'vehicle_global_position', field: 'alt' } },
    { key: 'gps', label: 'GPS', kind: 'global', lat: { type: 'sensor_gps', field: 'latitude_deg' }, lng: { type: 'sensor_gps', field: 'longitude_deg' }, alt: { type: 'sensor_gps', field: 'altitude_msl_m' } },
    { key: 'local', label: 'Local NED', kind: 'local', px: { type: 'vehicle_local_position', field: 'x' }, py: { type: 'vehicle_local_position', field: 'y' }, pz: { type: 'vehicle_local_position', field: 'z' } },
  ],
  defaultAttitude: 'vehicle_attitude',
  defaultPosition: 'global',
  // RC：input_rc.values[0..17]（PWM µs，Mode2：0=横滚 1=俯仰 2=油门 3=偏航）。
  rc: {
    kind: 'pwmChannels', types: ['input_rc'],
    chFieldPrefix: 'values[', chFieldSuffix: ']',
    rollCh: 0, pitchCh: 1, throttleCh: 2, yawCh: 3,
  },
  motor: { type: 'actuator_outputs', fields: motorFields },
  homePosition: { lat: { type: 'home_position', field: 'lat' }, lng: { type: 'home_position', field: 'lon' }, alt: { type: 'home_position', field: 'alt' } },
  // 电压：battery_status.voltage_cell_v[0..13]（float32，原生单位即 V）按 QGC 公式累加成总压，遇无效(0)即停。
  voltCells: { type: 'battery_status', fields: Array.from({ length: 14 }, (_, i) => 'voltage_cell_v[' + i + ']'), invalid: 0, scale: 1 },
  speed: [], // PX4 无标量地速：由 velocity.vx/vy 合成（logHorizontalSpeedAt 回退 velN/velE）
  velocity: { n: { type: 'vehicle_local_position', field: 'vx' }, e: { type: 'vehicle_local_position', field: 'vy' }, d: { type: 'vehicle_local_position', field: 'vz' } },
  verticalSpeed: [{ type: 'vehicle_local_position', field: 'vz' }],
  baroAlt: [{ type: 'vehicle_air_data', field: 'baro_alt_meter' }],
  geoInvalidEps: 1e-6,
  armedDetection: { kind: 'field', source: { type: 'vehicle_status', field: 'armed' }, armedValue: 1 },
};

registerProfile(ulog);
