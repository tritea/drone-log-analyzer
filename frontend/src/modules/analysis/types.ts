
export type LineSeries = {
  id: string;
  color: string;
  buffer: Float32Array;
  count: number;
  scaleY: number;
  offsetY: number;
  xOffset: number;
  /** 运行时绘制开关（不持久化）：false 时仅跳过该曲线绘制，不影响视口/不触发重算 */
  visible?: boolean;
};

export type ValueRange = { min: number; max: number };
export type Viewport = { xMin: number; xMax: number; yMin: number; yMax: number };
export type GridMargin = { left: number; right: number; top: number; bottom: number };

export type MarkArea = { startT: number; endT: number; color: string; label?: string };
export type MarkLine = {
  t: number;
  row: number;
  color: string;
  textColor: string;
  text: string;
  kind?: string;
};
export type MarkTooltipItem = { t: number; text: string };

export type LineChartOptions = {
  grid: GridMargin;
  clearColor: number;
  panAxis: 'both' | 'x';
  resolveTooltip?: (t: number) => string | null;
  resolveMarkTooltip?: (items: MarkTooltipItem[], kind: string) => string | null;
  formatX?: (absMs: number) => string;
  enableToolbar?: boolean;
  lineWidth?: number;
  enableWheelZoom?: boolean;
  enableDragPan?: boolean;
  enableTooltip?: boolean;
  enableMarkArea?: boolean;
  enableMarkLine?: boolean;
  enableBoxZoom?: boolean;
  enableSlider?: boolean;
  playheadMode?: boolean;
};

export type LineChartDataset = {
  series: LineSeries[];
  xRange: ValueRange;
  yRange: ValueRange;
  baseTimeMs: number;
  markAreas?: MarkArea[];
  markLines?: MarkLine[];
};

export type ChartEvent = 'dataZoom' | 'restore' | 'brush';
export type ChartListener = () => void;
