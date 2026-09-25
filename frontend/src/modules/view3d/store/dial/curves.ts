import { runtime } from '@/modules/shared/runtime';
import { useCurveManagerStore } from '@/modules/curves';
import { usePlaybackStore, quatToEulerDeg } from '@/modules/playback';
import type { AttitudeSourceCurves, WindCurveRefs } from '../types';

/* 姿态源曲线预载 + 实时取值（姿态仪独立视图，不依赖主场景存在）。 */

// 预载所有姿态源(如 ahr2/att/attDes)的 roll/pitch/yaw 或四元数曲线解析结果 → dial.curves。
// 之后主/虚影无人机都实时按源取值(attitudeAt)，切换源零开销、不重载遥测/不重置播放。
// 走 CurveManager 全局缓存。顺带解析风向量曲线（DCM.VWN/VWE/VWD 优先，缺则 XKF2 退化水平风）。
export async function preloadDialCurves(): Promise<void> {
  const dv = runtime.view3dDial;
  if (!dv) return;
  const pb = usePlaybackStore();
  const presets = pb.threeAttitudePresets();
  const cm = useCurveManagerStore();
  const out: Record<string, AttitudeSourceCurves> = {};
  const fetches: Promise<unknown>[] = [];
  for (const key in presets) {
    const p = presets[key];
    if (p.kind === 'quat' && p.quat) {
      // PX4：四元数 q[0..3]，存 quat；attitudeAt 实时 quatToEulerDeg 折成欧拉。
      const qs = [
        pb.findTelemetryCurve([p.quat[0].type], [p.quat[0].field]),
        pb.findTelemetryCurve([p.quat[1].type], [p.quat[1].field]),
        pb.findTelemetryCurve([p.quat[2].type], [p.quat[2].field]),
        pb.findTelemetryCurve([p.quat[3].type], [p.quat[3].field]),
      ];
      if (qs[0] && qs[1] && qs[2] && qs[3]) {
        out[key] = { kind: 'quat', q: [qs[0], qs[1], qs[2], qs[3]] };
        for (let qi = 0; qi < 4; qi++) fetches.push(cm.get(qs[qi].type, qs[qi].field).catch(function (): null { return null; }));
      }
    } else if (p.roll && p.pitch && p.yaw) {
      // APM：欧拉角 roll/pitch/yaw，角度插值。
      const roll = pb.findTelemetryCurve([p.roll.type], [p.roll.field]);
      const pitch = pb.findTelemetryCurve([p.pitch.type], [p.pitch.field]);
      const yaw = pb.findTelemetryCurve([p.yaw.type], [p.yaw.field]);
      if (roll && pitch && yaw) {
        out[key] = { kind: 'euler', roll: roll, pitch: pitch, yaw: yaw };
        fetches.push(cm.get(roll.type, roll.field).catch(function (): null { return null; }));
        fetches.push(cm.get(pitch.type, pitch.field).catch(function (): null { return null; }));
        fetches.push(cm.get(yaw.type, yaw.field).catch(function (): null { return null; }));
      }
    }
  }
  await Promise.all(fetches);
  dv.curves = out;
  // 风数据源：DCM.VWN/VWE/VWD 优先(含 VWD → 3D 风向量)；缺则 XKF2.VWN/VWE(无 VWD → 退化为水平方向)。N/E 同源。
  let wn = pb.findTelemetryCurve(['DCM'], ['VWN']);
  let we = pb.findTelemetryCurve(['DCM'], ['VWE']);
  let wd = pb.findTelemetryCurve(['DCM'], ['VWD']);
  if (!wn || !we) { wn = pb.findTelemetryCurve(['XKF2'], ['VWN']); we = pb.findTelemetryCurve(['XKF2'], ['VWE']); wd = null; }
  if (wn && we) {
    const wFetches: Promise<unknown>[] = [
      cm.get(wn.type, wn.field).catch(function (): null { return null; }),
      cm.get(we.type, we.field).catch(function (): null { return null; }),
    ];
    if (wd) wFetches.push(cm.get(wd.type, wd.field).catch(function (): null { return null; }));
    await Promise.all(wFetches);
    const windRefs: WindCurveRefs = { n: wn, e: we, d: wd };
    if (!dv.wind) dv.wind = { curves: null, arrow: null };
    dv.wind.curves = windRefs;
  } else if (dv.wind) {
    dv.wind.curves = null;
  }
}

// 实时取某姿态源在 t 的欧拉角(度)：quat 源现场折算，euler 源角度插值；缺曲线返回 null。
export function attitudeAt(source: string, t: number): { roll: number; pitch: number; yaw: number } | null {
  const dv = runtime.view3dDial;
  const c = dv && dv.curves ? dv.curves[source] : null;
  if (!c) return null;
  const cm = useCurveManagerStore();
  if (c.kind === 'quat') {
    const w = cm.getValueAt(c.q[0].type, c.q[0].field, t, 0);
    const x = cm.getValueAt(c.q[1].type, c.q[1].field, t, 0);
    const y = cm.getValueAt(c.q[2].type, c.q[2].field, t, 0);
    const z = cm.getValueAt(c.q[3].type, c.q[3].field, t, 0);
    return quatToEulerDeg(w || 0, x || 0, y || 0, z || 0);
  }
  return {
    roll: cm.getAngleAt(c.roll.type, c.roll.field, t, 0) || 0,
    pitch: cm.getAngleAt(c.pitch.type, c.pitch.field, t, 0) || 0,
    yaw: cm.getAngleAt(c.yaw.type, c.yaw.field, t, 0) || 0,
  };
}
