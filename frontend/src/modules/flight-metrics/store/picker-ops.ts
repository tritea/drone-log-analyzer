import type { Ref } from 'vue';
import type { MetricFieldSettings, MetricItem, MetricKind } from '@/types';
import { useCurveManagerStore } from '@/modules/curves';
import { useLogStore } from '@/modules/log';
import { tryFloat } from '@/modules/shared/utils/format';
import { tr } from '@/locales';
import { fieldShortLabel, genMetricId, metricDisplayName, seedFromItem, zhDefaultMetricName } from '../utils/flight-fields';
import { blankPicker, type MetricState } from './types';

interface PickerDeps {
  ensureField: (typeField: string) => void;
  makeFieldSettings: (source?: Partial<MetricFieldSettings>) => MetricFieldSettings;
}

function splitKey(key: string): { type: string; field: string } | null {
  const i = key.indexOf('.');
  return i >= 0 ? { type: key.slice(0, i), field: key.slice(i + 1) } : null;
}

/**
 * 字段选择器状态机：打开/编辑、勾选字段、为每字段单独配范围与换算、确认后生成 metric。
 * 依赖字段解析（登记曲线）与项操作（构造字段设置）。
 */
export function createPickerOps(state: Ref<MetricState>, deps: PickerDeps) {
  const { ensureField, makeFieldSettings } = deps;

  // 按日志消息类型顺序整理已勾选字段，再追加类型外的孤儿勾选（历史/外部写入）。
  function selectedPickerFields(): string[] {
    const sel = state.value.picker.selected;
    const types = useLogStore().log.messageTypes || [];
    const ordered: string[] = [];
    for (const mt of types) {
      for (const f of mt.fields || []) {
        const key = `${mt.name}.${f}`;
        if (sel[key]) ordered.push(key);
      }
    }
    const seen = new Set(ordered);
    const orphans = Object.keys(sel)
      .filter((k) => sel[k] && !seen.has(k))
      .sort();
    return [...ordered, ...orphans];
  }

  function pickerSelectedKeys(): string[] {
    return selectedPickerFields();
  }

  // 复位为空白 picker 后再翻开：blankPicker 的 open 恒为 false（也用于 store 初始态，
  // 初始时对话框必须关闭），所以这里必须显式置 open=true，否则点击「添加」无反应。
  function openPicker(): void {
    Object.assign(state.value.picker, blankPicker(), { open: true });
  }

  function closePicker(): void {
    const picker = state.value.picker;
    picker.open = false;
    picker.editingId = '';
  }

  // 从已有项回填选择器：勾上其字段、拷贝每字段设置，便于继续编辑。
  function openEditor(id: string): void {
    const item = state.value.items.find((it) => it.id === id);
    if (!item || item.builtin) return;
    const selected: Record<string, boolean> = {};
    const fieldSettings: Record<string, MetricFieldSettings> = {};
    for (const f of item.fields) {
      selected[f] = true;
      fieldSettings[f] = item.fieldSettings?.[f]
        ? { ...item.fieldSettings[f] }
        : makeFieldSettings(seedFromItem(item));
    }
    Object.assign(state.value.picker, {
      editingId: id,
      open: true,
      selected,
      fieldSettings,
      // 回填展示名（默认项按当前语言），未改名保存时再规范化回中文规范名
      name: metricDisplayName(item),
      render: item.render,
      orient: item.orient,
      filter: '',
      expanded: {},
    });
  }

  function togglePickerField(key: string): void {
    const picker = state.value.picker;
    const selected = { ...picker.selected };
    if (selected[key]) {
      delete selected[key];
    } else {
      selected[key] = true;
      // 首次勾选：种子一份字段设置，原始单位取自 logdefs（若有）。
      if (!picker.fieldSettings[key]) {
        const units = useCurveManagerStore().logdefs?.units;
        const origUnit = units?.[key] ?? '';
        picker.fieldSettings = {
          ...picker.fieldSettings,
          [key]: makeFieldSettings({ origUnit, unit: origUnit }),
        };
      }
    }
    picker.selected = selected;
  }

  function togglePickerGroup(typeName: string): void {
    const expanded = { ...state.value.picker.expanded };
    expanded[typeName] = !expanded[typeName];
    state.value.picker.expanded = expanded;
  }

  function setPickerFieldMinMax(key: string, minInput: string, maxInput: string): void {
    const picker = state.value.picker;
    const cur = picker.fieldSettings[key] || makeFieldSettings();
    picker.fieldSettings = {
      ...picker.fieldSettings,
      [key]: { ...cur, minInput, maxInput, min: tryFloat(minInput, 0), max: tryFloat(maxInput, 1) },
    };
  }

  function setPickerFieldConversion(key: string, unitMul: number, unit: string): void {
    const picker = state.value.picker;
    const cur = picker.fieldSettings[key] || makeFieldSettings();
    const mul = isFinite(unitMul) ? unitMul : 1;
    picker.fieldSettings = { ...picker.fieldSettings, [key]: { ...cur, unitMul: mul, unit } };
  }

  const setPickerName = (name: string): void => {
    state.value.picker.name = name;
  };
  const setPickerRender = (render: MetricItem['render']): void => {
    state.value.picker.render = render;
  };
  const setPickerOrient = (orient: MetricItem['orient']): void => {
    state.value.picker.orient = orient;
  };

  // 确认：拉取各字段曲线范围（新建且仍为默认时自动填充）、组装 metric、登记曲线、关闭。
  async function confirmPicker(): Promise<void> {
    const picker = state.value.picker;
    const keys = selectedPickerFields();
    if (!keys.length) return;
    const editing = !!picker.editingId;
    const kind: MetricKind = keys.length > 1 ? 'group' : 'field';
    const editingItem = editing ? state.value.items.find((it) => it.id === picker.editingId) : null;
    const defKey = editingItem?.defKey;
    let name = picker.name.trim() || fieldShortLabel(keys[0]);
    // 名字仍是当前语言的默认展示名：规范化回中文规范名，保住翻译响应性
    if (defKey && name === tr('flightMetrics.names.' + defKey)) name = zhDefaultMetricName(defKey);

    const curves = useCurveManagerStore();
    await curves.ensureLogDefs();
    const units = curves.logdefs?.units ?? {};
    const bounds = await Promise.allSettled(
      keys.map((k) => {
        const parts = splitKey(k);
        if (!parts) return Promise.reject(new Error('bad field key'));
        return curves.get(parts.type, parts.field);
      }),
    );

    const fieldSettings: Record<string, MetricFieldSettings> = {};
    keys.forEach((k, i) => {
      const cached = picker.fieldSettings[k] || makeFieldSettings();
      const stillDefault = cached.min === 0 && cached.max === 1;
      const resolved = bounds[i];
      let min = cached.min;
      let max = cached.max;
      let minInput = cached.minInput;
      let maxInput = cached.maxInput;
      if (
        !editing &&
        stillDefault &&
        resolved.status === 'fulfilled' &&
        isFinite(resolved.value.min) &&
        isFinite(resolved.value.max)
      ) {
        min = resolved.value.min;
        max = resolved.value.max;
        minInput = String(min);
        maxInput = String(max);
      }
      const origUnit = cached.origUnit || units[k] || '';
      const unit = cached.unit || origUnit;
      fieldSettings[k] = {
        min,
        max,
        minInput,
        maxInput,
        unit,
        origUnit,
        unitMul: isFinite(cached.unitMul) ? cached.unitMul : 1,
      };
    });

    const firstFs = fieldSettings[keys[0]];
    const item: MetricItem = {
      id: editing ? picker.editingId : genMetricId(),
      name,
      kind,
      fields: keys.slice(),
      render: picker.render,
      min: firstFs.min,
      max: firstFs.max,
      minInput: firstFs.minInput,
      maxInput: firstFs.maxInput,
      orient: picker.orient,
      builtin: '',
      defKey,
      unit: firstFs.unit,
      origUnit: firstFs.origUnit,
      unitMul: firstFs.unitMul,
      fieldSettings: kind === 'group' ? fieldSettings : undefined,
    };

    state.value.items = editing
      ? state.value.items.map((it) => (it.id === item.id ? item : it))
      : [...state.value.items, item];

    for (const f of keys) ensureField(f);
    picker.open = false;
    picker.editingId = '';
  }

  return {
    selectedPickerFields,
    pickerSelectedKeys,
    openPicker,
    closePicker,
    openEditor,
    togglePickerField,
    togglePickerGroup,
    setPickerFieldMinMax,
    setPickerFieldConversion,
    setPickerName,
    setPickerRender,
    setPickerOrient,
    confirmPicker,
  };
}
