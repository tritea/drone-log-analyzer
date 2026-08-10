import type { Viewport } from '../types';

/** 最大放大倍率：视口量程不得小于初始量程的 1/N */
const MAX_ZOOM_FACTOR = 500;

/** 像素坐标（CSS px，相对图表容器左上角） */
export type PixelPoint = { px: number; py: number };
/** 数据坐标（绝对时间戳 ms + 数据值） */
export type DataPoint = { t: number; v: number };
/** 绘图区矩形（CSS px，left/top 为距容器左上角的偏移） */
export type GridBox = { left: number; top: number; width: number; height: number };
/** 矩形（左上角 x/y + 宽高），用于对外暴露的 getGridRect */
export type GridRect = { x: number; y: number; width: number; height: number };

/** 数据坐标 → 像素坐标（纯函数，不依赖实例状态） */
export function dataToPixel(
  t: number,
  v: number,
  vp: Viewport,
  grid: GridBox,
  baseTimeMs: number,
): PixelPoint {
  const delta = t - baseTimeMs;
  const px = grid.left + ((delta - vp.xMin) / (vp.xMax - vp.xMin)) * grid.width;
  const py = grid.top + ((vp.yMax - v) / (vp.yMax - vp.yMin)) * grid.height;
  return { px, py };
}

/** 像素坐标 → 数据坐标（纯函数） */
export function pixelToData(
  px: number,
  py: number,
  vp: Viewport,
  grid: GridBox,
  baseTimeMs: number,
): DataPoint {
  const delta = vp.xMin + ((px - grid.left) / grid.width) * (vp.xMax - vp.xMin);
  const v = vp.yMax - ((py - grid.top) / grid.height) * (vp.yMax - vp.yMin);
  return { t: delta + baseTimeMs, v };
}

/** 收敛视口到初始范围内并限制缩放倍率（返回新对象，不改入参） */
export function clampViewport(view: Viewport, initial: Viewport): Viewport {
  const xBase = initial.xMax - initial.xMin || 1;
  const yBase = initial.yMax - initial.yMin || 1;
  const clampSpan = (cur: number, base: number): number => {
    const min = base / MAX_ZOOM_FACTOR;
    const max = base;
    return cur < min ? min : cur > max ? max : cur;
  };
  const xs = clampSpan(view.xMax - view.xMin, xBase);
  const ys = clampSpan(view.yMax - view.yMin, yBase);
  let xc = (view.xMin + view.xMax) / 2;
  let yc = (view.yMin + view.yMax) / 2;
  if (xc - xs / 2 < initial.xMin) xc = initial.xMin + xs / 2;
  if (xc + xs / 2 > initial.xMax) xc = initial.xMax - xs / 2;
  if (yc - ys / 2 < initial.yMin) yc = initial.yMin + ys / 2;
  if (yc + ys / 2 > initial.yMax) yc = initial.yMax - ys / 2;
  return { xMin: xc - xs / 2, xMax: xc + xs / 2, yMin: yc - ys / 2, yMax: yc + ys / 2 };
}
