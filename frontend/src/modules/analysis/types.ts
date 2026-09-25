/**
 * 图表域类型：CurveChart 的输入契约与 store 侧组装这些输入的中间结构。
 * 命名面向本域语义（曲线/视窗/色带/事件标签），不沿用通用图表库叫法。
 */

/** 一条待绘制曲线：交错 [deltaMs, value] 双值缓冲 + 显示变换（渲染层应用）。 */
export type CurveSeries = {
  id: string;
  color: string;
  buffer: Float32Array;
  count: number;
  scaleY: number;
  offsetY: number;
  /** X 平移（该曲线时间原点与统一原点的差，ms） */
  xOffset: number;
  /** 运行时绘制开关（不持久化）：false 时仅跳过绘制，不影响视口/量程 */
  visible?: boolean;
};

export type ValueRange = { min: number; max: number };

/** 绘图区外留白（CSS px）：left/right 给 Y 轴标签，bottom 给 X 轴标签，top 只留极小缝。 */
export type ChartMargins = { left: number; right: number; top: number; bottom: number };

/** 视窗（数据坐标，X 为相对时间原点的 delta ms）。 */
export type ViewWindow = { x0: number; x1: number; y0: number; y1: number };

/** 模式色带 / AI 警示带：一段绝对时间区间铺背景色。 */
export type BandSpec = {
  startT: number;
  endT: number;
  color: string;
  label?: string;
  /** 标签距绘图区顶部的偏移（px，缺省 6）；第二行标注（如 AI 问题标题）用更大值错开。 */
  labelTop?: number;
  /** z 深度（缺省 -2）：AI 警示带与模式色带错层，防共面 z-fighting。 */
  z?: number;
};

/** 事件标签（错误/事件/消息/AI 问题时段）：时间点上的 pill 标注。 */
export type TagSpec = {
  t: number;
  row: number;
  color: string;
  text: string;
  kind?: string;
  /** 业务回查 id（如 AI 问题时段 id），点击标签时回传给 onTagClick。 */
  id?: string;
  /** tooltip 补充说明（如 AI 问题时段的结论描述）。 */
  detail?: string;
};

export type TagTipItem = { t: number; text: string; detail?: string };

/** CurveChart 配置：能力开关缺省关（tooltip/bands/tags/rectZoom），滚轮/拖拽缺省开。 */
export type CurveChartConfig = {
  bgColor: number;
  /** 绘图区留白（轴 gutter）。top 保持小值——绘图区尽量占满元素，不留大空白。 */
  margins: ChartMargins;
  panAxis?: 'both' | 'x';
  strokeWidth?: number;
  tooltip?: boolean;
  bands?: boolean;
  tags?: boolean;
  wheelZoom?: boolean;
  dragPan?: boolean;
  rectZoom?: boolean;
  resolveTip?: (t: number) => string | null;
  resolveTagTip?: (items: TagTipItem[], kind: string) => string | null;
  onTagClick?: (tag: { t: number; kind: string; id?: string }) => void;
  formatX?: (absMs: number) => string;
};

/** 一次完整装载数据集：曲线 + 量程 + 时间原点 + 标注。 */
export type ChartDataset = {
  series: CurveSeries[];
  xRange: ValueRange;
  yRange: ValueRange;
  baseTimeMs: number;
  bands?: BandSpec[];
  tags?: TagSpec[];
};

/** viewport=视窗变化（缩放/平移/框选/聚焦）；reset=复位；select=框选生效。 */
export type ChartEventName = 'viewport' | 'reset' | 'select';
export type ChartListener = () => void;
