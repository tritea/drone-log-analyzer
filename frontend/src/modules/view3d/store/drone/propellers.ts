import type * as THREE from 'three';
import { runtime } from '@/modules/shared/runtime';
import { usePlaybackStore } from '@/modules/playback';
import { useParametersStore } from '@/modules/parameters';
import { useCurveManagerStore } from '@/modules/curves';
import { spinPropellersByPwm } from '@/modules/shared/utils/drone-model';
import type { NamedCurve } from '@/types';
import type { PropellerApi, View3dStoreCtx } from '../types';

export function createPropellers(_ctx: View3dStoreCtx): PropellerApi {

  // SERVOx_FUNCTION → RCOU 通道映射：参数表就绪后建一次（挂主视图 runtime）。
  // 参数缺失时保持 null，桨叶按 RCOU 原序取 PWM。
  function ensureServoMap(): Record<number, number> | null {
    const tv = runtime.view3dMain;
    if (!tv) return null;
    if (!tv.servoMap) tv.servoMap = { map: null, ready: false };
    if (!tv.servoMap.ready) {
      const items = useParametersStore().parameters.items;
      if (items && items.length) {
        tv.servoMap.map = usePlaybackStore().servoFuncToChannelMap();
        tv.servoMap.ready = true;
      }
    }
    return tv.servoMap.map;
  }

  // 单桨 PWM 解析：优先按 SERVO 功能号映射到对应 RCOU 通道曲线，缺映射按电机序。
  function resolvePropPwm(p: { func: number }, i: number, motors: NamedCurve[], funcMap: Record<number, number> | null, t: number): number | null {
    const func = p.func != null ? p.func : (33 + i);
    let curve = motors[i];
    if (funcMap && funcMap[func] != null) {
      const field = 'C' + funcMap[func];
      for (let k = 0; k < motors.length; k++) {
        if (motors[k] && motors[k].field === field) { curve = motors[k]; break; }
      }
    }
    return (curve && curve.type) ? useCurveManagerStore().getValueAt(curve.type, curve.field, t, null) : null;
  }

  function spinByPwm(
    props: Array<{ mesh: THREE.Object3D; dir: number; func: number }> | undefined,
    motors: NamedCurve[],
    funcMap: Record<number, number> | null,
    t: number,
    dt: number,
  ): void {
    if (!props || !props.length) return;
    const pwms: Array<number | null> = [];
    for (let i = 0; i < props.length; i++) pwms.push(resolvePropPwm(props[i], i, motors, funcMap, t));
    spinPropellersByPwm(props, pwms, dt);
  }

  // 每帧按电机 PWM 旋转主模型桨叶：桨叶严格跟随 PWM——无电机数据→停转，不假转。
  function spinMainPropellers(dt: number): void {
    const tv = runtime.view3dMain;
    if (!tv || dt <= 0) return;
    const motors = usePlaybackStore().curves.motor || [];
    const funcMap = ensureServoMap();
    const t = usePlaybackStore().playback.timeMs;
    spinByPwm(tv.propellers, motors, funcMap, t, dt);
  }

  return { spinMainPropellers };
}
