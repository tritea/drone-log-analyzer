import { usePlaybackStore } from '@/modules/playback';

/* RC 摇杆 HUD / 电机条的纯展示换算（无渲染状态，供 RcHud 与飞行指标瓦片共用）。 */

/** RC 数据是否可用（任一摇杆通道有值即视为有效）。 */
export function rcAvailable(): boolean {
  const roll = usePlaybackStore().current.rcRoll;
  return roll !== null && roll !== undefined;
}

/** PWM(1000..2000) → 12%..88%（摇杆旋钮在 pad 内的活动区间）。 */
export function rcNorm(pwm: number | null): number | null {
  if (pwm === null || pwm === undefined || !isFinite(pwm)) return null;
  let n = (Number(pwm) - 1000) / 1000; // 1000->0, 1500->0.5, 2000->1
  if (n < 0) n = 0;
  else if (n > 1) n = 1;
  return 12 + n * 76;
}

/** 横向摇杆位置（invert 时镜像）。 */
export function rcKnobStyleX(pwm: number | null, invert: boolean): { left: string } {
  const n = rcNorm(pwm);
  if (n === null) return { left: '50%' };
  return { left: (invert ? 100 - n : n) + '%' };
}

/** 纵向摇杆位置（上=大 PWM；invert 时镜像）。 */
export function rcKnobStyleY(pwm: number | null, invert: boolean): { top: string } {
  const n = rcNorm(pwm);
  if (n === null) return { top: '50%' };
  return { top: (invert ? n : 100 - n) + '%' };
}

/** PWM 展示值（缺失显示 '-'）。 */
export function formatPwm(pwm: number | null): string | number {
  if (pwm === null || pwm === undefined || !isFinite(pwm)) return '-';
  return Math.round(Number(pwm));
}

/** PWM → 电机推力条百分比（0..100）。 */
export function motorBarPct(pwm: number | null): number {
  if (pwm === null || pwm === undefined || !isFinite(pwm)) return 0;
  let n = (Number(pwm) - 1000) / 1000; // 1000->0, 2000->1
  if (n < 0) n = 0;
  else if (n > 1) n = 1;
  return Math.round(n * 100);
}

/** 电机是否满输出（≥2000 视为饱和）。 */
export function motorSaturated(pwm: number | null): boolean {
  if (pwm === null || pwm === undefined || !isFinite(pwm)) return false;
  return Number(pwm) >= 2000;
}
