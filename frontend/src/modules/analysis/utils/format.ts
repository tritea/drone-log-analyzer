import type { LogMessage } from '@/types';
import { pad2 } from '@/modules/shared/utils/format';
import { tr } from '@/locales';

/** 2001-09-09，大于此值视为真实毫秒时间戳，否则按相对时长处理。 */
const EPOCH_THRESHOLD = 1_000_000_000_000;
const pad2Utc = (n: number): string => (n < 10 ? `0${n}` : String(n));

/**
 * 毫秒时间戳 → HH:MM:SS.mmm；带日期时输出 'YYYY-MM-DD HH:MM:SS UTC'。
 * 早于阈值（2001）的值按相对时长格式化。
 */
export function formatTime(ms: number, withDate = false): string {
  let safe = Math.floor(ms);
  if (safe > EPOCH_THRESHOLD) {
    const d = new Date(safe);
    if (!Number.isNaN(d.getTime())) {
      const iso = d.toISOString();
      return withDate ? iso.replace('T', ' ').replace('Z', ' UTC') : iso.slice(11, 23);
    }
  }
  safe = Math.max(0, safe);
  const whole = Math.floor(safe / 1000);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const milli = safe % 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${String(milli).padStart(3, '0')}`;
}

/** 毫秒 → UTC 'YYYY-MM-DD HH:MM:SS'（相对时长退化为 HH:MM:SS）。 */
export function formatUTCTime(ms: number): string {
  let safe = Math.floor(Number(ms));
  if (!Number.isFinite(safe)) return '';
  if (safe > EPOCH_THRESHOLD) {
    const d = new Date(safe);
    if (!Number.isNaN(d.getTime())) {
      return (
        `${d.getUTCFullYear()}-${pad2Utc(d.getUTCMonth() + 1)}-${pad2Utc(d.getUTCDate())} ` +
        `${pad2Utc(d.getUTCHours())}:${pad2Utc(d.getUTCMinutes())}:${pad2Utc(d.getUTCSeconds())}`
      );
    }
  }
  safe = Math.max(0, safe);
  const whole = Math.floor(safe / 1000);
  return `${pad2Utc(Math.floor(whole / 3600))}:${pad2Utc(Math.floor((whole % 3600) / 60))}:${pad2Utc(whole % 60)}`;
}

/** 秒 → 本地化时长（zh 'N分M秒' / en 'Nm Ns'；零值 '0s'）。 */
export function formatDuration(seconds: number): string {
  if (!seconds) return tr('common.durationZero');
  const m = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return m > 0 ? tr('common.duration', { m, sec }) : tr('common.durationSec', { sec });
}

/** 大数压缩：≥1万显示为 'Nk'。 */
export function fmtCount(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(0)}k` : String(n);
}

/** 参数值友好化：0 直接返回，极值用指数，其余裁剪到 10 位有效数字。 */
export function formatParameterValue(value: number | string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000 || abs < 0.0001) return value.toExponential(6);
  return String(Number(value.toPrecision(10)));
}

/** 经纬度格式化（无效/零值显示占位符）。 */
export function formatCoord(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return '—';
  return value.toFixed(7);
}

const GEO_FIELDS = new Set(['lat', 'lng', 'lon', 'long', 'alt', 'relhomealt', 'baroalt']);

/** 经纬度/高度类字段保留 7 位小数，其余默认 4 位。 */
export function pointDecimals(curve: { field?: string } | null): number {
  if (curve && curve.field && GEO_FIELDS.has(curve.field.toLowerCase())) return 7;
  return 4;
}

/** 消息列表时刻：有 timeMs 显示时刻，否则退化行号。 */
export function formatMessageTime(item: LogMessage | null): string {
  return item && item.timeMs ? formatTime(item.timeMs, false) : '#' + (item ? item.lineno : '');
}
