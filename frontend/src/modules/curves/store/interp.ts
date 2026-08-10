import type { CurveBinary } from '@/modules/analysis/utils/curve-binary'

/**
 * Interpolate across the shortest angular path between two headings (degrees).
 * Used for attitude-style fields that wrap around the circle.
 */
export function lerpAngle(start: number, end: number, fraction: number): number {
  const delta = (((end - start) % 360) + 540) % 360 - 180
  return start + delta * fraction
}

/**
 * Smallest upper-bound sample index whose absolute timestamp is >= timeMs.
 * Precondition: the curve is non-empty and timeMs is strictly inside the
 * (firstAbs, lastAbs) range — boundary clamping is the caller's responsibility.
 */
function upperBoundIndex(curve: CurveBinary, timeMs: number): number {
  const samples = curve.buffer
  let lo = 0
  let hi = curve.count - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (curve.baseTimeMs + samples[mid * 2] < timeMs) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Sample the curve value at an absolute timestamp via linear interpolation.
 * In angle mode the interpolation wraps via {@link lerpAngle} so values like
 * yaw/heading don't sweep the long way around. Returns `fallback` when the
 * curve is empty, and clamps to the endpoints when outside the time range.
 */
export function interpBuffer(
  curve: CurveBinary,
  timeMs: number,
  fallback: number | null,
  angleMode: boolean,
): number | null {
  const samples = curve.buffer
  const count = curve.count
  if (count === 0) return fallback

  const firstAbs = curve.baseTimeMs + samples[0]
  const lastAbs = curve.baseTimeMs + samples[(count - 1) * 2]
  if (timeMs <= firstAbs) return samples[1]
  if (timeMs >= lastAbs) return samples[(count - 1) * 2 + 1]

  const hi = upperBoundIndex(curve, timeMs)
  const aAbs = curve.baseTimeMs + samples[(hi - 1) * 2]
  const bAbs = curve.baseTimeMs + samples[hi * 2]
  const aVal = samples[(hi - 1) * 2 + 1]
  const bVal = samples[hi * 2 + 1]
  const span = bAbs - aAbs || 1
  const fraction = (timeMs - aAbs) / span
  return angleMode ? lerpAngle(aVal, bVal, fraction) : aVal + (bVal - aVal) * fraction
}

/**
 * Index of the sample whose timestamp is closest to timeMs, clamped to the
 * curve's bounds. Returns -1 for an empty curve.
 */
export function findIndexAt(curve: CurveBinary, timeMs: number): number {
  const count = curve.count
  if (count === 0) return -1
  const samples = curve.buffer
  const firstAbs = curve.baseTimeMs + samples[0]
  const lastAbs = curve.baseTimeMs + samples[(count - 1) * 2]
  if (timeMs <= firstAbs) return 0
  if (timeMs >= lastAbs) return count - 1
  return upperBoundIndex(curve, timeMs)
}
