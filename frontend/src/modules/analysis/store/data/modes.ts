import type { FlightMode } from '@/types';
import { useLogStore } from '@/modules/log';
import { usePlaybackStore } from '@/modules/playback';
import { modeAtTime, modeBadgeColor, translateModeLabel } from '../../utils/flight-modes';

/** 飞行模式包装：utils 纯函数 + 日志/回放 store 的机型与当前时刻上下文。 */
export interface ModesApi {
  modeAt(t: number): FlightMode | null;
  modeNow(): string;
  modeLabel(mode: string): string;
  modeColor(mode: string): string;
}

export function createModes(): ModesApi {
  function modeAt(t: number): FlightMode | null {
    return modeAtTime(useLogStore().log.flightModes || [], t);
  }

  function modeNow(): string {
    const m = modeAt(usePlaybackStore().playback.timeMs);
    return m && m.mode ? String(m.mode) : '';
  }

  function modeLabel(mode: string): string {
    const summary = useLogStore().log.summary;
    return translateModeLabel(mode, !!summary && summary.vehicleType === 'Plane');
  }

  function modeColor(mode: string): string {
    return modeBadgeColor(mode);
  }

  return { modeAt, modeNow, modeLabel, modeColor };
}
