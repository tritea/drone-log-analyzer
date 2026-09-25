import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  MessageType,
  NamedCurve,
  RcInvert,
  TelemetrySample,
  ThreeCurrent,
  ThreeCurvesState,
  ThreePlaybackState,
  ThreeTelemetryState,
  TimeWindow,
} from '@/types';
import { showToast } from '@/modules/shared/ui-store';
import { useLogStore } from '@/modules/log';
import { useCurveManagerStore } from '@/modules/curves';
import { useParametersStore } from '@/modules/parameters';
import { useAnalysisStore } from '@/modules/analysis';
import { useAgentStore } from '@/modules/agent';
import { SEVERITY_META } from '@/modules/agent/utils/incidents';
import { useView3dStore } from '@/modules/view3d';
import { getProfile } from '@/profiles';
import type {
  FormatProfile,
  FieldSource,
  AttitudeSource,
  PositionSource,
} from '@/profiles';
import { THREE_UNITS_PER_METER } from '@/constants';

// ===== 播放/遥测数据中枢（自 view3d 拆出）=====
// 本 store 只管「数据与时钟」：播放时间轴推进、遥测采样、当前值计算、曲线定义；
// 不含任何渲染器（three.js/Cesium/Leaflet 实例仍在各渲染模块 + shared/runtime）。
// rAF 编排见同模块 loop/frame-loop.ts；渲染器每帧经 view3d 的 applyFrameOutputs 消费数据。

const GEO_INVALID_EPS = 1e-6;
/** 飞行簇离群判定阈值（度，约 220km）：有效经纬度偏离中位数簇心超过此值的行视为
 * 未锁定漂移/噪点剔除（见 buildThreeSamples 聚类剔除）。 */
const GEO_CLUSTER_DEG = 2;
/** 启用聚类剔除的最少有效行数：低于它统计无意义，保持首行原点旧行为。 */
const GEO_CLUSTER_MIN_ROWS = 8;

export function currentProfile(): FormatProfile {
  return getProfile(String(useLogStore().log.summary?.format || 'apm')) || getProfile('apm')!;
}

export function quatToEulerDeg(w: number, x: number, y: number, z: number): { roll: number; pitch: number; yaw: number } {
  var n = Math.sqrt(w * w + x * x + y * y + z * z);
  if (!n) return { roll: 0, pitch: 0, yaw: 0 };
  w /= n; x /= n; y /= n; z /= n;
  var sinp = 2 * (w * y - z * x);
  var pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);
  var roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  var yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  var deg = 180 / Math.PI;
  return { roll: roll * deg, pitch: pitch * deg, yaw: yaw * deg };
}

export const usePlaybackStore = defineStore('playback', () => {
  // ---- 状态（自 view3d 渲染面拆出的数据面）----
  const playback = ref<ThreePlaybackState>({
    timeMs: 0, playing: false, rate: 1, lastFrameTime: 0, timeWindow: null, fpsLastTime: 0, curveAxis: false, curveHeight: 150,
  });
  const telemetry = ref<ThreeTelemetryState>({
    loaded: false, samples: [], meta: {}, loading: false, error: '',
  });
  const curves = ref<ThreeCurvesState>({ volt: [], motor: [] });
  const current = ref<ThreeCurrent>({
    speed: null, verticalSpeed: null, altitude: null, altMsl: null, baroAlt: null,
    rcRoll: null, rcPitch: null, rcThrottle: null, rcYaw: null,
    x: null, y: null, z: null, north: null, east: null, down: null,
  });
  // RC 打杆方向自动判定（由 samples 相关性推导，属派生数据——随遥测加载/重置走）。
  const rcInvert = ref<RcInvert>({ roll: false, pitch: false });
  // 加载世代守卫（非响应式）：resetTelemetry/releaseTelemetry 递增；loadThreeTelemetry 在每个 await 后
  // 校验世代，防止「加载中离开可视化/换日志」后旧任务把过期数据写回新状态。
  let loadSeq = 0;

  // ---- getters ----
  const threeTimeRange = computed<TimeWindow>(() => {
    if (!telemetry.value.samples.length) return { min: 0, max: 1, span: 1 };
    var min = telemetry.value.samples[0].t;
    var max = telemetry.value.samples[telemetry.value.samples.length - 1].t;
    return { min: min, max: max, span: Math.max(1, max - min) };
  });

  const threePlaybackRange = computed<TimeWindow>(() => {
    if (playback.value.curveAxis && playback.value.timeWindow) return playback.value.timeWindow;
    return threeTimeRange.value;
  });

  const threeTimelineValue = computed<number>(() => {
    var r = threePlaybackRange.value;
    return Math.round(((playback.value.timeMs - r.min) / r.span) * 1000);
  });

  const threeTimelinePct = computed<number>(() => {
    var r = threePlaybackRange.value;
    if (!r.span) return 0;
    var p = ((playback.value.timeMs - r.min) / r.span) * 100;
    return Math.max(0, Math.min(100, p));
  });

  const threeCurrentTimeLabel = computed<string>(() => {
    return useAnalysisStore().formatTime(playback.value.timeMs, false);
  });

  const threeEndTimeLabel = computed<string>(() => {
    return useAnalysisStore().formatTime(threePlaybackRange.value.max, false);
  });

  const threeDebugInfo = computed<Record<string, any>>(() => {
    var t = playback.value.timeMs;
    var meta = telemetry.value.meta || {};
    var src: any = meta.posSource || {};
    var cur: any = current.value || {};
    var cm = useCurveManagerStore();
    function raw(def: any): number | null {
      if (!def) return null;
      return cm.getValueAt(def.type, def.field, t, null);
    }
    return {
      timeMs: t,
      source: meta.position || '',
      useGeo: !!src.useGeo,
      geoExact: !!src.geoExact,
      rawLat: raw(src.lat), rawLng: raw(src.lng), rawAlt: raw(src.alt), rawRelAlt: raw(src.relAlt),
      rawPx: raw(src.px), rawPy: raw(src.py),
      x: cur.x, y: cur.y, z: cur.z,
      north: cur.north, east: cur.east, down: cur.down,
      alt: cur.altitude, altMsl: cur.altMsl
    };
  });

  const threeModeSegments = computed<{ startPct: number; widthPct: number; color: string; label: string }[]>(() => {
    var modes = useLogStore().log.flightModes || [];
    var r = threePlaybackRange.value;
    if (!modes.length || !r.span) return [];
    var chartStore = useAnalysisStore();
    var out: { startPct: number; widthPct: number; color: string; label: string }[] = [];
    var i = 0;
    while (i < modes.length) {
      var name = modes[i].mode;
      var rawStart = modes[i].timeMs;
      var j = i;
      while (j + 1 < modes.length && modes[j + 1].mode === name) j++;
      var rawEnd = j + 1 < modes.length ? modes[j + 1].timeMs : r.max;
      if (typeof rawStart === 'number' && typeof rawEnd === 'number' && rawEnd > r.min && rawStart < r.max) {
        var start = Math.max(rawStart, r.min);
        var end = Math.min(rawEnd, r.max);
        if (end > start) {
          out.push({
            startPct: ((start - r.min) / r.span) * 100,
            widthPct: ((end - start) / r.span) * 100,
            color: chartStore.modeColor(name),
            label: chartStore.modeLabel(name) || String(name)
          });
        }
      }
      i = j + 1;
    }
    return out;
  });

  /** AI 问题时段在时间轴上的警示条（与模式分段同坐标系；仅展示，定位走消息卡片/主图标记点击）。 */
  const threeIncidentSegments = computed<{ startPct: number; widthPct: number; color: string }[]>(() => {
    var incidents = useAgentStore().incidents;
    var r = threePlaybackRange.value;
    if (!incidents.length || !r.span) return [];
    var base = useAnalysisStore().incidentAnchorMs();
    var out: { startPct: number; widthPct: number; color: string }[] = [];
    for (var inc of incidents) {
      var s = base + inc.startSec * 1000;
      var e = base + inc.endSec * 1000;
      if (e <= r.min || s >= r.max) continue;
      var start = Math.max(s, r.min);
      var end = Math.min(e, r.max);
      if (end <= start) continue;
      out.push({
        startPct: ((start - r.min) / r.span) * 100,
        widthPct: ((end - start) / r.span) * 100,
        color: SEVERITY_META[inc.severity].color
      });
    }
    return out;
  });

  // ---- 采样 ----
  function currentThreeSampleIndex(timeMs: number): number {
    var samples = telemetry.value.samples;
    if (!samples.length) return 0;
    if (timeMs <= samples[0].t) return 0;
    var last = samples.length - 1;
    if (timeMs >= samples[last].t) return last;
    var lo = 0;
    var hi = last;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      if (samples[mid].t <= timeMs) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function lerpAngle(a: number | null, b: number | null, f: number): number | null {
    if (a === null || a === undefined || !isFinite(a)) return b;
    if (b === null || b === undefined || !isFinite(b)) return a;
    var d = (((b - a) % 360) + 540) % 360 - 180;
    return a + d * f;
  }

  function mixNullable(a: any, b: any, f: number): any {
    if (a === null || a === undefined) return b;
    if (b === null || b === undefined) return a;
    return a + (b - a) * f;
  }

  function sampleAtTime(t: number): TelemetrySample | null {
    var points = telemetry.value.samples;
    if (!points.length) return null;
    if (t <= points[0].t) return points[0];
    var last = points[points.length - 1];
    if (t >= last.t) return last;
    var lo = 0, hi = points.length - 1;
    while (lo < hi) {
      var mid = Math.floor((lo + hi) / 2);
      if (points[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    var b = points[lo], a = points[lo - 1];
    var f = (t - a.t) / Math.max(1, b.t - a.t);

    return {
      t: t,
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      z: a.z + (b.z - a.z) * f,
      roll: lerpAngle(a.roll, b.roll, f) as number,
      pitch: lerpAngle(a.pitch, b.pitch, f) as number,
      yaw: lerpAngle(a.yaw, b.yaw, f) as number,
      speed: mixNullable(a.speed, b.speed, f),
      verticalSpeed: mixNullable(a.verticalSpeed, b.verticalSpeed, f),
      altitude: mixNullable(a.altitude, b.altitude, f),
      altMsl: mixNullable(a.altMsl, b.altMsl, f),
      baroAlt: mixNullable(a.baroAlt, b.baroAlt, f),
      rcRoll: mixNullable(a.rcRoll, b.rcRoll, f),
      rcPitch: mixNullable(a.rcPitch, b.rcPitch, f),
      rcThrottle: mixNullable(a.rcThrottle, b.rcThrottle, f),
      rcYaw: mixNullable(a.rcYaw, b.rcYaw, f)
    } as TelemetrySample;
  }

  /** 当前值数据面（HUD/飞行指标网格消费）：按 timeMs 采样写 current，返回该样本供位姿应用复用。
   * 位姿应用见 view3d.applyFrameOutputs。 */
  function updateCurrentData(sample?: TelemetrySample | null): TelemetrySample | null {
    var s = sample || sampleAtTime(playback.value.timeMs);
    if (!s) return null;
    current.value = {
      speed: s.speed,
      verticalSpeed: s.verticalSpeed,
      altitude: s.altitude,
      altMsl: s.altMsl,
      baroAlt: s.baroAlt,
      rcRoll: s.rcRoll,
      rcPitch: s.rcPitch,
      rcThrottle: s.rcThrottle,
      rcYaw: s.rcYaw,
      x: s.x, y: s.y, z: s.z,
      north: s.north, east: s.east, down: s.down
    };
    return s;
  }

  // ---- 播放时钟 ----
  // 推进回放时间轴：scene/2d 模式由 frame-loop 驱动；earth 模式由 Cesium scene.preRender 驱动
  // （推进/采样/渲染同一时钟，earthDrivesClock() 单一判定）。dt 钳到 250ms 以内，
  // 避免 rAF 拥有者切换/标签页切回时的大跳变。播放时累加 timeMs 并在窗口内回绕。
  function advanceThreePlayback(ts: number): void {
    if (playback.value.playing && telemetry.value.samples.length) {
      if (!playback.value.lastFrameTime) playback.value.lastFrameTime = ts;
      var dt = ts - playback.value.lastFrameTime;
      if (dt < 0 || dt > 250) dt = 0;
      playback.value.lastFrameTime = ts;
      var r = threePlaybackRange.value;
      playback.value.timeMs += dt * playback.value.rate;
      if (playback.value.timeMs > r.max) {
        playback.value.timeMs = r.min + ((playback.value.timeMs - r.max) % r.span);
      } else if (playback.value.timeMs < r.min) {
        playback.value.timeMs = r.min;
      }
    } else {
      playback.value.lastFrameTime = ts;
    }
  }

  // 切换可视化（渲染器互斥切换）时复位：暂停并回到起点。切走的视图不在后台继续推进数据，
  // 切入的视图从头开始（想看自己手动播放）——无人观看的持续计算就是浪费（web 资源要省）。
  function resetPlaybackToStart(): void {
    playback.value.playing = false;
    playback.value.lastFrameTime = 0;
    playback.value.timeMs = threePlaybackRange.value.min;
    updateCurrentData();
  }

  function toggleThreePlayback(): void {
    if (!telemetry.value.samples.length) return;
    playback.value.playing = !playback.value.playing;
    playback.value.lastFrameTime = 0;
    useView3dStore().ensureView3d();
  }

  function onThreeTimelineInput(e: Event): void {
    var r = threePlaybackRange.value;
    var v = parseFloat((e.target as HTMLInputElement).value || '0') / 1000;
    playback.value.timeMs = r.min + r.span * v;
    playback.value.playing = false;
    updateCurrentData();
    useView3dStore().renderView3d();
  }

  // 自定义进度条（div 版）按百分比定位：0..1 → 区间内时间。供指针拖拽/点击跳转复用。
  function seekThreeByPct(pct: number): void {
    var r = threePlaybackRange.value;
    var v = Math.max(0, Math.min(1, pct));
    playback.value.timeMs = r.min + r.span * v;
    playback.value.playing = false;
    updateCurrentData();
    useView3dStore().renderView3d();
  }

  // 按绝对毫秒定位回放（AI 问题时段跳转等）：钳到播放区间并暂停。
  function seekThreeToTime(timeMs: number): void {
    var r = threePlaybackRange.value;
    playback.value.timeMs = Math.max(r.min, Math.min(r.max, timeMs));
    playback.value.playing = false;
    updateCurrentData();
    useView3dStore().renderView3d();
  }

  function formatMetric(value: number | null, unit: string): string {
    if (value === null || value === undefined || !isFinite(value)) return '-';
    var s = Number(value).toFixed(2);
    // 清负零：游标插值 / 单位换算在零附近会产生极小负值，toFixed 会吐 "-0.00"，
    // 与 "0.00" 交替导致面板数值抖动。
    if (s.startsWith('-') && parseFloat(s) === 0) s = s.slice(1);
    return s + ' ' + unit;
  }

  // ---- 遥测加载 ----
  function ensureThreeTelemetry(): void {
    if (telemetry.value.loaded || telemetry.value.loading) return;
    loadThreeTelemetry();
    useView3dStore().refreshDroneModels();
  }

  // 姿态源预设：取当前格式 profile 的 attitudeSources，按 key 索引返回（供下拉/选源/曲线预载）。
  // 各源含 kind('euler'|'quat')：euler 有 roll/pitch/yaw FieldSource，quat 有 quat[4] FieldSource。
  function threeAttitudePresets(): Record<string, AttitudeSource> {
    var out: Record<string, AttitudeSource> = {};
    var srcs = currentProfile().attitudeSources || [];
    for (var i = 0; i < srcs.length; i++) out[srcs[i].key] = srcs[i];
    return out;
  }

  // 无人机位置来源预设：取当前格式 profile 的 positionSources。global(lat/lng/alt) 或 local(px/py/pz)。
  function threePositionPresets(): Record<string, PositionSource> {
    var out: Record<string, PositionSource> = {};
    var srcs = currentProfile().positionSources || [];
    for (var i = 0; i < srcs.length; i++) out[srcs[i].key] = srcs[i];
    return out;
  }

  function telemetryType(names: string[]): MessageType | null {
    var messageTypes = useLogStore().log.messageTypes;
    var wanted: Record<string, boolean> = {};
    for (var i = 0; i < names.length; i++) wanted[String(names[i]).toLowerCase()] = true;
    for (var j = 0; j < messageTypes.length; j++) {
      var t = messageTypes[j];
      if (wanted[String(t.name).toLowerCase()]) return t;
    }
    return null;
  }

  function telemetryField(type: MessageType | null, names: string[]): string {
    if (!type || !Array.isArray(type.fields)) return '';
    var wanted: Record<string, boolean> = {};
    for (var i = 0; i < names.length; i++) wanted[String(names[i]).toLowerCase()] = true;
    for (var j = 0; j < type.fields.length; j++) {
      var f = String(type.fields[j]);
      if (wanted[f.toLowerCase()]) return f;
    }
    return '';
  }

  function findTelemetryCurve(typeNames: string[], fieldNames: string[]): { type: string; field: string; key: string } | null {
    var type = telemetryType(typeNames);
    var field = telemetryField(type, fieldNames);
    if (!type || !field) return null;
    return { type: type.name, field: field, key: type.name + '.' + field };
  }

  function findTelemetryCurveFrom(candidates: { types: string[]; fields: string[] }[]): { type: string; field: string; key: string } | null {
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var found = findTelemetryCurve(c.types, c.fields);
      if (found) return found;
    }
    return null;
  }

  function collectVoltCurves(): any[] {
    var voltList = currentProfile().volt || [];
    var out = [];
    for (var i = 0; i < voltList.length; i++) {
      var def = findTelemetryCurve([voltList[i].type], [voltList[i].field]);
      if (def) out.push(def);
    }
    return out;
  }

  // 按需加载参数（首次进 3D 时参数尚未加载）。失败忽略——collectMotorCurves 会回退到 RCOU 通道原序。
  async function ensureParametersLoaded(): Promise<void> {
    var ps = useParametersStore();
    if (ps.parameters.items && ps.parameters.items.length) return;
    try { await ps.loadParameters(); } catch (e) { /* 忽略：失败回退 RCOU 原序 */ }
  }

  // SERVOx_FUNCTION → RC 输出通道(servo 通道号) 映射：{ function值: 通道号 }。
  // 例：33(MOTOR1)→通道x、34(MOTOR2)→通道y、70(Throttle)→通道z。桨按自身 func(MOTOR 号或 70) 取对应通道的 RCOU.C{通道} 作 PWM。
  // 参数缺失返回 null，调用方回退到 RCOU 原序。
  function servoFuncToChannelMap(): Record<number, number> | null {
    // 参数名模式取自 profile.servoFuncParamPattern（APM ^SERVO(\d+)_FUNCTION$；PX4 无此参数→返回 null）。
    var pat = currentProfile().servoFuncParamPattern;
    var re = pat ? new RegExp(pat, 'i') : null;
    var params = useParametersStore().parameters.items;
    if (!re || !params || !params.length) return null;
    var map: Record<number, number> = {};
    var found = false;
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      var m = String(p && p.name || '').match(re);
      if (!m) continue;
      var ch = parseInt(m[1], 10);
      var v = typeof p.value === 'number' ? p.value : parseFloat(String(p.value));
      if (!isFinite(ch) || !isFinite(v)) continue;
      map[v] = ch;
      found = true;
    }
    return found ? map : null;
  }

  function collectMotorCurves(): any[] {
    // 电机输出源取自 profile.motor：APM=RCOU.C{start..}(前缀+通道号扫描排序)；PX4=actuator_outputs.output[0..N](显式字段名列表)。
    var motor = currentProfile().motor;
    if (!motor || !motor.type) return [];
    var type = telemetryType([motor.type]);
    if (!type || !Array.isArray(type.fields)) return [];
    var out = [];
    if (motor.fields) {
      // PX4：按 fields 列表序取实际存在的字段（output[0..15]）。
      for (var fi = 0; fi < motor.fields.length; fi++) {
        var fname = motor.fields[fi];
        if (type.fields.indexOf(fname) < 0) continue;
        out.push({ type: type.name, field: fname, key: type.name + '.' + fname, label: String(fi) });
      }
    } else {
      // APM：前缀+通道号扫描（默认 'C'/1），按通道号排序。
      var pre = motor.fieldPrefix != null ? motor.fieldPrefix : 'C';
      var found = [];
      for (var i = 0; i < type.fields.length; i++) {
        var f = String(type.fields[i]);
        var m = f.match(new RegExp('^' + pre + '(\\d+)$'));
        if (!m) continue;
        found.push({ field: f, num: parseInt(m[1], 10) });
      }
      found.sort(function (a, b) { return a.num - b.num; });
      for (var j = 0; j < found.length; j++) {
        out.push({ type: type.name, field: found[j].field, key: type.name + '.' + found[j].field, label: String(found[j].num) });
      }
    }
    return out;
  }

  async function fetchTelemetryCurve(def: { type: string; field: string } | null): Promise<any> {
    if (!def) return null;
    // 走 CurveManager（/curve.bin 二进制，带缓存）；返回 {def, binary}，binary 即零拷贝 Float32Array 视图。
    try {
      const binary = await useCurveManagerStore().get(def.type, def.field);
      return { def: def, binary: binary };
    } catch {
      return null;
    }
  }

  async function loadThreeTelemetry(): Promise<void> {
    const seq = ++loadSeq;
    telemetry.value.loading = true;
    telemetry.value.error = '';

    // 消息类型未就绪（尚未加载日志 / loadMessages 仍在途）时，字段解析必然全空——
    // 此处不锁 loaded=true：日志就绪后的 ensureThreeTelemetry 会自然重试，
    // 避免「未找到位置字段」误报被锁死（日志加载后不再自动恢复）。
    if (!useLogStore().log.messageTypes.length) {
      telemetry.value.error = '日志尚未就绪，暂无法加载 3D 轨迹；加载日志后自动重试。';
      telemetry.value.loading = false;
      return;
    }

    var profile = currentProfile();
    var aPresets = threeAttitudePresets();
    var pPresets = threePositionPresets();
    var attitudePreset: AttitudeSource | undefined = aPresets[useView3dStore().view3d.camera.attitudeSource] || aPresets[profile.defaultAttitude];
    var positionPreset: PositionSource | undefined = pPresets[useView3dStore().view3d.camera.positionSource] || pPresets[profile.defaultPosition];
    // FieldSource → 曲线定义的便捷解析（找不到返回 null）。
    function resolveFs(fs?: FieldSource): any { return fs ? findTelemetryCurve([fs.type], [fs.field]) : null; }

    // ---- 位置：经纬度(geo) 跨源优先链 ----
    // 遍历 profile 全局位置源（选定源优先），取首个能解析出 lat+lng 的源作 geo 源（保证经纬度同消息、时间网格一致）。
    // 全无则 hasGeo=false 落到 NED。
    var posSrcs: PositionSource[] = profile.positionSources || [];
    var globalSrcs = posSrcs.filter(function (s) { return s.kind === 'global' && s.lat && s.lng; });
    if (positionPreset && positionPreset.kind === 'global') {
      var selIdx = globalSrcs.indexOf(positionPreset);
      if (selIdx > 0) { globalSrcs.splice(selIdx, 1); globalSrcs.unshift(positionPreset); }
    }
    var geoSrc: { lat: any; lng: any } | null = null;
    for (var gi = 0; gi < globalSrcs.length; gi++) {
      var gs = globalSrcs[gi];
      var latDef = resolveFs(gs.lat); var lngDef = resolveFs(gs.lng);
      if (latDef && lngDef) { geoSrc = { lat: latDef, lng: lngDef }; break; }
    }
    // alt 双链候选：绝对海拔链（alt，选定源优先→其余源）与相对 home 链（relAlt，同样选定源优先）。
    // 两条链独立解析：绝对高供地形基准（cesium 开地形），相对高供 HUD 与无地形地图；
    // 相对链可全缺（如 PX4 无相对字段）→ buildThreeSamples 由 altMsl−alt0 派生。
    var absAltCandidates: { types: string[]; fields: string[] }[] = [];
    if (positionPreset && positionPreset.alt) absAltCandidates.push({ types: [positionPreset.alt.type], fields: [positionPreset.alt.field] });
    for (var ai = 0; ai < posSrcs.length; ai++) {
      if (posSrcs[ai] === positionPreset || !posSrcs[ai].alt) continue;
      absAltCandidates.push({ types: [posSrcs[ai].alt!.type], fields: [posSrcs[ai].alt!.field] });
    }
    var relAltCandidates: { types: string[]; fields: string[] }[] = [];
    if (positionPreset && positionPreset.relAlt) relAltCandidates.push({ types: [positionPreset.relAlt.type], fields: [positionPreset.relAlt.field] });
    for (var ri = 0; ri < posSrcs.length; ri++) {
      if (posSrcs[ri] === positionPreset || !posSrcs[ri].relAlt) continue;
      relAltCandidates.push({ types: [posSrcs[ri].relAlt!.type], fields: [posSrcs[ri].relAlt!.field] });
    }
    // 局部 NED(px/py/pz)：优先 profile 的 local 源；profile 无 local 源(APM)时回退 EKF 候选清单（安全网）。
    var localSrc = posSrcs.filter(function (s) { return s.kind === 'local'; })[0];
    var APM_LOCAL_NED_TYPES = ['POS', 'XKF1', 'XKF2', 'NKF1', 'NKF2', 'XKF0', 'NKF0'];
    var pxDef = localSrc ? resolveFs(localSrc.px) : findTelemetryCurve(APM_LOCAL_NED_TYPES, ['PE', 'PosE', 'E', 'X']);
    var pyDef = localSrc ? resolveFs(localSrc.py) : findTelemetryCurve(APM_LOCAL_NED_TYPES, ['PN', 'PosN', 'N', 'Y']);
    var pzDef = localSrc ? resolveFs(localSrc.pz) : findTelemetryCurve(APM_LOCAL_NED_TYPES, ['PD', 'PosD', 'D', 'Z']);

    // ---- 姿态：euler(APM ATT/AHR2) 或 quat(PX4 vehicle_attitude.q[0..3]) ----
    var attIsQuat = !!(attitudePreset && attitudePreset.kind === 'quat' && attitudePreset.quat);
    var rollDef: any = null, pitchDef: any = null, yawDef: any = null;
    var qDefs: any[] = [null, null, null, null];
    if (attitudePreset && !attIsQuat) {
      rollDef = resolveFs(attitudePreset.roll); pitchDef = resolveFs(attitudePreset.pitch); yawDef = resolveFs(attitudePreset.yaw);
    } else if (attIsQuat && attitudePreset && attitudePreset.quat) {
      for (var qi = 0; qi < 4; qi++) qDefs[qi] = resolveFs(attitudePreset.quat[qi]);
    }

    // ---- 速度/气压/电压：候选清单来自 profile（格式无关）----
    var fsListToCands = function (fs?: FieldSource[]) { return (fs || []).map(function (f) { return { types: [f.type], fields: [f.field] }; }); };
    var speedDef = findTelemetryCurveFrom(fsListToCands(profile.speed));
    var verticalSpeedDef = findTelemetryCurveFrom(fsListToCands(profile.verticalSpeed));
    var baroAltDef = findTelemetryCurveFrom(fsListToCands(profile.baroAlt));
    var vel = profile.velocity || {};
    var velNDef = resolveFs(vel.n), velEDef = resolveFs(vel.e), velDDef = resolveFs(vel.d);

    // ---- 遥控：pwm 通道(APM RCIN.C1-4 / PX4 input_rc.value[0-3]) 或归一化轴(MAVLink) ----
    // rcKind 记入 meta，驱动 RC HUD 显示/归一化分支（APM/PX4 均为 pwm）。
    var rcKind: 'pwm' | 'normalized' = 'pwm';
    var rcRollDef: any = null, rcPitchDef: any = null, rcThrottleDef: any = null, rcYawDef: any = null;
    if (profile.rc) {
      var rc = profile.rc;
      rcKind = rc.kind === 'normalized' ? 'normalized' : 'pwm';
      if (rc.kind === 'pwmChannels') {
        var pre = rc.chFieldPrefix != null ? rc.chFieldPrefix : 'C';
        var suf = rc.chFieldSuffix != null ? rc.chFieldSuffix : '';
        var rcField = function (ch?: number) { return ch != null ? findTelemetryCurve(rc.types, [pre + ch + suf]) : null; };
        rcRollDef = rcField(rc.rollCh); rcPitchDef = rcField(rc.pitchCh); rcThrottleDef = rcField(rc.throttleCh); rcYawDef = rcField(rc.yawCh);
      } else {
        rcRollDef = resolveFs(rc.roll); rcPitchDef = resolveFs(rc.pitch); rcThrottleDef = resolveFs(rc.throttle); rcYawDef = resolveFs(rc.yaw);
      }
    }

    var defs: Record<string, any> = {
      lat: geoSrc ? geoSrc.lat : null,
      lng: geoSrc ? geoSrc.lng : null,
      // 绝对海拔（MSL）与相对 home 两条高度曲线；alt0（home 海拔零点）从绝对链取。
      altMsl: findTelemetryCurveFrom(absAltCandidates),
      relAlt: findTelemetryCurveFrom(relAltCandidates),
      px: pxDef, py: pyDef, pz: pzDef,
      roll: rollDef, pitch: pitchDef, yaw: yawDef,
      // PX4 四元数姿态：buildThreeSamples 逐帧 quatToEulerDeg 折成欧拉；APM 为 null，走 roll/pitch/yaw。
      q1: qDefs[0], q2: qDefs[1], q3: qDefs[2], q4: qDefs[3],
      speed: speedDef,
      velN: velNDef, velE: velEDef, velD: velDDef,
      verticalSpeed: verticalSpeedDef,
      // 气压高度：与位置高度区分，单独展示气压计估算高度。
      baroAlt: baroAltDef,
      // 遥控器四通道（APM PWM 1000-2000 / PX4 input_rc PWM）；缺失为 null。
      rcRoll: rcRollDef, rcPitch: rcPitchDef, rcThrottle: rcThrottleDef, rcYaw: rcYawDef,
      // 家点高度（PX4 home_position.alt，米）：作高度零点 alt0（相对家高），缺省回退解锁/首采样。
      homeAlt: profile.homePosition ? resolveFs(profile.homePosition.alt) : null,
      // 解锁检测字段（PX4 vehicle_status.armed）：buildThreeSamples 据此找首解锁时刻作高度零点。APM 走事件 id，为 null。
      armed: (profile.armedDetection && profile.armedDetection.kind === 'field') ? resolveFs(profile.armedDetection.source) : null
    };

    // 电机顺序依赖 SERVOx_FUNCTION 参数，先确保参数已加载（失败则回退 RCOU 原序）。
    await ensureParametersLoaded();
    if (seq !== loadSeq) return; // 加载期间被重置（离开可视化/换日志）——丢弃本次结果
    var voltDefs = collectVoltCurves();
    var motorDefs = collectMotorCurves();
    var list: Promise<any>[] = [];
    Object.keys(defs).forEach(function (k: string) { if (defs[k]) list.push(fetchTelemetryCurve(defs[k]).then(function (c: any) { return { name: k, curve: c }; })); });
    // 各电池电压曲线单独抓取，存为 {volt, label, type, field}（点数据走 CurveManager）。
    voltDefs.forEach(function (d: any) {
      list.push(fetchTelemetryCurve(d).then(function (c: any) {
        return (c && c.binary && c.binary.count)
          ? { volt: true, label: d.type, type: d.type, field: d.field }
          : null;
      }).catch(function (): any { return null; }));
    });
    // PX4 电压聚合(voltCells)：预取各 cell 曲线入缓存（不显示），供 currentVoltage 按 QGC 公式累加。
    if (profile.voltCells) {
      var vcType = profile.voltCells.type;
      profile.voltCells.fields.forEach(function (fld: string) {
        list.push(useCurveManagerStore().get(vcType, fld).then(function (): any { return null; }).catch(function (): any { return null; }));
      });
    }
    // 各电机输出通道单独抓取，存为 {motor, label, type, field}，按通道号排列。
    motorDefs.forEach(function (d: any) {
      list.push(fetchTelemetryCurve(d).then(function (c: any) {
        return (c && c.binary && c.binary.count)
          ? { motor: true, label: d.label, type: d.type, field: d.field }
          : null;
      }).catch(function (): any { return null; }));
    });

    try {
      const items: any = await Promise.all(list);
      if (seq !== loadSeq) return; // 加载期间被重置——丢弃本次结果
      var curvesOut: Record<string, any> = {};
      var voltCurves: NamedCurve[] = [];
      var motorCurves: NamedCurve[] = [];
      items.forEach(function (item: any) {
        if (!item) return;
        if (item.volt) { voltCurves.push({ label: item.label, type: item.type, field: item.field }); return; }
        if (item.motor) { motorCurves.push({ label: item.label, type: item.type, field: item.field }); return; }
        if (item.curve) curvesOut[item.name] = item.curve;
      });
      curves.value.volt = voltCurves;
      curves.value.motor = motorCurves;
      var hasGeo = curvesOut.lat && curvesOut.lng;
      var hasLocal = curvesOut.px && curvesOut.py;
      if (!hasGeo && !hasLocal) {
        telemetry.value.error = '未找到可用于3D轨迹的位置字段（GPS Lat/Lng 或 POS/XKF/NKF 位置）。';
        telemetry.value.loaded = true;
        return;
      }
      // geo(Lat/Lng)优先：buildThreeSamples 走 int32 全精度读取，已恢复 1cm 精度（不再有 float32 量化），
      // 且 geo 提供 geoOrigin 供地图轨迹叠加。仅当日志无 geo 经纬度时才回退 NED(米)。
      buildThreeSamples(curvesOut, hasGeo, rcKind, attIsQuat);
      // 诊断提示：NED 优先后下拉框不再反映真实位置源，弹 toast 亮出实际来源，
      // 便于判断漂移是走 NED(米,精确) 还是回退到了 geo(lat/lng, float32 量化)。
      showToast('3D 位置源: ' + (telemetry.value.meta.position || '未知'), 'info');
      // 位置来源缺失提示：所选来源没有 Lat/Lng 时告知用户（会回退到局部 NED 或报错）。
      if (!curvesOut.lat || !curvesOut.lng) {
        showToast('未找到 ' + (positionPreset ? positionPreset.label : '所选') + ' 的 Lat/Lng 字段，位置将回退到局部 NED 或无法显示', 'info');
      }
      // 姿态来源缺失提示：euler 缺 Roll/Pitch/Yaw 或 quat 缺 q[0..3] 时告知用户（姿态会归零）。
      var hasAtt = attIsQuat ? (curvesOut.q1 && curvesOut.q2 && curvesOut.q3 && curvesOut.q4) : (curvesOut.roll && curvesOut.pitch && curvesOut.yaw);
      if (!hasAtt) {
        showToast('未找到 ' + (attitudePreset ? attitudePreset.label : '所选') + ' 的姿态字段，无人机姿态将归零', 'info');
      }
      telemetry.value.loaded = true;
      // 遥测就绪：通知渲染侧（预载姿态源曲线 + 建视图）。
      useView3dStore().handleTelemetryReady();
    } catch (e: any) {
      if (seq !== loadSeq) return;
      telemetry.value.error = '3D遥测加载失败: ' + e.message;
    } finally {
      if (seq === loadSeq) telemetry.value.loading = false;
    }
  }

  function logHorizontalSpeedAt(curves: any, t: number): number | null {
    var cm = useCurveManagerStore();
    if (curves.speed) return cm.getValueAt(curves.speed.def.type, curves.speed.def.field, t, null);
    if (curves.velN && curves.velE) {
      var vn = cm.getValueAt(curves.velN.def.type, curves.velN.def.field, t, null);
      var ve = cm.getValueAt(curves.velE.def.type, curves.velE.def.field, t, null);
      if (vn !== null && ve !== null) return Math.sqrt(vn * vn + ve * ve);
    }
    return null;
  }

  function logVerticalSpeedAt(curves: any, t: number): number | null {
    var cm = useCurveManagerStore();
    if (curves.verticalSpeed) {
      var vd = cm.getValueAt(curves.verticalSpeed.def.type, curves.verticalSpeed.def.field, t, null);
      if (vd !== null && isFinite(vd)) return -vd;
    }
    return null;
  }

  // 按 RCIN↔实际姿态 的相关性自动判定横滚/俯仰打杆方向是否取反，比读 RCx_REVERSED 参数更可靠
  // （后者只含飞控软件反向，不含遥控器硬件极性）。
  function computeRcInvert(samples: TelemetrySample[]): RcInvert {
    return {
      roll: rcCorrSign(samples, 'rcRoll', 'roll') < 0,
      pitch: rcCorrSign(samples, 'rcPitch', 'pitch') > 0
    };
  }

  function rcCorrSign(samples: TelemetrySample[], aKey: string, bKey: string): number {
    var n = samples.length, ma = 0, mb = 0, count = 0;
    for (var i = 0; i < n; i++) {
      var a = (samples as any)[i][aKey], b = (samples as any)[i][bKey];
      if (a === null || a === undefined || !isFinite(a) || b === null || b === undefined || !isFinite(b)) continue;
      ma += a; mb += b; count++;
    }
    if (count < 8) return 0;
    ma /= count; mb /= count;
    var cov = 0, va = 0, vb = 0;
    for (var j = 0; j < n; j++) {
      var x = (samples as any)[j][aKey], y = (samples as any)[j][bKey];
      if (x === null || x === undefined || !isFinite(x) || y === null || y === undefined || !isFinite(y)) continue;
      var da = x - ma, db = y - mb;
      cov += da * db; va += da * da; vb += db * db;
    }
    if (va < 1e-9 || vb < 1e-9) return 0;
    return (cov / Math.sqrt(va * vb)) < 0 ? -1 : 1;
  }

  function buildThreeSamples(curveData: Record<string, any>, useGeo: boolean, rcKind: 'pwm' | 'normalized', attIsQuat: boolean): void {
    var cm = useCurveManagerStore();
    var profile = currentProfile();
    // 在二进制 buffer 上按时刻取值（线性/角度插值由 CurveManager 内部二分完成）。
    function at(c: any, t: number, fb: any, angle?: boolean): any {
      if (!c || !c.binary) return fb;
      return angle ? cm.getAngleAt(c.def.type, c.def.field, t, fb) : cm.getValueAt(c.def.type, c.def.field, t, fb);
    }
    function firstV(c: any, fb: any): any {
      return c && c.binary && c.binary.count ? c.binary.buffer[1] : fb;
    }

    // 无效经纬度判定：未定位时 lat/lng 记 0，单行 0 值会让 north/east 跳到百万米级、撑爆 maxRadius 与网格/相机。
    // 两轴同时 < eps（距 (0,0) 不足 ~0.1m）即视为飞点。阈值取自 profile.geoInvalidEps。
    var geoEps = profile.geoInvalidEps != null ? profile.geoInvalidEps : GEO_INVALID_EPS;
    function validGeo(latv: any, lngv: any): boolean {
      return isFinite(latv) && isFinite(lngv) && Math.abs(latv) >= geoEps && Math.abs(lngv) >= geoEps;
    }

    // 经纬度全精度：lat/lng 在 body 里是精确 int32(格式 'L'=度×1e7)，Float32Array 会截断到 ~0.2m，
    // 叠加在真实抖动上比 APM(全精度 double) 更狠。取原始 int32 列，(latInt-lat0Int)*scale*110540
    // 全程 float64，恢复 1cm。非 int32 字段回退 Float32 路径。
    var latI32 = useGeo && curveData.lat ? cm.rawInt32Column(curveData.lat.def.type, curveData.lat.def.field) : null;
    var lngI32 = useGeo && curveData.lng ? cm.rawInt32Column(curveData.lng.def.type, curveData.lng.def.field) : null;
    var geoExact = !!(latI32 && lngI32);
    // 聚类剔除：未锁定阶段 GPS 可能输出非零漂移值（实测 tlog 冷启动 ~0.0003° 缓慢漂移），
    // (0,0) 过滤挡不住——首行一旦是这种垃圾，随后真实位置在数千公里外，maxRadius 撑爆
    // 网格/相机缩放，3D 撕裂。取有效行经纬度中位数为飞行簇心，偏离簇心超过 GEO_CLUSTER_DEG
    // 的行整行剔除，原点=剔除后首行。正常日志中位数≈所有行、零剔除，行为与旧版一致。
    var clusterOn = false, medLat = 0, medLng = 0;
    function geoRowOk(latv: any, lngv: any): boolean {
      if (!validGeo(latv, lngv)) return false;
      if (!clusterOn) return true;
      var la = geoExact ? latv * latI32.scale : latv;
      var ln = geoExact ? lngv * lngI32.scale : lngv;
      return Math.abs(la - medLat) <= GEO_CLUSTER_DEG && Math.abs(ln - medLng) <= GEO_CLUSTER_DEG;
    }
    var lat0i = 0, lng0i = 0;
    var lat0 = 0, lng0 = 0, cosLat = 1, geoValid = 0;
    if (useGeo && curveData.lat && curveData.lat.binary) {
      var latBin = curveData.lat.binary;
      // 第一遍：收集有效行求簇心（中位数对离群天然免疫）。
      var vlat: number[] = [], vlng: number[] = [];
      for (var gi = 0; gi < latBin.count; gi++) {
        var glat = geoExact ? latI32.values[gi] : latBin.buffer[gi * 2 + 1];
        var glng = geoExact ? lngI32.values[gi] : at(curveData.lng, latBin.baseTimeMs + latBin.buffer[gi * 2], 0);
        if (!validGeo(glat, glng)) continue;
        vlat.push(geoExact ? glat * latI32.scale : glat);
        vlng.push(geoExact ? glng * lngI32.scale : glng);
      }
      if (vlat.length >= GEO_CLUSTER_MIN_ROWS) {
        var slat = vlat.slice().sort(function (a: number, b: number): number { return a - b; });
        var slng = vlng.slice().sort(function (a: number, b: number): number { return a - b; });
        medLat = slat[Math.floor(slat.length / 2)];
        medLng = slng[Math.floor(slng.length / 2)];
        clusterOn = true;
      }
      // 第二遍：确定原点(簇内首个有效经纬度)与簇内有效点计数。有效点不足 2 且有 NED 时回退 NED，
      // 避免原点取到 0 或整段无定位造成空轨迹。
      for (var gj = 0; gj < latBin.count; gj++) {
        var flat = geoExact ? latI32.values[gj] : latBin.buffer[gj * 2 + 1];
        var flng = geoExact ? lngI32.values[gj] : at(curveData.lng, latBin.baseTimeMs + latBin.buffer[gj * 2], 0);
        if (!geoRowOk(flat, flng)) continue;
        geoValid++;
        if (geoValid === 1) {
          if (geoExact) { lat0i = flat; lng0i = flng; }
          else { lat0 = flat; lng0 = flng; }
        }
      }
      if (geoValid < 2 && curveData.px && curveData.py) useGeo = false;
      else cosLat = Math.cos((geoExact ? lat0i * latI32.scale : lat0) * Math.PI / 180);
    }

    var baseBin = useGeo ? curveData.lat.binary : curveData.px.binary;
    var baseN = baseBin.count;
    var baseT0 = baseBin.baseTimeMs;
    var samples = [];
    // 高度零点取解锁时刻（首次 ARMED/AUTO_ARMED）的取值，而非首采样：起飞即 y=0、爬升为正，
    // 避免解锁前被搬运/未定位使首采样高度偏高、起飞后钻到地下。仅改垂直零点（geo 的 alt / NED 的 down），
    // 不动水平原点（lat0/lng0、east0/north0 仍取首采样）。无 ARMED 事件 → tArm=null → 回退首采样（原行为）。
    // 解锁时刻按格式检测：APM=首次 ARMED/AUTO_ARMED 事件 id；PX4=vehicle_status.armed 首次===armedValue。
    var armedDet = profile.armedDetection;
    var tArm = (function (): number | null {
      if (armedDet && armedDet.kind === 'eventIds') {
        var evs = useLogStore().log.events;
        var ids = armedDet.ids || [];
        if (!evs || !evs.length || !ids.length) return null;
        for (var ei = 0; ei < evs.length; ei++) {
          var ev = evs[ei];
          if (ev && typeof ev.timeMs === 'number' && isFinite(ev.timeMs) && ids.indexOf(ev.id) >= 0) return ev.timeMs;
        }
        return null;
      }
      if (armedDet && armedDet.kind === 'field') {
        var ac = curveData.armed;
        if (ac && ac.binary) {
          for (var bi = 0; bi < ac.binary.count; bi++) {
            if (ac.binary.buffer[bi * 2 + 1] === armedDet.armedValue) return ac.binary.baseTimeMs + ac.binary.buffer[bi * 2];
          }
        }
        return null;
      }
      return null;
    })();
    // 高度零点 alt0（home 海拔，MSL 口径——供 geoOrigin/任务航点换算与相对高派生）：
    // 家点高度(PX4 home_position.alt，米)优先；否则绝对海拔链解锁时刻取值；再否则首采样。
    var alt0 = curveData.homeAlt && curveData.homeAlt.binary
      ? firstV(curveData.homeAlt, 0)
      : (tArm != null ? at(curveData.altMsl, tArm, firstV(curveData.altMsl, 0)) : firstV(curveData.altMsl, 0));
    var east0 = useGeo ? 0 : firstV(curveData.px, 0);
    var north0 = useGeo ? 0 : firstV(curveData.py, 0);
    var down0 = curveData.pz ? (tArm != null ? at(curveData.pz, tArm, firstV(curveData.pz, 0)) : firstV(curveData.pz, 0)) : 0;
    var maxRadius = 1;

    for (var i = 0; i < baseN; i++) {
      var t = baseT0 + baseBin.buffer[i * 2];
      var north, east, down, altMsl, relAlt;
      if (useGeo) {
        if (geoExact) {
          var li = latI32.values[i], ln = lngI32.values[i];
          if (!geoRowOk(li, ln)) continue; // 跳过无定位/飞点/簇外漂移行
          north = (li - lat0i) * latI32.scale * 110540;   // 整数差 ×scale，float64 全精度
          east = (ln - lng0i) * lngI32.scale * cosLat * 111320;
        } else {
          var lat = baseBin.buffer[i * 2 + 1];
          var lng = at(curveData.lng, t, lng0);
          if (!geoRowOk(lat, lng)) continue; // 跳过无定位/飞点/簇外漂移行
          north = (lat - lat0) * 110540;
          east = (lng - lng0) * cosLat * 111320;
        }
        // 双高度：绝对海拔(altMsl)与相对 home(relAlt)分开取。相对高优先日志相对字段
        // （POS.RelHomeAlt/RelativeAlt，其基准即 home）；该时刻无值或缺字段则由绝对海拔−home 海拔零点派生。
        altMsl = at(curveData.altMsl, t, null);
        var rel1 = curveData.relAlt ? at(curveData.relAlt, t, null) : null;
        if (rel1 === null && altMsl !== null) rel1 = altMsl - alt0;
        relAlt = rel1;
        down = rel1 !== null ? -rel1 : 0;
      } else {
        east = at(curveData.px, t, east0) - east0;
        north = at(curveData.py, t, north0) - north0;
        down = curveData.pz ? at(curveData.pz, t, down0) - down0 : 0;
        altMsl = curveData.altMsl ? at(curveData.altMsl, t, null) : null;
        var rel2 = curveData.relAlt ? at(curveData.relAlt, t, null) : null;
        relAlt = rel2 !== null ? rel2 : -down;
      }

      var x = east * THREE_UNITS_PER_METER;
      var y = -down * THREE_UNITS_PER_METER;
      var z = -north * THREE_UNITS_PER_METER;
      var speed = logHorizontalSpeedAt(curveData, t);
      var verticalSpeed = logVerticalSpeedAt(curveData, t);
      // 姿态：euler(APM roll/pitch/yaw，角度插值) 或 quat(PX4 q[0..3]→quatToEulerDeg 折成欧拉度)。
      // 下游全程只认欧拉度，故 quat 在此折成 roll/pitch/yaw，sample/makeDroneQuaternion/姿态仪契约不变。
      var roll: number, pitch: number, yaw: number;
      if (attIsQuat) {
        var e = quatToEulerDeg(at(curveData.q1, t, 0), at(curveData.q2, t, 0), at(curveData.q3, t, 0), at(curveData.q4, t, 0));
        roll = e.roll; pitch = e.pitch; yaw = e.yaw;
      } else {
        roll = at(curveData.roll, t, 0, true);
        pitch = at(curveData.pitch, t, 0, true);
        yaw = at(curveData.yaw, t, 0, true);
      }
      var sample = {
        t: t, x: x, y: y, z: z,
        north: north, east: east, down: down,
        roll: roll,
        pitch: pitch,
        yaw: yaw,
        speed: speed,
        verticalSpeed: verticalSpeed,
        // 相对 home 高（HUD/无地形地图口径）；绝对海拔 altMsl（地形渲染基准），缺失为 null。
        altitude: relAlt,
        altMsl: altMsl,
        // 气压高度独立于位置高度，缺失时为 null（面板显示 -）。
        baroAlt: at(curveData.baroAlt, t, null),
        // 遥控器四通道原始 PWM，缺失为 null。
        rcRoll: at(curveData.rcRoll, t, null),
        rcPitch: at(curveData.rcPitch, t, null),
        rcThrottle: at(curveData.rcThrottle, t, null),
        rcYaw: at(curveData.rcYaw, t, null)
      };
      maxRadius = Math.max(maxRadius, Math.abs(x), Math.abs(z), Math.abs(y));
      samples.push(sample);
    }
    telemetry.value.samples = samples;
    // 保留当前播放时刻：切换位置源时不同源时间跨度基本一致，落在新区间内则保持，否则回起点。
    var prevT = playback.value.timeMs;
    var firstT = samples.length ? samples[0].t : 0;
    var lastT = samples.length ? samples[samples.length - 1].t : 0;
    playback.value.timeMs = (prevT >= firstT && prevT <= lastT) ? prevT : firstT;
    rcInvert.value = computeRcInvert(samples);
    telemetry.value.meta = {
      position: (useGeo ? curveData.lat.def.type + '.Lat/Lng' : curveData.px.def.type + ' NED') + ' -> XYZ x' + THREE_UNITS_PER_METER,
      attitude: attIsQuat
        ? (curveData.q1 ? curveData.q1.def.type + '.q (quat→euler)' : 'quat 缺失')
        : (curveData.roll ? curveData.roll.def.key : 'Roll') + ' / ' + (curveData.pitch ? curveData.pitch.def.field : 'Pitch') + ' / ' + (curveData.yaw ? curveData.yaw.def.field : 'Yaw'),
      speed: (curveData.speed ? curveData.speed.def.key : (curveData.velN && curveData.velE ? curveData.velN.def.key + ' + ' + curveData.velE.def.key : '未找到日志速度字段')),
      verticalSpeed: curveData.verticalSpeed ? curveData.verticalSpeed.def.key + ' (down取反)' : '未找到垂直速度字段',
      altitude: curveData.relAlt ? curveData.relAlt.def.key : (curveData.altMsl ? curveData.altMsl.def.key + ' (-alt0)' : '由局部Z估算'),
      altMsl: curveData.altMsl ? curveData.altMsl.def.key : '未找到绝对海拔字段',
      baroAlt: curveData.baroAlt ? curveData.baroAlt.def.key : '未找到气压高度',
      rc: curveData.rcRoll ? curveData.rcRoll.def.type + ' RC' : '未找到 RC',
      // RC 值类型：pwm(APM RCIN / PX4 input_rc，1000-2000) | normalized(MAVLink -1..1)。驱动 RC HUD 显示分支。
      rcKind: rcKind,
      volt: curves.value.volt && curves.value.volt.length
        ? curves.value.volt.map(function (c) { return c.label; }).join(' · ')
        : '未找到电压字段',
      motor: curves.value.motor && curves.value.motor.length
        ? curves.value.motor[0].type + ' ×' + curves.value.motor.length
        : '未找到电机输出',
      maxRadius: maxRadius,
      scale: THREE_UNITS_PER_METER,
      // 保留地理原点供"航线"叠加层复用同一投影（仅 GPS 轨迹时可用）。geoExact 时用 int32 精确原点(度)。
      geoOrigin: useGeo ? { lat0: geoExact ? lat0i * latI32.scale : lat0, lng0: geoExact ? lng0i * lngI32.scale : lng0, alt0: alt0, cosLat: cosLat } : null,
      // 调试面板用：实际位置源字段，供实时取原始值与转换 XYZ 对照，定位精度/计算问题。
      posSource: {
        useGeo: useGeo, geoExact: geoExact,
        lat: curveData.lat ? curveData.lat.def : null, lng: curveData.lng ? curveData.lng.def : null,
        alt: curveData.altMsl ? curveData.altMsl.def : null, relAlt: curveData.relAlt ? curveData.relAlt.def : null,
        px: curveData.px ? curveData.px.def : null, py: curveData.py ? curveData.py.def : null, pz: curveData.pz ? curveData.pz.def : null
      }
    };
    updateCurrentData();
  }

  // ---- 当前值查询（flight-metrics 等按帧消费）----
  function motorsAvailable(): boolean {
    return (curves.value.motor || []).length > 0;
  }

  function currentMotors(): Array<{ label: string; value: any }> {
    var motorCurves = curves.value.motor || [];
    var out: Array<{ label: string; value: any }> = [];
    for (var i = 0; i < motorCurves.length; i++) {
      out.push({ label: motorCurves[i].label, value: useCurveManagerStore().getValueAt(motorCurves[i].type, motorCurves[i].field, playback.value.timeMs, null) });
    }
    return out;
  }

  // 当前总电压：PX4 按 QGC 公式累加 battery_status.voltage_cell_v[0..13]（float32，单位 V；遇 invalid(0) 即停）；
  // APM 单 volt 字段直读。供飞行面板 __volt__ 虚拟键。缺失返回 null。
  function currentVoltage(): number | null {
    var profile = currentProfile();
    var cm = useCurveManagerStore();
    var t = playback.value.timeMs;
    if (profile.voltCells) {
      var vc = profile.voltCells;
      var invalid = vc.invalid != null ? vc.invalid : 0;
      var scale = vc.scale != null ? vc.scale : 1;
      var total = 0, any = false;
      for (var i = 0; i < vc.fields.length; i++) {
        var v = cm.getValueAt(vc.type, vc.fields[i], t, null);
        if (v === null || !isFinite(v) || Math.abs(v - invalid) < 0.5) break; // QGC：遇 UINT16_MAX/无效即停
        total += v; any = true;
      }
      return any ? total * scale : null;
    }
    if (profile.volt && profile.volt.length) {
      return cm.getValueAt(profile.volt[0].type, profile.volt[0].field, t, null);
    }
    return null;
  }

  // ---- 生命周期 ----
  // 换日志时复位数据面（渲染器复位由 view3d.resetView3dScene 编排，其内部调用本函数）。
  function resetTelemetry(): void {
    loadSeq++; // 使在途加载失效
    playback.value.playing = false;
    playback.value.timeMs = 0;
    playback.value.lastFrameTime = 0;
    playback.value.fpsLastTime = 0;
    telemetry.value.loaded = false;
    telemetry.value.samples = [];
    telemetry.value.meta = {};
    telemetry.value.error = '';
    curves.value.volt = [];
    curves.value.motor = [];
    rcInvert.value = { roll: false, pitch: false };
    current.value = {
      speed: null, verticalSpeed: null, altitude: null, altMsl: null, baroAlt: null,
      rcRoll: null, rcPitch: null, rcThrottle: null, rcYaw: null,
      x: null, y: null, z: null, north: null, east: null, down: null,
    };
  }

  // 离开可视化视图时释放派生数据（按需加载/用完释放，防内存常驻）：
  // samples/meta/曲线定义/current 全清、loaded=false；CurveManager 缓存不动（与曲线图共用，换日志才清）。
  // 重新进入可视化由 ensureThreeTelemetry 重建（曲线数据命中缓存，无网络请求）。
  function releaseTelemetry(): void {
    resetTelemetry();
  }

  return {
    // state
    playback, telemetry, curves, current, rcInvert,
    // getters
    threeTimeRange, threePlaybackRange, threeTimelineValue, threeTimelinePct,
    threeCurrentTimeLabel, threeEndTimeLabel, threeDebugInfo, threeModeSegments,
    threeIncidentSegments,
    // 采样
    sampleAtTime, currentThreeSampleIndex, lerpAngle, updateCurrentData,
    // 播放时钟
    advanceThreePlayback, toggleThreePlayback, resetPlaybackToStart, onThreeTimelineInput,
    seekThreeByPct, seekThreeToTime,
    // 遥测加载
    ensureThreeTelemetry, loadThreeTelemetry, buildThreeSamples,
    threeAttitudePresets, threePositionPresets,
    telemetryType, telemetryField, findTelemetryCurve, findTelemetryCurveFrom,
    collectVoltCurves, collectMotorCurves, ensureParametersLoaded, servoFuncToChannelMap,
    // 当前值查询
    motorsAvailable, currentMotors, currentVoltage, formatMetric,
    // 生命周期
    resetTelemetry, releaseTelemetry,
  };
});
