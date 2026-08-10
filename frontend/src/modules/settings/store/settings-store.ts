import { defineStore } from 'pinia';
import { computed, nextTick, reactive, watch } from 'vue';
import { configClient } from '@/services/config';
import { showToast } from '@/modules/shared/ui-store';
import { useAnalysisStore } from '@/modules/analysis';
import { useScene3dStore } from '@/modules/scene-3d';
import { useMapStateStore } from '@/modules/shared/map-state';
import { useLogStore } from '@/modules/log';
import { getProfile, type FormatProfile } from '@/profiles';

/* -------------------------------------------------------------------------- */
/*  Persisted settings shape                                                  */
/*                                                                            */
/*  These interfaces describe the document we round-trip through the Go       */
/*  config service. They are intentionally narrower than the live store       */
/*  state: every field is optional because a stored blob may originate        */
/*  from an older release. Restore guards (isNum / oneOf / ...) make every    */
/*  assignment defensive, so an unexpected type is silently skipped rather    */
/*  than crashing the UI.                                                     */
/* -------------------------------------------------------------------------- */

type AntiAliasing = 'off' | 'msaa' | 'fxaa';
type RenderQuality = 'auto' | 'high' | 'medium' | 'low';
type DroneModel = 'glb' | 'lowpoly';
type RcLayout = 'side' | 'center';
type MapRenderer = '2d' | '3d' | 'earth';

const AA_MODES = ['off', 'msaa', 'fxaa'] as const;
const QUALITY_MODES = ['auto', 'high', 'medium', 'low'] as const;
const SAVE_DEBOUNCE_MS = 350;
const FALLBACK_FORMAT = 'apm';

interface ChartSnapshot {
  tooltip?: boolean;
  showErrors?: boolean;
  showEvents?: boolean;
  showMessages?: boolean;
  lineWidth?: number;
}

interface ViewSnapshot {
  attitudeSource?: string;
  positionSource?: string;
}

interface RcSnapshot {
  hud?: boolean;
  readout?: boolean;
  layout?: RcLayout;
}

interface LightingSnapshot {
  enabled?: boolean;
  env?: number;
  ambient?: number;
  key?: number;
}

interface SkySnapshot {
  enabled?: boolean;
  cloud?: number;
}

interface GroundSnapshot {
  show?: boolean;
}

interface WaterSnapshot {
  enabled?: boolean;
  wave?: number;
}

interface RenderSideSnapshot {
  aa?: AntiAliasing;
  /** Legacy alias used by older saved blobs. */
  fxaa?: boolean;
  resolution?: number;
}

interface RenderSnapshot {
  quality?: RenderQuality;
  main?: RenderSideSnapshot;
  attitude?: RenderSideSnapshot;
  /** Legacy alias used by older saved blobs. */
  antialias?: boolean;
  fps?: number;
}

interface DebugSnapshot {
  posPanel?: boolean;
}

interface ThreeSnapshot {
  view?: ViewSnapshot;
  playback?: { curveAxis?: boolean };
  rc?: RcSnapshot;
  lighting?: LightingSnapshot;
  sky?: SkySnapshot;
  droneScale?: number;
  model?: DroneModel;
  ground?: GroundSnapshot;
  water?: WaterSnapshot;
  render?: RenderSnapshot;
  debug?: DebugSnapshot;
  /** Legacy aliases that used to live under `three` but map onto map flags. */
  path?: { show?: boolean };
  mission?: { route?: boolean };
}

interface MapSnapshot {
  providerId?: string;
  renderer?: MapRenderer;
  terrainOn?: boolean;
  followDrone?: boolean;
  lockView?: boolean;
  droneModel?: DroneModel;
  droneScale?: number;
  droneShaded?: boolean;
  mapFps?: number;
  controlBarCollapsed?: boolean;
  showPath?: boolean;
  showRoute?: boolean;
  showWaypoints?: boolean;
}

interface PersistedSettings {
  chart?: ChartSnapshot;
  three?: ThreeSnapshot;
  map?: MapSnapshot;
}

interface SettingsResponse {
  error?: string;
  settings?: PersistedSettings;
}

/* -------------------------------------------------------------------------- */
/*  Narrowing guards & math helpers                                           */
/* -------------------------------------------------------------------------- */

function isNum(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Clamp when the incoming value is a finite number, otherwise return null. */
function clampOptional(v: unknown, min: number, max: number): number | null {
  return isNum(v) ? clampNum(v, min, max) : null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === 'string' && (allowed as readonly string[]).indexOf(v) >= 0;
}

/* -------------------------------------------------------------------------- */
/*  Profile-aware source validation                                           */
/*                                                                            */
/*  These read the active log format, so they must run inside an action       */
/*  (never at module load) — the log store is only safe to touch once the     */
/*  app is booted.                                                            */
/* -------------------------------------------------------------------------- */

function activeProfile(): FormatProfile {
  const fmt = String(useLogStore().log.summary?.format || FALLBACK_FORMAT);
  return getProfile(fmt) || getProfile(FALLBACK_FORMAT)!;
}

function isKnownAttitudeKey(key: string): boolean {
  return activeProfile().attitudeSources.some((s) => s.key === key);
}

function isKnownPositionKey(key: string): boolean {
  return activeProfile().positionSources.some((s) => s.key === key);
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

export const useSettingsStore = defineStore('settings', () => {
  /* ---------------- state ---------------------------------------------- */
  const settings = reactive({
    /** True while a remote snapshot is being pushed into the live stores. */
    restoring: false,
    /** Pending debounce handle for the next write-back. */
    saveTimer: null as ReturnType<typeof setTimeout> | null,
    /** Whether the deep auto-save watcher has been installed. */
    started: false,
  });

  /* ---------------- computed ------------------------------------------- */

  /** Frozen snapshot of every persistable preference, ready to write back. */
  const toolbarConfig = computed<PersistedSettings>(() => buildSnapshot());

  function buildSnapshot(): PersistedSettings {
    const chart = useAnalysisStore().chart;
    const three = useScene3dStore().three;
    const map = useMapStateStore().map;
    return {
      chart: {
        tooltip: chart.tooltip,
        showErrors: chart.showErrors,
        showEvents: chart.showEvents,
        showMessages: chart.showMessages,
        lineWidth: chart.lineWidth,
      },
      three: {
        view: { attitudeSource: three.view.attitudeSource, positionSource: three.view.positionSource },
        playback: { curveAxis: three.playback.curveAxis },
        rc: { hud: three.rc.hud, readout: three.rc.readout, layout: three.rc.layout },
        lighting: { enabled: three.lighting.enabled, env: three.lighting.env, ambient: three.lighting.ambient, key: three.lighting.key },
        sky: { enabled: three.sky.enabled, cloud: three.sky.cloud },
        droneScale: three.droneScale,
        model: three.model,
        ground: { show: three.ground.show },
        water: { enabled: three.water.enabled, wave: three.water.wave },
        render: {
          quality: three.render.quality,
          main: { aa: three.render.main.aa, resolution: three.render.main.resolution },
          attitude: { aa: three.render.attitude.aa, resolution: three.render.attitude.resolution },
          fps: three.render.fps,
        },
        debug: { posPanel: three.debug.posPanel },
      },
      map: {
        providerId: map.providerId,
        renderer: map.renderer,
        terrainOn: map.terrainOn,
        followDrone: map.followDrone,
        lockView: map.lockView,
        droneModel: map.droneModel,
        droneScale: map.droneScale,
        droneShaded: map.droneShaded,
        mapFps: map.mapFps,
        controlBarCollapsed: map.controlBarCollapsed,
        showPath: map.showPath,
        showRoute: map.showRoute,
        showWaypoints: map.showWaypoints,
      },
    };
  }

  /* ---------------- restore appliers ----------------------------------- */
  //
  // Each helper restores a single slice. They are intentionally defensive:
  // every field is guarded so that a malformed or partial blob cannot corrupt
  // the live state. Side-effectful store methods (applyLighting, onSkyToggle,
  // ...) are only re-run when the corresponding field is actually present.

  function applyChartSlice(c: ChartSnapshot | undefined): void {
    if (!c) return;
    const chart = useAnalysisStore().chart;
    if (c.tooltip !== undefined) chart.tooltip = !!c.tooltip;
    if (c.showErrors !== undefined) chart.showErrors = !!c.showErrors;
    if (c.showEvents !== undefined) chart.showEvents = !!c.showEvents;
    if (c.showMessages !== undefined) chart.showMessages = !!c.showMessages;
    if (isNum(c.lineWidth)) chart.lineWidth = c.lineWidth;
  }

  function resolveAaMode(side: RenderSideSnapshot | undefined, legacy: boolean | undefined): AntiAliasing | null {
    if (side) {
      if (oneOf(side.aa, AA_MODES)) return side.aa;
      if (side.fxaa !== undefined) return side.fxaa !== false ? 'fxaa' : 'off';
    }
    if (legacy !== undefined) return legacy !== false ? 'msaa' : 'off';
    return null;
  }

  function applyViewSlice(v: ViewSnapshot | undefined): void {
    if (!v) return;
    const view = useScene3dStore().three.view;
    if (isStr(v.attitudeSource) && isKnownAttitudeKey(v.attitudeSource)) view.attitudeSource = v.attitudeSource;
    if (isStr(v.positionSource) && isKnownPositionKey(v.positionSource)) view.positionSource = v.positionSource;
  }

  function applyRcSlice(r: RcSnapshot | undefined): void {
    if (!r) return;
    const rc = useScene3dStore().three.rc;
    if (r.hud !== undefined) rc.hud = !!r.hud;
    if (r.readout !== undefined) rc.readout = !!r.readout;
    if (r.layout === 'side' || r.layout === 'center') rc.layout = r.layout;
  }

  function applyLightingSlice(l: LightingSnapshot | undefined): void {
    if (!l) return;
    const scene = useScene3dStore();
    const lighting = scene.three.lighting;
    if (l.enabled !== undefined) lighting.enabled = l.enabled !== false;
    const env = clampOptional(l.env, 0, 3);
    if (env !== null) lighting.env = env;
    const ambient = clampOptional(l.ambient, 0, 2);
    if (ambient !== null) lighting.ambient = ambient;
    const key = clampOptional(l.key, 0, 2);
    if (key !== null) lighting.key = key;
    scene.applyLighting();
  }

  function applySkySlice(s: SkySnapshot | undefined): void {
    if (!s) return;
    const scene = useScene3dStore();
    const sky = scene.three.sky;
    if (s.enabled !== undefined) sky.enabled = s.enabled !== false;
    if (isNum(s.cloud)) sky.cloud = clampNum(s.cloud, 0, 1);
    scene.onSkyToggle(sky.enabled);
  }

  function applyDroneScaleSlice(scale: number | undefined): void {
    if (!isNum(scale)) return;
    const clamped = clampNum(scale, 0.1, 20);
    const scene = useScene3dStore();
    scene.three.droneScale = clamped;
    scene.onDroneScaleChange(clamped);
  }

  function applyGroundSlice(g: GroundSnapshot | undefined): void {
    if (!g || g.show === undefined) return;
    const scene = useScene3dStore();
    const show = g.show !== false;
    scene.three.ground.show = show;
    scene.onGroundToggle(show);
  }

  function applyWaterSlice(w: WaterSnapshot | undefined): void {
    if (!w) return;
    const scene = useScene3dStore();
    if (w.enabled === true) scene.onWaterToggle(true);
    if (isNum(w.wave)) scene.onWaterWaveChange(clampNum(w.wave, 0, 1));
  }

  function applyRenderSlice(r: RenderSnapshot | undefined): void {
    if (!r) return;
    const scene = useScene3dStore();
    const render = scene.three.render;
    if (oneOf(r.quality, QUALITY_MODES)) {
      render.quality = r.quality;
      scene.onQualityChange(render.quality);
    }
    const mainAa = resolveAaMode(r.main, r.antialias);
    if (mainAa) scene.onMainAaChange(mainAa);
    if (r.main && isNum(r.main.resolution)) scene.onMainResolutionChange(clampNum(r.main.resolution, 0.25, 1));
    const attitudeAa = resolveAaMode(r.attitude, undefined);
    if (attitudeAa) scene.onAttitudeAaChange(attitudeAa);
    if (r.attitude && isNum(r.attitude.resolution)) scene.onAttitudeResolutionChange(clampNum(r.attitude.resolution, 0.25, 1));
    if (isNum(r.fps)) scene.onMainFpsChange(r.fps);
  }

  function applyDebugSlice(d: DebugSnapshot | undefined): void {
    if (!d) return;
    if (d.posPanel !== undefined) useScene3dStore().three.debug.posPanel = d.posPanel === true;
  }

  function applyThreeSlice(t: ThreeSnapshot | undefined): void {
    if (!t) return;
    applyViewSlice(t.view);
    if (t.playback && t.playback.curveAxis !== undefined) {
      useScene3dStore().three.playback.curveAxis = !!t.playback.curveAxis;
    }
    applyRcSlice(t.rc);
    applyLightingSlice(t.lighting);
    applySkySlice(t.sky);
    applyDroneScaleSlice(t.droneScale);
    if (t.model === 'glb' || t.model === 'lowpoly') useScene3dStore().onModelChange(t.model);
    applyGroundSlice(t.ground);
    applyWaterSlice(t.water);
    applyRenderSlice(t.render);
    applyDebugSlice(t.debug);
  }

  function applyMapSlice(m: MapSnapshot | undefined, legacyThree: ThreeSnapshot | undefined): void {
    if (!m) return;
    const map = useMapStateStore().map;
    if (isStr(m.providerId)) map.providerId = m.providerId;
    if (m.renderer === '2d' || m.renderer === '3d') map.renderer = m.renderer;
    if (isBool(m.terrainOn)) map.terrainOn = m.terrainOn;
    if (isBool(m.followDrone)) map.followDrone = m.followDrone;
    if (isBool(m.lockView)) map.lockView = m.lockView;
    if (m.droneModel === 'glb' || m.droneModel === 'lowpoly') map.droneModel = m.droneModel;
    if (isNum(m.droneScale)) map.droneScale = clampNum(m.droneScale, 0.1, 20);
    if (isBool(m.droneShaded)) map.droneShaded = m.droneShaded;
    if (isNum(m.mapFps)) map.mapFps = m.mapFps < 0 ? 0 : Math.round(m.mapFps);
    if (isBool(m.controlBarCollapsed)) map.controlBarCollapsed = m.controlBarCollapsed;
    if (isBool(m.showPath)) {
      map.showPath = m.showPath;
    } else if (legacyThree?.path && legacyThree.path.show !== undefined) {
      map.showPath = legacyThree.path.show !== false;
    }
    if (isBool(m.showRoute)) {
      map.showRoute = m.showRoute;
    } else if (legacyThree?.mission && legacyThree.mission.route !== undefined) {
      map.showRoute = legacyThree.mission.route !== false;
    }
    if (isBool(m.showWaypoints)) map.showWaypoints = m.showWaypoints;
  }

  /** Public entry point: push a restored snapshot into every live store. */
  function applyConfig(raw: PersistedSettings | undefined): void {
    if (!raw) return;
    applyChartSlice(raw.chart);
    applyThreeSlice(raw.three);
    applyMapSlice(raw.map, raw.three);
  }

  /* ---------------- load / persistence --------------------------------- */

  async function loadToolbarConfig(): Promise<void> {
    settings.restoring = true;
    try {
      const res: SettingsResponse = await configClient.getSettings();
      if (res && res.error) { showToast(res.error, 'error'); return; }
      applyConfig(res.settings);
      await nextTick();
    } catch {
      // Backend read failure is non-fatal: leave the current preferences in place.
    } finally {
      settings.restoring = false;
    }
    startWatching();
  }

  function scheduleSave(): void {
    if (settings.restoring) return;
    if (settings.saveTimer) clearTimeout(settings.saveTimer);
    settings.saveTimer = setTimeout(() => {
      settings.saveTimer = null;
      void saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  async function saveNow(): Promise<void> {
    try {
      await configClient.saveSettings(toolbarConfig.value);
    } catch {
      // Write failure is non-fatal; the next change will retry.
    }
  }

  function flushSave(): void {
    if (!settings.saveTimer) return;
    clearTimeout(settings.saveTimer);
    settings.saveTimer = null;
    void saveNow();
  }

  /* ---------------- watcher install ------------------------------------ */

  function startWatching(): void {
    if (settings.started) return;
    settings.started = true;
    watch(
      () => toolbarConfig.value,
      () => { if (!settings.restoring) scheduleSave(); },
      { deep: true },
    );
  }

  return {
    settings,
    toolbarConfig,
    applyConfig,
    loadToolbarConfig,
    scheduleSave,
    saveNow,
    startWatching,
    flushSave,
  };
});
