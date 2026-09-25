import type { Ref } from 'vue';
import type { MetricFieldSettings, MetricItem } from '@/types';
import { showToast } from '@/modules/shared/ui-store';
import { tr } from '@/locales';
import { seedFromItem } from '../utils/flight-fields';
import type { MetricState } from './types';

/**
 * metric 项的增删/移动 + 字段设置读取。
 * 所有改动走不可变替换（state.items = [...]），固定项（飞行模式/电机）不可删。
 */
export function createItemOps(state: Ref<MetricState>) {
  function removeItem(id: string): void {
    const target = state.value.items.find((it) => it.id === id);
    if (!target) return;
    if (target.builtin) {
      showToast(tr('flightMetrics.toast.builtinUndeletable'), 'warn');
      return;
    }
    state.value.items = state.value.items.filter((it) => it.id !== id);
  }

  function moveItem(id: string, dir: -1 | 1): void {
    const list = state.value.items;
    const from = list.findIndex((it) => it.id === id);
    if (from < 0) return;
    const to = from + dir;
    if (to < 0 || to >= list.length) return;
    const next = list.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    state.value.items = next;
  }

  // 取某字段的范围/单位设置：有就用，没有就从父项种子派生一份默认。
  function fieldSettingsFor(item: MetricItem, key: string): MetricFieldSettings {
    return item.fieldSettings?.[key] ?? seedFromItem(item);
  }

  function makeFieldSettings(source?: Partial<MetricFieldSettings>): MetricFieldSettings {
    const s = source ?? {};
    return {
      min: s.min ?? 0,
      max: s.max ?? 1,
      minInput: s.minInput ?? '0',
      maxInput: s.maxInput ?? '1',
      unit: s.unit ?? '',
      origUnit: s.origUnit ?? '',
      unitMul: s.unitMul !== undefined && isFinite(s.unitMul) ? s.unitMul : 1,
    };
  }

  return { removeItem, moveItem, fieldSettingsFor, makeFieldSettings };
}
