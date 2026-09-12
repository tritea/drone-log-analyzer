
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

export type MarkArea = {
  startT: number;
  endT: number;
  color: string;
  label?: string;
  /** 色带 z 深度（缺省 DEPTH_BAND）；AI 警示带与模式色带共面会 z-fighting，用不同 z 错开。 */
  z?: number;
};
export type MarkLine = {
  t: number;
  row: number;
  color: string;
  textColor: string;
  text: string;
  kind?: string;
  /** 业务回查 id（如 AI 问题时段 id），点击标记时回传给 onMarkClick。 */
  id?: string;
  /** tooltip 补充说明（如 AI 问题时段的结论描述）。 */
  detail?: string;
};
export type MarkTooltipItem = { t: number; text: string; detail?: string };

export type LineChartOptions = {
  grid: GridMargin;
  clearColor: number;
  panAxis: 'both' | 'x';
  resolveTooltip?: (t: number) => string | null;
  resolveMarkTooltip?: (items: MarkTooltipItem[], kind: string) => string | null;
  /** 点击事件标记（kind + 业务 id），用于"跳到问题时段"类联动。 */
  onMarkClick?: (mark: { t: number; kind: string; id?: string }) => void;
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
