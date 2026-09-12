import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { parseColor } from '../utils/color';
import { niceNumberStep, niceTimeStep, ticksInRange, formatTickNumber, dedupeTicks } from '../utils/ticks';
import {
  dataToPixel as projectToPixel,
  pixelToData as unprojectPixel,
  clampViewport,
} from '../utils/viewport';
import type { PixelPoint, DataPoint, GridBox, GridRect } from '../utils/viewport';
import {
  OVERLAY_STYLE,
  TOOLTIP_STYLE,
  MARK_TOOLTIP_STYLE,
  BOX_SELECT_STYLE,
  X_AXIS_STYLE,
  Y_AXIS_STYLE,
  TOOLBAR_STYLE,
  TOOLBAR_BUTTON_STYLE,
  ICON_BOX_SELECT,
  ICON_RESET,
} from './styles';
import type {
  LineSeries,
  Viewport,
  ValueRange,
  MarkArea,
  MarkLine,
  MarkTooltipItem,
  LineChartOptions,
  LineChartDataset,
  ChartEvent,
  ChartListener,
} from '../types';

// ---- 调参常量（原散落各处的魔数，集中命名） ----

// 视口留白（占数据量程的比例）
const Y_PAD_RATIO = 0.03;
const BANDS_TOP_PAD_RATIO = 0.05; // 有飞行模式色带时，额外顶部留白
const TAG_BASE_PAD_RATIO = 0.03; // 有事件标签时，基础底部留白
const TAG_ROW_PAD_RATIO = 0.03; // 每多一行事件标签，额外底部留白

// 刻度去重的最小间距（占量程比例）
const TICK_GAP_X_RATIO = 0.02;
const TICK_GAP_Y_RATIO = 0.05;

// 交互时序 / 阈值
const HISTORY_LIMIT = 50; // 视口缩放历史栈上限
const PAINT_MIN_INTERVAL_MS = 15; // 合并连续重绘的单帧最小间隔
const WHEEL_HISTORY_INTERVAL_MS = 250; // 滚轮连续滚动合并为一次历史的窗口
const ZOOM_FACTOR = 1.15; // 单次滚轮缩放倍率
const BOX_SELECT_MIN_PX = 4; // 框选生效的最小拖拽尺寸
const EVENT_TIP_HIDE_DELAY_MS = 180; // 事件标签提示框延迟隐藏
const TOOLTIP_OFFSET_PX = 14; // 数据提示框相对鼠标偏移
const TOOLTIP_MARGIN_PX = 4; // 数据提示框距容器边缘安全间距

// 渲染
const DEFAULT_LINE_WIDTH = 2; // opts.lineWidth 缺省值
const DEPTH_BAND = -2; // 色带 z（背景层之后）
const DEPTH_GRID = -1; // 网格线 z
const DEPTH_CROSSHAIR = 1; // 十字光标 z（数据线之前）
const RENDER_ORDER_BG = 0;
const RENDER_ORDER_GRID = 1;
const RENDER_ORDER_PLOT = 2;
const RENDER_ORDER_FG = 3;

// 颜色
const GRID_LINE_COLOR = 0xeef1f5;
const CROSSHAIR_LINE_COLOR = 0xcbd5e1;
const BOX_SELECT_ACTIVE_BG = '#3b82f6';
const BOX_SELECT_ACTIVE_FG = '#fff';
const BOX_SELECT_IDLE_FG = '#4b5563';

type SeriesMesh = {
  mesh: Line2;
  geometry: LineGeometry;
  material: LineMaterial;
  series: LineSeries;
};
type GridLayer = {
  line: THREE.LineSegments;
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial;
};
type GuideLine = {
  line: THREE.Line;
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial;
};
type BandBlock = {
  mesh: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  material: THREE.MeshBasicMaterial;
  labelEl: HTMLDivElement | null;
  startT: number;
  endT: number;
};
type EventTag = { el: HTMLDivElement; t: number; row: number; kind: string; text: string; id?: string; detail?: string };

/**
 * 专用折线图：Three.js 正交相机 + DOM overlay。
 *
 * 系列更新走「增量同步」(syncSeries，按 id diff)：
 *  - 新增曲线只建一条 mesh；
 *  - 移除只销毁一条；
 *  - 数据未变（buffer 引用相同）则复用 geometry，绝不重建；
 *  - 仅颜色 / 缩放 / 偏移变更时，只 patch 对应材质与变换。
 * 因此切换 / 增删单条曲线不会触发全量重建。
 *
 * 公开方法名保持稳定（供 analysis / scene-3d 两个 store 调用）；
 * 色带与事件标签数量有界，仍随 setOption 整体重建（开销可忽略）。
 */
export class LineChart {
  private el: HTMLElement;
  private overlay: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private bgGroup: THREE.Group;
  private gridGroup: THREE.Group;
  private fgGroup: THREE.Group;
  private camera: THREE.OrthographicCamera;
  private resizeObserver: ResizeObserver | null = null;
  private frameId = 0;
  private lastRenderTs = 0;

  private opts: LineChartOptions;
  private clearColor: number;

  private plot: GridBox = { left: 0, top: 0, width: 0, height: 0 };
  private plotDev = { x: 0, y: 0, w: 0, h: 0 };

  private plots: SeriesMesh[] = [];
  private gridLayer: GridLayer | null = null;
  private crosshairV: GuideLine | null = null;
  private crosshairH: GuideLine | null = null;
  private bands: BandBlock[] = [];
  private tags: EventTag[] = [];
  private tooltipEl: HTMLDivElement | null = null;
  private eventTipEl: HTMLDivElement | null = null;
  private xAxisEl: HTMLDivElement | null = null;
  private yAxisEl: HTMLDivElement | null = null;
  private boxSelectBtn: HTMLButtonElement | null = null;

  private baseTimeMs = 0;
  private initialViewport: Viewport = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  private viewport: Viewport = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  private history: Viewport[] = [];

  private tooltipEnabled = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private boxSelectEl: HTMLDivElement | null = null;
  private boxStart: { x: number; y: number } | null = null;
  private lastWheelTime = 0;
  private boxSelectMode = false;
  private lastPointer: PixelPoint | null = null;

  private listeners: Record<ChartEvent, ChartListener[]> = {
    dataZoom: [],
    restore: [],
    brush: [],
  };

  constructor(el: HTMLElement, opts: LineChartOptions) {
    this.el = el;
    this.opts = opts;
    this.clearColor = opts.clearColor;
    this.tooltipEnabled = !!opts.enableTooltip;
    this.boxSelectMode = !!opts.enableBoxZoom;

    const cssW = el.clientWidth || 1;
    const cssH = el.clientHeight || 1;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(cssW, cssH, false);
    this.renderer.setClearColor(this.clearColor, 1);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    el.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.bgGroup = new THREE.Group();
    this.bgGroup.renderOrder = RENDER_ORDER_BG;
    this.scene.add(this.bgGroup);
    this.gridGroup = new THREE.Group();
    this.gridGroup.renderOrder = RENDER_ORDER_GRID;
    this.scene.add(this.gridGroup);
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
    this.fgGroup = new THREE.Group();
    this.fgGroup.renderOrder = RENDER_ORDER_FG;
    this.scene.add(this.fgGroup);

    this.overlay = this.createOverlay();
    this.createAxisNodes();

    if (opts.enableTooltip) {
      this.tooltipEl = this.createNode(TOOLTIP_STYLE, 'gpu-tooltip');
      this.overlay.appendChild(this.tooltipEl);
      this.initCrosshair();
    }
    if (opts.enableBoxZoom) {
      this.boxSelectEl = this.createNode(BOX_SELECT_STYLE);
      this.overlay.appendChild(this.boxSelectEl);
    }
    if (opts.enableMarkLine && opts.resolveMarkTooltip) {
      this.eventTipEl = this.createNode(MARK_TOOLTIP_STYLE, 'gpu-tooltip gpu-mark-tooltip');
      this.eventTipEl.addEventListener('mouseenter', () => this.cancelHideEventTip());
      this.eventTipEl.addEventListener('mouseleave', () => this.scheduleHideEventTip());
      this.overlay.appendChild(this.eventTipEl);
    }
    if (opts.enableToolbar) this.createToolbar();

    this.measure(cssW, cssH);
    this.bindEvents();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(el);
  }

  // ---- DOM 节点构造 ----

  private createOverlay(): HTMLElement {
    const parent = this.el.parentElement || this.el;
    const overlay = document.createElement('div');
    overlay.className = 'gpu-overlay';
    overlay.style.cssText = OVERLAY_STYLE;
    parent.appendChild(overlay);
    return overlay;
  }

  private createNode(cssText: string, className?: string): HTMLDivElement {
    const node = document.createElement('div');
    if (className) node.className = className;
    node.style.cssText = cssText;
    return node;
  }

  private createAxisNodes(): void {
    this.xAxisEl = this.createNode(X_AXIS_STYLE);
    this.overlay.appendChild(this.xAxisEl);
    this.yAxisEl = this.createNode(Y_AXIS_STYLE);
    this.overlay.appendChild(this.yAxisEl);
  }

  private createToolbar(): void {
    const toolbar = this.createNode(TOOLBAR_STYLE);
    this.overlay.appendChild(toolbar);

    const boxBtn = this.createToolbarButton(ICON_BOX_SELECT, '框选缩放（点击切换）');
    boxBtn.addEventListener('click', () => this.setBoxZoomActive(!this.boxSelectMode));
    toolbar.appendChild(boxBtn);
    this.boxSelectBtn = boxBtn;

    const resetBtn = this.createToolbarButton(ICON_RESET, '重置视图');
    resetBtn.addEventListener('click', () => this.resetZoom());
    toolbar.appendChild(resetBtn);
  }

  private createToolbarButton(icon: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.title = title;
    btn.style.cssText = TOOLBAR_BUTTON_STYLE;
    btn.innerHTML = icon;
    return btn;
  }

  // ---- 尺寸 / 坐标 ----

  private measure(cssW: number, cssH: number): void {
    const g = this.opts.grid;
    this.plot = {
      left: g.left,
      top: g.top,
      width: Math.max(1, cssW - g.left - g.right),
      height: Math.max(1, cssH - g.top - g.bottom),
    };
    const dpr = this.renderer.getPixelRatio();
    this.plotDev = {
      x: Math.round(this.plot.left * dpr),
      y: Math.round((cssH - this.plot.top - this.plot.height) * dpr),
      w: Math.round(this.plot.width * dpr),
      h: Math.round(this.plot.height * dpr),
    };
    if (this.xAxisEl) {
      this.xAxisEl.style.left = `${this.plot.left}px`;
      this.xAxisEl.style.top = `${this.plot.top + this.plot.height}px`;
      this.xAxisEl.style.width = `${this.plot.width}px`;
      this.xAxisEl.style.height = `${this.opts.grid.bottom}px`;
    }
    if (this.yAxisEl) {
      this.yAxisEl.style.left = '0px';
      this.yAxisEl.style.top = `${this.plot.top}px`;
      this.yAxisEl.style.width = `${this.opts.grid.left}px`;
      this.yAxisEl.style.height = `${this.plot.height}px`;
    }
  }

  dataToPixel(t: number, v: number): PixelPoint {
    return projectToPixel(t, v, this.viewport, this.plot, this.baseTimeMs);
  }

  pixelToData(px: number, py: number): DataPoint {
    return unprojectPixel(px, py, this.viewport, this.plot, this.baseTimeMs);
  }

  getGridRect(): GridRect {
    return {
      x: this.plot.left,
      y: this.plot.top,
      width: this.plot.width,
      height: this.plot.height,
    };
  }

  getEl(): HTMLElement {
    return this.el;
  }

  getZoomWindow(): ValueRange {
    return {
      min: this.viewport.xMin + this.baseTimeMs,
      max: this.viewport.xMax + this.baseTimeMs,
    };
  }

  // ---- 数据装载 ----

  setOption(opt: LineChartDataset): void {
    this.baseTimeMs = opt.baseTimeMs;
    const xMin = opt.xRange.min - opt.baseTimeMs;
    const xMax = opt.xRange.max - opt.baseTimeMs;
    const ySpan = opt.yRange.max - opt.yRange.min || 1;

    const topPad = Y_PAD_RATIO + (opt.markAreas?.length ? BANDS_TOP_PAD_RATIO : 0);
    const bottomPad = Y_PAD_RATIO + this.tagBottomPad(opt.markLines);

    const yMin = opt.yRange.min - ySpan * bottomPad;
    const yMax = opt.yRange.max + ySpan * topPad;
    this.initialViewport = { xMin, xMax, yMin, yMax };
    this.viewport = { xMin, xMax, yMin, yMax };
    this.history = [];

    this.syncSeries(opt.series);
    this.buildBands(opt.markAreas || []);
    this.buildTags(opt.markLines || []);
    this.applyViewport(false);
    this.emit('dataZoom');
  }

  /** 事件标签占用底部行数 → 对应的额外底部留白比例 */
  private tagBottomPad(lines: MarkLine[] | undefined): number {
    if (!lines?.length) return 0;
    let lastRow = 0;
    for (const ln of lines) if (ln.row > lastRow) lastRow = ln.row;
    return TAG_BASE_PAD_RATIO + lastRow * TAG_ROW_PAD_RATIO;
  }

  /** 当前 Y 留白（来自已构建的 bands / tags）：顶部受色带影响，底部受事件标签行数影响 */
  private yPad(): { top: number; bottom: number } {
    const top = Y_PAD_RATIO + (this.bands.length ? BANDS_TOP_PAD_RATIO : 0);
    let lastRow = 0;
    for (const t of this.tags) if (t.row > lastRow) lastRow = t.row;
    const bottom = Y_PAD_RATIO + (this.tags.length ? TAG_BASE_PAD_RATIO + lastRow * TAG_ROW_PAD_RATIO : 0);
    return { top, bottom };
  }

  /** 批量替换曲线集合（增量同步：复用未变 mesh，仅重建变更项） */
  setSeries(series: LineSeries[]): void {
    this.syncSeries(series);
    this.schedulePaint();
  }

  /**
   * 重算 Y 量程并刷新，**保留当前 X 缩放窗口**。
   * 用于曲线缩放 / 偏移变更（Y 范围变化、时间窗口不变）：只更新 Y 上下界
   * （初始与当前视口同步重置到新量程），X 维持用户当前缩放，不清空缩放历史。
   */
  refitYRange(yRange: ValueRange): void {
    const ySpan = yRange.max - yRange.min || 1;
    const { top, bottom } = this.yPad();
    const yMin = yRange.min - ySpan * bottom;
    const yMax = yRange.max + ySpan * top;
    this.initialViewport = { ...this.initialViewport, yMin, yMax };
    this.viewport = { ...this.viewport, yMin, yMax };
    this.applyViewport(false);
  }

  /** 运行时绘制开关：仅切换某条曲线 mesh 的可见性，不改视口、不重算、不重载 */
  setSeriesVisible(id: string, visible: boolean): void {
    let changed = false;
    for (const entry of this.plots) {
      if (entry.series.id !== id) continue;
      entry.mesh.visible = visible;
      changed = true;
    }
    if (changed) this.schedulePaint();
  }

  updateTransform(id: string, scaleY: number, offsetY: number): void {
    for (const entry of this.plots) {
      if (entry.series.id !== id) continue;
      entry.series.scaleY = scaleY;
      entry.series.offsetY = offsetY;
      entry.mesh.scale.set(1, scaleY, 1);
      entry.mesh.position.set(0, offsetY, 0);
    }
    this.schedulePaint();
  }

  setLinewidth(w: number): void {
    for (const entry of this.plots) entry.material.linewidth = w;
    this.schedulePaint();
  }

  // ---- 系列（增量同步） ----

  /**
   * 按 id diff 同步曲线集合：
   *  - 同 id 且 buffer 引用未变 → 复用 geometry，仅 patch 颜色 / 缩放 / 偏移 / 可见性；
   *  - 同 id 但 buffer 变了 → 只重建该条 geometry；
   *  - 新 id → 新建一条 mesh；
   *  - 消失的 id → 销毁其 mesh / geometry / material。
   * 复杂度随「真正变化」的曲线数，而非总曲线数。
   */
  private syncSeries(incoming: LineSeries[]): void {
    const byId = new Map<string, SeriesMesh>();
    for (const m of this.plots) byId.set(m.series.id, m);

    const kept = new Set<string>();
    const next: SeriesMesh[] = [];
    for (const s of incoming) {
      if (!s.count) continue;
      kept.add(s.id);
      const existing = byId.get(s.id);
      if (existing) {
        this.patchSeriesMesh(existing, s);
        next.push(existing);
      } else {
        const entry = this.createSeriesMesh(s);
        this.scene.add(entry.mesh);
        next.push(entry);
      }
    }

    for (const m of this.plots) {
      if (kept.has(m.series.id)) continue;
      this.scene.remove(m.mesh);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.plots = next;
  }

  private createSeriesMesh(s: LineSeries): SeriesMesh {
    const geometry = new LineGeometry();
    geometry.setPositions(this.buildPositions(s));
    const material = new LineMaterial({
      color: new THREE.Color(s.color),
      linewidth: this.opts.lineWidth || DEFAULT_LINE_WIDTH,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    material.resolution.set(this.plotDev.w || 1, this.plotDev.h || 1);
    const mesh = new Line2(geometry, material);
    mesh.renderOrder = RENDER_ORDER_PLOT;
    mesh.scale.set(1, s.scaleY, 1);
    mesh.position.set(s.xOffset || 0, s.offsetY, 0);
    mesh.visible = s.visible !== false;
    return { mesh, geometry, material, series: s };
  }

  /** 就地更新一条已有 mesh：仅在数据变化时重建 geometry，否则只 patch 轻量属性 */
  private patchSeriesMesh(entry: SeriesMesh, s: LineSeries): void {
    const dataChanged = s.buffer !== entry.series.buffer || s.count !== entry.series.count;
    if (dataChanged) {
      const nextGeo = new LineGeometry();
      nextGeo.setPositions(this.buildPositions(s));
      const oldGeo = entry.geometry;
      entry.mesh.geometry = nextGeo;
      oldGeo.dispose();
      entry.geometry = nextGeo;
    }
    if (s.color !== entry.series.color) entry.material.color = new THREE.Color(s.color);
    entry.mesh.scale.set(1, s.scaleY, 1);
    entry.mesh.position.set(s.xOffset || 0, s.offsetY, 0);
    entry.mesh.visible = s.visible !== false;
    entry.series = s;
  }

  /** LineSeries 的双值交错 buffer → Three.js 需要的 XYZ 位置数组 */
  private buildPositions(s: LineSeries): Float32Array {
    const positions = new Float32Array(s.count * 3);
    for (let j = 0; j < s.count; j++) {
      positions[j * 3] = s.buffer[j * 2];
      positions[j * 3 + 1] = s.buffer[j * 2 + 1];
      positions[j * 3 + 2] = 0;
    }
    return positions;
  }

  private buildBands(areas: MarkArea[]): void {
    for (const band of this.bands) {
      this.bgGroup.remove(band.mesh);
      band.geometry.dispose();
      band.material.dispose();
      band.labelEl?.remove();
    }
    this.bands = [];
    if (!this.opts.enableMarkArea) return;

    const iv = this.initialViewport;
    const bandH = iv.yMax - iv.yMin || 1;
    const bandY = (iv.yMax + iv.yMin) / 2;
    for (const area of areas) {
      const startD = area.startT - this.baseTimeMs;
      const endD = area.endT - this.baseTimeMs;
      const w = endD - startD;
      if (!(w > 0)) continue;
      const geometry = new THREE.PlaneGeometry(1, 1);
      const parsed = parseColor(area.color);
      const material = new THREE.MeshBasicMaterial({
        color: parsed.color,
        transparent: true,
        opacity: parsed.opacity,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = RENDER_ORDER_BG;
      mesh.position.set((startD + endD) / 2, bandY, DEPTH_BAND);
      mesh.scale.set(w, bandH, 1);
      this.bgGroup.add(mesh);

      let labelEl: HTMLDivElement | null = null;
      if (area.label) {
        labelEl = document.createElement('div');
        labelEl.textContent = area.label;
        labelEl.className = 'gpu-mode-label';
        labelEl.style.cssText = `position:absolute;color:#374151;font:700 12px -apple-system,"Microsoft YaHei",sans-serif;pointer-events:none;transform:translateX(-50%);top:${this.plot.top + (area.labelTop ?? 6)}px;white-space:nowrap;letter-spacing:0.3px;text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff,0 1px 2px rgba(0,0,0,0.25);`;
        this.overlay.appendChild(labelEl);
      }
      this.bands.push({
        mesh,
        geometry,
        material,
        labelEl,
        startT: area.startT,
        endT: area.endT,
      });
    }
  }

  private buildTags(lines: MarkLine[]): void {
    for (const tag of this.tags) tag.el.remove();
    this.tags = [];
    if (!this.opts.enableMarkLine) return;

    for (const ln of lines) {
      const kind = ln.kind || '';
      const el = document.createElement('div');
      el.className = `gpu-event-label gpu-event-row-${ln.row}`;
      el.textContent = ln.text;
      const hex = `#${parseColor(ln.color).color.getHexString()}`;
      const clickable = !!this.opts.onMarkClick;
      el.style.cssText = `position:absolute;font:600 10px -apple-system,"Microsoft YaHei",sans-serif;pointer-events:auto;white-space:nowrap;background:${hex};border-radius:999px;padding:1px 7px;color:#ffffff;box-shadow:0 1px 2px rgba(15,23,42,0.18);display:none;cursor:${clickable ? 'pointer' : 'default'};`;
      el.addEventListener('mouseenter', () => this.onTagHover(kind, el));
      el.addEventListener('mouseleave', () => this.scheduleHideEventTip());
      if (clickable) {
        el.addEventListener('click', () => this.opts.onMarkClick?.({ t: ln.t, kind, id: ln.id }));
      }
      this.overlay.appendChild(el);
      this.tags.push({ el, t: ln.t, row: ln.row, kind, text: ln.text, id: ln.id, detail: ln.detail });
    }
  }

  // ---- 网格 / 刻度 ----

  private drawGrid(): void {
    if (this.gridLayer) {
      this.gridGroup.remove(this.gridLayer.line);
      this.gridLayer.geometry.dispose();
      this.gridLayer.material.dispose();
    }
    const vp = this.viewport;
    const xStep = niceTimeStep(vp.xMax - vp.xMin, 8);
    const yStep = niceNumberStep(vp.yMax - vp.yMin, 6);
    const xTicks = ticksInRange(vp.xMin, vp.xMax, xStep);
    const yTicks = ticksInRange(vp.yMin, vp.yMax, yStep);

    const positions: number[] = [];
    for (const tx of xTicks) positions.push(tx, vp.yMin, DEPTH_GRID, tx, vp.yMax, DEPTH_GRID);
    for (const ty of yTicks) positions.push(vp.xMin, ty, DEPTH_GRID, vp.xMax, ty, DEPTH_GRID);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: GRID_LINE_COLOR });
    const line = new THREE.LineSegments(geometry, material);
    line.renderOrder = RENDER_ORDER_GRID;
    this.gridGroup.add(line);
    this.gridLayer = { line, geometry, material };

    this.drawTicks(xTicks, yTicks, yStep);
  }

  private drawTicks(xTicks: number[], yTicks: number[], yStep: number): void {
    const vp = this.viewport;
    const g = this.plot;
    const xSpan = vp.xMax - vp.xMin || 1;
    const ySpan = vp.yMax - vp.yMin || 1;

    const xFinal = dedupeTicks([...xTicks, vp.xMin, vp.xMax], xSpan * TICK_GAP_X_RATIO);
    const yFinal = dedupeTicks([...yTicks, vp.yMin, vp.yMax], ySpan * TICK_GAP_Y_RATIO);

    if (this.xAxisEl) {
      this.xAxisEl.innerHTML = '';
      for (const d of xFinal) {
        const px = g.left + ((d - vp.xMin) / xSpan) * g.width;
        const tick = document.createElement('div');
        tick.style.cssText = 'position:absolute;width:1px;height:5px;background:#9ca3af;transform:translateX(-50%);';
        tick.style.left = `${px - g.left}px`;
        tick.style.top = '0px';
        this.xAxisEl.appendChild(tick);
        const lab = document.createElement('div');
        lab.style.cssText = 'position:absolute;transform:translateX(-50%);font:11px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#6b7280;white-space:nowrap;letter-spacing:0.2px;';
        lab.style.left = `${px - g.left}px`;
        lab.style.top = '8px';
        lab.textContent = this.opts.formatX ? this.opts.formatX(this.baseTimeMs + d) : String(Math.round(d));
        this.xAxisEl.appendChild(lab);
      }
    }
    if (this.yAxisEl) {
      this.yAxisEl.innerHTML = '';
      for (const v of yFinal) {
        const py = g.top + ((vp.yMax - v) / ySpan) * g.height;
        const tick = document.createElement('div');
        tick.style.cssText = 'position:absolute;width:5px;height:1px;background:#9ca3af;transform:translateY(-50%);';
        tick.style.top = `${py - g.top}px`;
        tick.style.right = '0px';
        this.yAxisEl.appendChild(tick);
        const lab = document.createElement('div');
        lab.style.cssText = 'position:absolute;right:8px;transform:translateY(-50%);font:11px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#6b7280;white-space:nowrap;text-align:right;';
        lab.style.top = `${py - g.top}px`;
        lab.textContent = formatTickNumber(v, yStep);
        this.yAxisEl.appendChild(lab);
      }
    }
  }

  // ---- 十字光标 ----

  private initCrosshair(): void {
    const make = (): GuideLine => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, DEPTH_CROSSHAIR, 0, 0, DEPTH_CROSSHAIR], 3));
      const material = new THREE.LineBasicMaterial({
        color: CROSSHAIR_LINE_COLOR,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const line = new THREE.Line(geometry, material);
      line.renderOrder = RENDER_ORDER_FG;
      line.frustumCulled = false;
      line.visible = false;
      this.fgGroup.add(line);
      return { line, geometry, material };
    };
    this.crosshairV = make();
    this.crosshairH = make();
  }

  private placeCrosshair(px: number, py: number): void {
    if (!this.crosshairV || !this.crosshairH) return;
    const d = this.pixelToData(px, py);
    const delta = d.t - this.baseTimeMs;
    const vp = this.viewport;
    const v = this.crosshairV.geometry.attributes.position as THREE.BufferAttribute;
    v.setXYZ(0, delta, vp.yMin, DEPTH_CROSSHAIR);
    v.setXYZ(1, delta, vp.yMax, DEPTH_CROSSHAIR);
    v.needsUpdate = true;
    const h = this.crosshairH.geometry.attributes.position as THREE.BufferAttribute;
    h.setXYZ(0, vp.xMin, d.v, DEPTH_CROSSHAIR);
    h.setXYZ(1, vp.xMax, d.v, DEPTH_CROSSHAIR);
    h.needsUpdate = true;
    this.crosshairV.line.visible = true;
    this.crosshairH.line.visible = true;
    this.schedulePaint();
  }

  private hideCrosshair(): void {
    if (this.crosshairV) this.crosshairV.line.visible = false;
    if (this.crosshairH) this.crosshairH.line.visible = false;
    this.schedulePaint();
  }

  private realignCrosshair(): void {
    if (!this.crosshairV || !this.crosshairV.line.visible || !this.lastPointer) return;
    const g = this.plot;
    const { px, py } = this.lastPointer;
    if (px < g.left || px > g.left + g.width || py < g.top || py > g.top + g.height) {
      this.hideCrosshair();
      return;
    }
    this.placeCrosshair(px, py);
  }

  // ---- overlay 定位 ----

  private placeOverlays(): void {
    this.hideEventTipNow();
    const g = this.plot;
    const vp = this.viewport;
    const inX = (t: number): { px: number; visible: boolean } => {
      const delta = t - this.baseTimeMs;
      const px = g.left + ((delta - vp.xMin) / (vp.xMax - vp.xMin)) * g.width;
      return { px, visible: delta >= vp.xMin && delta <= vp.xMax };
    };
    for (const tag of this.tags) {
      const r = inX(tag.t);
      tag.el.style.display = r.visible ? 'block' : 'none';
      tag.el.style.left = `${r.px}px`;
      tag.el.style.top = `${this.plot.top + this.plot.height - 16 - tag.row * 18}px`;
    }
    for (const band of this.bands) {
      if (!band.labelEl) continue;
      const visStart = Math.max(band.startT, vp.xMin + this.baseTimeMs);
      const visEnd = Math.min(band.endT, vp.xMax + this.baseTimeMs);
      if (visEnd <= visStart) {
        band.labelEl.style.display = 'none';
        continue;
      }
      const r = inX((visStart + visEnd) / 2);
      band.labelEl.style.display = 'block';
      band.labelEl.style.left = `${r.px}px`;
    }
  }

  // ---- 视口 ----

  private applyViewport(emit: boolean): void {
    this.viewport = clampViewport(this.viewport, this.initialViewport);
    const vp = this.viewport;
    this.camera.left = vp.xMin;
    this.camera.right = vp.xMax;
    this.camera.top = vp.yMax;
    this.camera.bottom = vp.yMin;
    this.camera.updateProjectionMatrix();
    this.drawGrid();
    this.placeOverlays();
    this.realignCrosshair();
    this.schedulePaint();
    if (emit) this.emit('dataZoom');
  }

  private pushHistory(): void {
    this.history.push({ ...this.viewport });
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  undoZoom(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.viewport = prev;
    this.applyViewport(true);
  }

  resetZoom(): void {
    this.history = [];
    this.viewport = { ...this.initialViewport };
    this.applyViewport(false);
    this.emit('restore');
  }

  /**
   * 聚焦一个绝对时间窗（如 AI 问题时段）：X 缩放到该窗口（带 15% 边距，
   * 钳制在数据范围内），Y 保持当前量程；入历史栈可撤销。
   */
  focusXWindow(x: ValueRange): void {
    const iv = this.initialViewport;
    const span = Math.max(x.max - x.min, 1);
    const pad = span * 0.15;
    const xMin = Math.max(x.min - pad - this.baseTimeMs, iv.xMin);
    const xMax = Math.min(x.max + pad - this.baseTimeMs, iv.xMax);
    if (!(xMax > xMin)) return;
    this.pushHistory();
    this.viewport = { ...this.viewport, xMin, xMax };
    this.applyViewport(true);
  }

  // ---- 渲染循环 ----

  private schedulePaint(): void {
    if (this.frameId) return;
    this.frameId = requestAnimationFrame((ts) => {
      this.frameId = 0;
      if (ts - this.lastRenderTs < PAINT_MIN_INTERVAL_MS) {
        this.schedulePaint();
        return;
      }
      this.lastRenderTs = ts;
      this.render();
    });
  }

  private render(): void {
    const r = this.renderer;
    const dpr = r.getPixelRatio();
    const cssW = this.el.clientWidth || 1;
    const cssH = this.el.clientHeight || 1;
    const devW = Math.round(cssW * dpr);
    const devH = Math.round(cssH * dpr);

    r.setScissorTest(false);
    r.setViewport(0, 0, devW, devH);
    r.setClearColor(this.clearColor, 1);
    r.clear(true, true, false);

    const g = this.plotDev;
    r.setScissorTest(true);
    r.setViewport(g.x, g.y, g.w, g.h);
    r.setScissor(g.x, g.y, g.w, g.h);
    r.render(this.scene, this.camera);
    r.setScissorTest(false);
  }

  resize(): void {
    const cssW = this.el.clientWidth || 1;
    const cssH = this.el.clientHeight || 1;
    if (cssW < 2 || cssH < 2) return;
    this.renderer.setSize(cssW, cssH, false);
    this.measure(cssW, cssH);
    const resW = this.plotDev.w || 1;
    const resH = this.plotDev.h || 1;
    for (const entry of this.plots) entry.material.resolution.set(resW, resH);
    this.drawGrid();
    this.placeOverlays();
    this.realignCrosshair();
    this.schedulePaint();
  }

  // ---- 输入 ----

  private bindEvents(): void {
    const dom = this.renderer.domElement;
    if (this.opts.enableWheelZoom !== false) dom.addEventListener('wheel', this.onWheel, { passive: false });
    if (this.opts.enableDragPan !== false || this.opts.enableBoxZoom) {
      dom.addEventListener('pointerdown', this.onPointerDown);
    }
    dom.addEventListener('contextmenu', this.onContextmenu);
    if (this.opts.enableTooltip) {
      dom.addEventListener('mousemove', this.onMouseMove);
      dom.addEventListener('mouseleave', this.onMouseLeave);
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const anchor = this.pixelToData(px, py);
    const now = performance.now();
    if (now - this.lastWheelTime > WHEEL_HISTORY_INTERVAL_MS) this.pushHistory();
    this.lastWheelTime = now;

    const factor = e.deltaY < 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
    const vp = this.viewport;
    const anchorDelta = anchor.t - this.baseTimeMs;
    vp.xMin = anchorDelta - (anchorDelta - vp.xMin) * factor;
    vp.xMax = anchorDelta - (anchorDelta - vp.xMax) * factor;
    if (this.opts.panAxis === 'both') {
      vp.yMin = anchor.v - (anchor.v - vp.yMin) * factor;
      vp.yMax = anchor.v - (anchor.v - vp.yMax) * factor;
    }
    this.applyViewport(true);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 1) e.preventDefault();
    const rect = this.el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (this.boxSelectMode && this.boxSelectEl && e.button !== 1) {
      this.pushHistory();
      this.boxStart = { x: px, y: py };
      this.boxSelectEl.style.display = 'block';
      this.boxSelectEl.style.left = `${px}px`;
      this.boxSelectEl.style.top = `${py}px`;
      this.boxSelectEl.style.width = '0px';
      this.boxSelectEl.style.height = '0px';
      window.addEventListener('pointermove', this.onBoxMove);
      window.addEventListener('pointerup', this.onBoxUp);
      return;
    }
    if (this.opts.enableDragPan === false) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.pushHistory();
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* 部分环境下 pointerId 已失效，忽略 */
    }
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  };

  private onBoxMove = (e: PointerEvent): void => {
    if (!this.boxStart || !this.boxSelectEl) return;
    const rect = this.el.getBoundingClientRect();
    const gx0 = this.plot.left;
    const gy0 = this.plot.top;
    const gx1 = gx0 + this.plot.width;
    const gy1 = gy0 + this.plot.height;
    const px = Math.max(gx0, Math.min(gx1, e.clientX - rect.left));
    const py = Math.max(gy0, Math.min(gy1, e.clientY - rect.top));
    this.boxSelectEl.style.left = `${Math.min(this.boxStart.x, px)}px`;
    this.boxSelectEl.style.top = `${Math.min(this.boxStart.y, py)}px`;
    this.boxSelectEl.style.width = `${Math.abs(px - this.boxStart.x)}px`;
    this.boxSelectEl.style.height = `${Math.abs(py - this.boxStart.y)}px`;
  };

  private onBoxUp = (e: PointerEvent): void => {
    window.removeEventListener('pointermove', this.onBoxMove);
    window.removeEventListener('pointerup', this.onBoxUp);
    if (this.boxSelectEl) this.boxSelectEl.style.display = 'none';
    if (!this.boxStart) return;
    const rect = this.el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const x0 = Math.min(this.boxStart.x, px);
    const x1 = Math.max(this.boxStart.x, px);
    const y0 = Math.min(this.boxStart.y, py);
    const y1 = Math.max(this.boxStart.y, py);
    this.boxStart = null;
    if (x1 - x0 < BOX_SELECT_MIN_PX || y1 - y0 < BOX_SELECT_MIN_PX) return;
    const a = this.pixelToData(x0, y0);
    const b = this.pixelToData(x1, y1);
    this.viewport.xMin = a.t - this.baseTimeMs;
    this.viewport.xMax = b.t - this.baseTimeMs;
    this.viewport.yMax = a.v;
    this.viewport.yMin = b.v;
    this.applyViewport(true);
    this.emit('brush');
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const rect = this.el.getBoundingClientRect();
    const dxPx = e.clientX - rect.left - (this.lastX - rect.left);
    const dyPx = e.clientY - rect.top - (this.lastY - rect.top);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    const vp = this.viewport;
    const g = this.plot;
    const dxData = (dxPx / g.width) * (vp.xMax - vp.xMin);
    const dyData = (dyPx / g.height) * (vp.yMax - vp.yMin);
    vp.xMin -= dxData;
    vp.xMax -= dxData;
    if (this.opts.panAxis === 'both') {
      vp.yMin += dyData;
      vp.yMax += dyData;
    }
    this.applyViewport(false);
  };

  private onPointerUp = (): void => {
    this.dragging = false;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.emit('dataZoom');
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.tooltipEnabled) return;
    const rect = this.el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (
      px < this.plot.left ||
      px > this.plot.left + this.plot.width ||
      py < this.plot.top ||
      py > this.plot.top + this.plot.height
    ) {
      this.lastPointer = null;
      this.hideCrosshair();
      this.hideTooltip();
      return;
    }
    this.lastPointer = { px, py };
    this.placeCrosshair(px, py);
    if (this.opts.resolveTooltip && this.tooltipEl) {
      const d = this.pixelToData(px, py);
      const html = this.opts.resolveTooltip(d.t);
      if (html) {
        this.tooltipEl.innerHTML = html;
        this.tooltipEl.style.display = 'block';
        const tw = this.tooltipEl.offsetWidth || 240;
        const th = this.tooltipEl.offsetHeight || 80;
        let left = px + TOOLTIP_OFFSET_PX;
        let top = py + TOOLTIP_OFFSET_PX;
        if (left + tw > this.el.clientWidth - TOOLTIP_MARGIN_PX) left = px - tw - TOOLTIP_OFFSET_PX;
        if (top + th > this.el.clientHeight - TOOLTIP_MARGIN_PX) top = py - th - TOOLTIP_OFFSET_PX;
        this.tooltipEl.style.left = `${left}px`;
        this.tooltipEl.style.top = `${top}px`;
      } else {
        this.tooltipEl.style.display = 'none';
      }
    }
  };

  private onMouseLeave = (): void => {
    this.lastPointer = null;
    this.hideCrosshair();
    this.hideTooltip();
  };

  private onContextmenu = (e: MouseEvent): void => {
    e.preventDefault();
    this.resetZoom();
  };

  // ---- 事件标签 hover tooltip ----

  private onTagHover = (kind: string, el: HTMLElement): void => {
    if (!this.opts.resolveMarkTooltip || !this.eventTipEl) return;
    this.cancelHideEventTip();
    const l = el.offsetLeft - 1;
    const r = el.offsetLeft + el.offsetWidth + 1;
    const items: MarkTooltipItem[] = [];
    for (const ml of this.tags) {
      if (ml.kind !== kind || ml.el.style.display === 'none') continue;
      const mlL = ml.el.offsetLeft;
      const mlR = ml.el.offsetLeft + ml.el.offsetWidth;
      if (mlL < r && mlR > l) items.push({ t: ml.t, text: ml.text, detail: ml.detail });
    }
    items.sort((a, b) => a.t - b.t);
    const html = this.opts.resolveMarkTooltip(items, kind);
    if (!html) {
      this.eventTipEl.style.display = 'none';
      return;
    }
    this.eventTipEl.innerHTML = html;
    this.eventTipEl.style.display = 'block';
    const tw = this.eventTipEl.offsetWidth || 240;
    const th = this.eventTipEl.offsetHeight || 60;
    const mx = el.offsetLeft;
    const mw = el.offsetWidth;
    const my = el.offsetTop;
    const mh = el.offsetHeight || 18;
    let left = mx + mw / 2 - tw / 2;
    if (left < TOOLTIP_MARGIN_PX) left = TOOLTIP_MARGIN_PX;
    if (left + tw > this.el.clientWidth - TOOLTIP_MARGIN_PX) left = this.el.clientWidth - tw - TOOLTIP_MARGIN_PX;
    let top = my - th - 8;
    if (top < TOOLTIP_MARGIN_PX) top = my + mh + 8;
    this.eventTipEl.style.left = `${left}px`;
    this.eventTipEl.style.top = `${top}px`;
  };

  private eventTipTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleHideEventTip = (): void => {
    if (this.eventTipTimer) clearTimeout(this.eventTipTimer);
    this.eventTipTimer = setTimeout(() => {
      this.eventTipTimer = null;
      if (this.eventTipEl) this.eventTipEl.style.display = 'none';
    }, EVENT_TIP_HIDE_DELAY_MS);
  };
  private cancelHideEventTip = (): void => {
    if (this.eventTipTimer) {
      clearTimeout(this.eventTipTimer);
      this.eventTipTimer = null;
    }
  };
  private hideEventTipNow = (): void => {
    this.cancelHideEventTip();
    if (this.eventTipEl) this.eventTipEl.style.display = 'none';
  };

  // ---- 对外小开关 ----

  clearBrush(): void {
    /* 预留：当前框选即时生效，无需清理 */
  }

  setBoxZoomActive(active: boolean): void {
    this.boxSelectMode = !!active;
    if (this.boxSelectBtn) {
      this.boxSelectBtn.style.background = this.boxSelectMode ? BOX_SELECT_ACTIVE_BG : 'transparent';
      this.boxSelectBtn.style.color = this.boxSelectMode ? BOX_SELECT_ACTIVE_FG : BOX_SELECT_IDLE_FG;
    }
  }

  hideTooltip(): void {
    if (this.tooltipEl) this.tooltipEl.style.display = 'none';
  }

  setTooltipEnabled(enabled: boolean): void {
    this.tooltipEnabled = !!enabled;
    if (!this.tooltipEnabled) {
      this.hideTooltip();
      this.hideCrosshair();
    }
  }

  setPlayheadTime(_timeMs: number): void {
    /* 预留：主图无播放游标 */
  }

  // ---- 事件订阅 ----

  on(evt: ChartEvent, cb: ChartListener): void {
    this.listeners[evt].push(cb);
  }

  off(evt: ChartEvent, cb?: ChartListener): void {
    if (!cb) {
      this.listeners[evt] = [];
      return;
    }
    const arr = this.listeners[evt];
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] === cb) arr.splice(i, 1);
  }

  private emit(evt: ChartEvent): void {
    for (const cb of this.listeners[evt]) cb();
  }

  // ---- 销毁 ----

  dispose(): void {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
    if (this.eventTipTimer) {
      clearTimeout(this.eventTipTimer);
      this.eventTipTimer = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    const dom = this.renderer.domElement;
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('contextmenu', this.onContextmenu);
    dom.removeEventListener('mousemove', this.onMouseMove);
    dom.removeEventListener('mouseleave', this.onMouseLeave);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointermove', this.onBoxMove);
    window.removeEventListener('pointerup', this.onBoxUp);

    for (const entry of this.plots) {
      this.scene.remove(entry.mesh);
      entry.geometry.dispose();
      entry.material.dispose();
    }
    if (this.gridLayer) {
      this.gridGroup.remove(this.gridLayer.line);
      this.gridLayer.geometry.dispose();
      this.gridLayer.material.dispose();
    }
    if (this.crosshairV) {
      this.fgGroup.remove(this.crosshairV.line);
      this.crosshairV.geometry.dispose();
      this.crosshairV.material.dispose();
    }
    if (this.crosshairH) {
      this.fgGroup.remove(this.crosshairH.line);
      this.crosshairH.geometry.dispose();
      this.crosshairH.material.dispose();
    }
    for (const band of this.bands) {
      this.bgGroup.remove(band.mesh);
      band.geometry.dispose();
      band.material.dispose();
      band.labelEl?.remove();
    }
    this.renderer.dispose();
    dom.remove();
    this.overlay.remove();
  }
}
