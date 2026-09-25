import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { parseColor } from './color';
import { dedupeTicks, formatTickNumber, niceNumberStep, niceTimeStep, ticksInRange } from './ticks';
import {
  BAND_LABEL_STYLE,
  RECT_STYLE,
  SKIN_STYLE,
  TAG_PILL_STYLE,
  TAG_TIP_STYLE,
  TOOLTIP_STYLE,
  X_LABEL_STYLE,
  Y_LABEL_STYLE,
} from './styles';
import type {
  BandSpec,
  ChartDataset,
  ChartEventName,
  ChartListener,
  CurveChartConfig,
  CurveSeries,
  TagSpec,
  TagTipItem,
  ViewWindow,
} from '../types';

// ---- 调参常量 ----

// Y 留白（占数据量程比例）：固定头尾留白 + 事件标签每行补偿
const Y_PAD_RATIO = 0.03;
const TAG_PAD_BASE = 0.03;
const TAG_PAD_PER_ROW = 0.03;

// 刻度：目标数量与去重最小间距（占量程比例）
const X_TICK_TARGET = 8;
const Y_TICK_TARGET = 6;
const TICK_GAP_X_RATIO = 0.02;
const TICK_GAP_Y_RATIO = 0.05;

// 交互时序 / 阈值
const HISTORY_LIMIT = 50; // 视窗缩放历史栈上限
const WHEEL_MERGE_MS = 250; // 滚轮连续滚动合并为一次历史的窗口
const ZOOM_STEP = 1.15; // 单次滚轮缩放倍率
const RECT_SELECT_MIN_PX = 4; // 框选生效的最小拖拽尺寸
const TAG_TIP_HIDE_MS = 180; // 事件标签提示框延迟隐藏
const TIP_OFFSET_PX = 14; // 数据提示框相对指针偏移
const TIP_MARGIN_PX = 4; // 提示框距容器边缘安全间距

// 事件标签几何（相对绘图区底边，X 轴标签在绘图区外 gutter 不占位）
const TAG_ROW_PX = 18; // 事件标签每行高度
const TAG_BASE_PX = 16; // 首行事件标签距绘图区底边

// 渲染分层：z 深度 + renderOrder 双保险（色带 → 网格 → 曲线 → 叠加 → 十字线）
const Z_BAND = -2;
const Z_GRID = -1;
const Z_CROSSHAIR = 1;
const ORDER_BAND = 0;
const ORDER_GRID = 1;
const ORDER_CURVE = 2;
const ORDER_OVERLAY = 3;
const ORDER_CROSSHAIR = 4;

const DEFAULT_STROKE = 2;
const MAX_ZOOM = 500; // 视窗量程不得小于初始量程的 1/N
const MAX_GRID_SEGS = 96; // 网格预分配段数上限（x+y 刻度线各半足够）
const GRID_COLOR = 0xeef1f5;
const CROSSHAIR_COLOR = 0xcbd5e1;

type CurveMesh = {
  mesh: Line2;
  geometry: LineGeometry;
  material: LineMaterial;
  series: CurveSeries;
};
type BandBlock = {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  label: HTMLDivElement | null;
  /** 标签距绘图区顶部的偏移（px）。 */
  labelTop: number;
  startT: number;
  endT: number;
};
type TagNode = {
  el: HTMLDivElement;
  t: number;
  row: number;
  kind: string;
  text: string;
  id?: string;
  detail?: string;
  /** 当前屏幕 x/y（transform 定位，offsetLeft/Top 不可用，重叠判定与 tooltip 定位用）。 */
  px: number;
  py: number;
};

/** 视窗收敛到初始范围内并限制缩放倍率（返回新对象）。 */
function clampView(v: ViewWindow, home: ViewWindow): ViewWindow {
  const bx = home.x1 - home.x0 || 1;
  const by = home.y1 - home.y0 || 1;
  const sx = Math.min(Math.max(v.x1 - v.x0, bx / MAX_ZOOM), bx);
  const sy = Math.min(Math.max(v.y1 - v.y0, by / MAX_ZOOM), by);
  let cx = (v.x0 + v.x1) / 2;
  let cy = (v.y0 + v.y1) / 2;
  if (cx - sx / 2 < home.x0) cx = home.x0 + sx / 2;
  if (cx + sx / 2 > home.x1) cx = home.x1 - sx / 2;
  if (cy - sy / 2 < home.y0) cy = home.y0 + sy / 2;
  if (cy + sy / 2 > home.y1) cy = home.y1 - sy / 2;
  return { x0: cx - sx / 2, x1: cx + sx / 2, y0: cy - sy / 2, y1: cy + sy / 2 };
}

/** 曲线交错缓冲 [deltaMs, value] → LineGeometry 需要的 XYZ 位置数组。 */
function seriesPositions(s: CurveSeries): Float32Array {
  const out = new Float32Array(s.count * 3);
  for (let j = 0; j < s.count; j++) {
    out[j * 3] = s.buffer[j * 2];
    out[j * 3 + 1] = s.buffer[j * 2 + 1];
  }
  return out;
}

/**
 * 专用曲线图：Three.js 正交相机 + DOM skin 覆盖层。
 *
 * 布局沿用经典轴 gutter：left/bottom 留白给 Y/X 轴刻度文字，**top 只留极小缝**——
 * 绘图区尽量占满宿主元素，不留旧版那种大块顶部空白；模式色带标签、事件标签
 * 叠在绘图区内（白描边保可读）。
 *
 * 曲线集合走「增量同步」（syncCurves 按 id diff）：新增/移除只动一条 mesh，
 * buffer 未变则复用 geometry，仅颜色/变换变更时 patch 材质与变换。
 * AI 叠加曲线是独立通道（不参与视窗/量程，全量重建，数量有界）。
 *
 * 性能要点：devicePixelRatio 适配 HiDPI；网格/十字线预分配原位更新；
 * 色带共享单位几何；轴标签 DOM 池复用；高频定位走 transform；悬停解析合并到 rAF。
 */
export class CurveChart {
  private host: HTMLElement;
  private skin: HTMLElement;
  private gl: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cam: THREE.OrthographicCamera;
  private size = { w: 1, h: 1 }; // 宿主元素 CSS px
  /** 绘图区（轴 gutter 内侧，CSS px，相对宿主元素左上角）。WebGL viewport 传 CSS px（three 内部自乘 pixelRatio）。 */
  private plot = { left: 0, top: 0, width: 1, height: 1 };
  private ro: ResizeObserver | null = null;
  private raf = 0;

  private cfg: CurveChartConfig;
  private bgColor: number;
  private hoverOn: boolean;
  private rectZoomOn: boolean;

  private timeOrigin = 0; // baseTimeMs：数据 delta 时间 → 绝对 ms 的原点
  private home: ViewWindow = { x0: 0, x1: 1, y0: 0, y1: 1 };
  private view: ViewWindow = { x0: 0, x1: 1, y0: 0, y1: 1 };
  private past: ViewWindow[] = [];

  private curves: CurveMesh[] = [];
  private ghost: CurveMesh[] = []; // AI 叠加通道
  private quad: THREE.PlaneGeometry; // 色带共享单位几何
  private bandBlocks: BandBlock[] = [];
  private tags: TagNode[] = [];

  private grid: THREE.LineSegments;
  private gridBuf: Float32Array; // 预分配网格顶点（x,y,z 三元组）
  private gridAttr: THREE.BufferAttribute;
  private crosshair: THREE.LineSegments; // 竖+横两段合一
  private crossAttr: THREE.BufferAttribute;

  private xLabels: HTMLDivElement[] = [];
  private yLabels: HTMLDivElement[] = [];
  private tipEl: HTMLDivElement | null = null;
  private tagTipEl: HTMLDivElement | null = null;
  private rectEl: HTMLDivElement | null = null;

  private hoverRaf = 0;
  private hoverAt: { x: number; y: number } | null = null;
  private hostRectCache: DOMRect | null = null;
  private panning = false;
  private panLast = { x: 0, y: 0 };
  private rectStart: { x: number; y: number } | null = null;
  private lastWheel = 0;
  private tagTipTimer: ReturnType<typeof setTimeout> | null = null;

  private listeners: Record<ChartEventName, ChartListener[]> = {
    viewport: [],
    reset: [],
    select: [],
  };

  constructor(host: HTMLElement, cfg: CurveChartConfig) {
    this.host = host;
    this.cfg = cfg;
    this.bgColor = cfg.bgColor;
    this.hoverOn = !!cfg.tooltip;
    this.rectZoomOn = !!cfg.rectZoom;

    this.gl = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.gl.setPixelRatio(window.devicePixelRatio || 1);
    this.gl.setSize(host.clientWidth || 1, host.clientHeight || 1, false);
    this.gl.setClearColor(this.bgColor, 1);
    this.gl.domElement.style.display = 'block';
    this.gl.domElement.style.width = '100%';
    this.gl.domElement.style.height = '100%';
    host.appendChild(this.gl.domElement);

    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);

    // 色带共享单位平面（缩放/定位由 mesh 变换承担）
    this.quad = new THREE.PlaneGeometry(1, 1);

    // 网格：预分配缓冲，视窗变化时原位重写 + drawRange 收口
    this.gridBuf = new Float32Array(MAX_GRID_SEGS * 6);
    const geo = new THREE.BufferGeometry();
    this.gridAttr = new THREE.BufferAttribute(this.gridBuf, 3);
    this.gridAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.gridAttr);
    geo.setDrawRange(0, 0);
    this.grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: GRID_COLOR }));
    this.grid.renderOrder = ORDER_GRID;
    this.grid.frustumCulled = false;
    this.scene.add(this.grid);

    // 十字线：竖横两段合一个 LineSegments（4 顶点原位更新）
    const crossGeo = new THREE.BufferGeometry();
    this.crossAttr = new THREE.BufferAttribute(new Float32Array(12), 3);
    this.crossAttr.setUsage(THREE.DynamicDrawUsage);
    crossGeo.setAttribute('position', this.crossAttr);
    this.crosshair = new THREE.LineSegments(crossGeo, new THREE.LineBasicMaterial({
      color: CROSSHAIR_COLOR,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }));
    this.crosshair.renderOrder = ORDER_CROSSHAIR;
    this.crosshair.frustumCulled = false;
    this.crosshair.visible = false;
    this.scene.add(this.crosshair);

    // DOM skin：挂在宿主元素内部（canvas 之上），inset:0 铺满
    this.skin = document.createElement('div');
    this.skin.className = 'chart-skin';
    this.skin.style.cssText = SKIN_STYLE;
    host.appendChild(this.skin);

    if (cfg.rectZoom) {
      this.rectEl = document.createElement('div');
      this.rectEl.style.cssText = RECT_STYLE;
      this.skin.appendChild(this.rectEl);
    }
    if (cfg.tooltip) {
      this.tipEl = document.createElement('div');
      this.tipEl.className = 'chart-tip';
      this.tipEl.style.cssText = TOOLTIP_STYLE;
      this.skin.appendChild(this.tipEl);
    }
    if (cfg.tags && cfg.resolveTagTip) {
      this.tagTipEl = document.createElement('div');
      this.tagTipEl.className = 'chart-tag-tip';
      this.tagTipEl.style.cssText = TAG_TIP_STYLE;
      this.tagTipEl.addEventListener('mouseenter', () => this.cancelTagTipHide());
      this.tagTipEl.addEventListener('mouseleave', () => this.scheduleTagTipHide());
      this.skin.appendChild(this.tagTipEl);
    }

    this.bindInput();
    this.resize();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
  }

  // ---- 数据装载 ----

  /** 全量装载数据集：重置视窗到数据全域，重建标注，增量同步曲线。 */
  load(ds: ChartDataset): void {
    this.timeOrigin = ds.baseTimeMs;
    const x0 = ds.xRange.min - ds.baseTimeMs;
    const x1 = ds.xRange.max - ds.baseTimeMs;
    const ySpan = ds.yRange.max - ds.yRange.min || 1;
    const bottom = Y_PAD_RATIO + tagPadRatio(ds.tags);
    this.home = { x0, x1, y0: ds.yRange.min - ySpan * bottom, y1: ds.yRange.max + ySpan * Y_PAD_RATIO };
    this.view = { ...this.home };
    this.past = [];

    this.syncCurves(ds.series);
    this.buildBands(ds.bands || []);
    this.buildTags(ds.tags || []);
    this.applyView(false);
    this.emit('viewport');
  }

  /** 批量替换曲线集合（增量同步：复用未变 mesh，仅重建变更项）。 */
  syncCurves(incoming: CurveSeries[]): void {
    const byId = new Map<string, CurveMesh>();
    for (const m of this.curves) byId.set(m.series.id, m);

    const kept = new Set<string>();
    const next: CurveMesh[] = [];
    for (const s of incoming) {
      if (!s.count) continue;
      kept.add(s.id);
      const existing = byId.get(s.id);
      if (existing) {
        this.patchCurveMesh(existing, s);
        next.push(existing);
      } else {
        const entry = this.makeCurveMesh(s, ORDER_CURVE);
        this.scene.add(entry.mesh);
        next.push(entry);
      }
    }
    for (const m of this.curves) {
      if (kept.has(m.series.id)) continue;
      this.scene.remove(m.mesh);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.curves = next;
    this.requestPaint();
  }

  /**
   * AI 临时叠加曲线：与主曲线集完全独立的绘制通道——不参与视窗/量程计算、
   * 不与主曲线按 id diff（store 侧已归一化映射并加 ai- 前缀 id）。数量有界，全量重建。
   */
  setOverlayCurves(series: CurveSeries[]): void {
    for (const entry of this.ghost) {
      this.scene.remove(entry.mesh);
      entry.geometry.dispose();
      entry.material.dispose();
    }
    this.ghost = [];
    for (const s of series) {
      if (!s.count) continue;
      const entry = this.makeCurveMesh(s, ORDER_OVERLAY);
      this.scene.add(entry.mesh);
      this.ghost.push(entry);
    }
    this.requestPaint();
  }

  /**
   * 重算 Y 量程并刷新，**保留当前 X 缩放窗口**。
   * 用于曲线缩放/偏移变更（Y 范围变化、时间窗不变）：初始与当前视窗的 Y 同步
   * 重置到新量程，X 维持用户缩放，不清历史。
   */
  refitY(range: { min: number; max: number }): void {
    const ySpan = range.max - range.min || 1;
    const bottom = Y_PAD_RATIO + this.builtTagPadRatio();
    this.home = { ...this.home, y0: range.min - ySpan * bottom, y1: range.max + ySpan * Y_PAD_RATIO };
    this.view = { ...this.view, y0: this.home.y0, y1: this.home.y1 };
    this.refitBands();
    this.applyView(false);
  }

  /** 当前 Y 留白（来自已构建事件标签的行数）：refitY 时用。 */
  private builtTagPadRatio(): number {
    if (!this.tags.length) return 0;
    let lastRow = 0;
    for (const tag of this.tags) if (tag.row > lastRow) lastRow = tag.row;
    return TAG_PAD_BASE + lastRow * TAG_PAD_PER_ROW;
  }

  /** 运行时绘制开关：仅切换 mesh 可见性，不改视窗、不重算。 */
  setCurveVisible(id: string, visible: boolean): void {
    let changed = false;
    for (const entry of this.curves) {
      if (entry.series.id !== id) continue;
      entry.mesh.visible = visible;
      changed = true;
    }
    if (changed) this.requestPaint();
  }

  setStrokeWidth(w: number): void {
    for (const entry of this.curves) entry.material.linewidth = w;
    for (const entry of this.ghost) entry.material.linewidth = w;
    this.requestPaint();
  }

  // ---- 曲线 mesh（增量同步） ----

  private makeCurveMesh(s: CurveSeries, order: number): CurveMesh {
    const geometry = new LineGeometry();
    geometry.setPositions(seriesPositions(s));
    const material = new LineMaterial({
      color: new THREE.Color(s.color),
      linewidth: this.cfg.strokeWidth || DEFAULT_STROKE,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    const dpr = this.gl.getPixelRatio();
    material.resolution.set(Math.round(this.plot.width * dpr) || dpr, Math.round(this.plot.height * dpr) || dpr);
    const mesh = new Line2(geometry, material);
    mesh.renderOrder = order;
    mesh.scale.set(1, s.scaleY, 1);
    mesh.position.set(s.xOffset || 0, s.offsetY, 0);
    mesh.visible = s.visible !== false;
    return { mesh, geometry, material, series: s };
  }

  /** 就地更新一条已有 mesh：数据变化才重建 geometry，否则只 patch 轻量属性。 */
  private patchCurveMesh(entry: CurveMesh, s: CurveSeries): void {
    if (s.buffer !== entry.series.buffer || s.count !== entry.series.count) {
      const nextGeo = new LineGeometry();
      nextGeo.setPositions(seriesPositions(s));
      entry.mesh.geometry = nextGeo;
      entry.geometry.dispose();
      entry.geometry = nextGeo;
    }
    if (s.color !== entry.series.color) entry.material.color = new THREE.Color(s.color);
    entry.mesh.scale.set(1, s.scaleY, 1);
    entry.mesh.position.set(s.xOffset || 0, s.offsetY, 0);
    entry.mesh.visible = s.visible !== false;
    entry.series = s;
  }

  // ---- 色带 / 事件标签 ----

  private buildBands(specs: BandSpec[]): void {
    for (const band of this.bandBlocks) {
      this.scene.remove(band.mesh);
      band.material.dispose(); // 几何共享，不 dispose
      band.label?.remove();
    }
    this.bandBlocks = [];
    if (!this.cfg.bands) return;

    const cy = (this.home.y0 + this.home.y1) / 2;
    const sy = this.home.y1 - this.home.y0 || 1;
    for (const spec of specs) {
      const startD = spec.startT - this.timeOrigin;
      const endD = spec.endT - this.timeOrigin;
      const w = endD - startD;
      if (!(w > 0)) continue;
      const parsed = parseColor(spec.color);
      const material = new THREE.MeshBasicMaterial({
        color: parsed.color,
        transparent: true,
        opacity: parsed.opacity,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.quad, material);
      mesh.renderOrder = ORDER_BAND;
      mesh.position.set((startD + endD) / 2, cy, spec.z ?? Z_BAND);
      mesh.scale.set(w, sy, 1);
      this.scene.add(mesh);

      let label: HTMLDivElement | null = null;
      const labelTop = spec.labelTop ?? 6;
      if (spec.label) {
        label = document.createElement('div');
        label.className = 'chart-band-label';
        label.textContent = spec.label;
        label.style.cssText = BAND_LABEL_STYLE;
        this.skin.appendChild(label);
      }
      this.bandBlocks.push({ mesh, material, label, labelTop, startT: spec.startT, endT: spec.endT });
    }
  }

  /** home 的 Y 变化后（refitY），把已建色带重新铺满新 Y 范围。 */
  private refitBands(): void {
    const cy = (this.home.y0 + this.home.y1) / 2;
    const sy = this.home.y1 - this.home.y0 || 1;
    for (const band of this.bandBlocks) {
      band.mesh.position.y = cy;
      band.mesh.scale.y = sy;
    }
  }

  private buildTags(specs: TagSpec[]): void {
    for (const tag of this.tags) tag.el.remove();
    this.tags = [];
    if (!this.cfg.tags) return;

    for (const spec of specs) {
      const kind = spec.kind || '';
      const el = document.createElement('div');
      el.className = `chart-tag chart-tag-row-${spec.row}`;
      el.textContent = spec.text;
      el.style.cssText = TAG_PILL_STYLE +
        `background:#${parseColor(spec.color).color.getHexString()};` +
        `cursor:${this.cfg.onTagClick ? 'pointer' : 'default'};`;
      this.skin.appendChild(el);
      const node: TagNode = { el, t: spec.t, row: spec.row, kind, text: spec.text, id: spec.id, detail: spec.detail, px: 0, py: 0 };
      el.addEventListener('mouseenter', () => this.showTagTip(node));
      el.addEventListener('mouseleave', () => this.scheduleTagTipHide());
      if (this.cfg.onTagClick) {
        el.addEventListener('click', () => this.cfg.onTagClick?.({ t: spec.t, kind, id: spec.id }));
      }
      this.tags.push(node);
    }
  }

  // ---- 网格 / 刻度 ----

  private updateGrid(): void {
    const v = this.view;
    const spanX = v.x1 - v.x0 || 1;
    const spanY = v.y1 - v.y0 || 1;
    const xs = ticksInRange(v.x0, v.x1, niceTimeStep(spanX, X_TICK_TARGET));
    const ys = ticksInRange(v.y0, v.y1, niceNumberStep(spanY, Y_TICK_TARGET));

    // 边框线（视窗四边）+ 内部刻度线；X 只取内部刻度做标签（边界标签贴边会被裁半）
    const gridXs = dedupeTicks([...xs, v.x0, v.x1], spanX * TICK_GAP_X_RATIO);
    const gridYs = dedupeTicks([...ys, v.y0, v.y1], spanY * TICK_GAP_Y_RATIO);

    let n = 0;
    const buf = this.gridBuf;
    for (const x of gridXs) {
      if (n >= MAX_GRID_SEGS) break;
      buf[n * 6] = x; buf[n * 6 + 1] = v.y0; buf[n * 6 + 2] = Z_GRID;
      buf[n * 6 + 3] = x; buf[n * 6 + 4] = v.y1; buf[n * 6 + 5] = Z_GRID;
      n++;
    }
    for (const y of gridYs) {
      if (n >= MAX_GRID_SEGS) break;
      buf[n * 6] = v.x0; buf[n * 6 + 1] = y; buf[n * 6 + 2] = Z_GRID;
      buf[n * 6 + 3] = v.x1; buf[n * 6 + 4] = y; buf[n * 6 + 5] = Z_GRID;
      n++;
    }
    this.gridAttr.needsUpdate = true;
    this.grid.geometry.setDrawRange(0, n * 2);

    this.layoutXLabels(xs);
    this.layoutYLabels(ys, niceNumberStep(spanY, Y_TICK_TARGET));
  }

  /** X 轴标签池：节点复用，transform 定位（拖拽平移每帧刷新不触发布局）。gutter 在绘图区下方。 */
  private layoutXLabels(xs: number[]): void {
    this.poolNodes(this.xLabels, xs.length, X_LABEL_STYLE, 'chart-x-label');
    const v = this.view;
    const g = this.plot;
    const spanX = v.x1 - v.x0 || 1;
    const top = g.top + g.height + 7;
    for (let i = 0; i < this.xLabels.length; i++) {
      const el = this.xLabels[i];
      if (i >= xs.length) {
        el.style.display = 'none';
        continue;
      }
      const px = g.left + ((xs[i] - v.x0) / spanX) * g.width;
      el.style.display = 'block';
      el.style.transform = `translate3d(${px}px,${top}px,0) translateX(-50%)`;
      el.textContent = this.cfg.formatX ? this.cfg.formatX(this.timeOrigin + xs[i]) : String(Math.round(xs[i]));
    }
  }

  /** Y 轴标签池：同上，gutter 在绘图区左侧、右对齐至绘图区左缘。 */
  private layoutYLabels(ys: number[], yStep: number): void {
    this.poolNodes(this.yLabels, ys.length, Y_LABEL_STYLE, 'chart-y-label');
    const v = this.view;
    const g = this.plot;
    const spanY = v.y1 - v.y0 || 1;
    for (let i = 0; i < this.yLabels.length; i++) {
      const el = this.yLabels[i];
      if (i >= ys.length) {
        el.style.display = 'none';
        continue;
      }
      const py = g.top + ((v.y1 - ys[i]) / spanY) * g.height;
      el.style.display = 'block';
      el.style.transform = `translate3d(${Math.max(0, g.left - 8)}px,${py}px,0) translate(-100%,-50%)`;
      el.textContent = formatTickNumber(ys[i], yStep);
    }
  }

  private poolNodes(pool: HTMLDivElement[], need: number, cssText: string, cls: string): void {
    while (pool.length < need) {
      const el = document.createElement('div');
      el.className = cls;
      el.style.cssText = cssText;
      this.skin.appendChild(el);
      pool.push(el);
    }
  }

  // ---- 视窗 ----

  private applyView(emit: boolean): void {
    this.view = clampView(this.view, this.home);
    const v = this.view;
    this.cam.left = v.x0;
    this.cam.right = v.x1;
    this.cam.top = v.y1;
    this.cam.bottom = v.y0;
    this.cam.updateProjectionMatrix();
    this.updateGrid();
    this.placeOverlays();
    this.realignCrosshair();
    this.requestPaint();
    if (emit) this.emit('viewport');
  }

  private pushPast(): void {
    this.past.push({ ...this.view });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
  }

  undoZoom(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.view = prev;
    this.applyView(true);
  }

  resetView(): void {
    this.past = [];
    this.view = { ...this.home };
    this.applyView(false);
    this.emit('reset');
  }

  /**
   * 聚焦一个绝对时间窗（如 AI 问题时段）：X 缩放到该窗口（带 15% 边距、
   * 钳制在数据范围内），Y 保持当前量程；入历史栈可撤销。
   * 返回是否生效——窗口与数据范围完全无交集时不动作。
   */
  zoomToWindow(t0: number, t1: number): boolean {
    const span = Math.max(t1 - t0, 1);
    const pad = span * 0.15;
    const x0 = Math.max(t0 - pad - this.timeOrigin, this.home.x0);
    const x1 = Math.min(t1 + pad - this.timeOrigin, this.home.x1);
    if (!(x1 > x0)) return false;
    this.pushPast();
    this.view = { ...this.view, x0, x1 };
    this.applyView(true);
    return true;
  }

  /** 当前可见的绝对时间窗。 */
  visibleWindow(): { min: number; max: number } {
    return { min: this.view.x0 + this.timeOrigin, max: this.view.x1 + this.timeOrigin };
  }

  // ---- 坐标换算（对外只需 X 方向；px 均为相对宿主元素左上角） ----

  timeToX(t: number): number {
    const v = this.view;
    const g = this.plot;
    return g.left + ((t - this.timeOrigin - v.x0) / (v.x1 - v.x0 || 1)) * g.width;
  }

  xToTime(px: number): number {
    const v = this.view;
    const g = this.plot;
    return v.x0 + ((px - g.left) / (g.width || 1)) * (v.x1 - v.x0) + this.timeOrigin;
  }

  /** 指针是否在绘图区内。 */
  private inPlot(px: number, py: number): boolean {
    const g = this.plot;
    return px >= g.left && px <= g.left + g.width && py >= g.top && py <= g.top + g.height;
  }

  // ---- 悬停（十字线 + 数据提示） ----

  private moveCrosshair(px: number, py: number): void {
    const v = this.view;
    const g = this.plot;
    const dx = this.xToTime(px) - this.timeOrigin;
    const val = v.y1 - ((py - g.top) / (g.height || 1)) * (v.y1 - v.y0);
    const a = this.crossAttr.array as Float32Array;
    a[0] = dx; a[1] = v.y0; a[2] = Z_CROSSHAIR;
    a[3] = dx; a[4] = v.y1; a[5] = Z_CROSSHAIR;
    a[6] = v.x0; a[7] = val; a[8] = Z_CROSSHAIR;
    a[9] = v.x1; a[10] = val; a[11] = Z_CROSSHAIR;
    this.crossAttr.needsUpdate = true;
    this.crosshair.visible = true;
  }

  private hideCrosshair(): void {
    this.crosshair.visible = false;
  }

  private realignCrosshair(): void {
    if (!this.crosshair.visible || !this.hoverAt) return;
    const { x, y } = this.hoverAt;
    if (!this.inPlot(x, y)) {
      this.hideCrosshair();
      return;
    }
    this.moveCrosshair(x, y);
  }

  /** 悬停解析合并到 rAF：指针风暴（>60Hz 鼠标）下每帧至多一次。 */
  private queueHover(): void {
    if (this.hoverRaf) return;
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      this.runHover();
    });
  }

  private runHover(): void {
    const p = this.hoverAt;
    if (!p || !this.hoverOn) return;
    if (!this.inPlot(p.x, p.y)) {
      this.hoverAt = null;
      this.clearHover();
      return;
    }
    this.moveCrosshair(p.x, p.y);
    this.requestPaint();
    if (!this.cfg.resolveTip || !this.tipEl) return;
    const html = this.cfg.resolveTip(this.xToTime(p.x));
    if (!html) {
      this.tipEl.style.display = 'none';
      return;
    }
    this.tipEl.innerHTML = html;
    this.tipEl.style.display = 'block';
    const tw = this.tipEl.offsetWidth || 240;
    const th = this.tipEl.offsetHeight || 80;
    let left = p.x + TIP_OFFSET_PX;
    let top = p.y + TIP_OFFSET_PX;
    if (left + tw > this.size.w - TIP_MARGIN_PX) left = p.x - tw - TIP_OFFSET_PX;
    if (top + th > this.size.h - TIP_MARGIN_PX) top = p.y - th - TIP_OFFSET_PX;
    this.tipEl.style.transform = `translate3d(${Math.max(0, left)}px,${Math.max(0, top)}px,0)`;
  }

  private clearHover(): void {
    this.hideCrosshair();
    if (this.tipEl) this.tipEl.style.display = 'none';
    this.requestPaint();
  }

  // ---- overlay 定位（标签 / 色带标签） ----

  private placeOverlays(): void {
    this.hideTagTipNow();
    const v = this.view;
    const g = this.plot;
    const spanX = v.x1 - v.x0 || 1;
    const xPx = (t: number): number => g.left + ((t - this.timeOrigin - v.x0) / spanX) * g.width;
    /** 居中定位钳制在绘图区内：贴边标签半宽不越出轴 gutter / 右缘。 */
    const clampX = (el: HTMLElement, rawPx: number): number => {
      const half = el.offsetWidth / 2 + 2;
      const lo = g.left + half;
      const hi = g.left + g.width - half;
      return hi < lo ? g.left + g.width / 2 : Math.min(Math.max(rawPx, lo), hi);
    };
    for (const tag of this.tags) {
      const dx = tag.t - this.timeOrigin;
      const visible = dx >= v.x0 && dx <= v.x1;
      tag.el.style.display = visible ? 'block' : 'none';
      if (visible) {
        tag.px = clampX(tag.el, xPx(tag.t));
        tag.py = g.top + g.height - TAG_BASE_PX - tag.row * TAG_ROW_PX;
        tag.el.style.transform = `translate3d(${tag.px}px,${tag.py}px,0) translateX(-50%)`;
      }
    }
    for (const band of this.bandBlocks) {
      if (!band.label) continue;
      const visStart = Math.max(band.startT, v.x0 + this.timeOrigin);
      const visEnd = Math.min(band.endT, v.x1 + this.timeOrigin);
      if (visEnd <= visStart) {
        band.label.style.display = 'none';
        continue;
      }
      band.label.style.display = 'block';
      band.label.style.top = `${this.plot.top + band.labelTop}px`;
      band.label.style.transform = `translate3d(${clampX(band.label, xPx((visStart + visEnd) / 2))}px,0,0) translateX(-50%)`;
    }
  }

  // ---- 事件标签 tooltip ----

  /** 同 kind 且屏幕上互相重叠的标签合并成一个 tooltip 列表。 */
  private showTagTip(hovered: TagNode): void {
    if (!this.cfg.resolveTagTip || !this.tagTipEl) return;
    this.cancelTagTipHide();
    const kind = hovered.kind;
    const l = hovered.px;
    const r = hovered.px + hovered.el.offsetWidth + 1;
    const items: TagTipItem[] = [];
    for (const tag of this.tags) {
      if (tag.kind !== kind || tag.el.style.display === 'none') continue;
      const tl = tag.px;
      const tr = tag.px + tag.el.offsetWidth;
      if (tl < r && tr > l) items.push({ t: tag.t, text: tag.text, detail: tag.detail });
    }
    items.sort((a, b) => a.t - b.t);
    const html = this.cfg.resolveTagTip(items, kind);
    if (!html) {
      this.tagTipEl.style.display = 'none';
      return;
    }
    this.tagTipEl.innerHTML = html;
    this.tagTipEl.style.display = 'block';
    const tw = this.tagTipEl.offsetWidth || 240;
    const th = this.tagTipEl.offsetHeight || 60;
    const mx = hovered.px;
    const mw = hovered.el.offsetWidth;
    const my = hovered.py; // transform 定位，用记录的 py
    let left = mx + mw / 2 - tw / 2;
    if (left < TIP_MARGIN_PX) left = TIP_MARGIN_PX;
    if (left + tw > this.size.w - TIP_MARGIN_PX) left = this.size.w - tw - TIP_MARGIN_PX;
    let top = my - th - 8;
    if (top < TIP_MARGIN_PX) top = my + hovered.el.offsetHeight + 8;
    this.tagTipEl.style.transform = `translate3d(${left}px,${top}px,0)`;
  }

  private scheduleTagTipHide(): void {
    if (this.tagTipTimer) clearTimeout(this.tagTipTimer);
    this.tagTipTimer = setTimeout(() => {
      this.tagTipTimer = null;
      if (this.tagTipEl) this.tagTipEl.style.display = 'none';
    }, TAG_TIP_HIDE_MS);
  }

  private cancelTagTipHide(): void {
    if (this.tagTipTimer) {
      clearTimeout(this.tagTipTimer);
      this.tagTipTimer = null;
    }
  }

  private hideTagTipNow(): void {
    this.cancelTagTipHide();
    if (this.tagTipEl) this.tagTipEl.style.display = 'none';
  }

  // ---- 渲染 ----

  private requestPaint(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render(): void {
    const r = this.gl;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.w, this.size.h);
    r.setClearColor(this.bgColor, 1);
    r.clear(true, true, false);
    // 场景只画绘图区（轴 gutter 留白给 DOM 标签）；y 轴换算成 GL 的左下角原点。
    // 注意：three 的 setViewport/setScissor 内部自乘 pixelRatio，这里必须传 CSS px。
    const g = this.plot;
    const gy = this.size.h - g.top - g.height;
    r.setScissorTest(true);
    r.setViewport(g.left, gy, g.width, g.height);
    r.setScissor(g.left, gy, g.width, g.height);
    r.render(this.scene, this.cam);
    r.setScissorTest(false);
  }

  /** 宿主 CSS 尺寸 + margins → 绘图区矩形（CSS px）。 */
  private measure(): void {
    const m = this.cfg.margins;
    const g = this.plot;
    g.left = m.left;
    g.top = m.top;
    g.width = Math.max(1, this.size.w - m.left - m.right);
    g.height = Math.max(1, this.size.h - m.top - m.bottom);
  }

  resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h || w < 2 || h < 2) return;
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== this.gl.getPixelRatio()) this.gl.setPixelRatio(dpr);
    this.size = { w, h };
    this.gl.setSize(w, h, false);
    this.hostRectCache = null;
    this.measure();
    // LineMaterial 分辨率用绘图区实际设备像素（three 不代为缩放）
    const rw = Math.round(this.plot.width * dpr) || 1;
    const rh = Math.round(this.plot.height * dpr) || 1;
    for (const entry of this.curves) entry.material.resolution.set(rw, rh);
    for (const entry of this.ghost) entry.material.resolution.set(rw, rh);
    this.updateGrid();
    this.placeOverlays();
    this.realignCrosshair();
    this.requestPaint();
  }

  // ---- 输入 ----

  /** host 边界缓存：拖拽/悬停高频取用，resize/scroll 时失效。 */
  private hostRect(): DOMRect {
    if (!this.hostRectCache) this.hostRectCache = this.host.getBoundingClientRect();
    return this.hostRectCache;
  }

  private dropRect = (): void => {
    this.hostRectCache = null;
  };

  private bindInput(): void {
    const dom = this.gl.domElement;
    if (this.cfg.wheelZoom !== false) dom.addEventListener('wheel', this.onWheel, { passive: false });
    if (this.cfg.dragPan !== false || this.cfg.rectZoom) dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('contextmenu', this.onContextmenu);
    if (this.cfg.tooltip) {
      dom.addEventListener('mousemove', this.onMouseMove);
      dom.addEventListener('mouseleave', this.onMouseLeave);
    }
    window.addEventListener('scroll', this.dropRect, true);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.hostRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const v = this.view;
    const g = this.plot;
    const ax = this.xToTime(px) - this.timeOrigin;
    const ay = v.y1 - ((py - g.top) / (g.height || 1)) * (v.y1 - v.y0);
    const now = performance.now();
    if (now - this.lastWheel > WHEEL_MERGE_MS) this.pushPast();
    this.lastWheel = now;

    const k = e.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    const next: ViewWindow = {
      x0: ax - (ax - v.x0) * k,
      x1: ax - (ax - v.x1) * k,
      y0: v.y0,
      y1: v.y1,
    };
    if (this.cfg.panAxis === 'both') {
      next.y0 = ay - (ay - v.y0) * k;
      next.y1 = ay - (ay - v.y1) * k;
    }
    this.view = next;
    this.applyView(true);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 1) e.preventDefault();
    const rect = this.hostRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (this.rectZoomOn && this.rectEl && e.button !== 1) {
      this.pushPast();
      this.rectStart = { x: px, y: py };
      this.rectEl.style.display = 'block';
      this.rectEl.style.transform = `translate3d(${px}px,${py}px,0)`;
      this.rectEl.style.width = '0px';
      this.rectEl.style.height = '0px';
      window.addEventListener('pointermove', this.onRectMove);
      window.addEventListener('pointerup', this.onRectUp);
      return;
    }
    if (this.cfg.dragPan === false) return;
    this.panning = true;
    this.panLast = { x: e.clientX, y: e.clientY };
    this.pushPast();
    try {
      this.gl.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* 部分环境下 pointerId 已失效，忽略 */
    }
    window.addEventListener('pointermove', this.onPanMove);
    window.addEventListener('pointerup', this.onPanUp);
  };

  private onRectMove = (e: PointerEvent): void => {
    if (!this.rectStart || !this.rectEl) return;
    const rect = this.hostRect();
    const g = this.plot;
    const px = Math.max(g.left, Math.min(g.left + g.width, e.clientX - rect.left));
    const py = Math.max(g.top, Math.min(g.top + g.height, e.clientY - rect.top));
    const x = Math.min(this.rectStart.x, px);
    const y = Math.min(this.rectStart.y, py);
    this.rectEl.style.transform = `translate3d(${x}px,${y}px,0)`;
    this.rectEl.style.width = `${Math.abs(px - this.rectStart.x)}px`;
    this.rectEl.style.height = `${Math.abs(py - this.rectStart.y)}px`;
  };

  private onRectUp = (e: PointerEvent): void => {
    window.removeEventListener('pointermove', this.onRectMove);
    window.removeEventListener('pointerup', this.onRectUp);
    if (this.rectEl) this.rectEl.style.display = 'none';
    if (!this.rectStart) return;
    const rect = this.hostRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const x0 = Math.min(this.rectStart.x, px);
    const x1 = Math.max(this.rectStart.x, px);
    const y0 = Math.min(this.rectStart.y, py);
    const y1 = Math.max(this.rectStart.y, py);
    this.rectStart = null;
    if (x1 - x0 < RECT_SELECT_MIN_PX || y1 - y0 < RECT_SELECT_MIN_PX) return;
    const v = this.view;
    const g = this.plot;
    const t0 = this.xToTime(x0) - this.timeOrigin;
    const t1 = this.xToTime(x1) - this.timeOrigin;
    const valTop = v.y1 - ((y0 - g.top) / (g.height || 1)) * (v.y1 - v.y0);
    const valBottom = v.y1 - ((y1 - g.top) / (g.height || 1)) * (v.y1 - v.y0);
    this.view = { x0: t0, x1: t1, y0: valBottom, y1: valTop };
    this.applyView(true);
    this.emit('select');
  };

  private onPanMove = (e: PointerEvent): void => {
    if (!this.panning) return;
    const dxPx = e.clientX - this.panLast.x;
    const dyPx = e.clientY - this.panLast.y;
    this.panLast = { x: e.clientX, y: e.clientY };
    const v = this.view;
    const g = this.plot;
    const dxData = (dxPx / (g.width || 1)) * (v.x1 - v.x0);
    const dyData = (dyPx / (g.height || 1)) * (v.y1 - v.y0);
    const next: ViewWindow = { x0: v.x0 - dxData, x1: v.x1 - dxData, y0: v.y0, y1: v.y1 };
    if (this.cfg.panAxis === 'both') {
      next.y0 = v.y0 + dyData;
      next.y1 = v.y1 + dyData;
    }
    this.view = next;
    this.applyView(false);
  };

  private onPanUp = (): void => {
    this.panning = false;
    window.removeEventListener('pointermove', this.onPanMove);
    window.removeEventListener('pointerup', this.onPanUp);
    this.emit('viewport');
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.hoverOn) return;
    const rect = this.hostRect();
    this.hoverAt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.queueHover();
  };

  private onMouseLeave = (): void => {
    this.hoverAt = null;
    this.clearHover();
  };

  private onContextmenu = (e: MouseEvent): void => {
    e.preventDefault();
    this.resetView();
  };

  // ---- 对外小开关 ----

  setRectZoomActive(active: boolean): void {
    this.rectZoomOn = !!active;
  }

  setTooltipEnabled(enabled: boolean): void {
    this.hoverOn = !!enabled;
    if (!this.hoverOn) {
      this.hoverAt = null;
      this.clearHover();
    }
  }

  // ---- 事件订阅 ----

  on(evt: ChartEventName, cb: ChartListener): void {
    this.listeners[evt].push(cb);
  }

  off(evt: ChartEventName, cb?: ChartListener): void {
    if (!cb) {
      this.listeners[evt] = [];
      return;
    }
    const arr = this.listeners[evt];
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] === cb) arr.splice(i, 1);
  }

  private emit(evt: ChartEventName): void {
    for (const cb of this.listeners[evt]) cb();
  }

  // ---- 销毁 ----

  dispose(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.hoverRaf) {
      cancelAnimationFrame(this.hoverRaf);
      this.hoverRaf = 0;
    }
    if (this.tagTipTimer) {
      clearTimeout(this.tagTipTimer);
      this.tagTipTimer = null;
    }
    if (this.ro) {
      this.ro.disconnect();
      this.ro = null;
    }
    const dom = this.gl.domElement;
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('contextmenu', this.onContextmenu);
    dom.removeEventListener('mousemove', this.onMouseMove);
    dom.removeEventListener('mouseleave', this.onMouseLeave);
    window.removeEventListener('scroll', this.dropRect, true);
    window.removeEventListener('pointermove', this.onPanMove);
    window.removeEventListener('pointerup', this.onPanUp);
    window.removeEventListener('pointermove', this.onRectMove);
    window.removeEventListener('pointerup', this.onRectUp);

    const killCurves = (list: CurveMesh[]): void => {
      for (const entry of list) {
        this.scene.remove(entry.mesh);
        entry.geometry.dispose();
        entry.material.dispose();
      }
    };
    killCurves(this.curves);
    killCurves(this.ghost);
    for (const band of this.bandBlocks) {
      this.scene.remove(band.mesh);
      band.material.dispose();
      band.label?.remove();
    }
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.crosshair.geometry.dispose();
    (this.crosshair.material as THREE.Material).dispose();
    this.quad.dispose();
    this.scene.remove(this.grid);
    this.scene.remove(this.crosshair);
    this.gl.dispose();
    dom.remove();
    this.skin.remove();
  }
}

/** 事件标签占用底部行数 → 对应的额外底部留白比例（占数据量程）。 */
function tagPadRatio(tags: TagSpec[] | undefined): number {
  if (!tags?.length) return 0;
  let lastRow = 0;
  for (const tag of tags) if (tag.row > lastRow) lastRow = tag.row;
  return TAG_PAD_BASE + lastRow * TAG_PAD_PER_ROW;
}
