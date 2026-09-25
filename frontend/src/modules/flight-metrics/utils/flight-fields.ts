import type { MetricFieldSettings, MetricItem } from '@/types';
import { getProfile } from '@/profiles';
import type { FieldSource } from '@/profiles';
import { useLogStore } from '@/modules/log';
import { tr } from '@/locales';

// 合成字段键：不对应日志真实 TYPE.field，值由 scene3d 派生或取自飞控状态。
export const MODE_FIELD_KEY = '__mode__';
export const MOTOR_FIELD_KEY = '__motor__';
export const SPEED_FIELD_KEY = '__speed__';
export const VSPEED_FIELD_KEY = '__vspeed__';
export const VOLT_FIELD_KEY = '__volt__';

// 默认项的稳定 defKey 集与中文规范名（规范名是持久化身份，磁盘上的旧配置写的正是它）。
export const KNOWN_DEFKEYS = ['mode', 'speed', 'vspeed', 'alt', 'baro', 'volt', 'motor'] as const;

const ZH_DEFAULT_NAMES: Record<string, string> = {
  mode: '飞行模式',
  speed: '水平速度',
  vspeed: '垂直速度',
  alt: '高度',
  baro: '气压高度',
  volt: '电压',
  motor: '电机输出',
};

/** defKey → 中文规范名（持久化契约值，未知 defKey 回退空串）。 */
export function zhDefaultMetricName(defKey: string): string {
  return ZH_DEFAULT_NAMES[defKey] || '';
}

/**
 * 项的展示名：默认项（defKey 命中且未被用户改名）按当前语言解析词条；
 * 用户改过名的项 name 是数据，原样返回。旧配置里没有 defKey 的中文默认项
 * 靠规范名匹配同样能翻译。
 */
export function metricDisplayName(item: MetricItem): string {
  if (!item.defKey) return item.name;
  const translated = tr('flightMetrics.names.' + item.defKey);
  if (item.name === ZH_DEFAULT_NAMES[item.defKey] || item.name === translated) return translated;
  return item.name;
}

const profileFor = (): ReturnType<typeof getProfile> =>
  getProfile(String(useLogStore().log.summary?.format || 'apm')) || getProfile('apm')!;

const keyOf = (src: FieldSource | undefined): string => (src ? `${src.type}.${src.field}` : '');

export function defaultAltField(): string {
  const profile = profileFor();
  const match = (profile.positionSources || []).find((s) => s.key === profile.defaultPosition);
  // 高度指标面向飞行员，取相对 home 高优先；无相对字段（PX4）回退绝对海拔字段。
  return keyOf(match?.relAlt) || keyOf(match?.alt) || 'POS.RelHomeAlt';
}

export function defaultBaroField(): string {
  return keyOf((profileFor().baroAlt || [])[0]) || 'BARO.Alt';
}

// 把 [min,max] 区间归一化到 0–100 的填充百分比；非法/空区间返回 0。
export function barPct(value: number | null | undefined, min: number, max: number): number {
  if (value === null || value === undefined || !isFinite(value)) return 0;
  const span = max - min;
  if (!span || !isFinite(span)) return 0;
  let ratio = (Number(value) - min) / span;
  if (ratio < 0) ratio = 0;
  else if (ratio > 1) ratio = 1;
  return Math.round(ratio * 100);
}

export function fieldShortLabel(typeField: string): string {
  const i = typeField.indexOf('.');
  return i >= 0 ? typeField.slice(i + 1) : typeField;
}

// 单调进程内序号 + 随机后缀，保证 metric id 全局唯一（无需持久化连续）。
let idSeq = 0;
export function genMetricId(): string {
  idSeq = (idSeq + 1) % 1e9;
  return `m-${idSeq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeDefaultMetricItems(): MetricItem[] {
  return [
    { id: 'builtin-mode', name: '飞行模式', kind: 'field', fields: [MODE_FIELD_KEY], render: 'number', min: 0, max: 1, minInput: '0', maxInput: '1', orient: 'horizontal', builtin: 'mode', defKey: 'mode', unit: '', origUnit: '', unitMul: 1 },
    { id: 'builtin-speed', name: '水平速度', kind: 'field', fields: [SPEED_FIELD_KEY], render: 'number', min: 0, max: 30, minInput: '0', maxInput: '30', orient: 'horizontal', builtin: '', defKey: 'speed', unit: 'm/s', origUnit: 'm/s', unitMul: 1 },
    { id: 'builtin-vspeed', name: '垂直速度', kind: 'field', fields: [VSPEED_FIELD_KEY], render: 'number', min: -10, max: 10, minInput: '-10', maxInput: '10', orient: 'horizontal', builtin: '', defKey: 'vspeed', unit: 'm/s', origUnit: 'm/s', unitMul: 1 },
    { id: 'builtin-alt', name: '高度', kind: 'field', fields: [defaultAltField()], render: 'number', min: 0, max: 200, minInput: '0', maxInput: '200', orient: 'horizontal', builtin: '', defKey: 'alt', unit: 'm', origUnit: 'm', unitMul: 1 },
    { id: 'builtin-baro', name: '气压高度', kind: 'field', fields: [defaultBaroField()], render: 'number', min: 0, max: 200, minInput: '0', maxInput: '200', orient: 'horizontal', builtin: '', defKey: 'baro', unit: 'm', origUnit: 'm', unitMul: 1 },
    { id: 'builtin-volt', name: '电压', kind: 'field', fields: [VOLT_FIELD_KEY], render: 'number', min: 0, max: 25, minInput: '0', maxInput: '25', orient: 'horizontal', builtin: '', defKey: 'volt', unit: 'V', origUnit: 'V', unitMul: 1 },
    { id: 'builtin-motor', name: '电机输出', kind: 'group', fields: [MOTOR_FIELD_KEY], render: 'bar', min: 1000, max: 2000, minInput: '1000', maxInput: '2000', orient: 'vertical', builtin: 'motor', defKey: 'motor', unit: 'PWM', origUnit: 'PWM', unitMul: 1 },
  ];
}

export function cloneItem(item: MetricItem): MetricItem {
  return { ...item, fields: item.fields.slice() };
}

export function seedFromItem(item: MetricItem): MetricFieldSettings {
  return {
    min: item.min,
    max: item.max,
    minInput: item.minInput,
    maxInput: item.maxInput,
    unit: item.unit,
    origUnit: item.origUnit,
    unitMul: item.unitMul,
  };
}

const numOr = (v: unknown, fallback: number): number => (typeof v === 'number' && isFinite(v) ? v : fallback);
const strOr = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

// 取固定项（飞行模式/电机）的默认模板。
function builtinTemplate(kind: 'mode' | 'motor'): MetricItem | null {
  for (const it of makeDefaultMetricItems()) {
    if (it.builtin === kind) return cloneItem(it);
  }
  return null;
}

/**
 * 把磁盘读回的任意条目归一化为合法 MetricItem（边界 narrow，不信任外部形状）。
 * 非法条目返回 null，由调用方丢弃。
 */
export function normalizeMetricItem(raw: unknown): MetricItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const builtin: MetricItem['builtin'] = r.builtin === 'mode' || r.builtin === 'motor' ? r.builtin : '';
  if (builtin === 'mode' || builtin === 'motor') {
    const tmpl = builtinTemplate(builtin);
    if (!tmpl) return null;
    const id = typeof r.id === 'string' && r.id ? r.id : tmpl.id;
    return { ...tmpl, id };
  }

  const fields: string[] = Array.isArray(r.fields)
    ? r.fields.filter(
        (f: unknown): f is string => typeof f === 'string' && f.length > 0 && f !== MODE_FIELD_KEY && f !== MOTOR_FIELD_KEY,
      )
    : [];
  if (!fields.length) return null;

  const min = numOr(r.min, 0);
  const max = numOr(r.max, 1);
  const unit = strOr(r.unit, '');
  const origUnit = typeof r.origUnit === 'string' ? r.origUnit : unit;
  const unitMul = numOr(r.unitMul, 1);

  const base: MetricItem = {
    id: typeof r.id === 'string' && r.id ? r.id : genMetricId(),
    name: typeof r.name === 'string' && r.name.trim() ? r.name : fieldShortLabel(fields[0]),
    kind: r.kind === 'group' || fields.length > 1 ? 'group' : 'field',
    fields,
    render: r.render === 'bar' ? 'bar' : 'number',
    min,
    max,
    minInput: strOr(r.minInput, String(min)),
    maxInput: strOr(r.maxInput, String(max)),
    orient: r.orient === 'vertical' ? 'vertical' : 'horizontal',
    builtin: '',
    unit,
    origUnit,
    unitMul,
  };
  // 透传统计内已知 defKey（未知值丢弃，按自定义项处理）
  if (typeof r.defKey === 'string' && (KNOWN_DEFKEYS as readonly string[]).includes(r.defKey)) {
    base.defKey = r.defKey;
  } else {
    // 旧配置没有 defKey：name 恰为中文规范名的默认项回填 defKey，让展示翻译生效
    const legacy = Object.keys(ZH_DEFAULT_NAMES).find((k) => ZH_DEFAULT_NAMES[k] === base.name);
    if (legacy) base.defKey = legacy;
  }

  if (base.kind !== 'group') return base;

  // 字段组：逐字段恢复范围/单位（缺省从父项种子派生）。
  const rawFs = r.fieldSettings;
  const src = rawFs && typeof rawFs === 'object' ? (rawFs as Record<string, unknown>) : null;
  const fieldSettings: Record<string, MetricFieldSettings> = {};
  for (const f of fields) {
    const entry = src ? src[f] : null;
    if (entry && typeof entry === 'object') {
      const o = entry as Record<string, unknown>;
      fieldSettings[f] = {
        min: numOr(o.min, min),
        max: numOr(o.max, max),
        minInput: strOr(o.minInput, base.minInput),
        maxInput: strOr(o.maxInput, base.maxInput),
        unit: strOr(o.unit, unit),
        origUnit: strOr(o.origUnit, origUnit),
        unitMul: numOr(o.unitMul, unitMul),
      };
    } else {
      fieldSettings[f] = seedFromItem(base);
    }
  }
  return { ...base, fieldSettings };
}

export interface UnitPreset {
  key: string;
  label: string;
  mul: number;
  unit: string;
}

/** 按原始单位给出常用换算预设（如 m/s↔km/h），用于下拉快速选择。 */
export function conversionPresets(origUnit: string): UnitPreset[] {
  const u = (origUnit || '').trim().toLowerCase();
  const presets: UnitPreset[] = [];
  const add = (key: string, label: string, mul: number, unit: string): void => {
    presets.push({ key, label, mul, unit });
  };
  if (u === 'cm/s' || u === 'cms' || u === 'cm/sec') {
    add('cms-ms', 'm/s (×0.01)', 0.01, 'm/s');
    add('cms-kmh', 'km/h (×0.036)', 0.036, 'km/h');
  } else if (u === 'm/s' || u === 'mps' || u === 'm/sec') {
    add('ms-kmh', 'km/h (×3.6)', 3.6, 'km/h');
    add('ms-mph', 'mph (×2.237)', 2.23694, 'mph');
    add('ms-fps', 'ft/s (×3.281)', 3.28084, 'ft/s');
  } else if (u === 'cm') {
    add('cm-m', 'm (×0.01)', 0.01, 'm');
  } else if (u === 'm') {
    add('m-ft', 'ft (×3.281)', 3.28084, 'ft');
    add('m-km', 'km (×0.001)', 0.001, 'km');
  } else if (u === 'cdeg') {
    add('cdeg-deg', '° (×0.01)', 0.01, '°');
    add('cdeg-rad', 'rad (×1.75e-4)', 0.000174533, 'rad');
  } else if (u === 'deg' || u === '°' || u === 'degrees') {
    add('deg-rad', 'rad (×0.01745)', 0.0174533, 'rad');
  }
  return presets;
}

/** 确保固定项（飞行模式/电机）一定存在，缺失则前置补齐。 */
export function ensureBuiltinMetrics(items: MetricItem[]): MetricItem[] {
  const out = items.slice();
  for (const kind of ['mode', 'motor'] as const) {
    if (!out.some((i) => i.builtin === kind)) {
      const tmpl = builtinTemplate(kind);
      if (tmpl) out.unshift(tmpl);
    }
  }
  return out;
}
