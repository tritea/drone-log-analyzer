import type { Ref } from 'vue';
import type { MetricItem } from '@/types';
import { useCurveManagerStore } from '@/modules/curves';
import { usePlaybackStore } from '@/modules/playback';
import {
  MODE_FIELD_KEY,
  MOTOR_FIELD_KEY,
  SPEED_FIELD_KEY,
  VSPEED_FIELD_KEY,
  VOLT_FIELD_KEY,
  fieldShortLabel,
} from '../utils/flight-fields';
import type { MetricState } from './types';

interface LabeledValue {
  label: string;
  value: number | null;
}

interface GroupValue {
  key: string;
  label: string;
  value: number | null;
}

// 合成字段键：不对应日志里的真实 TYPE.field，值由 scene3d 派生或直接取自飞控状态。
const SYNTHETIC_KEYS = new Set([MODE_FIELD_KEY, MOTOR_FIELD_KEY, SPEED_FIELD_KEY, VSPEED_FIELD_KEY, VOLT_FIELD_KEY]);

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

function splitTypeField(typeField: string): { type: string; field: string } | null {
  const dot = typeField.indexOf('.');
  return dot >= 0 ? { type: typeField.slice(0, dot), field: typeField.slice(dot + 1) } : null;
}

/**
 * 字段值解析：把 metric 引用的字段键解析成「当前播放帧」的数值。
 * 合成键（飞行模式/电机/水平速度/垂直速度/电压）走 scene3d 派生量；
 * 真实键（TYPE.field）走曲线管理器按播放时间取值。
 */
export function createFieldResolution(state: Ref<MetricState>) {
  // 真实字段需提前登记到曲线缓存，否则取值时才发现没曲线；合成键直接跳过。
  function ensureField(typeField: string): void {
    if (!typeField || SYNTHETIC_KEYS.has(typeField)) return;
    const parts = splitTypeField(typeField);
    if (!parts) return;
    const curves = useCurveManagerStore();
    if (curves.peek(parts.type, parts.field)) return;
    void curves.get(parts.type, parts.field).catch(() => {
      /* 曲线缺失不致命：取值时返回 null 即可。 */
    });
  }

  function fieldValue(typeField: string): number | null {
    if (!typeField || typeField === MODE_FIELD_KEY || typeField === MOTOR_FIELD_KEY) return null;
    const pb = usePlaybackStore();
    switch (typeField) {
      case SPEED_FIELD_KEY:
        return finiteOrNull(pb.current.speed);
      case VSPEED_FIELD_KEY:
        return finiteOrNull(pb.current.verticalSpeed);
      case VOLT_FIELD_KEY:
        return finiteOrNull(pb.currentVoltage());
      default:
        break;
    }
    const parts = splitTypeField(typeField);
    if (!parts) return null;
    const t = pb.playback.timeMs;
    return useCurveManagerStore().getValueAt(parts.type, parts.field, t, null);
  }

  function fieldValues(typeField: string): LabeledValue[] {
    if (typeField === MOTOR_FIELD_KEY) {
      return usePlaybackStore().currentMotors() as LabeledValue[];
    }
    const v = fieldValue(typeField);
    return v === null ? [] : [{ label: fieldShortLabel(typeField), value: v }];
  }

  // 字段组：电机展开为多通道；模式项跳过；其余每字段一条。
  function groupFieldValues(item: MetricItem): GroupValue[] {
    const out: GroupValue[] = [];
    for (const f of item.fields) {
      if (f === MOTOR_FIELD_KEY) {
        for (const m of fieldValues(f)) out.push({ key: f, label: m.label, value: m.value });
      } else if (f === MODE_FIELD_KEY) {
        continue;
      } else {
        out.push({ key: f, label: fieldShortLabel(f), value: fieldValue(f) });
      }
    }
    return out;
  }

  function reloadAllFields(): void {
    for (const it of state.value.items) {
      for (const f of it.fields) ensureField(f);
    }
  }

  return { ensureField, fieldValue, fieldValues, groupFieldValues, reloadAllFields };
}
