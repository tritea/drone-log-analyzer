import type { FlightMode } from '@/types';

/** 已知飞行模式的语义背景色（半透明），未知模式按 MODE_TINT_PALETTE 循环分配。 */
export const NAMED_MODE_TINT: Record<string, string> = {
  LOITER: 'rgba(168,230,184,0.75)',
  ALT_HOLD: 'rgba(247,231,161,0.75)',
  RTL: 'rgba(169,199,245,0.75)',
  GUIDED: 'rgba(242,242,242,0.85)',
  LAND: 'rgba(248,182,217,0.75)',
  AUTO: 'rgba(201,179,230,0.75)',
  MANUAL: 'rgba(207,216,220,0.75)',
  ALTCTL: 'rgba(255,236,179,0.75)',
  POSCTL: 'rgba(200,230,201,0.75)',
  POSITION: 'rgba(178,235,224,0.75)',
  ACRO: 'rgba(178,235,242,0.75)',
  STABILIZED: 'rgba(179,229,252,0.75)',
  RATTITUDE: 'rgba(225,190,231,0.75)',
  OFFBOARD: 'rgba(248,187,208,0.75)',
  ORBIT: 'rgba(232,234,246,0.75)',
  AUTO_MISSION: 'rgba(187,222,251,0.75)',
  AUTO_LOITER: 'rgba(220,237,200,0.75)',
  AUTO_RTL: 'rgba(197,202,233,0.75)',
  AUTO_TAKEOFF: 'rgba(209,196,233,0.75)',
  AUTO_LAND: 'rgba(255,205,210,0.75)',
  AUTO_FOLLOW_TARGET: 'rgba(255,249,196,0.75)',
  AUTO_PRECLAND: 'rgba(255,204,188,0.75)',
  AUTO_VTOL_TAKEOFF: 'rgba(215,204,200,0.75)',
  AUTO_VTOL_LAND: 'rgba(252,228,237,0.75)',
};

/** 未知模式循环分配的背景色调色板。 */
export const MODE_TINT_PALETTE = [
  'rgba(59,130,246,0.18)',
  'rgba(16,185,129,0.18)',
  'rgba(245,158,11,0.18)',
  'rgba(168,85,247,0.18)',
  'rgba(236,72,153,0.18)',
  'rgba(20,184,166,0.18)',
  'rgba(249,115,22,0.18)',
  'rgba(99,102,241,0.18)',
];

const PX4_MODE_LABELS: Record<string, string> = {
  MANUAL: '手动', ALTCTL: '高度', POSCTL: '位置控制', POSITION: '位置',
  ACRO: '特技', STABILIZED: '自稳', RATTITUDE: '姿态特技', OFFBOARD: '离机',
  ORBIT: '环绕', AUTO_MISSION: '任务', AUTO_LOITER: '盘旋', AUTO_RTL: '返航',
  AUTO_TAKEOFF: '起飞', AUTO_LAND: '降落', AUTO_FOLLOW_TARGET: '跟随',
  AUTO_PRECLAND: '精准降落', AUTO_VTOL_TAKEOFF: 'VTOL起飞', AUTO_VTOL_LAND: 'VTOL降落',
};

const COPTER_MODE_LABELS: Record<string, string> = {
  STABILIZE: '自稳', ACRO: '特技', ALT_HOLD: '定高', AUTO: '自动',
  GUIDED: '引导', LOITER: 'GPS', RTL: '返航', CIRCLE: '绕圈',
  LAND: '降落', POSHOLD: '定点', DRIFT: '漂移', SPORT: '运动',
  FLIP: '翻滚', AUTOTUNE: '自动调参', BRAKE: '刹车', THROW: '抛飞',
  SMART_RTL: '智能返航', FOLLOW: '跟随',
};

const PLANE_MODE_LABELS: Record<string, string> = {
  MANUAL: '手动', CIRCLE: '盘旋', STABILIZE: '自稳', TRAINING: '教练',
  ACRO: '特技', FBWA: 'FBWA', FBWB: 'FBWB', CRUISE: '巡航',
  AUTOTUNE: '自动调参', AUTO: '自动', RTL: '返航', LOITER: '盘旋',
  TAKEOFF: '起飞', AVOID_ADSB: '避让', GUIDED: '引导', INITIALISING: '初始化',
  THERMAL: '热气流',
  QSTABILIZE: 'Q自稳', QHOVER: 'Q悬停', QLOITER: 'Q定点', QLAND: 'Q降落',
  QRTL: 'Q返航', QAUTOTUNE: 'Q调参', QACRO: 'Q特技',
};

const MODE_BADGE_COLOR: Record<string, string> = {
  STABILIZE: '#00C853', ALT_HOLD: '#FFB300', LOITER: '#00BFA5',
  RTL: '#2979FF', AUTO: '#AA00FF', GUIDED: '#00B0FF',
  LAND: '#FF4081', POSHOLD: '#76FF03', BRAKE: '#FF1744',
  DRIFT: '#7C4DFF', SPORT: '#FF6D00', FLIP: '#D500F9',
  ACRO: '#00ACC1', CIRCLE: '#26A69A', THROW: '#5C6BC0',
  MANUAL: '#78909C', FBWA: '#0288D1', FBWB: '#03A9F4', CRUISE: '#43A047',
  TRAINING: '#9E9E9E', TAKEOFF: '#7B1FA2', THERMAL: '#FF8F00',
  INITIALISING: '#BDBDBD', AVOID_ADSB: '#E53935', AVOID: '#E53935',
  QSTABILIZE: '#66BB6A', QHOVER: '#26C6DA', QLOITER: '#AB47BC',
  QLAND: '#EC407A', QRTL: '#42A5F5', QAUTOTUNE: '#FF7043', QACRO: '#8D6E63',
  ALTCTL: '#F4511E', POSCTL: '#7CB342', POSITION: '#26A69A', STABILIZED: '#00E676',
  RATTITUDE: '#AB47BC', OFFBOARD: '#EC407A', ORBIT: '#FF7043',
  AUTO_MISSION: '#3949AB', AUTO_LOITER: '#00897B', AUTO_RTL: '#1E88E5',
  AUTO_TAKEOFF: '#8E24AA', AUTO_LAND: '#D81B60', AUTO_FOLLOW_TARGET: '#F9A825',
  AUTO_PRECLAND: '#C2185B', AUTO_VTOL_TAKEOFF: '#5E35B1', AUTO_VTOL_LAND: '#6D4C41',
};

const has = (map: Record<string, string>, key: string): boolean => Object.prototype.hasOwnProperty.call(map, key);

/** 模式代号 → 中文标签（先查 PX4 通用词典，再按机型查多旋翼/固定翼）。 */
export function translateModeLabel(mode: string, isPlane: boolean): string {
  if (!mode) return mode;
  const key = mode.toUpperCase();
  if (has(PX4_MODE_LABELS, key)) return PX4_MODE_LABELS[key];
  const labels = isPlane ? PLANE_MODE_LABELS : COPTER_MODE_LABELS;
  return has(labels, key) ? labels[key] : String(mode);
}

/** 模式代号 → 徽章颜色（无匹配回退蓝）。 */
export function modeBadgeColor(mode: string): string {
  return MODE_BADGE_COLOR[mode] || '#3b82f6';
}

/** 在按 timeMs 升序的模式序列里二分定位 t 时刻所处的模式。 */
export function modeAtTime(modes: FlightMode[], t: number): FlightMode | null {
  if (!modes.length || typeof t !== 'number') return null;
  if (t < modes[0].timeMs) return null;
  let lo = 0;
  let hi = modes.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (modes[mid].timeMs <= t) lo = mid;
    else hi = mid - 1;
  }
  return modes[lo];
}
