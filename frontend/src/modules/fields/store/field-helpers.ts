/**
 * 字段面板使用的纯函数与 DTO 类型。
 *
 * 这里集中放置不依赖任何 Pinia store 的归一化 / 清洗 / 命名建议逻辑，
 * 让 {@link ./fields-store.ts} 只负责编排状态与副作用。
 */
import type {
  FieldCurve,
  FieldEntry,
  FieldGroupParams,
  PickerCurveSettings,
} from '@/types';
import { tryFloat } from '@/modules/shared/utils/format';
import { nextColor } from '@/modules/shared/utils/colors';

/** 后端 / 导入 JSON 中字段项的原始（未受信）形状：任意键值集合。 */
export type FieldEntryInput = Record<string, unknown>;

/** 后端 listFieldEntries / saveFieldEntry / deleteFieldEntry 的响应壳。 */
export interface FieldEntriesResponse {
  entries?: unknown[];
  path?: string;
  error?: string;
}

/** 写回后端 saveFieldEntry 的字段项 DTO（currentFieldEntryPayload 产出）。 */
export interface FieldEntryPayload {
  name: string;
  scale: number;
  offset: number;
  scaleInput: string;
  offsetInput: string;
  curves: FieldCurve[];
}

const DEFAULT_SCALE = 1;
const DEFAULT_OFFSET = 0;

/**
 * 把后端 / 导入 JSON 里的原始对象安全归一化为 {@link FieldEntry}。
 * 接受 unknown 是因为这条数据来自 IPC 响应与用户选择的 JSON 文件，不能假设形状。
 */
export function normalizeFieldEntry(input: unknown): FieldEntry {
  const src: FieldEntryInput = input && typeof input === 'object' ? (input as FieldEntryInput) : {};
  const scale = src.scale !== undefined ? (src.scale as number) : DEFAULT_SCALE;
  const offset = src.offset !== undefined ? (src.offset as number) : DEFAULT_OFFSET;
  return {
    name: String(src.name ?? '').trim(),
    curves: Array.isArray(src.curves) ? (src.curves as FieldCurve[]) : [],
    scale,
    offset,
    scaleInput: src.scaleInput !== undefined ? String(src.scaleInput) : String(scale),
    offsetInput: src.offsetInput !== undefined ? String(src.offsetInput) : String(offset),
    createdAt: (src.createdAt as string) || '',
    updatedAt: (src.updatedAt as string) || '',
  };
}

/** 去重并补全字段组里的曲线条目，丢弃 type/field 缺失的项。 */
export function cleanFieldEditCurves(curves: FieldCurve[]): FieldCurve[] {
  const cleaned: FieldCurve[] = [];
  const seen = new Set<string>();
  for (const curve of curves || []) {
    const type = String(curve.type || '').trim();
    const field = String(curve.field || '').trim();
    if (!type || !field) continue;
    const key = type + '.' + field;
    if (seen.has(key)) continue;
    seen.add(key);
    const scale = curve.scale !== undefined ? curve.scale : DEFAULT_SCALE;
    const offset = curve.offset !== undefined ? curve.offset : DEFAULT_OFFSET;
    cleaned.push({
      type,
      field,
      visible: curve.visible !== undefined ? !!curve.visible : true,
      color: curve.color || '',
      scale,
      offset,
      scaleInput: curve.scaleInput !== undefined ? String(curve.scaleInput) : String(scale),
      offsetInput: curve.offsetInput !== undefined ? String(curve.offsetInput) : String(offset),
    });
  }
  return cleaned;
}

/** 由任意来源（曲线或既有 settings）补全出一组合法的 picker 曲线参数。 */
export function makePickerCurveSettings(source?: Partial<FieldCurve>): PickerCurveSettings {
  const src = source || {};
  const scale = src.scale !== undefined ? src.scale : DEFAULT_SCALE;
  const offset = src.offset !== undefined ? src.offset : DEFAULT_OFFSET;
  return {
    visible: src.visible !== undefined ? !!src.visible : true,
    color: src.color || nextColor(),
    scale: tryFloat(src.scaleInput !== undefined ? src.scaleInput : scale, scale),
    offset: tryFloat(src.offsetInput !== undefined ? src.offsetInput : offset, offset),
    scaleInput: src.scaleInput !== undefined ? String(src.scaleInput) : String(scale),
    offsetInput: src.offsetInput !== undefined ? String(src.offsetInput) : String(offset),
  };
}

/** 字段项在列表里展示的一句话摘要（首条曲线 + 其余数量）。 */
export function fieldSummary(entry: FieldEntry): string {
  const curves = entry && Array.isArray(entry.curves) ? entry.curves : [];
  if (!curves.length) return '0 fields';
  const head = curves[0].type + '.' + curves[0].field;
  return curves.length === 1 ? head : head + ' +' + (curves.length - 1);
}

/** 在已占用名称之外递增得到一个不冲突的 `group_N` 名称。 */
export function suggestGroupName(items: FieldEntry[]): string {
  const taken = new Set(items.map((entry) => entry.name));
  let candidate = items.length + 1;
  while (taken.has('group_' + candidate)) candidate++;
  return 'group_' + candidate;
}

/** 单条曲线以 `TYPE.FIELD` 命名，多条曲线回退到下一个空闲的 `group_N`。 */
export function pickDefaultEntryName(curves: FieldCurve[], items: FieldEntry[]): string {
  if (!curves || !curves.length) return suggestGroupName(items);
  if (curves.length === 1) return curves[0].type + '.' + curves[0].field;
  return suggestGroupName(items);
}

/** 由既有 group 参数与曲线构造写回后端的 DTO。 */
export function buildFieldEntryPayload(
  name: string,
  curves: FieldCurve[],
  group: FieldGroupParams,
): FieldEntryPayload {
  return {
    name,
    scale: group.scale,
    offset: group.offset,
    scaleInput: group.scaleInput,
    offsetInput: group.offsetInput,
    curves: cleanFieldEditCurves(curves || []),
  };
}
