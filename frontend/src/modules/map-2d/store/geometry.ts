import * as L from 'leaflet';
import type { TelemetrySample } from '@/types';
import type { OriginFrame } from './types';

/* 纯几何工具：局部米制坐标（north/east，原点 geoOrigin）→ 经纬度、平面米距、
 * 按地面间距抽稀、有序下标二分。无状态、不触 store。 */

/** 纬度每度米数（sampleToLatLng 换算用）。 */
const DEG_LAT_METERS = 110540;
/** 赤道经度每度米数（sampleToLatLng 换算与米距近似共用，保持原实现口径）。 */
const DEG_LNG_METERS = 111320;

/** 采样点 → LatLng：纬度线性换算，经度按原点纬度 cos 收敛。 */
export function sampleToLatLng(sample: TelemetrySample, origin: OriginFrame): L.LatLng {
  return L.latLng(
    origin.lat0 + sample.north / DEG_LAT_METERS,
    origin.lng0 + sample.east / (origin.cosLat * DEG_LNG_METERS),
  );
}

/** 两 LatLng 的平面米距平方（小范围近似，抽稀阈值比较用，免开方）。 */
export function squaredMeterGap(a: L.LatLng, b: L.LatLng): number {
  const north = (a.lat - b.lat) * DEG_LNG_METERS;
  const east = (a.lng - b.lng) * DEG_LNG_METERS * Math.cos((a.lat * Math.PI) / 180);
  return north * north + east * east;
}

/** 按最小地面间距抽稀：保留首/尾点与所有距上一保留点 ≥ minMeters 的点。
 * 返回保留点及其在原数组的下标（滑窗模式按原始时间下标取段）。 */
export function thinBySpacing(points: L.LatLng[], minMeters: number): { kept: L.LatLng[]; sourceIdx: number[] } {
  const total = points.length;
  const kept: L.LatLng[] = [];
  const sourceIdx: number[] = [];
  if (!total) return { kept, sourceIdx };
  kept.push(points[0]);
  sourceIdx.push(0);
  const limitSq = minMeters * minMeters;
  let anchor = points[0];
  for (let i = 1; i < total; i++) {
    if (squaredMeterGap(anchor, points[i]) >= limitSq) {
      kept.push(points[i]);
      sourceIdx.push(i);
      anchor = points[i];
    }
  }
  if (sourceIdx[sourceIdx.length - 1] !== total - 1) {
    kept.push(points[total - 1]);
    sourceIdx.push(total - 1);
  }
  return { kept, sourceIdx };
}

/** 首个 ≥ v 的下标（有序数组，二分）。 */
export function firstIndexAtLeast(sorted: number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 首个 > v 的下标（有序数组，二分）。 */
export function firstIndexExceeding(sorted: number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
