import { defineStore } from 'pinia';
import { ref, computed, nextTick } from 'vue';
import type {
  MessageType,
  MissionVersion,
  NamedCurve,
  RcInvert,
  TelemetrySample,
  ThreeState,
  ThreeMaterialTier,
  TimeWindow,
} from '@/types';
import { runtime } from '@/modules/shared/runtime';
import type { AttitudeLive } from '@/modules/shared/runtime';
import { showToast } from '@/modules/shared/ui-store';
import { isEditableTarget } from '@/modules/shared/utils/dom';
import { useUiStore } from '@/modules/shared/ui-store';
import { useAnalysisStore } from '@/modules/analysis';
import { useCommandsStore } from '@/modules/commands';
import { useLogStore } from '@/modules/log';
import { useMapStateStore } from '@/modules/shared/map-state';
import { useMap2dStore } from '@/modules/map-2d';
import { useMap3dStore } from '@/modules/map-3d';
import { useEarthStore } from '@/modules/earth';
import { useCurveManagerStore } from '@/modules/curves';
import { useParametersStore } from '@/modules/parameters';
import { getProfile } from '@/profiles';
import type {
  FormatProfile,
  FieldSource,
  AttitudeSource,
  PositionSource,
  RcSource,
  MotorSource,
  ArmedDetection,
} from '@/profiles';
import * as THREE from 'three';
import { LineChart } from '@/modules/analysis';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import SpriteText from 'three-spritetext';

import {
  THREE_FREE_MAX_DISTANCE,
  THREE_FREE_MIN_DISTANCE,
  THREE_PROPELLER_DARKEN,
  THREE_PROPELLER_MAX_OMEGA,
  THREE_UNITS_PER_METER,
  THREE_DEFAULT_DRONE_MODEL,
  THREE_MODEL_MATERIAL,
  BODY_MATERIAL,
  THREE_SKY_CLOUD_SPEED,
  THREE_SKY_NOISE_SIZE,
  THREE_WATER_SIZE,
  THREE_WATER_WAVE_AMP,
  THREE_WATER_WAVE_NEAR,
  THREE_WATER_WAVE_FAR,
  THREE_WATER_FRESNEL0,
  THREE_WATER_SHININESS,
  THREE_WATER_GLINT,
  THREE_WATER_DEEP_COLOR,
  THREE_WATER_SHALLOW_COLOR,
  THREE_WATER_HORIZON_FADE_SKY,
  THREE_WATER_HORIZON_FADE_WATER,
  TRAJ_MAX_POINTS,
} from '@/constants';
import type { MaterialProperties } from '@/constants';
import {
  buildLowpolyDroneModel,
  addLowpolyMotor,
  addLowpolyProp,
  makeDroneQuaternion,
  resolveDroneModelName,
  collectPropellers,
  computeDronePhysicalScale,
  normalizeLoadedDroneModel,
  spinPropellersByPwm,
} from '@/modules/shared/utils/drone-model';

declare module 'three/examples/jsm/postprocessing/EffectComposer.js' {
  interface EffectComposer {
    _apmW?: number;
    _apmH?: number;
    _apmCalibrated?: boolean;
  }
}

const THREE_LIGHT_AMBIENT_MAIN = 0.3;       
const THREE_LIGHT_AMBIENT_ATTITUDE = 0.5;   
const THREE_LIGHT_KEY_MAIN = 0.85;          
const THREE_LIGHT_KEY_ATTITUDE = 0.9;       

const THREE_ATTITUDE_MODEL_EXTENT = 1.4;

const THREE_ATTITUDE_FPS = 30;
let lastAttitudeRenderTs = 0;
let lastMapRenderTs = 0;
let lastMainRenderTs = 0;

const GEO_INVALID_EPS = 1e-6;

function currentProfile(): FormatProfile {
  return getProfile(String(useLogStore().log.summary?.format || 'apm')) || getProfile('apm')!;
}

function quatToEulerDeg(w: number, x: number, y: number, z: number): { roll: number; pitch: number; yaw: number } {
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

function fsToDef(fs: FieldSource): { type: string; field: string; key: string } {
  return { type: fs.type, field: fs.field, key: fs.type + '.' + fs.field };
}

const THREE_SKY_COLOR_FN = [
  'vec3 threeSkyColor(vec3 dir){',
  '  dir = normalize(dir);',
  '  float y = dir.y;',
  '  vec3 col = y > 0.0',
  '    ? mix(uHorizonColor, uTopColor, smoothstep(0.0, 0.6, y))',
  '    : mix(uHorizonColor, uBottomColor, clamp(-y*1.5, 0.0, 1.0));',
  '  if(uCloud > 0.001){',
  '    vec2 cuv = vec2(atan(dir.z, dir.x) * 0.63662, asin(clamp(dir.y, -1.0, 1.0)) * 1.27324);',
  '    cuv += vec2(uTime * ' + THREE_SKY_CLOUD_SPEED + ', uTime * ' + (THREE_SKY_CLOUD_SPEED * 0.73) + ');',
  '    float c = texture2D(uNoiseTex, cuv).r;',
  '    c = smoothstep(0.5, 0.92, c);',
  '    float mask = smoothstep(0.02, 0.22, dir.y) * (1.0 - smoothstep(0.55, 0.95, dir.y));',
  '    col = mix(col, vec3(1.0, 0.98, 0.96), c * mask * uCloud);',
  '  }',
  '  float d = max(dot(dir, uSunDir), 0.0);',
  '  float disc = smoothstep(0.9994, 0.9998, d);',                              
  '  float glow = pow(d, 220.0)*0.7 + pow(d, 16.0)*0.4 + pow(d, 4.0)*0.15;',     
  '  col += uSunColor * (disc*3.0 + glow);',
  '  return col;',
  '}'
].join('\n');

export const useScene3dStore = defineStore('scene-3d', () => {
  const three = ref<ThreeState>({
    view: { mode: 'free', cameraMode: 'lock', attitudeSource: 'ahr2', positionSource: 'pos', cameraSeeded: false, lockSeeded: false, ssao: false, fullTrajectory: false, compareAttitude: false, compareSource: 'attDes' },
    playback: { timeMs: 0, playing: false, rate: 1, lastFrameTime: 0, timeWindow: null, fpsLastTime: 0, curveAxis: false, curveHeight: 150 },
    telemetry: { loaded: false, samples: [], meta: {}, loading: false, error: '' },
    mission: { versions: null },
    rc: { hud: true, readout: false, layout: 'side', invert: { roll: false, pitch: false } },
    curves: { volt: [], motor: [] },
    current: { speed: null, verticalSpeed: null, altitude: null, baroAlt: null, rcRoll: null, rcPitch: null, rcThrottle: null, rcYaw: null, x: null, y: null, z: null, north: null, east: null, down: null },
    lighting: { enabled: true, env: 1, ambient: 1, key: 1 },
    sky: { enabled: true, cloud: 0.6 },
    droneScale: 1,
    model: 'glb' as 'glb' | 'lowpoly',
    ground: { show: true },
    water: { enabled: false, wave: 0.4 },
    render: { quality: 'auto', main: { aa: 'msaa', resolution: 1 }, attitude: { aa: 'msaa', resolution: 1 }, fps: 0 },
    debug: { posPanel: false },
  });
  const threeMainEl = ref<HTMLElement | null>(null);
  const threeAttitudeEl = ref<HTMLElement | null>(null);
  const threePlayheadEl = ref<HTMLElement | null>(null);
  const threePlayheadTagEl = ref<HTMLElement | null>(null);


  const threeTimeRange = computed<TimeWindow>(() => {
    if (!three.value.telemetry.samples.length) return { min: 0, max: 1, span: 1 };
    var min = three.value.telemetry.samples[0].t;
    var max = three.value.telemetry.samples[three.value.telemetry.samples.length - 1].t;
    return { min: min, max: max, span: Math.max(1, max - min) };
  });

  const threePlaybackRange = computed<TimeWindow>(() => {
    if (three.value.playback.curveAxis && three.value.playback.timeWindow) return three.value.playback.timeWindow;
    return threeTimeRange.value;
  });

  const threeTimelineValue = computed<number>(() => {
    var r = threePlaybackRange.value;
    return Math.round(((three.value.playback.timeMs - r.min) / r.span) * 1000);
  });

  const threeTimelinePct = computed<number>(() => {
    var r = threePlaybackRange.value;
    if (!r.span) return 0;
    var p = ((three.value.playback.timeMs - r.min) / r.span) * 100;
    return Math.max(0, Math.min(100, p));
  });

  const threeCurrentTimeLabel = computed<string>(() => {
    return useAnalysisStore().formatTime(three.value.playback.timeMs, false);
  });

  const threeDebugInfo = computed<Record<string, any>>(() => {
    var t = three.value.playback.timeMs;
    var meta = three.value.telemetry.meta || {};
    var src: any = meta.posSource || {};
    var cur: any = three.value.current || {};
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
      rawLat: raw(src.lat), rawLng: raw(src.lng), rawAlt: raw(src.alt),
      rawPx: raw(src.px), rawPy: raw(src.py),
      x: cur.x, y: cur.y, z: cur.z,
      north: cur.north, east: cur.east, down: cur.down,
      alt: cur.altitude
    };
  });

  const threeEndTimeLabel = computed<string>(() => {
    return useAnalysisStore().formatTime(threePlaybackRange.value.max, false);
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
            color: chartStore.flightModeColor(name),
            label: chartStore.translateMode(name) || String(name)
          });
        }
      }
      i = j + 1;
    }
    return out;
  });

  function registerThreeMain(el: HTMLElement | null): void { threeMainEl.value = el }
  function registerThreeAttitude(el: HTMLElement | null): void { threeAttitudeEl.value = el }
  function registerThreePlayhead(el: HTMLElement | null): void { threePlayheadEl.value = el }
  function registerThreePlayheadTag(el: HTMLElement | null): void { threePlayheadTagEl.value = el }

  function ensureThreeView(): void {
      if (useUiStore().ui.mainView !== 'three') return;
      if (!THREE) {
        three.value.telemetry.error = 'three.module.min.js 未加载（vendor/three.module.min.js 可能 404 或损坏），3D 视图不可用';
        return;
      }
      var tc = document.createElement('canvas');
      var gl = tc.getContext('webgl') || tc.getContext('experimental-webgl');
      if (!gl) {
        three.value.telemetry.error = '浏览器/WebView 不支持 WebGL —— 3D 无法渲染。请换用 Chrome/Edge，或在浏览器设置里开启硬件加速。';
        return;
      }
      try {
        if (!runtime.threeView) createThreeView();
        if (String(runtime.threeView.attitudeRenderer.render).length < 30) {
          three.value.telemetry.error = 'WebGL 上下文创建失败（渲染器降级）。请更新显卡驱动或在浏览器里启用硬件加速后重试。';
          destroyThreeView();
          return;
        }
        updateThreeSceneData();
        if (three.value.view.mode === 'free' && !three.value.view.cameraSeeded) seedThreeCameraBehindDrone();
        if (three.value.view.cameraMode === 'lock' && !three.value.view.lockSeeded) seedThreeLockOrbit();
        resizeThreeView();
        updateThreeCameraMode();
        if (!runtime.threeView.raf) updateThreeFrame();
        else renderThreeView();
      } catch (e) {
        three.value.telemetry.error = '3D初始化失败: ' + (e && e.message ? e.message : e);
        destroyThreeView();
      }
  }

  function positionAttitudeCamera(): void {
      if (!runtime.threeView || !runtime.threeView.attitudeCamera) return;
      const d = runtime.threeView.attitudeCamDist || 3.0;
      runtime.threeView.attitudeCamera.position.set(-d * 0.4, d * 0.34, d * 0.85);
      runtime.threeView.attitudeCamera.up.set(0, 1, 0);
      runtime.threeView.attitudeCamera.lookAt(0, 0, 0);
      runtime.threeView.attitudeCamera.updateProjectionMatrix();
  }

  function createThreeView(): void {
      var mainEl = threeMainEl.value;
      var attitudeEl = threeAttitudeEl.value;
      if (!mainEl || !attitudeEl) return;
      runtime.threeView = {
        mainEl: mainEl,
        attitudeEl: attitudeEl,
        scene: new THREE.Scene(),
        attitudeScene: new THREE.Scene(),
        freeYaw: -0.65,
        freePitch: -0.65,
        freeDistance: 180,
        lockYaw: 0,
        lockPitch: -0.46,
        lockDistance: 0,
        dragging: false,
        lastX: 0,
        lastY: 0,
        pathKey: '',
        droneBaseScale: 1,
        fps: { x: 0, y: 0, z: 0, speed: 40 },
        keys: { forward: 0, back: 0, left: 0, right: 0, up: 0, down: 0 },
        droneModelName: '',
      };
      runtime.threeView.scene.background = new THREE.Color(0xf3f4f6);
      runtime.threeView.attitudeScene.background = new THREE.Color(0xeef1f5); 
      runtime.threeView.renderer = new THREE.WebGLRenderer({ antialias: three.value.render.main.aa === 'msaa' });
      runtime.threeView.renderer.useLegacyLights = true; 
      runtime.threeView.renderer.setClearColor(0xf3f4f6, 1);
      runtime.threeView.renderer.setPixelRatio(effectivePixelRatio(three.value.render.main.resolution));
      mainEl.appendChild(runtime.threeView.renderer.domElement);
      runtime.threeView.gpuTier = detectGpuTier(runtime.threeView.renderer);
      runtime.threeView.materialTier = resolveTier(three.value.render.quality);
      runtime.threeView.attitudeRenderer = new THREE.WebGLRenderer({ antialias: three.value.render.attitude.aa === 'msaa', alpha: false });
      runtime.threeView.attitudeRenderer.useLegacyLights = true; 
      runtime.threeView.attitudeRenderer.setClearColor(0xeef1f5, 1);
      runtime.threeView.attitudeRenderer.setPixelRatio(effectivePixelRatio(three.value.render.attitude.resolution));
      attitudeEl.appendChild(runtime.threeView.attitudeRenderer.domElement);

      ensureThreeEnv();

      runtime.threeView.grid = createThreeGrid();
      runtime.threeView.scene.add(runtime.threeView.grid);

      if (three.value.sky.enabled) ensureThreeSky();

      if (three.value.water.enabled) {
        ensureThreeWater();
      }

      runtime.threeView.mainAmbient = new THREE.AmbientLight(0xffffff, THREE_LIGHT_AMBIENT_MAIN);
      runtime.threeView.scene.add(runtime.threeView.mainAmbient);
      runtime.threeView.mainHemi = new THREE.HemisphereLight(0xbfe3ff, 0x2a3a50, 0.4);
      runtime.threeView.scene.add(runtime.threeView.mainHemi);

      const keyLight = new THREE.DirectionalLight(0xfff4e0, THREE_LIGHT_KEY_MAIN);
      keyLight.position.set(90, 140, 70);
      runtime.threeView.mainKeyLight = keyLight;
      runtime.threeView.scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xd6e4ff, 0.35);
      fillLight.position.set(-90, 100, 50);
      runtime.threeView.mainFill = fillLight;
      runtime.threeView.scene.add(fillLight);
      const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
      rimLight.position.set(0, 90, -130);
      runtime.threeView.mainRim = rimLight;
      runtime.threeView.scene.add(rimLight);

      runtime.threeView.attitudeLight = new THREE.DirectionalLight(0xffffff, THREE_LIGHT_KEY_ATTITUDE);
      runtime.threeView.attitudeLight.position.set(-8, 5, 6);
      runtime.threeView.attitudeAmbient = new THREE.AmbientLight(0xffffff, THREE_LIGHT_AMBIENT_ATTITUDE);
      runtime.threeView.attitudeScene.add(runtime.threeView.attitudeAmbient);
      runtime.threeView.attitudeHemi = new THREE.HemisphereLight(0xbfe3ff, 0x2a3a50, 0.45);
      runtime.threeView.attitudeScene.add(runtime.threeView.attitudeHemi);
      runtime.threeView.attitudeScene.add(runtime.threeView.attitudeLight);

      runtime.threeView.perspectiveCamera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
      runtime.threeView.attitudeCamDist = 3.1;
      runtime.threeView.attitudeCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      positionAttitudeCamera();
      bindThreeControls();

      loadDroneModel();

      applyLighting();
  }

  function applyLighting(): void {
      var tv = runtime.threeView;
      if (!tv) return;
      var L = three.value.lighting;
      var on = L.enabled !== false; 
      if (runtime.threeView && runtime.threeView.materialTier === 'low') on = false;
      var skyOn = three.value.sky.enabled !== false && !!tv.skyEnvRt;
      tv.scene.environment = on ? (skyOn ? tv.skyEnvRt.texture : (tv.envRt ? tv.envRt.texture : null)) : null;
      tv.attitudeScene.environment = (on && tv.attitudeEnvRt) ? tv.attitudeEnvRt.texture : null;
      if (tv.mainHemi) tv.mainHemi.visible = on;
      if (tv.mainFill) tv.mainFill.visible = on;
      if (tv.mainRim) tv.mainRim.visible = on;
      if (tv.attitudeHemi) tv.attitudeHemi.visible = on;
      if (tv.mainAmbient) tv.mainAmbient.intensity = THREE_LIGHT_AMBIENT_MAIN * L.ambient;
      if (tv.attitudeAmbient) tv.attitudeAmbient.intensity = THREE_LIGHT_AMBIENT_ATTITUDE * L.ambient;
      if (tv.mainKeyLight) tv.mainKeyLight.intensity = THREE_LIGHT_KEY_MAIN * L.key;
      if (tv.attitudeLight) tv.attitudeLight.intensity = THREE_LIGHT_KEY_ATTITUDE * L.key;
      var envVal = on ? L.env : 0;
      var applyMat = function (root: THREE.Object3D | null | undefined): void {
        if (!root) return;
        root.traverse(function (o: any) {
          if (!o.isMesh || !o.material) return;
          var mats = Array.isArray(o.material) ? o.material : [o.material];
          for (var i = 0; i < mats.length; i++) {
            var m = mats[i];
            if (m.isMeshPhysicalMaterial || m.isMeshStandardMaterial) {
              if (m.userData._apmBaseMetal === undefined) m.userData._apmBaseMetal = m.metalness;
              m.metalness = on ? m.userData._apmBaseMetal : 0;
              m.envMapIntensity = envVal;
            }
          }
        });
      };
      applyMat(tv.scene);
      applyMat(tv.attitudeScene);
      if (useUiStore().ui.mainView === 'three') renderThreeView();
  }

  function onLightingChange(field: 'env' | 'ambient' | 'key', value: number): void {
      three.value.lighting[field] = value;
      applyLighting();
  }

  function onLightingToggle(enabled: boolean): void {
      three.value.lighting.enabled = enabled;
      applyLighting();
  }

  function updateThreeSkyUniforms(ts: number): void {
      var tv = runtime.threeView;
      if (!tv || !tv.sky || !tv.sky.material) return;
      if (tv.skyBackgroundTex) return;
      var u = tv.sky.material.uniforms;
      if (!u) return;
      u.uTime.value = (ts || 0) / 1000;
      u.uCloud.value = three.value.sky.cloud;
  }

  function onSkyToggle(enabled: boolean): void {
      three.value.sky.enabled = enabled;
      var tv = runtime.threeView;
      if (enabled) {
        ensureThreeSky();
      } else if (tv) {
        disposeThreeSky();
        tv.scene.background = new THREE.Color(0xf3f4f6);
      }
      applyLighting();
      if (useUiStore().ui.mainView === 'three') renderThreeView();
  }

  function onSkyCloudChange(value: number): void {
      three.value.sky.cloud = value;
  }

  function onDroneScaleChange(value: number): void {
      three.value.droneScale = value;
      var tv = runtime.threeView;
      if (tv && tv.drone && tv.droneBaseScale) {
        var s = tv.droneBaseScale * value; 
        tv.drone.scale.set(s, s, s);
        alignThreeGrid();
      }
      if (useUiStore().ui.mainView === 'three') renderThreeView();
  }

  function onGroundToggle(show: boolean): void {
      three.value.ground.show = show;
      if (runtime.threeView && runtime.threeView.ground) runtime.threeView.ground.visible = show;
      if (useUiStore().ui.mainView === 'three') renderThreeView();
  }

  function onWaterToggle(enabled: boolean): void {
      three.value.water.enabled = enabled;
      var tv = runtime.threeView;
      if (enabled) {
        if (tv) ensureThreeWater();
      } else {
        disposeThreeWater();
      }
      if (useUiStore().ui.mainView === 'three') renderThreeView();
  }

  function onWaterWaveChange(value: number): void {
      three.value.water.wave = value;
  }

  function updateThreeSceneData(): void {
      if (!runtime.threeView || !three.value.telemetry.samples.length || !THREE) return;
      var key = three.value.telemetry.samples.length + '|' + three.value.telemetry.meta.maxRadius;
      if (runtime.threeView.pathKey === key) {
        updateThreeProgressPath();
        return;
      }

      if (runtime.threeView.pathLine) {
        runtime.threeView.scene.remove(runtime.threeView.pathLine);
        disposeThreeObjects(runtime.threeView.pathLine);  
      }
      var positions = [];
      for (var i = 0; i < three.value.telemetry.samples.length; i++) {
        var s = three.value.telemetry.samples[i];
        positions.push(s.x, s.y, s.z);
      }
      var geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.computeBoundingSphere();
      geom.setDrawRange(0, 1);
      var mat = new THREE.LineBasicMaterial({ color: 0x2563eb, linewidth: 5 });
      runtime.threeView.pathGeometry = geom;
      runtime.threeView.pathLine = new THREE.Line(geom, mat);
      runtime.threeView.pathLine.visible = useMapStateStore().map.showPath;
      runtime.threeView.scene.add(runtime.threeView.pathLine);
      runtime.threeView.pathKey = key;
      fitThreeCamera();
      updateThreeProgressPath();
      updateThreeMissionRoute();
  }

  function currentThreeSampleIndex(timeMs: number): number {
      var samples = three.value.telemetry.samples;
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

  function updateThreeProgressPath(): void {
      if (!runtime.threeView || !runtime.threeView.pathGeometry || !three.value.telemetry.samples.length) return;
      var idx = currentThreeSampleIndex(three.value.playback.timeMs);
      if (!three.value.view.fullTrajectory) {
        var start = Math.max(0, idx + 1 - TRAJ_MAX_POINTS);
        runtime.threeView.pathGeometry.setDrawRange(start, idx + 1 - start);
      } else {
        runtime.threeView.pathGeometry.setDrawRange(0, Math.max(1, idx + 1));
      }
      updateThreeMissionRoute();
  }

  function fitThreeCamera(): void {
      if (!runtime.threeView) return;
      var radius = Math.max(12, three.value.telemetry.meta.maxRadius || 60);
      runtime.threeView.freeDistance = radius * 2.45;
      runtime.threeView.grid.scale.set(Math.max(0.55, radius / 90), 1, Math.max(0.55, radius / 90));
      updateThreeDroneScale();
      updateThreeCameraMode();
  }

  function computeDroneBaseScale(): number | null {
      var tv = runtime.threeView;
      if (!tv || !tv.drone) return null;
      var summary = useLogStore().log.summary;
      var r = computeDronePhysicalScale(tv.drone, summary && summary.airframe);
      return r ? r.scale * THREE_UNITS_PER_METER : null;
  }

  function updateThreeDroneScale(): void {
      var tv = runtime.threeView;
      if (!tv || !tv.drone) return;
      var baseScale = computeDroneBaseScale();
      if (baseScale) tv.droneBaseScale = baseScale; 
      var visScale = (tv.droneBaseScale || 1) * (three.value.droneScale || 1); 
      tv.drone.scale.set(visScale, visScale, visScale);
      alignThreeGrid();
  }

  function alignThreeGrid(): void {
      if (!runtime.threeView || !runtime.threeView.grid || !runtime.threeView.drone) return;
      runtime.threeView.drone.updateMatrixWorld(true);
      var box = new THREE.Box3().setFromObject(runtime.threeView.drone);
      var localBottom = box.min.y - (runtime.threeView.drone.position.y || 0);
      if (isFinite(localBottom)) runtime.threeView.grid.position.y = localBottom;
      var height = box.max.y - box.min.y;
      if (isFinite(height) && height > 0) runtime.threeView.droneHalfHeight = height / 2;
  }

  function createThreeGrid(): THREE.Group {
      const group = new THREE.Group();
      group.name = 'three-grid';
      const SIZE = 240;

      const gridMat = new THREE.ShaderMaterial({
        uniforms: {
          uBaseColor: { value: new THREE.Color(0xeaeef2) }, 
          uMinorColor: { value: new THREE.Color(0x707880) },
          uMajorColor: { value: new THREE.Color(0x4a5260) },
          uMinorScale: { value: 240 },   
          uMajorScale: { value: 48 },    
          uMinorOpacity: { value: 0.35 },
          uMajorOpacity: { value: 0.9 },
        },
        vertexShader: [
          'varying vec2 vUv;',
          'void main() {',
          '  vUv = uv;',
          '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
          '}',
        ].join('\n'),
        fragmentShader: [
          'varying vec2 vUv;',
          'uniform vec3 uBaseColor;',
          'uniform vec3 uMinorColor;',
          'uniform vec3 uMajorColor;',
          'uniform float uMinorScale;',
          'uniform float uMajorScale;',
          'uniform float uMinorOpacity;',
          'uniform float uMajorOpacity;',
          'float lineAxis(float c) { return 1.0 - min(abs(fract(c - 0.5) - 0.5) / fwidth(c), 1.0); }',
          'void main() {',
          '  float minorLine = max(lineAxis(vUv.x * uMinorScale), lineAxis(vUv.y * uMinorScale));',
          '  float majorLine = max(lineAxis(vUv.x * uMajorScale), lineAxis(vUv.y * uMajorScale));',
          '  float minorDeriv = max(fwidth(vUv.x * uMinorScale), fwidth(vUv.y * uMinorScale));',
          '  minorLine *= 1.0 - smoothstep(1.0, 2.5, minorDeriv);',
          '  vec3 col = uBaseColor;',
          '  col = mix(col, uMinorColor, minorLine * uMinorOpacity);',
          '  col = mix(col, uMajorColor, majorLine * uMajorOpacity);',
          '  gl_FragColor = vec4(col, 1.0);',
          '}',
        ].join('\n'),
        transparent: false,
        depthWrite: true,
        side: THREE.FrontSide, 
        fog: false,
        toneMapped: false,
        extensions: { derivatives: true },
      });

      const plane = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), gridMat);
      plane.rotation.x = -Math.PI / 2; 
      plane.position.y = 0;            
      plane.renderOrder = 2;           
      plane.name = 'three-ground';
      plane.visible = three.value.ground.show; 
      group.add(plane);
      runtime.threeView.ground = plane; 

      return group;
  }

  function updateThreeCameraMode(): void {
      if (!runtime.threeView) return;
      var aspect = Math.max(1, runtime.threeView.mainEl.clientWidth) / Math.max(1, runtime.threeView.mainEl.clientHeight);
      var cam = runtime.threeView.perspectiveCamera;
      cam.aspect = aspect;
      cam.up.set(0, 1, 0);
      var mode = three.value.view.cameraMode;
      if (mode === 'fps') {
        var ff = runtime.threeView.fps;
        cam.position.set(ff.x, ff.y, ff.z);
      } else {
        var isLock = mode === 'lock';
        if (isLock && !three.value.view.lockSeeded && runtime.threeView.drone && three.value.telemetry.samples.length) {
          seedThreeLockOrbit();
        }
        var d = isLock ? runtime.threeView.lockDistance : runtime.threeView.freeDistance;
        var yaw = isLock ? runtime.threeView.lockYaw : runtime.threeView.freeYaw;
        var pitch = isLock ? runtime.threeView.lockPitch : runtime.threeView.freePitch;
        var tx = 0, ty = 0, tz = 0;
        if (isLock && runtime.threeView.drone) {
          tx = runtime.threeView.drone.position.x;
          ty = runtime.threeView.drone.position.y;
          tz = runtime.threeView.drone.position.z;
          d = Math.max(THREE_FREE_MIN_DISTANCE, d);
        }
        cam.position.set(tx + Math.sin(yaw) * Math.cos(pitch) * d, ty - Math.sin(pitch) * d, tz + Math.cos(yaw) * Math.cos(pitch) * d);
        cam.lookAt(tx, ty, tz);
      }
      cam.updateProjectionMatrix();
      runtime.threeView.activeCamera = cam;
  }

  function resizeThreeView(): void {
      if (!runtime.threeView) return;
      var tv = runtime.threeView;
      var mainPR = effectivePixelRatio(three.value.render.main.resolution);
      if (tv.renderer && tv.renderer.getPixelRatio() !== mainPR) tv.renderer.setPixelRatio(mainPR);
      var w = Math.max(1, tv.mainEl.clientWidth);
      var h = Math.max(1, tv.mainEl.clientHeight);
      tv.renderer.setSize(w, h, false);
      syncMainComposerSize();
      var attitudePR = effectivePixelRatio(three.value.render.attitude.resolution);
      if (tv.attitudeRenderer && tv.attitudeRenderer.getPixelRatio() !== attitudePR) tv.attitudeRenderer.setPixelRatio(attitudePR);
      var aw = Math.max(1, tv.attitudeEl.clientWidth);
      var ah = Math.max(1, tv.attitudeEl.clientHeight);
      tv.attitudeRenderer.setSize(aw, ah, false);
      syncAttitudeComposerSize();
      var attitudeAspect = aw / ah;
      tv.attitudeCamera.aspect = attitudeAspect;
      positionAttitudeCamera();
      updateThreeCameraMode();
  }

  function updateThreeFrame(now?: number): void {
      if (!runtime.threeView || useUiStore().ui.mainView !== 'three') {
        if (runtime.threeView) runtime.threeView.raf = 0;
        return;
      }
      var ts = now || performance.now();
      var realPrev = three.value.playback.lastFrameTime;
      var realDt = realPrev ? (ts - realPrev) / 1000 : 0;
      if (realDt < 0 || realDt > 0.1) realDt = 0; 
      if (three.value.playback.fpsLastTime) {
        var fpsDt = (ts - three.value.playback.fpsLastTime) / 1000;
        if (fpsDt > 0 && fpsDt < 0.1 && three.value.view.mode === 'free' && three.value.view.cameraMode === 'fps') {
          updateThreeFpsMotion(fpsDt);
        }
      }
      three.value.playback.fpsLastTime = ts;
      advanceThreePlayback(ts);

      const mapFps = useMapStateStore().map.mapFps;
      if (useMapStateStore().map.active && (mapFps <= 0 || ts - lastMapRenderTs >= 1000 / mapFps)) {
        lastMapRenderTs = ts;
        try {
          const renderer = useMapStateStore().map.renderer;
          if (renderer === '3d') useMap3dStore().renderMapLibre();
          else if (renderer === 'earth') useEarthStore().renderEarth();
          else useMap2dStore().renderMap2d();
        } catch (e) {  }
      }

      try {
        updateThreeSkyUniforms(ts);
        updateThreeWaterUniforms(ts);
        alignThreeWater();
        updateThreePropellers(realDt);
        updateThreeCurrent();
        applyThreeOverlayVisibility();
        renderThreeView();
      } catch (e) {
      }
      runtime.threeView.raf = requestAnimationFrame(function (t: number) { updateThreeFrame(t); });
  }

  function ensureServoFuncMap(): Record<number, number> | null {
      var tv = runtime.threeView;
      if (!tv) return null;
      if (!tv.servoFuncMapSet) {
        var items = useParametersStore().parameters.items;
        if (items && items.length) {
          tv.servoFuncMap = servoFuncToChannelMap();
          tv.servoFuncMapSet = true;
        }
      }
      return tv.servoFuncMap;
  }

  function updateThreePropellers(dt: number): void {
      if (!runtime.threeView || dt <= 0) return;
      var motors = three.value.curves.motor || [];
      var funcMap = ensureServoFuncMap();
      var t = three.value.playback.timeMs;
      spinPropellers(runtime.threeView.mainPropellers, motors, funcMap, t, dt);
  }

  function propellerPwm(p: { func: number }, i: number, motors: NamedCurve[], funcMap: Record<number, number> | null, t: number): number | null {
      var func = p.func != null ? p.func : (33 + i);
      var curve = motors[i];
      if (funcMap && funcMap[func] != null) {
        var field = 'C' + funcMap[func];
        for (var k = 0; k < motors.length; k++) {
          if (motors[k] && motors[k].field === field) { curve = motors[k]; break; }
        }
      }
      return (curve && curve.type) ? useCurveManagerStore().getValueAt(curve.type, curve.field, t, null) : null;
  }

  function spinPropellers(props: Array<{ mesh: THREE.Object3D; dir: number; func: number }> | undefined, motors: NamedCurve[], funcMap: Record<number, number> | null, t: number, dt: number): void {
      if (!props || !props.length) return;
      var pwms: Array<number | null> = [];
      for (var i = 0; i < props.length; i++) pwms.push(propellerPwm(props[i], i, motors, funcMap, t));
      spinPropellersByPwm(props, pwms, dt);
  }

  function currentPropellerPwms(t: number): Array<number | null> {
      var tv = runtime.threeView;
      if (!tv || !tv.mainPropellers) return [];
      var motors = three.value.curves.motor || [];
      var funcMap = ensureServoFuncMap();
      var out: Array<number | null> = [];
      for (var i = 0; i < tv.mainPropellers.length; i++) out.push(propellerPwm(tv.mainPropellers[i], i, motors, funcMap, t));
      return out;
  }

  function applyPropellerBlurColor(mesh: THREE.Object3D, omega: number): void {
      var cache = mesh.userData.blurMats;
      if (!cache) {
        cache = [];
        mesh.traverse(function (child: any) {
          if (child.isMesh && child.material && child.material.color) {
            cache.push({ mat: child.material, base: child.material.color.clone() });
          }
        });
        if (!cache.length) return;
        mesh.userData.blurMats = cache;
      }
      var norm = omega / THREE_PROPELLER_MAX_OMEGA;
      if (norm > 1) norm = 1;
      else if (norm < 0) norm = 0;
      var factor = 1 - norm * THREE_PROPELLER_DARKEN;
      for (var i = 0; i < cache.length; i++) {
        var c = cache[i];
        c.mat.color.copy(c.base).multiplyScalar(factor);
      }
  }

  function updateThreeCurrent(): void {
      if (three.value.playback.curveAxis) updateThreePlayhead();
      var sample = sampleAtTime(three.value.playback.timeMs);
      if (!sample) return;
      three.value.current = {
        speed: sample.speed,
        verticalSpeed: sample.verticalSpeed,
        altitude: sample.altitude,
        baroAlt: sample.baroAlt,
        rcRoll: sample.rcRoll,
        rcPitch: sample.rcPitch,
        rcThrottle: sample.rcThrottle,
        rcYaw: sample.rcYaw,
        x: sample.x, y: sample.y, z: sample.z,
        north: sample.north, east: sample.east, down: sample.down
      };
      if (runtime.threeView) {
        var t = three.value.playback.timeMs;
        var att = liveAttitude(three.value.view.attitudeSource, t);
        applyDronePose(runtime.threeView.drone, sample, true, att);
        applyDronePose(runtime.threeView.attitudeDrone, sample, false, att);
        applyGhostPose(t);
        var a = att || { roll: sample.roll || 0, pitch: sample.pitch || 0, yaw: sample.yaw || 0 };
        updateAttitudeArcs(a.roll, a.pitch, a.yaw);
        updateWindArrow(t);
        updateThreeProgressPath();
      }
  }

  function liveAttitude(source: string, t: number): { roll: number; pitch: number; yaw: number } | null {
      var tv = runtime.threeView;
      var c = tv && tv.attitudeCurves ? tv.attitudeCurves[source] : null;
      if (!c) return null;
      var cm = useCurveManagerStore();
      if (c.kind === 'quat') {
        var w = cm.getValueAt(c.q[0].type, c.q[0].field, t, 0);
        var x = cm.getValueAt(c.q[1].type, c.q[1].field, t, 0);
        var y = cm.getValueAt(c.q[2].type, c.q[2].field, t, 0);
        var z = cm.getValueAt(c.q[3].type, c.q[3].field, t, 0);
        return quatToEulerDeg(w || 0, x || 0, y || 0, z || 0);
      }
      return {
        roll: cm.getAngleAt(c.roll.type, c.roll.field, t, 0) || 0,
        pitch: cm.getAngleAt(c.pitch.type, c.pitch.field, t, 0) || 0,
        yaw: cm.getAngleAt(c.yaw.type, c.yaw.field, t, 0) || 0,
      };
  }

  function applyGhostPose(t: number): void {
      var tv = runtime.threeView;
      if (!tv || !tv.ghostDrone || !tv.drone) return;
      var att = liveAttitude(three.value.view.compareSource, t);
      if (!att) return;
      tv.ghostDrone.position.copy(tv.drone.position);
      tv.ghostDrone.scale.copy(tv.drone.scale);
      tv.ghostDrone.quaternion.copy(makeDroneQuaternion(att));
  }

  function applyDronePose(obj: THREE.Object3D | undefined, sample: TelemetrySample | null, usePosition: boolean, att?: { roll: number; pitch: number; yaw: number } | null): void {
      if (!obj || !sample) return;

      if (usePosition) obj.position.set(sample.x, sample.y, sample.z);
      obj.quaternion.copy(makeDroneQuaternion(att || sample));
  }

  function renderThreeView(): void {
      if (!runtime.threeView) return;
      if (!runtime.threeView.perspectiveCamera || !runtime.threeView.attitudeCamera) return;
      resizeThreeView();
      var now = performance.now(); 
      var mainFps = three.value.render.fps;
      if (runtime.threeView.activeCamera && (mainFps <= 0 || now - lastMainRenderTs >= 1000 / mainFps)) {
        lastMainRenderTs = now;
        if (three.value.render.main.aa === 'fxaa' || three.value.view.ssao) {
          ensureMainComposer();
          syncMainComposerPasses();
          calibrateMainSsao();
          runtime.threeView.mainComposer.render();
        } else {
          runtime.threeView.renderer.render(runtime.threeView.scene, runtime.threeView.activeCamera);
        }
      }
      if (now - lastAttitudeRenderTs >= 1000 / THREE_ATTITUDE_FPS) {
        lastAttitudeRenderTs = now;
        if (three.value.render.attitude.aa === 'fxaa') {
          ensureAttitudeComposer();
          syncAttitudeComposerPasses();
          runtime.threeView.attitudeComposer.render();
        } else {
          runtime.threeView.attitudeRenderer.render(runtime.threeView.attitudeScene, runtime.threeView.attitudeCamera);
        }
      }
  }

  function destroyThreeView(): void {
      if (!runtime.threeView) return;
      if (runtime.threeView.raf) cancelAnimationFrame(runtime.threeView.raf);
      resetThreeFpsKeys();
      three.value.playback.fpsLastTime = 0;
      disposeThreePostfx();
      disposeThreeEnv();
      disposeThreeSky();
      disposeThreeWater();
      if (runtime.threeView.grid) {
        disposeThreeObjects(runtime.threeView.grid);
        runtime.threeView.grid = null;
        runtime.threeView.ground = null;
      }
      if (runtime.threeView.drone) { disposeThreeObjects(runtime.threeView.drone, true); runtime.threeView.drone = undefined }
      if (runtime.threeView.attitudeDrone) { disposeThreeObjects(runtime.threeView.attitudeDrone, true); runtime.threeView.attitudeDrone = undefined }
      if (runtime.threeView.ghostDrone) { disposeGhostMaterials(runtime.threeView.ghostDrone); runtime.threeView.ghostDrone = undefined }
      if (runtime.threeView.missionLineGroup) { disposeThreeObjects(runtime.threeView.missionLineGroup, true); runtime.threeView.missionLineGroup = undefined }
      if (runtime.threeView.missionMarkerGroup) { disposeThreeObjects(runtime.threeView.missionMarkerGroup, true); runtime.threeView.missionMarkerGroup = undefined }
      if (runtime.threeView.pathLine) { disposeThreeObjects(runtime.threeView.pathLine); runtime.threeView.pathLine = undefined; runtime.threeView.pathGeometry = undefined }
      if (runtime.threeView.attitudeReference) { disposeThreeObjects(runtime.threeView.attitudeReference); runtime.threeView.attitudeReference = undefined }
      if (runtime.threeView.attitudeAxes) { disposeThreeObjects(runtime.threeView.attitudeAxes); runtime.threeView.attitudeAxes = undefined }
      if (runtime.threeView.windArrow) { disposeThreeObjects(runtime.threeView.windArrow); runtime.threeView.windArrow = undefined }
      if (runtime.threeView.renderer) {
        runtime.threeView.renderer.dispose();
        if (runtime.threeView.renderer.domElement && runtime.threeView.renderer.domElement.parentNode) runtime.threeView.renderer.domElement.parentNode.removeChild(runtime.threeView.renderer.domElement);
      }
      if (runtime.threeView.attitudeRenderer) {
        runtime.threeView.attitudeRenderer.dispose();
        if (runtime.threeView.attitudeRenderer.domElement && runtime.threeView.attitudeRenderer.domElement.parentNode) runtime.threeView.attitudeRenderer.domElement.parentNode.removeChild(runtime.threeView.attitudeRenderer.domElement);
      }
      runtime.threeView = null;
      if (runtime.threeCurveChart) {
        try { runtime.threeCurveChart.dispose(); } catch (e) {}
        runtime.threeCurveChart = null;
      }
  }

  function disposeThreeObjects(obj: THREE.Object3D | null, withTextures: boolean = false): void {
      if (!obj) return;
      const seen = withTextures ? new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>() : null;
      obj.traverse(function (child: any) {
        if (child.geometry && (!seen || !seen.has(child.geometry))) {
          try { child.geometry.dispose(); } catch (e) {}
          seen?.add(child.geometry);
        }
        if (!child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i] as THREE.Material;
          if (!m || (seen && seen.has(m))) continue;
          if (withTextures && seen) {
            for (const key of Object.keys(m)) {
              const v = (m as any)[key];
              if (v && v.isTexture && !seen.has(v)) { try { v.dispose(); } catch (e) {} seen.add(v); }
              if (Array.isArray(v)) { for (const t of v) if (t && t.isTexture && !seen.has(t)) { try { t.dispose(); } catch (e) {} seen.add(t); } }
            }
          }
          try { m.dispose(); } catch (e) {}
          seen?.add(m);
        }
      });
  }

  function toggleFullTrajectory(): void {
      three.value.view.fullTrajectory = !three.value.view.fullTrajectory;
  }

  function toggleThreePath(): void {
      const m = useMapStateStore().map;
      m.showPath = !m.showPath;
      if (runtime.threeView && runtime.threeView.pathLine) {
        runtime.threeView.pathLine.visible = m.showPath;
        if (useUiStore().ui.mainView === 'three') renderThreeView();
      }
  }

  function toggleThreeRcLayout(): void {
      three.value.rc.layout = three.value.rc.layout === 'center' ? 'side' : 'center';
  }

  function onMainAaChange(aa: string): void {
      var next: 'off' | 'msaa' | 'fxaa' = (aa === 'fxaa' || aa === 'off' || aa === 'msaa') ? aa : three.value.render.main.aa;
      var prev = three.value.render.main.aa;
      three.value.render.main.aa = next;
      if (!runtime.threeView || useUiStore().ui.mainView !== 'three') return;
      if ((prev === 'msaa') !== (next === 'msaa')) { destroyThreeView(); ensureThreeView(); }
      else renderThreeView();
  }

  function onMainResolutionChange(resolution: number): void {
      three.value.render.main.resolution = resolution;
      if (runtime.threeView && useUiStore().ui.mainView === 'three') resizeThreeView();
  }

  function onMainFpsChange(fps: number): void {
    three.value.render.fps = fps <= 0 ? 0 : Math.max(1, Math.round(fps));
  }

  function onAttitudeAaChange(aa: string): void {
      var next: 'off' | 'msaa' | 'fxaa' = (aa === 'fxaa' || aa === 'off' || aa === 'msaa') ? aa : three.value.render.attitude.aa;
      var prev = three.value.render.attitude.aa;
      three.value.render.attitude.aa = next;
      if (!runtime.threeView || useUiStore().ui.mainView !== 'three') return;
      if ((prev === 'msaa') !== (next === 'msaa')) { destroyThreeView(); ensureThreeView(); }
      else renderThreeView();
  }

  function onAttitudeResolutionChange(resolution: number): void {
      three.value.render.attitude.resolution = resolution;
      if (runtime.threeView && useUiStore().ui.mainView === 'three') resizeThreeView();
  }

  function detectGpuTier(renderer?: THREE.WebGLRenderer): ThreeMaterialTier {
      try {
        var gl = renderer ? renderer.getContext() : null;
        var rendererStr = '';
        if (gl) {
          var dbg = (gl as any).getExtension('WEBGL_debug_renderer_info');
          if (dbg) {
            var unmasked = (gl as any).getParameter(dbg.UNMASKED_RENDERER_WEBGL);
            if (typeof unmasked === 'string') rendererStr = unmasked.toLowerCase();
          }
          if (!rendererStr) {
            var fallback = (gl as any).getParameter(gl.RENDERER);
            if (typeof fallback === 'string') rendererStr = fallback.toLowerCase();
          }
        }
        if (/swiftshader|llvmpipe|microsoft basic render|apple software|softpipe/.test(rendererStr)) return 'low';
        var cores = navigator.hardwareConcurrency || 0;
        var mem = (navigator as any).deviceMemory || 0;
        var dpr = window.devicePixelRatio || 1;
        if ((cores && cores < 4) || (mem && mem < 4) || dpr > 2.5) return 'medium';
        return 'high';
      } catch (e) {
        return 'high';
      }
  }

  function effectivePixelRatio(resolution: number): number {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var r = typeof resolution === 'number' && isFinite(resolution) ? resolution : 1;
      if (r < 0.25) r = 0.25; else if (r > 1) r = 1;
      return dpr * r;
  }

  function resolveTier(quality: string): ThreeMaterialTier {
      if (quality === 'medium' || quality === 'low') return quality;
      if (quality === 'high') return 'high';
      return (runtime.threeView && runtime.threeView.gpuTier) || 'high';
  }

  function onQualityChange(value: string): void {
      var q: 'auto' | 'high' | 'medium' | 'low' =
        (value === 'high' || value === 'medium' || value === 'low') ? value : 'auto';
      three.value.render.quality = q;
      if (runtime.threeView) {
        var tier = resolveTier(q);
        applyMaterialTier(tier);
        applySkyTier(tier);
      }
  }

  function setMainView(view: string): void {
      useUiStore().ui.mainView = view === 'three' ? 'three' : 'chart';
      if (useUiStore().ui.mainView === 'three') {
        ensureThreeTelemetry();
        nextTick(() => {
          ensureThreeView();
          if (three.value.playback.curveAxis) rebuildThreeCurveChart();
        });
      } else {
        three.value.playback.playing = false;
        if (three.value.view.cameraMode === 'fps') resetThreeFpsKeys();
        three.value.playback.fpsLastTime = 0;
        if (runtime.threeView && runtime.threeView.raf) {
          cancelAnimationFrame(runtime.threeView.raf);
          runtime.threeView.raf = 0;
        }
        nextTick(() => { if (runtime.mainChart) runtime.mainChart.resize(); });
      }
  }

  function setThreeViewMode(mode: string): void {
      var next: 'ortho' | 'free' = mode === 'free' ? 'free' : 'ortho';
      if (next !== 'free' && three.value.view.cameraMode === 'fps') resetThreeFpsKeys();
      three.value.view.mode = next;
      if (next === 'free' && !three.value.view.cameraSeeded) seedThreeCameraBehindDrone();
      updateThreeCameraMode();
  }

  function setThreeCameraMode(mode: string): void {
      if (mode !== 'fps' && mode !== 'lock') mode = 'normal';
      var prev = three.value.view.cameraMode;
      if (prev === 'fps' && mode !== 'fps') resetThreeFpsKeys();
      if (mode === 'fps' && prev !== 'fps') seedThreeFpsFromCamera();
      if (mode === 'lock' && !three.value.view.lockSeeded) seedThreeLockOrbit();
      three.value.view.cameraMode = mode as 'normal' | 'fps' | 'lock';
      updateThreeCameraMode();
  }

  function seedThreeFpsFromCamera(): void {
      if (!runtime.threeView) return;
      var cam = runtime.threeView.perspectiveCamera;
      var f = runtime.threeView.fps;
      f.x = cam.position.x;
      f.y = cam.position.y;
      f.z = cam.position.z;
      f.speed = 2
  }

  function seedThreeCameraBehindDrone(): void {
      if (!runtime.threeView || !runtime.threeView.perspectiveCamera || !three.value.telemetry.samples.length || !THREE) return;
      updateThreeCurrent();
      var drone = runtime.threeView.drone;
      if (!drone) return;
      var dronePos = drone.position.clone();
      var forward = new THREE.Vector3(0, 0, 1).applyQuaternion(drone.quaternion);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
      forward.normalize();
      var s = runtime.threeView.droneBaseScale || 1;
      var backDist = Math.max(14, 9 * s);
      var heightDist = Math.max(7, 4.5 * s);
      var camPos = dronePos.clone()
        .add(forward.multiplyScalar(-backDist))
        .add(new THREE.Vector3(0, heightDist, 0));
      var cam = runtime.threeView.perspectiveCamera;
      cam.position.copy(camPos);
      cam.up.set(0, 1, 0);
      cam.lookAt(dronePos);
      var f = runtime.threeView.fps;
      f.x = camPos.x;
      f.y = camPos.y;
      f.z = camPos.z;
      three.value.view.cameraSeeded = true;
  }

  function seedThreeLockOrbit(): void {
      if (!runtime.threeView || !runtime.threeView.drone || !three.value.telemetry.samples.length || !THREE) return;
      updateThreeCurrent();
      var drone = runtime.threeView.drone;
      if (!drone) return;
      drone.updateMatrixWorld(true);
      var box = new THREE.Box3().setFromObject(drone);
      var dim = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
      if (!isFinite(dim) || dim <= 0) dim = 1;
      var back = 2.8 * dim;
      var height = 0.6 * dim;
      runtime.threeView.lockPitch = -Math.atan2(height, back);
      runtime.threeView.lockDistance = Math.sqrt(back * back + height * height);
      var fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(drone.quaternion);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
      fwd.normalize();
      runtime.threeView.lockYaw = Math.atan2(-fwd.x, -fwd.z);
      three.value.view.lockSeeded = true;
  }

  function updateThreeFpsMotion(dtSec: number): void {
      if (!runtime.threeView || !runtime.threeView.fps) return;
      var f = runtime.threeView.fps;
      var k = runtime.threeView.keys;
      var mf = (k.forward ? 1 : 0) - (k.back ? 1 : 0);
      var mr = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      var mu = (k.up ? 1 : 0) - (k.down ? 1 : 0);
      if (!mf && !mr && !mu) return;
      var axes = threeFpsAxes(runtime.threeView.perspectiveCamera.quaternion);
      var fwd = axes.forward.normalize();
      var right = axes.right.normalize();
      var up = axes.up.normalize();
      var mx = fwd.x * mf + right.x * mr + up.x * mu;
      var my = fwd.y * mf + right.y * mr + up.y * mu;
      var mz = fwd.z * mf + right.z * mr + up.z * mu;
      var len = Math.sqrt(mx * mx + my * my + mz * mz);
      if (len > 0) { mx /= len; my /= len; mz /= len; }
      var step = f.speed * dtSec;
      f.x += mx * step;
      f.y += my * step;
      f.z += mz * step;
  }

  function bindThreeControls(): void {
      var canvas = runtime.threeView.renderer.domElement;
      canvas.addEventListener('pointerdown', function (e: PointerEvent) {
        if (three.value.view.mode !== 'free') return;
        if (three.value.view.cameraMode === 'fps') {
          if (document.pointerLockElement !== canvas) {
            try { canvas.requestPointerLock(); } catch (_) {}
          }
          return;
        }
        runtime.threeView.dragging = true;
        runtime.threeView.lastX = e.clientX;
        runtime.threeView.lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointermove', function (e: PointerEvent) {
        if (!runtime.threeView.dragging) return;
        var dx = e.clientX - runtime.threeView.lastX;
        var dy = e.clientY - runtime.threeView.lastY;
        runtime.threeView.lastX = e.clientX;
        runtime.threeView.lastY = e.clientY;
        var isLock = three.value.view.cameraMode === 'lock';
        var yawKey: 'lockYaw' | 'freeYaw' = isLock ? 'lockYaw' : 'freeYaw';
        var pitKey: 'lockPitch' | 'freePitch' = isLock ? 'lockPitch' : 'freePitch';
        runtime.threeView[yawKey] -= dx * 0.006;
        var pMin = isLock ? -1.5 : -1.35;
        var pMax = isLock ? 1.5 : -0.15;
        runtime.threeView[pitKey] = Math.max(pMin, Math.min(pMax, runtime.threeView[pitKey] - dy * 0.006));
        updateThreeCameraMode();
      });
      canvas.addEventListener('pointerup', function (e: PointerEvent) {
        runtime.threeView.dragging = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      });
      canvas.addEventListener('mouseenter', function (e: MouseEvent) {
        runtime.threeView.lastX = e.clientX;
        runtime.threeView.lastY = e.clientY;
      });
      canvas.addEventListener('mousemove', function (e: MouseEvent) {
        if (three.value.view.mode !== 'free' || three.value.view.cameraMode !== 'fps') {
          runtime.threeView.lastX = e.clientX;
          runtime.threeView.lastY = e.clientY;
          return;
        }

        if (document.pointerLockElement !== canvas)
          return; 

        var dx: number, dy: number;
        if (document.pointerLockElement === canvas) {
          dx = e.movementX || 0;
          dy = e.movementY || 0;
        } else {
          dx = e.clientX - runtime.threeView.lastX;
          dy = e.clientY - runtime.threeView.lastY;
          runtime.threeView.lastX = e.clientX;
          runtime.threeView.lastY = e.clientY;
        }
        threeFpsApplyLook(dx, dy);
        updateThreeCameraMode();
      });
      canvas.addEventListener('wheel', function (e: WheelEvent) {
        if (three.value.view.mode !== 'free') return;
        e.preventDefault();
        if (three.value.view.cameraMode === 'fps') {
          var f = runtime.threeView.fps;
          f.speed = Math.max(2, Math.min(3000, f.speed * (e.deltaY > 0 ? 0.85 : 1.18)));
          return;
        }
        var distKey: 'lockDistance' | 'freeDistance' = three.value.view.cameraMode === 'lock' ? 'lockDistance' : 'freeDistance';
        runtime.threeView[distKey] = Math.max(THREE_FREE_MIN_DISTANCE, Math.min(THREE_FREE_MAX_DISTANCE, runtime.threeView[distKey] * (e.deltaY > 0 ? 1.1 : 0.9)));
        updateThreeCameraMode();
      }, { passive: false });
  }

  function threeWindowFromZoom(): TimeWindow | null {
      if (!runtime.threeCurveChart) return null;
      var z = runtime.threeCurveChart.getZoomWindow();
      return { min: z.min, max: z.max, span: Math.max(1, z.max - z.min) };
  }

  function bindThreeCurveChartInteractions(): void {
      if (!runtime.threeCurveChart) return;
      runtime.threeCurveChart.off('dataZoom');
      runtime.threeCurveChart.off('restore');
      runtime.threeCurveChart.on('dataZoom', function () {
        var z = runtime.threeCurveChart.getZoomWindow();
        var w = { min: z.min, max: z.max, span: Math.max(1, z.max - z.min) };
        three.value.playback.timeWindow = w;
        if (three.value.playback.timeMs < w.min) three.value.playback.timeMs = w.min;
        if (three.value.playback.timeMs > w.max) three.value.playback.timeMs = w.max;
        refreshThreePlayhead();
      });
      runtime.threeCurveChart.on('restore', function () {
        var xr = useAnalysisStore().calcXRange();
        three.value.playback.timeWindow = { min: xr.min, max: xr.max, span: Math.max(1, xr.max - xr.min) };
        refreshThreePlayhead();
      });
  }

  function rebuildThreeCurveChart(): void {
      nextTick(function () {
        if (!three.value.playback.curveAxis) return;
        var el = document.getElementById('three-curve-chart');
        if (!el) return;
        if (!runtime.threeCurveChart) {
          runtime.threeCurveChart = new LineChart(el, {
            grid: { left: 56, right: 12, top: 10, bottom: 24 },
            clearColor: 0xf3f4f6,
            panAxis: 'both',
            enableWheelZoom: true,
            enableDragPan: true,
            lineWidth: useAnalysisStore().chart.lineWidth,
            formatX: function (ms: number) { return useAnalysisStore().formatTime(ms, false); },
          });
          bindThreeCurveChartInteractions();
          if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(function () { refreshThreePlayhead(); }).observe(el);
          }
        }
        var chartStore = useAnalysisStore();
        var xRange = chartStore.calcXRange();
        var yRange = chartStore.calcYRange();
        var baseTimeMs = chartStore.chartBaseTimeMs();
        runtime.threeCurveChart.setOption({
          series: chartStore.buildLineSeries(baseTimeMs),
          xRange: xRange,
          yRange: yRange,
          baseTimeMs: baseTimeMs,
        });
        runtime.threeCurveChart.resize();
        three.value.playback.timeWindow = { min: xRange.min, max: xRange.max, span: Math.max(1, xRange.max - xRange.min) };
        refreshThreePlayhead();
      });
  }

  function updateThreePlayhead(): void { refreshThreePlayhead(); }

  function threeChartGridRect(): any {
      if (!runtime.threeCurveChart) return null;
      var r = runtime.threeCurveChart.getGridRect();
      return (r && r.width > 0) ? r : null;
  }

  function threePixelForTime(time: number): number | null {
      if (!runtime.threeCurveChart) return null;
      var px = runtime.threeCurveChart.dataToPixel(time, 0).px;
      return isFinite(px) ? px : null;
  }

  function threeTimeForPixel(px: number): number | null {
      if (!runtime.threeCurveChart) return null;
      var t = runtime.threeCurveChart.pixelToData(px, 0).t;
      return isFinite(t) ? t : null;
  }

  function refreshThreePlayhead(): void {
      if (!three.value.playback.curveAxis || !runtime.threeCurveChart) return;
      var el = threePlayheadEl.value;
      if (!el) return;
      var x = threePixelForTime(three.value.playback.timeMs);
      if (x == null || !isFinite(x)) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.style.transform = 'translateX(' + x + 'px)';
      var tag = threePlayheadTagEl.value;
      if (tag) tag.textContent = useAnalysisStore().formatUTCTime(three.value.playback.timeMs);
  }

  function onThreePlayheadDown(e: MouseEvent): void {
      if (!runtime.threeCurveChart) return;
      e.preventDefault();
      e.stopPropagation();
      three.value.playback.playing = false;
      var move = function (ev: MouseEvent) { seekThreeByClientX(ev.clientX); };
      var up = function () {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      seekThreeByClientX(e.clientX);
  }

  function seekThreeByClientX(clientX: number): void {
      if (!runtime.threeCurveChart) return;
      var el = document.getElementById('three-curve-chart');
      if (!el) return;
      var px = clientX - el.getBoundingClientRect().left;
      var time = threeTimeForPixel(px);
      if (time == null || !isFinite(time)) return;
      var w = threePlaybackRange.value;
      if (time < w.min) time = w.min;
      if (time > w.max) time = w.max;
      three.value.playback.timeMs = time;
      updateThreeCurrent();
      if (useUiStore().ui.mainView === 'three') renderThreeView();
  }

  function toggleThreeCurveAxis(): void {
      three.value.playback.curveAxis = !three.value.playback.curveAxis;
      if (three.value.playback.curveAxis) {
        var xr = useAnalysisStore().calcXRange();
        three.value.playback.timeWindow = { min: xr.min, max: xr.max, span: Math.max(1, xr.max - xr.min) };
        if (three.value.playback.timeMs < xr.min) three.value.playback.timeMs = xr.min;
        if (three.value.playback.timeMs > xr.max) three.value.playback.timeMs = xr.max;
        rebuildThreeCurveChart();
      } else {
        three.value.playback.timeWindow = null;
        var r = threeTimeRange.value;
        if (three.value.playback.timeMs < r.min) three.value.playback.timeMs = r.min;
        if (three.value.playback.timeMs > r.max) three.value.playback.timeMs = r.max;
        if (runtime.threeCurveChart) {
          try { runtime.threeCurveChart.dispose(); } catch (e) {}
          runtime.threeCurveChart = null;
        }
      }
  }

  function onThreeCurveResizeDown(e: MouseEvent): void {
      e.preventDefault();
      e.stopPropagation();
      var startY = e.clientY;
      var startH = three.value.playback.curveHeight;
      var minH = 80;
      var maxH = Math.max(minH, (window.innerHeight || 800) - 220);
      var move = function (ev: MouseEvent) {
        three.value.playback.curveHeight = Math.max(minH, Math.min(maxH, startH + (startY - ev.clientY)));
      };
      var up = function () {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
  }

  function applyThreeFpsKey(e: KeyboardEvent, down: boolean): boolean {
      if (useUiStore().ui.mainView !== 'three' || three.value.view.mode !== 'free' || three.value.view.cameraMode !== 'fps' || !runtime.threeView) return false;
      if (isEditableTarget(e.target)) return false;
      var lower = String(e.key || '').toLowerCase();
      var code = e.code || '';
      var k = runtime.threeView.keys;
      var used = false;
      var set = function (name: 'forward' | 'back' | 'left' | 'right' | 'up' | 'down') { (k as any)[name] = down ? 1 : 0; used = true; };
      if (lower === 'w' || code === 'ArrowUp') set('forward');
      else if (lower === 's' || code === 'ArrowDown') set('back');
      else if (lower === 'a' || code === 'ArrowLeft') set('left');
      else if (lower === 'd' || code === 'ArrowRight') set('right');
      else if (lower === ' ' || code === 'Space' || lower === 'e') set('up');
      else if (lower === 'q' || lower === 'c') set('down');
      if (used) e.preventDefault();
      return used;
  }

  function resetThreeFpsKeys(): void {
      if (!runtime.threeView || !runtime.threeView.keys) return;
      var k = runtime.threeView.keys;
      k.forward = k.back = k.left = k.right = k.up = k.down = 0;
  }

  function threeFpsAxes(q: THREE.Quaternion): { forward: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 } {
      return {
        forward: new THREE.Vector3(0, 0, -1).applyQuaternion(q),
        right: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
        up: new THREE.Vector3(0, 1, 0).applyQuaternion(q)
      };
  }

  function threeFpsApplyLook(dx: number, dy: number): void {
      if (!runtime.threeView || !THREE) return;
      var q = runtime.threeView.perspectiveCamera.quaternion;
      var sens = 0.0025;
      var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      var curPitch = Math.asin(Math.max(-1, Math.min(1, forward.y)));
      var newPitch = Math.max(-1.5, Math.min(1.5, curPitch - dy * sens));
      var pitchDelta = newPitch - curPitch;
      var qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * sens);
      var qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchDelta);
      q.premultiply(qYaw);
      q.multiply(qPitch);
      q.normalize();
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

  function lerpAngle(a: number | null, b: number | null, f: number): number | null {
      if (a === null || a === undefined || !isFinite(a)) return b;
      if (b === null || b === undefined || !isFinite(b)) return a;
      var d = (((b - a) % 360) + 540) % 360 - 180;
      return a + d * f;
  }

  function sampleAtTime(t: number): TelemetrySample | null {
      var points = three.value.telemetry.samples;
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
        baroAlt: mixNullable(a.baroAlt, b.baroAlt, f),
        rcRoll: mixNullable(a.rcRoll, b.rcRoll, f),
        rcPitch: mixNullable(a.rcPitch, b.rcPitch, f),
        rcThrottle: mixNullable(a.rcThrottle, b.rcThrottle, f),
        rcYaw: mixNullable(a.rcYaw, b.rcYaw, f)
      } as TelemetrySample;
  }

  function mixNullable(a: any, b: any, f: number): any {
      if (a === null || a === undefined) return b;
      if (b === null || b === undefined) return a;
      return a + (b - a) * f;
  }

  async function toggleThreeMissionRoute(): Promise<void> {
      const m = useMapStateStore().map;
      m.showRoute = !m.showRoute;
      await ensureThreeMissionBuild();
  }

  async function toggleThreeWaypoints(): Promise<void> {
      const m = useMapStateStore().map;
      m.showWaypoints = !m.showWaypoints;
      await ensureThreeMissionBuild();
  }

  async function ensureThreeMissionBuild(): Promise<void> {
      if (useUiStore().ui.mainView === 'three') {
        ensureThreeView();
        if (!useCommandsStore().commands.loaded) {
          try { await useCommandsStore().loadCommands(); } catch {  }
        }
      }
      updateThreeMissionRoute();
  }

  function rebuildThreeMissionVersions(): void {
      var cmdStore = useCommandsStore();
      var versions = [];
      var sorted = cmdStore.commands.items.slice().sort(function (a, b) {
        if ((a.timeMs || 0) !== (b.timeMs || 0)) return (a.timeMs || 0) - (b.timeMs || 0);
        return (a.sequence || 0) - (b.sequence || 0);
      });
      var cur = null;
      var prevSeq = -1;
      for (var i = 0; i < sorted.length; i++) {
        var c = sorted[i];
        if (!c) continue;
        var seq = c.sequence || 0;
        if (!cur || seq <= prevSeq) {
          cur = { startTime: c.timeMs || 0, points: [] };
          versions.push(cur);
        }
        cur.points.push(c);
        prevSeq = seq;
      }
      three.value.mission.versions = versions;
  }

  function activeMissionVersionAt(timeMs: number): MissionVersion | null {
      var versions = three.value.mission.versions;
      if (!versions || !versions.length) return null;
      var active = versions[0];
      for (var i = 0; i < versions.length; i++) {
        if ((versions[i].startTime || 0) <= (timeMs || 0)) active = versions[i];
        else break;
      }
      return active;
  }

  function missionAltIsRelative(frame: number): boolean {
      return frame === 3 || frame === 6 || frame === 10 || frame === 11;
  }

  function computeMissionPoints(origin: { lat0: number; lng0: number; alt0: number; cosLat: number }): any[] | null {
      if (!origin) return null;
      var cmdStore = useCommandsStore();
      if (cmdStore.commands.items && cmdStore.commands.items.length && !three.value.mission.versions) {
        rebuildThreeMissionVersions();
      }
      var active = activeMissionVersionAt(three.value.playback.timeMs || 0);
      if (!active || !active.points) return null;

      var home = null;
      for (var h = 0; h < active.points.length; h++) {
        if (active.points[h] && active.points[h].sequence === 0) { home = active.points[h]; break; }
      }
      var homeLat = home ? home.latitude : origin.lat0;
      var homeLng = home ? home.longitude : origin.lng0;
      var homeAltRef = home
        ? (missionAltIsRelative(home.frame) ? origin.alt0 : (home.altitude || 0))
        : origin.alt0;

      var NAV: Record<number, number> = { 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 23: 1, 24: 1, 25: 1, 80: 1, 81: 1, 94: 1, 194: 1 };
      var pts: any[] = [];
      for (var i = 0; i < active.points.length; i++) {
        var c = active.points[i];
        if (!c || !NAV[c.command]) continue;
        var hasCoords = isFinite(c.latitude) && isFinite(c.longitude) &&
          (c.latitude !== 0 || c.longitude !== 0);
        var lat = hasCoords ? c.latitude : homeLat;
        var lng = hasCoords ? c.longitude : homeLng;
        var north = (lat - origin.lat0) * 110540;
        var east = (lng - origin.lng0) * origin.cosLat * 111320;
        var x = east * THREE_UNITS_PER_METER;
        var z = -north * THREE_UNITS_PER_METER;
        var aboveHome = missionAltIsRelative(c.frame)
          ? (c.altitude || 0)
          : ((c.altitude || 0) - homeAltRef);
        var y = aboveHome * THREE_UNITS_PER_METER;
        pts.push({
          x: x, y: y, z: z,
          seq: c.sequence,
          isTakeoff: c.command === 22,
          isHome: c.sequence === 0,
          name: c.commandName
        });
      }
      var wpNo = 0;
      for (var k = 0; k < pts.length; k++) {
        if (pts[k].isHome) {
          pts[k].label = 'H';
        } else if (pts[k].isTakeoff) {
          pts[k].label = 'T';
        } else {
          wpNo++;
          pts[k].label = String(wpNo);
        }
      }
      return pts.length ? pts : null;
  }

  function missionLatLngPoints(): { lat: number; lng: number; label: string; isHome: boolean; isTakeoff: boolean; alt: number }[] | null {
      var cmdStore = useCommandsStore();
      if (cmdStore.commands.items && cmdStore.commands.items.length && !three.value.mission.versions) {
        rebuildThreeMissionVersions();
      }
      var active = activeMissionVersionAt(three.value.playback.timeMs || 0);
      if (!active || !active.points) return null;

      var home: any = null;
      for (var h = 0; h < active.points.length; h++) {
        if (active.points[h] && active.points[h].sequence === 0) { home = active.points[h]; break; }
      }
      var homeLat = home ? home.latitude : 0;
      var homeLng = home ? home.longitude : 0;
      var originAlt0 = three.value.telemetry.meta.geoOrigin?.alt0 ?? 0;
      var homeAltRef = home
        ? (missionAltIsRelative(home.frame) ? originAlt0 : (home.altitude || 0))
        : originAlt0;

      var NAV: Record<number, number> = { 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 23: 1, 24: 1, 25: 1, 80: 1, 81: 1, 94: 1, 194: 1 };
      var pts: any[] = [];
      for (var i = 0; i < active.points.length; i++) {
        var c = active.points[i];
        if (!c || !NAV[c.command]) continue;
        var hasCoords = isFinite(c.latitude) && isFinite(c.longitude) && (c.latitude !== 0 || c.longitude !== 0);
        var aboveHome = missionAltIsRelative(c.frame)
          ? (c.altitude || 0)
          : ((c.altitude || 0) - homeAltRef);
        pts.push({
          lat: hasCoords ? c.latitude : homeLat,
          lng: hasCoords ? c.longitude : homeLng,
          isTakeoff: c.command === 22,
          isHome: c.sequence === 0,
          alt: aboveHome,
        });
      }
      var wpNo = 0;
      for (var k = 0; k < pts.length; k++) {
        if (pts[k].isHome) {
          pts[k].label = 'H';
        } else if (pts[k].isTakeoff) {
          pts[k].label = 'T';
        } else {
          wpNo++;
          pts[k].label = String(wpNo);
        }
      }
      return pts;
  }

  async function updateThreeMissionRoute(): Promise<void> {
      if (!runtime.threeView || !THREE) return;
      var map = useMapStateStore().map;
      var wantAny = map.showRoute || map.showWaypoints;
      var timeMs = three.value.playback.timeMs || 0;
      var cmdStore = useCommandsStore();

      if (cmdStore.commands.items && cmdStore.commands.items.length && !three.value.mission.versions) {
        rebuildThreeMissionVersions();
      }
      var active = activeMissionVersionAt(timeMs);
      var activeKey = active ? active.startTime : -1;

      if (wantAny && runtime.threeView.missionLineGroup && runtime.threeView.missionActiveKey === activeKey) {
        return;
      }
      runtime.threeView.missionActiveKey = activeKey;

      if (runtime.threeView.missionLineGroup) {
        runtime.threeView.scene.remove(runtime.threeView.missionLineGroup);
        disposeThreeObjects(runtime.threeView.missionLineGroup, true);  
        runtime.threeView.missionLineGroup = null;
      }
      if (runtime.threeView.missionMarkerGroup) {
        runtime.threeView.scene.remove(runtime.threeView.missionMarkerGroup);
        disposeThreeObjects(runtime.threeView.missionMarkerGroup, true);
        runtime.threeView.missionMarkerGroup = null;
      }
      if (!wantAny) return;
      if (!cmdStore.commands.loaded) {
        try { await cmdStore.loadCommands(); } catch {  }
        updateThreeMissionRoute();
        return;
      }

      var origin = three.value.telemetry.meta && three.value.telemetry.meta.geoOrigin;
      if (!origin) {
        showToast('当前轨迹非 GPS 经纬度，无法叠加航线与航点', 'info');
        map.showRoute = false;
        map.showWaypoints = false;
        return;
      }
      if (!active || !active.points) return;

      var pts = computeMissionPoints(origin);
      if (!pts || !pts.length) return;

      var lineGroup = new THREE.Group();
      if (pts.length >= 2) {
        var posArr = [];
        for (var p = 0; p < pts.length; p++) posArr.push(pts[p].x, pts[p].y, pts[p].z);
        var lineGeom = new THREE.BufferGeometry();
        lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
        var lineMat = new THREE.LineDashedMaterial({
          color: 0xea580c, dashSize: 1.6, gapSize: 1.0, linewidth: 2,
          transparent: true, opacity: 0.7, depthWrite: false
        });
        var line = new THREE.Line(lineGeom, lineMat);
        line.computeLineDistances();
        lineGroup.add(line);
      }
      lineGroup.visible = map.showRoute;
      runtime.threeView.missionLineGroup = lineGroup;
      runtime.threeView.scene.add(lineGroup);

      var markerGroup = new THREE.Group();
      var WP_R = 0.5, HOME_R = 0.8;
      var coreGeom = new THREE.SphereGeometry(WP_R, 16, 16);
      var homeCoreGeom = new THREE.SphereGeometry(HOME_R, 18, 18);
      var coreMat = new THREE.MeshBasicMaterial({ color: 0xea580c, transparent: true, opacity: 0.92, depthWrite: false });
      var homeCoreMat = new THREE.MeshBasicMaterial({ color: 0x16a34a, transparent: true, opacity: 0.92, depthWrite: false });
      var outGeom = new THREE.SphereGeometry(WP_R * 1.32, 16, 16);
      var homeOutGeom = new THREE.SphereGeometry(HOME_R * 1.26, 18, 18);
      var outMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.BackSide, depthWrite: false });
      var haloGeom = new THREE.RingGeometry(WP_R * 1.15, WP_R * 1.95, 28);
      var homeHaloGeom = new THREE.RingGeometry(HOME_R * 1.1, HOME_R * 1.8, 32);
      var haloMat = new THREE.MeshBasicMaterial({ color: 0xea580c, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
      var homeHaloMat = new THREE.MeshBasicMaterial({ color: 0x16a34a, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
      var GROUND_Y = 0;
      for (var n = 0; n < pts.length; n++) {
        var pt = pts[n];
        var isHome = pt.seq === 0;
        var r = isHome ? HOME_R : WP_R;
        var core = new THREE.Mesh(isHome ? homeCoreGeom : coreGeom, isHome ? homeCoreMat : coreMat);
        core.position.set(pt.x, pt.y, pt.z);
        markerGroup.add(core);
        var outline = new THREE.Mesh(isHome ? homeOutGeom : outGeom, outMat);
        outline.position.set(pt.x, pt.y, pt.z);
        markerGroup.add(outline);
        var halo = new THREE.Mesh(isHome ? homeHaloGeom : haloGeom, isHome ? homeHaloMat : haloMat);
        halo.rotation.x = -Math.PI / 2; 
        halo.position.set(pt.x, GROUND_Y, pt.z);
        markerGroup.add(halo);
        var labelSprite = new SpriteText(pt.label, isHome ? 0.62 : 0.52);
        labelSprite.position.set(pt.x, pt.y + r + 0.35, pt.z); 
        markerGroup.add(labelSprite);
      }
      markerGroup.visible = map.showWaypoints;
      runtime.threeView.missionMarkerGroup = markerGroup;
      runtime.threeView.scene.add(markerGroup);
  }

  function applyThreeOverlayVisibility(): void {
      var tv = runtime.threeView; if (!tv) return;
      var m = useMapStateStore().map;
      if (tv.pathLine) tv.pathLine.visible = m.showPath;
      if (tv.missionLineGroup) tv.missionLineGroup.visible = m.showRoute;
      if (tv.missionMarkerGroup) tv.missionMarkerGroup.visible = m.showWaypoints;
  }

  function getVertices(mesh: THREE.Mesh): THREE.Vector3[] {
      const pos = mesh.geometry.attributes.position;
      const arr = [];

      for (let i = 0; i < pos.count; i++) {
        arr.push(new THREE.Vector3().fromBufferAttribute(pos, i));
      }

      return arr;
  }

  function loadDroneModel(): void {
      if (!THREE || !runtime.threeView) return;

      const logStore = useLogStore()
      const summary = logStore.log.summary
      const modelName = resolveDroneModelName(summary && summary.frame, summary && summary.airframe)
      const key = modelName + '@' + three.value.model;
      if (runtime.threeView.droneModelName && runtime.threeView.droneModelName === key) return;

      if (three.value.model === 'lowpoly') {
        loadThreeMainDroneModel({ scene: buildLowpolyDroneModel(modelName) }, modelName);
        loadThreeAttributeDroneModel({ scene: buildLowpolyDroneModel(modelName) }, modelName);
        runtime.threeView.droneModelName = key;
        return;
      }

      if (!GLTFLoader) return;
      function loadOnce(target: 'main' | 'attitude', name: string): void {
        const loader = new GLTFLoader();
        loader.load(`vendor/${name}.glb`,
          function (geometry: any) {
            if (target === 'main') loadThreeMainDroneModel(geometry, name)
            else loadThreeAttributeDroneModel(geometry, name)
          },
          undefined,
          function () {
            if (name !== THREE_DEFAULT_DRONE_MODEL) loadOnce(target, THREE_DEFAULT_DRONE_MODEL)
          },
        );
      }
      loadOnce('main', modelName)
      loadOnce('attitude', modelName)

      runtime.threeView.droneModelName = key
  }

    // 程序化方块模型(lowpoly)与 addLowpolyMotor/addLowpolyProp 已抽到 @/modules/shared/utils/drone-model
    // （与 MapLibre 自定义图层共用同一建模管线）。此处直接用导入的纯函数；下面 onModelChange 等照旧。
    // buildLowpolyDroneModel / addLowpolyMotor / addLowpolyProp 由模块顶部 import 提供（亦在 store return 暴露）。

    // 机型模型形态切换（glb/lowpoly）：重载主+姿态模型。视图未建则仅记状态，下次构建套用。
  function onModelChange(model: string): void {
      const next: 'glb' | 'lowpoly' = model === 'lowpoly' ? 'lowpoly' : 'glb';
      if (three.value.model === next) return;
      three.value.model = next;
      if (runtime.threeView) {
        runtime.threeView.droneModelName = ''; // 清去重键，强制重载
        loadDroneModel();
      }
  }

  function loadThreeMainDroneModel(geometry: any, name: string): void {
      if (!THREE) return;

      const droneModel = applyExtraDroneModel(geometry, { x: 0.01, y: 0.01, z: 0.01 }, { x: false, y: true, z: true }, name);

      if (runtime.threeView.drone) {
        runtime.threeView.scene.remove(runtime.threeView.drone);
        disposeThreeObjects(runtime.threeView.drone, true);  // 含 GLB 纹理，否则换机型/形态累积泄漏
      }

      runtime.threeView.drone = droneModel
      runtime.threeView.mainPropellers = collectPropellers(droneModel, name);
      runtime.threeView.scene.add(runtime.threeView.drone);
      // 新载入的主模型套用当前光照倍率（envMapIntensity）。
      applyLighting();
      // 模型就位：按物理尺寸算基础缩放并应用(内部会 alignThreeGrid)；几何未就绪时沿用默认。
      updateThreeDroneScale();
      // 主模型(重)载后，若姿态对比开启，重建虚影(clone 新模型)。
      if (three.value.view.compareAttitude) rebuildGhostDrone();
  }

    // 纬线粗环(Torus)：XZ 平面(水平)、半径 radius、高度 y。tube 控制线粗，可半透明。
    // 用 Torus 取代 LineLoop——LineBasicMaterial.lwidt 在多数平台被忽略只能 1px，Torus 才有真实粗细。
  function makeLatRing(radius: number, y: number, color: number, opacity: number, tube = 0.008): THREE.Mesh | undefined {
      if (!THREE) return;
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(radius, tube, 10, 120),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false })
      );
      mesh.rotation.x = Math.PI / 2; // Torus 默认在 XY 平面，转 90° 平躺成纬圈
      mesh.position.y = y;
      return mesh;
  }

    // 经线粗环(Torus)：XY 平面(竖直经面)、半径 radius，再绕 Y 轴旋转 rotY 得不同经线。
  function makeMeridian(radius: number, rotY: number, color: number, opacity: number, tube = 0.006): THREE.Mesh | undefined {
      if (!THREE) return;
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(radius, tube, 10, 120),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false })
      );
      mesh.rotation.y = rotY; // 默认 XY 平面已是经面，绕 Y 旋转得不同经线
      return mesh;
  }

    // 罗盘字母纹理缓存：N/E/S/W 各一张 CanvasTexture，世界固连、内容不变，全局复用。
    // disposeThreeObjects 只回收 geometry/material、不回收 material.map 纹理，故缓存复用避免每次重建姿态球泄露。
  const compassLabelTex: Record<string, THREE.Texture> = {};
  function getCompassLabelTex(text: string, color: string): THREE.Texture | undefined {
      if (!THREE) return;
      const key = text + '|' + color;
      if (compassLabelTex[key]) return compassLabelTex[key];
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.font = 'bold 44px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.fillText(text, 32, 34);
      const tex = new THREE.CanvasTexture(canvas);
      compassLabelTex[key] = tex;
      return tex;
  }

    // 罗盘字母 Sprite：永远面向相机，赤道环外侧方位标识。北(N)蓝突出，其余深灰。
  function makeCompassLabel(text: string, color: string): THREE.Sprite | undefined {
      if (!THREE) return;
      const tex = getCompassLabelTex(text, color);
      if (!tex) return;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sprite.scale.set(0.34, 0.34, 1);
      return sprite;
  }

    // 径向刻度短线(细 Cylinder)：赤道环上 r0→r1 的方位标记。az=0 对应 −Z(北)，顺时针(与 yaw 同向)。
    // 用四元数把圆柱默认 +Y 轴对齐到径向 (sin az, 0, −cos az)；N 刻度更粗更长以突出正北。
  function makeCompassTick(az: number, color: number, r0: number, r1: number, thickness: number): THREE.Mesh | undefined {
      if (!THREE) return;
      const len = r1 - r0;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(thickness, thickness, len, 8),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.9, depthWrite: false })
      );
      const dir = new THREE.Vector3(Math.sin(az), 0, -Math.cos(az));
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const rm = (r0 + r1) / 2;
      mesh.position.set(dir.x * rm, 0, dir.z * rm);
      return mesh;
  }

    // 地平参照球：外层淡玻璃球壳(包裹感) + 下半球深灰染色(下半球远面 BackSide，上浅下深、不盖机体) + 浅灰赤道/正向圆环/赤道十字 + N，世界固定、无人机与红机头杆在内旋转。
    // 玻璃壳+下深上浅给"球内包裹/天地"视觉感；赤道判 pitch/roll，正向圆环判 yaw，赤道十字给水平面基准；正北 N 给航向零点。
  function createAttitudeSphere(): THREE.Group | undefined {
      if (!THREE) return;
      const R = 1.15;
      const group = new THREE.Group();
      group.name = 'attitude-reference';

      // 背景圆（在 3D 之后、比球大一点、独立浅色 ≠ 画布背景 → 有层次）：给上半球一个有层次的底色——
      // 上半球透明→显背景圆色(不直接透到画布背景)，下半球再叠更深染色 → 上浅(背景圆)、下深(染色)分明。
      // 相机方向在此算一次(faceRing 复用)。世界固连（不随机身转）。
      const camPos = runtime.threeView.attitudeCamera ? runtime.threeView.attitudeCamera.position : new THREE.Vector3(0, 0, 1);
      const camDir = camPos.lengthSq() > 1e-6 ? camPos.clone().normalize() : new THREE.Vector3(0, 0, 1);
      const bgDiscMat = new THREE.MeshBasicMaterial({ color: 0xe3e8ee, side: THREE.DoubleSide, depthWrite: false });
      const bgDisc = new THREE.Mesh(new THREE.CircleGeometry(R * 1.4, 64), bgDiscMat);
      bgDisc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), camDir); // 圆面朝相机
      bgDisc.position.copy(camDir).multiplyScalar(-R * 1.1); // 贴在球后(远离相机侧)
      bgDisc.renderOrder = -2; // 最底层
      group.add(bgDisc);
      // 下半球染色（SpaceX 风：下半球染比背景更深的同色系灰，上半球留空显浅背景 → 上浅下深）：
      // 只染下半球"远面"=BackSide，位于无人机之后→机体遮挡、不被盖住。世界固连（不随机身转）。
      const lowerDyeMat = new THREE.MeshBasicMaterial({ color: 0xb8c2cc, transparent: true, opacity: 0.6, side: THREE.BackSide, depthWrite: false });
      const lowerDye = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lowerDyeMat); // 赤道→南极(下半球) 远面
      lowerDye.renderOrder = -1;
      group.add(lowerDye);

      // 赤道（E-W 地平基准）+ 一条垂直经线：均粗环(Torus) 灰色，构成单色两环参照球。
      // 赤道半径=R，与正向圆环同径（正面看似等大、不超出）；横向不再拉长——拉长会超出正圆。
      const equator = makeLatRing(R, 0, 0xBAC3CE, 1.0, 0.015); // 不透明浅灰：下半染色不透到赤道，赤道保持自身浅灰、不被染
      if (equator) group.add(equator);
      // 赤道面上的十字参考线：W-E(沿 X)、N-S(沿 Z) 两条直径，灰、与环同粗，作赤道面方向参照（非经纬网格）。
      const crossMat = new THREE.MeshBasicMaterial({ color: 0xBAC3CE, transparent: true, opacity: 1.0, depthWrite: false });
      const we = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, R * 2, 8), crossMat);
      we.rotation.z = Math.PI / 2; // 圆柱默认沿 Y，绕 Z 转 90° → 沿 X（W-E 直径）
      group.add(we);
      const ns = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, R * 2, 8), crossMat);
      ns.rotation.x = Math.PI / 2; // 圆柱默认沿 Y，绕 X 转 90° → 沿 Z（N-S 直径）
      group.add(ns);
      // 正向圆环（面朝相机 → 正面看似 2D 正圆，非侧立椭圆）：环面法线对齐"原点→相机"方向。
      // 半径略放大(×1.05)以盖过赤道椭圆的视觉宽度；相机固定时该环固定；粗灰、与赤道同粗。
      const faceRing = new THREE.Mesh(
        new THREE.TorusGeometry(R * 1.05, 0.015, 12, 120),
        new THREE.MeshBasicMaterial({ color: 0xBAC3CE, transparent: true, opacity: 1.0, depthWrite: false })
      );
      faceRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), camDir);
      group.add(faceRing);
      // 正北标识（世界固连）：yaw=0 时机头朝 −Z(见 makeDroneQuaternion)，故 az=0→−Z=北。
      // 仅标一个 N 作航向零点：字母加深加大、renderOrder 抬到最上 → 不被天地半球上色模糊、清晰可读。
      const N_AZ = 0;
      const nTick = makeCompassTick(N_AZ, 0xBAC3CE, R, R + 0.22, 0.014);
      if (nTick) { nTick.renderOrder = 2; group.add(nTick); }
      const nLabel = makeCompassLabel('N', '#1e293b');
      if (nLabel) {
        nLabel.scale.set(0.46, 0.46, 1); // 放大字母
        nLabel.renderOrder = 2;           // 画在天地半球/环线之上，清晰不被模糊
        nLabel.position.set(Math.sin(N_AZ) * (R + 0.4), 0, -Math.cos(N_AZ) * (R + 0.4));
        group.add(nLabel);
      }
      // 朝向偏移由 attitudeAxes(跟随无人机的本体环层) 与世界环的夹角指示，球本身保留赤道+经线+正北标识作世界参照。
      return group;
  }

    // 本体姿态层(跟随无人机)：一条虚线红赤道 + 机头红点，叠在世界环(蓝实赤道/灰经线)上。
    // 虚线 vs 实线、红 vs 蓝/灰 —— 双层一眼可辨(旧版 3 条琥珀环与世界环颜色/粗细太近、6 环太乱)。
    // 本体赤道倾斜 = pitch/roll；机头红点绕垂直轴的位置 = yaw。
  function rebuildAttitudeAxes(): void {
      // var tv = runtime.threeView;
      // if (!tv || !THREE) return;
      // if (tv.attitudeAxes) {
      //   tv.attitudeScene.remove(tv.attitudeAxes);
      //   disposeThreeObjects(tv.attitudeAxes);
      //   tv.attitudeAxes = null;
      // }
      // var R = 1.15; // 与 createAttitudeSphere 的 R 对齐
      // var SEG = 96;
      // var group = new THREE.Group();
      // group.name = 'attitude-body';
      // // 本体赤道：虚线红线（与世界蓝实线赤道明显区分）
      // var eqPts: THREE.Vector3[] = [];
      // for (var i = 0; i <= SEG; i++) { var a = (i / SEG) * Math.PI * 2; eqPts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)); }
      // var eqLine = new THREE.LineLoop(
      //   new THREE.BufferGeometry().setFromPoints(eqPts),
      //   new THREE.LineDashedMaterial({ color: 0xff3b30, dashSize: 0.06, gapSize: 0.045, transparent: true, opacity: 0.95, depthWrite: false })
      // );
      // eqLine.computeLineDistances();
      // group.add(eqLine);
      
      // // 机头红点：本体赤道上 +Z 处，指示航向(yaw)
      // var noseDot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 14), new THREE.MeshBasicMaterial({ color: 0xff3b30, depthWrite: false }));
      // noseDot.position.set(0, 0, R);
      // group.add(noseDot);
      // tv.attitudeAxes = group;
      // tv.attitudeScene.add(group);

        var tv = runtime.threeView;
      if (!tv || !THREE) return;
      if (tv.attitudeAxes) {
        tv.attitudeScene.remove(tv.attitudeAxes);
        disposeThreeObjects(tv.attitudeAxes);
        tv.attitudeAxes = null;
      }
      var NOSE_R = 1.15;
      var nose = new THREE.Group();
      nose.name = 'attitude-nose';
      // 机头方向箭头（醒目红，加粗杆 + 锥形箭头尖）：本体固连，随机身姿态指向机头(局部 +Z)。
      // 锥尖给出明确朝向；箭头总长=NOSE_R，尖端落在球面上、不超出包围球/正向圆，方向一眼可辨。
      var noseMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, depthWrite: false });
      var HEAD_LEN = 0.22;
      var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, NOSE_R - HEAD_LEN, 12), noseMat);
      shaft.rotation.x = Math.PI / 2; // 圆柱默认沿 Y，转 90° 对齐局部 +Z（机头方向）
      shaft.position.set(0, 0, (NOSE_R - HEAD_LEN) / 2);
      var head = new THREE.Mesh(new THREE.ConeGeometry(0.07, HEAD_LEN, 18), noseMat);
      head.rotation.x = Math.PI / 2; // 圆锥默认指 +Y，转 90° 指 +Z（箭头朝机头方向）
      head.position.set(0, 0, NOSE_R - HEAD_LEN / 2); // 尖端 = NOSE_R，落在球面上、不超出
      nose.add(shaft);
      nose.add(head);
      tv.attitudeAxes = nose;
      tv.attitudeScene.add(nose);
  }

    // 风向箭头：世界固连(不随机身转)，按 WIND.Dir 偏航。青色，与世界环/红本体环区分。
    // 无风数据时隐藏。用 makeDroneQuaternion({yaw}) 取向，与机头(heading)同一世界系，二者夹角即相对风向。
  function rebuildWindArrow(): void {
      var tv = runtime.threeView;
      if (!tv || !THREE) return;
      if (tv.windArrow) { tv.attitudeScene.remove(tv.windArrow); disposeThreeObjects(tv.windArrow); tv.windArrow = null; }
      var R = 1.15;
      var mat = new THREE.MeshBasicMaterial({ color: 0x00e676, depthWrite: false });
      var g = new THREE.Group();
      g.name = 'wind-arrow';
      // 短箭头贴在球面、指向球心：头部尖朝 -Z(中心)，杆在外侧一点点。整体靠近 R、长度很短。
      var head = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.13, 14), mat);
      head.rotation.x = -Math.PI / 2; // 圆锥默认指 +Y，转 -90° 指 -Z(朝球心)
      head.position.set(0, 0, R - 0.065); // 尖端 ~R-0.13、底 ~R
      var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.09, 8), mat);
      shaft.rotation.x = Math.PI / 2;
      shaft.position.set(0, 0, R + 0.045); // 杆在球面外侧一点点
      g.add(head);
      g.add(shaft);
      g.visible = false; // 无风数据时隐藏，updateWindArrow 命中时再显示
      tv.windArrow = g;
      tv.attitudeScene.add(g);
  }

    // 每帧按风速向量 (N,E,D) 定向箭头：yaw=atan2(E,N)(水平流向)，pitch 按 VWD 上下俯仰(3D 风向量)。
    // 无 VWD(XKF2)→pitch=0 退化为水平。箭头沿风速向量(风去的方向)；要"风来的方向"改 yaw+180。与机头同世界系。
  function updateWindArrow(t: number): void {
      var tv = runtime.threeView;
      if (!tv || !tv.windArrow) return;
      var c = tv.windCurves;
      if (!c) { tv.windArrow.visible = false; return; }
      var cm = useCurveManagerStore();
      var n = cm.getValueAt(c.n.type, c.n.field, t, NaN);
      var e = cm.getValueAt(c.e.type, c.e.field, t, NaN);
      if (n === null || e === null || !isFinite(n) || !isFinite(e)) { tv.windArrow.visible = false; return; }
      var horiz = Math.sqrt(n * n + e * e);
      var yawDeg = Math.atan2(e, n) * 180 / Math.PI;
      var d = 0;
      if (c.d) {
        var dv = cm.getValueAt(c.d.type, c.d.field, t, 0);
        if (dv !== null && isFinite(dv)) d = dv;
      }
      // VWD 为 NED-down(正=向下风)；-d 转上正，与 pitch(抬头正) 对齐。
      var pitchDeg = horiz > 1e-9 ? Math.atan2(-d, horiz) * 180 / Math.PI : 0;
      // 风向 = 气象"风来的方向"(FROM)：流速向量反方向(+180)，故风从左侧来→箭头落在左侧指向球心。
      tv.windArrow.visible = true;
      tv.windArrow.quaternion.copy(makeDroneQuaternion({ roll: 0, pitch: pitchDeg, yaw: yawDeg + 180 }));
  }

    // 每帧把三轴 gizmo 同步到无人机姿态（四元数已在 applyDronePose 写入 attitudeDrone）。
    // 保留 roll/pitch/yaw 形参以兼容调用点，实际不再使用（直接读四元数，无欧拉角歧义）。
  function updateAttitudeArcs(_roll: number, _pitch: number, _yaw: number): void {
      var tv = runtime.threeView;
      if (!tv) return;
      if (tv.attitudeAxes && tv.attitudeDrone) tv.attitudeAxes.quaternion.copy(tv.attitudeDrone.quaternion);
  }

  function loadThreeAttributeDroneModel(geometry: any, name: string): void {
      if (!THREE) return;

      const attributeModel = applyExtraDroneModel(geometry, { x: 0.025, y: 0.025, z: 0.025 }, { x: false, y: false, z: true }, name);

      // 归一化到固定尺度(THREE_ATTITUDE_MODEL_EXTENT)：与机型/GLB 原始大小无关，
      // 缩到参考球内并留出边距，足够大以直观判读方向、又不会撑满姿态球。
      attributeModel.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(attributeModel);
      const ext = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
      if (isFinite(ext) && ext > 0) attributeModel.scale.multiplyScalar(THREE_ATTITUDE_MODEL_EXTENT / ext);

      // 姿态小模型材质降级：右下角姿态仪只需判读姿态方向，无需 PBR/envMap 高光。
      // 强制 medium（MeshLambertMaterial + 简单光照 + 微自发光防阴影面死黑），能清晰显示即可，省 GPU。
      attributeModel.traverse((child: any) => {
        if (!child.isMesh) return;
        const cfg: MaterialProperties | undefined = child.userData._apmMatConfig;
        if (!cfg) return; // 非机身 mesh（桨叶等）保持载入态材质
        child.material = buildTierMaterial(cfg, 'medium');
      });

      if (runtime.threeView.attitudeDrone) {
        // 旧姿态模型挂在 attitudeScene（非主 scene），须从 attitudeScene 移除——
        // 否则切换形态/机型重建后旧模型残留，姿态仪里会出现两个模型。
        runtime.threeView.attitudeScene.remove(runtime.threeView.attitudeDrone);
        disposeThreeObjects(runtime.threeView.attitudeDrone, true);  // 含 GLB 纹理
      }
      // 重建时一并移除并释放上一份姿态球。
      if (runtime.threeView.attitudeReference) {
        runtime.threeView.attitudeScene.remove(runtime.threeView.attitudeReference);
        disposeThreeObjects(runtime.threeView.attitudeReference);
        runtime.threeView.attitudeReference = null;
      }

      runtime.threeView.attitudeDrone = attributeModel;
      runtime.threeView.attitudePropellers = collectPropellers(attributeModel, name);
      const sphere = createAttitudeSphere();
      if (sphere) {
        runtime.threeView.attitudeReference = sphere;
        runtime.threeView.attitudeScene.add(sphere);
      }
      // 本体姿态层（跟随无人机，与世界环叠合显示姿态偏移；与姿态球一起构建/重建）。
      rebuildAttitudeAxes();
      // 风向箭头（世界固连，无风数据时隐藏；方向每帧由 updateWindArrow 更新）。
      rebuildWindArrow();
      runtime.threeView.attitudeScene.add(runtime.threeView.attitudeDrone);
      // 新载入的姿态模型套用当前光照倍率（envMapIntensity 等）。
      applyLighting();
  }

    // 按材质档与配置构造一个材质实例：High=MeshPhysicalMaterial(PBR+清漆)，Medium=MeshLambertMaterial(+自发光底)，
    // Low=MeshBasicMaterial(平涂)。Lambert/Basic 只取 color；Lambert 加 emissive=color*0.05 防阴影面死黑。
  function buildTierMaterial(cfg: MaterialProperties, tier: ThreeMaterialTier): THREE.Material {
      if (tier === 'low') return new THREE.MeshBasicMaterial({ color: cfg.color });
      if (tier === 'medium') {
        return new THREE.MeshLambertMaterial({
          color: cfg.color,
          emissive: new THREE.Color(cfg.color).multiplyScalar(0.05),
        });
      }
      return new THREE.MeshPhysicalMaterial({
        color: cfg.color,
        metalness: cfg.metalness,
        roughness: cfg.roughness,
        clearcoat: cfg.clearcoat,
        clearcoatRoughness: cfg.clearcoatRoughness,
      });
  }

    // 按 tier 重建所有无人机实例（主/姿态/虚影）的材质：从 userData._apmMatConfig 取配置，dispose 旧、按 tier 建新。
    // 仅在 tier 变更(onQualityChange)时调用；模型载入时 applyExtraDroneModel 已按当前 tier 建。
    // 重建后重设虚影半透明、姿态机 Physical 高光参数；失效桨叶压暗缓存；末尾 applyLighting 让 Physical 档恢复金属/envMap。
  function applyMaterialTier(tier: ThreeMaterialTier): void {
      var tv = runtime.threeView;
      if (!tv || !THREE) return;
      tv.materialTier = tier;
      var roots: Array<{ root: THREE.Object3D | undefined | null; isGhost: boolean; isAttitude: boolean }> = [
        { root: tv.drone, isGhost: false, isAttitude: false },
        { root: tv.attitudeDrone, isGhost: false, isAttitude: true },
        { root: tv.ghostDrone, isGhost: true, isAttitude: false },
      ];
      for (var i = 0; i < roots.length; i++) {
        var r = roots[i];
        if (!r.root) continue;
        r.root.traverse(function (child: any) {
          if (!child.isMesh) return;
          var cfg: MaterialProperties | undefined = child.userData._apmMatConfig;
          if (!cfg) return; // 非机身 mesh 保持载入态材质
          // dispose 旧材质（防御 Material | Material[]）
          if (child.material) {
            var oldMats = Array.isArray(child.material) ? child.material : [child.material];
            for (var k = 0; k < oldMats.length; k++) { try { oldMats[k].dispose(); } catch (e) { /* noop */ } }
          }
          // 姿态小模型固定 medium（Lambert）：不走 PBR/envMap，与 loadThreeAttributeDroneModel 一致。
          var m: any = buildTierMaterial(cfg, r.isAttitude ? 'medium' : tier);
          if (r.isGhost) {
            // 虚影覆盖（与 rebuildGhostDrone 一致）：半透明、不写深度。
            m.transparent = true;
            m.opacity = 0.3;
            m.depthWrite = false;
          }
          child.material = m;
          // 桨叶压暗缓存引用了旧材质颜色，失效让其按新材质重建（applyPropellerBlurColor 下次自建）。
          if (child.userData.blurMats) child.userData.blurMats = null;
        });
      }
      applyLighting();
      if (useUiStore().ui.mainView === 'three') renderThreeView();
  }

  function applyExtraDroneModel(gltf: any, scale: { x: number; y: number; z: number }, offsetToCenter: { x: boolean; y: boolean; z: boolean }, name: string): THREE.Group | undefined {
      if (!THREE) return;
      // 归一化管线（材质分配/AABB 居中/base>rotation 层级）抽到共享 normalizeLoadedDroneModel；
      // 此处注入 tier-aware 材质构建器，保持按 render.quality 热切换材质的原行为。
      return normalizeLoadedDroneModel(
        gltf.scene, scale, offsetToCenter, name,
        THREE_MODEL_MATERIAL, BODY_MATERIAL,
        (cfg: MaterialProperties) => buildTierMaterial(cfg, resolveTier(three.value.render.quality)),
      );
  }

  // collectPropellers 已抽到 @/modules/shared/utils/drone-model（与 MapLibre 图层共用），由模块顶部 import 提供。

    // ===== three/playback.ts =====
    // 推进回放时间轴：3D rAF 与地图 rAF 共用的单一推进入口。dt 钳到 250ms 以内，
    // 避免 rAF 拥有者切换/标签页切回时的大跳变。播放时累加 timeMs 并在窗口内回绕。
  function advanceThreePlayback(ts: number): void {
      if (three.value.playback.playing && three.value.telemetry.samples.length) {
        if (!three.value.playback.lastFrameTime) three.value.playback.lastFrameTime = ts;
        var dt = ts - three.value.playback.lastFrameTime;
        if (dt < 0 || dt > 250) dt = 0;
        three.value.playback.lastFrameTime = ts;
        var r = threePlaybackRange.value;
        three.value.playback.timeMs += dt * three.value.playback.rate;
        if (three.value.playback.timeMs > r.max) {
          three.value.playback.timeMs = r.min + ((three.value.playback.timeMs - r.max) % r.span);
        } else if (three.value.playback.timeMs < r.min) {
          three.value.playback.timeMs = r.min;
        }
      } else {
        three.value.playback.lastFrameTime = ts;
      }
  }

  function toggleThreePlayback(): void {
      if (!three.value.telemetry.samples.length) return;
      three.value.playback.playing = !three.value.playback.playing;
      three.value.playback.lastFrameTime = 0;
      if (useUiStore().ui.mainView === 'three') ensureThreeView();
  }

  function onThreeTimelineInput(e: Event): void {
      var r = threePlaybackRange.value;
      var v = parseFloat((e.target as HTMLInputElement).value || '0') / 1000;
      three.value.playback.timeMs = r.min + r.span * v;
      three.value.playback.playing = false;
      updateThreeCurrent();
      renderThreeView();
  }

    // 自定义进度条（div 版）按百分比定位：0..1 → 区间内时间。供指针拖拽/点击跳转复用。
  function seekThreeByPct(pct: number): void {
      var r = threePlaybackRange.value;
      var v = Math.max(0, Math.min(1, pct));
      three.value.playback.timeMs = r.min + r.span * v;
      three.value.playback.playing = false;
      updateThreeCurrent();
      if (useUiStore().ui.mainView === 'three') renderThreeView();
  }

  function formatMetric(value: number | null, unit: string): string {
      if (value === null || value === undefined || !isFinite(value)) return '-';
      var s = Number(value).toFixed(2);
      // 清负零：游标插值 / 单位换算在零附近会产生极小负值，toFixed 会吐 "-0.00"，
      // 与 "0.00" 交替导致面板数值抖动。
      if (s.startsWith('-') && parseFloat(s) === 0) s = s.slice(1);
      return s + ' ' + unit;
  }

    // ===== three/rc.ts =====
  function rcAvailable(): boolean {
      return three.value.current.rcRoll !== null && three.value.current.rcRoll !== undefined;
  }

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

  function rcNorm(pwm: number | null): number | null {
      if (pwm === null || pwm === undefined || !isFinite(pwm)) return null;
      var n = (Number(pwm) - 1000) / 1000; // 1000->0, 1500->0.5, 2000->1
      if (n < 0) n = 0;
      else if (n > 1) n = 1;
      return 12 + n * 76; // 12% .. 88%
  }

  function rcKnobStyleX(pwm: number | null, invert: boolean): { left: string } {
      var n = rcNorm(pwm);
      if (n === null) return { left: '50%' };
      return { left: (invert ? 100 - n : n) + '%' };
  }

  function rcKnobStyleY(pwm: number | null, invert: boolean): { top: string } {
      var n = rcNorm(pwm);
      if (n === null) return { top: '50%' };
      return { top: (invert ? n : 100 - n) + '%' };
  }

  function formatPwm(pwm: number | null): string | number {
      if (pwm === null || pwm === undefined || !isFinite(pwm)) return '-';
      return Math.round(Number(pwm));
  }

  function motorsAvailable(): boolean {
      return (three.value.curves.motor || []).length > 0;
  }

  function currentMotors(): Array<{ label: string; value: any }> {
      var curves = three.value.curves.motor || [];
      var out: Array<{ label: string; value: any }> = [];
      for (var i = 0; i < curves.length; i++) {
        out.push({ label: curves[i].label, value: useCurveManagerStore().getValueAt(curves[i].type, curves[i].field, three.value.playback.timeMs, null) });
      }
      return out;
  }

  // 当前总电压：PX4 按 QGC 公式累加 battery_status.voltage_cell_v[0..13]（float32，单位 V；遇 invalid(0) 即停）；
  // APM 单 volt 字段直读。供飞行面板 __volt__ 虚拟键。缺失返回 null。
  function currentVoltage(): number | null {
      var profile = currentProfile();
      var cm = useCurveManagerStore();
      var t = three.value.playback.timeMs;
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

  function motorBarPct(pwm: number | null): number {
      if (pwm === null || pwm === undefined || !isFinite(pwm)) return 0;
      var n = (Number(pwm) - 1000) / 1000; // 1000->0, 2000->1
      if (n < 0) n = 0;
      else if (n > 1) n = 1;
      return Math.round(n * 100);
  }

  function motorSaturated(pwm: number | null): boolean {
      if (pwm === null || pwm === undefined || !isFinite(pwm)) return false;
      return Number(pwm) >= 2000;
  }

    // ===== three/env.ts =====
    // 工作室 IBL：RoomEnvironment 是一组中性柔光箱 + 顶部点光，PMREMGenerator.fromScene 把它烘焙成预过滤环境贴图。
    // 赋给 scene.environment 后，场景内所有 PBR 材质（金属机身）从任意角度都能获得漫反射 + 高光——
    // 相当于"无限多个柔光源"却只多一次纹理采样，故能替代原先为补暗角堆叠的多盏方向光（方向光只能照亮朝向它的面）。
    // 主/姿态两个 renderer 是独立 WebGL 上下文，纹理不可跨上下文共享，需各烘焙一份。
  function bakeEnv(renderer: THREE.WebGLRenderer | null): THREE.WebGLRenderTarget | null {
      if (!renderer) return null;
      try {
        var pmrem = new THREE.PMREMGenerator(renderer);
        var env = new RoomEnvironment(); // r160：默认 intensity=5，与本项目 useLegacyLights=true 的旧光照模型匹配
        var rt = pmrem.fromScene(env, 0.04);
        pmrem.dispose();
        // RoomEnvironment 内含几何/材质，烘焙完成后释放，避免 WebGL 资源泄漏。
        env.traverse(function (o: any) {
          if (o.geometry) { try { o.geometry.dispose(); } catch (e) { /* noop */ } }
          if (o.material) {
            var mm = o.material;
            if (Array.isArray(mm)) { for (var i = 0; i < mm.length; i++) { try { mm[i].dispose(); } catch (e) { /* noop */ } } }
            else { try { mm.dispose(); } catch (e) { /* noop */ } }
          }
        });
        return rt;
      } catch (e) {
        return null;
      }
  }

  function ensureThreeEnv(): void {
      var tv = runtime.threeView;
      if (!tv || !THREE) return;
      // Low 档不烘焙 IBL（Basic 不采样 envMap，applyLighting 会摘 scene.environment，省启动开销）。
      if (tv.materialTier === 'low') return;
      if (!tv.envRt) {
        tv.envRt = bakeEnv(tv.renderer);
        if (tv.envRt) tv.scene.environment = tv.envRt.texture;
      }
      if (!tv.attitudeEnvRt) {
        tv.attitudeEnvRt = bakeEnv(tv.attitudeRenderer);
        if (tv.attitudeEnvRt) tv.attitudeScene.environment = tv.attitudeEnvRt.texture;
      }
  }

  function disposeThreeEnv(): void {
      var tv = runtime.threeView;
      if (!tv) return;
      if (tv.envRt) { try { tv.envRt.dispose(); } catch (e) { /* noop */ } tv.envRt = null; }
      if (tv.attitudeEnvRt) { try { tv.attitudeEnvRt.dispose(); } catch (e) { /* noop */ } tv.attitudeEnvRt = null; }
      if (tv.scene) tv.scene.environment = null;
      if (tv.attitudeScene) tv.attitudeScene.environment = null;
  }

    // ===== three/sky.ts =====
    // 天空 ShaderMaterial 构造器（天空盒与水面倒影烘焙共用同一份 shader：方向→颜色，含渐变/太阳/云）。
    // 抽出来便于 bakeWaterSkyTex 在天空 mesh 未构建(天空关)时也能即时造一份材质烘焙成立方体贴图。
  function createSkyMaterial(noiseTex: THREE.DataTexture | null, cloud: number): THREE.ShaderMaterial {
      var sunDir = new THREE.Vector3(0.5, 0.78, 0.39).normalize(); // 与主光 keyLight(90,140,70) 同源
      return new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
        uniforms: {
          uTopColor: { value: new THREE.Color(0x2a63c9) },
          uHorizonColor: { value: new THREE.Color(0xc4dcf2) },
          uBottomColor: { value: new THREE.Color(0xd8dde2) },
          uSunDir: { value: sunDir },
          uSunColor: { value: new THREE.Color(0xfff3d6) },
          // 云层：uTime 推进漂移、uCloud 控制云量（每帧由 updateThreeSkyUniforms 同步）；uNoiseTex=预烘焙噪声。
          uTime: { value: 0 },
          uCloud: { value: cloud },
          uNoiseTex: { value: noiseTex }
        },
        vertexShader: [
          'varying vec3 vDir;',
          'void main(){',
          '  vDir = position;',
          '  vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position,1.0);',
          '  p.z = p.w;', // 推到远平面，避免盒子背面被近裁面剔除
          '  gl_Position = p;',
          '}'
        ].join('\n'),
        fragmentShader: [
          'varying vec3 vDir;',
          'uniform vec3 uTopColor;',
          'uniform vec3 uHorizonColor;',
          'uniform vec3 uBottomColor;',
          'uniform vec3 uSunDir;',
          'uniform vec3 uSunColor;',
          'uniform float uTime;',
          'uniform float uCloud;',
          'uniform sampler2D uNoiseTex;', // 预烘焙可平铺 FBM 噪声（替代每片元 5 倍频计算）
          THREE_SKY_COLOR_FN,             // 共享天空颜色函数（与水面反射同源）
          'void main(){',
          '  gl_FragColor = vec4(threeSkyColor(vDir), 1.0);',
          '}'
        ].join('\n')
      });
  }

    // 一次性把天空 shader 烘焙成立方体贴图（CubeCamera 六面采样，云冻结），供水面倒影采样。
    // 天空 mesh 存在则复用其 clone；不存在(天空关)则用 createSkyMaterial 即时造一份。失败返回 null（水面回落到解析天空）。
  function bakeWaterSkyTex(): any {
      var tv = runtime.threeView;
      if (!tv || !tv.renderer || !THREE) return null;
      try {
        if (!tv.skyNoiseTex) tv.skyNoiseTex = bakeSkyNoiseTex();
        var skyMat = createSkyMaterial(tv.skyNoiseTex, three.value.sky.cloud);
        var skyGeom = new THREE.BoxGeometry(1, 1, 1);
        var cubeRT = new THREE.WebGLCubeRenderTarget(256, {
          format: THREE.RGBAFormat,
          generateMipmaps: true,
          minFilter: THREE.LinearMipmapLinearFilter,
          type: THREE.UnsignedByteType,
        });
        var cubeCam = new THREE.CubeCamera(0.1, 1000, cubeRT);
        var tmp = new THREE.Scene();
        tmp.add(new THREE.Mesh(skyGeom, skyMat)); // 共享几何/材质的副本置于临时场景
        cubeCam.update(tv.renderer, tmp);
        skyGeom.dispose();
        skyMat.dispose();
        return cubeRT;
      } catch (e) {
        return null;
      }
  }

    // 程序化天空盒：BoxGeometry + 自定义渐变着色器（蓝紫天顶 → 浅蓝地平线 + 太阳光晕）。
    // 顶点着色器用 mat4(mat3(modelViewMatrix)) 剥离相机平移，使天空始终包络相机（"无限远"），无需每帧重定位；
    // 并把 gl_Position.z 置为 w 推到远平面，避免盒子被近裁面剔除。配合 depthTest/depthWrite 关闭 + renderOrder=-1，
    // 始终先画铺底、不挡场景物体，近似游戏引擎 Skybox。
    // 另用 PMREMGenerator.fromScene 把天空烘焙成 IBL，替代原 royal_esplanade_1k.hdr —— 机身清漆层能反射出天空，且无需任何外部资源。
  function ensureThreeSky(): void {
      var tv = runtime.threeView;
      if (!tv || !THREE || tv.sky) return;

      // 预烘焙可平铺 FBM 噪声纹理（替代 shader 内每片元 5 倍频噪声）；云层改为单次纹理采样。
      if (!tv.skyNoiseTex) tv.skyNoiseTex = bakeSkyNoiseTex();

      // 天空材质抽到 createSkyMaterial（与水面倒影烘焙共用同一份 shader）。
      var skyMat = createSkyMaterial(tv.skyNoiseTex, three.value.sky.cloud);

      var skyGeom = new THREE.BoxGeometry(1, 1, 1);
      var sky = new THREE.Mesh(skyGeom, skyMat);
      sky.frustumCulled = false;
      sky.renderOrder = -1;
      sky.name = 'three-sky';
      tv.sky = sky;
      tv.scene.add(sky);
      // 天空网格本身就是背景，关掉纯色 background 以免多余绘制。
      tv.scene.background = null;

      // 把天空烘焙成 IBL（替代 royal_esplanade_1k.hdr）：临时场景只放一份共享几何/材质的天空副本，
      // fromScene 用内部立方相机采样六面并预过滤。失败则仅保留背景天空、不阻断 3D。
      // Low 档不烘焙天空 IBL（Basic 不采样 envMap、applyLighting 会摘 scene.environment，省启动开销）。
      if (tv.materialTier !== 'low') {
        try {
          var pmrem = new THREE.PMREMGenerator(tv.renderer);
          var skyScene = new THREE.Scene();
          skyScene.add(new THREE.Mesh(skyGeom, skyMat));
          tv.skyEnvRt = pmrem.fromScene(skyScene);
          // scene.environment 的挂载交给 applyLighting 统一决策（天空开→skyEnvRt，否则 envRt），此处不直接赋值，避免互相覆盖。
          pmrem.dispose();
        } catch (e) {
          tv.skyEnvRt = null;
        }
      }
      // 按当前 tier 决定天空形态：Low → 烘焙静态背景(零天空 shader)；其余 → mesh + 噪声 shader(云漂移)。
      applySkyTier(tv.materialTier || 'high');
  }

    // 预烘焙可平铺 FBM 噪声为 DataTexture（单通道 R，RepeatWrapping）。
    // 与旧天空 shader 同款 5 倍频 value noise，但用周期化整数格点保证纹理无缝；shader 内云层改为一次纹理采样。
  function bakeSkyNoiseTex(): THREE.DataTexture | null {
      if (!THREE) return null;
      var N = THREE_SKY_NOISE_SIZE;
      // 整数 hash → [0,1)
      var hash2 = function (ix: number, iy: number): number {
        var h = (ix * 374761393 + iy * 668265263) | 0;
        h = ((h ^ (h >> 13)) * 1274126177) | 0;
        h = (h ^ (h >> 16)) >>> 0;
        return h / 4294967296;
      };
      // 可平铺 2D value noise：f=每 tile 的格数；整数格点按 f 取模保证无缝。
      var vnoiseTile = function (u: number, v: number, f: number): number {
        var x = u * f, y = v * f;
        var ix = Math.floor(x), iy = Math.floor(y);
        var fx = x - ix, fy = y - iy;
        var fxs = fx * fx * (3 - 2 * fx), fys = fy * fy * (3 - 2 * fy);
        ix = ((ix % f) + f) % f; iy = ((iy % f) + f) % f;
        var ix1 = (ix + 1) % f, iy1 = (iy + 1) % f;
        var v00 = hash2(ix, iy), v10 = hash2(ix1, iy), v01 = hash2(ix, iy1), v11 = hash2(ix1, iy1);
        var a = v00 + (v10 - v00) * fxs;
        var b = v01 + (v11 - v01) * fxs;
        return a + (b - a) * fys;
      };
      // 5 倍频 fbm：基频 4 格/tile，倍频 4/8/16/32/64 均整除 256 → 全可平铺。
      var fbmTile = function (u: number, v: number): number {
        var val = 0, a = 0.5, f = 4;
        for (var o = 0; o < 5; o++) { val += a * vnoiseTile(u, v, f); f *= 2; a *= 0.5; }
        return val;
      };
      // 先用 Float 收集 fbm 并记录 min/max，再归一化到 [0,1] —— 避免 value-noise fbm 集中在 ~0.48
      // 导致 smoothstep(0.5,0.92) 几乎全 0（云消失）。归一化后阈值约落在中位，云覆盖率合理。
      var raw = new Float32Array(N * N);
      var mn = Infinity, mx = -Infinity;
      for (var py = 0; py < N; py++) {
        for (var px = 0; px < N; px++) {
          var c = fbmTile((px + 0.5) / N, (py + 0.5) / N);
          raw[py * N + px] = c;
          if (c < mn) mn = c;
          if (c > mx) mx = c;
        }
      }
      var range = (mx - mn) || 1;
      // RGBA 灰度（rgb 复用同一噪声值、a=255）：规避 RedFormat 在某些驱动/GLSL 组合下采样异常。
      var data = new Uint8Array(N * N * 4);
      for (var i = 0; i < N * N; i++) {
        var n = (raw[i] - mn) / range;
        if (n < 0) n = 0; else if (n > 1) n = 1;
        var b = Math.round(n * 255);
        data[i * 4] = b; data[i * 4 + 1] = b; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
      }
      var tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.flipY = false;
      tex.needsUpdate = true;
      return tex;
  }

    // Low 档天空：把天空 mesh 一次性渲染成立方体纹理 → scene.background，隐藏 mesh（零天空 shader、云冻结）。
  function bakeSkyBackground(): void {
      var tv = runtime.threeView;
      if (!tv || !tv.renderer || !tv.sky || !THREE) return;
      try {
        var cubeRT = new THREE.WebGLCubeRenderTarget(256, {
          format: THREE.RGBAFormat,
          generateMipmaps: true,
          minFilter: THREE.LinearMipmapLinearFilter,
          type: THREE.UnsignedByteType,
        });
        var cubeCam = new THREE.CubeCamera(0.1, 1000, cubeRT);
        var tmp = new THREE.Scene();
        tmp.add(tv.sky.clone()); // 共享几何/材质的副本置于临时场景，立方相机采样六面
        cubeCam.update(tv.renderer, tmp);
        tv.skyBackgroundTex = cubeRT;
        tv.scene.background = cubeRT.texture;
        tv.sky.visible = false; // 背景接管，停 mesh 绘制
      } catch (e) {
        /* 烘焙失败则保留 mesh 天空，不阻断 */
      }
  }

    // 按 tier 切换天空形态：Low → 静态背景(烘焙)；其余 → mesh + 噪声 shader。仅天空开启时生效。
  function applySkyTier(tier: ThreeMaterialTier): void {
      var tv = runtime.threeView;
      if (!tv || !tv.sky) return;
      if (!three.value.sky.enabled) return; // 天空关：背景由 onSkyToggle 管理，此处不碰
      if (tier === 'low') {
        if (!tv.skyBackgroundTex) bakeSkyBackground();
      } else if (tv.skyBackgroundTex) {
        // 回到 mesh 天空：移除静态背景、显 mesh（ensureThreeSky 已置 scene.background=null 由 mesh 接管）。
        try { tv.skyBackgroundTex.dispose(); } catch (e) { /* noop */ }
        tv.skyBackgroundTex = null;
        tv.scene.background = null;
        tv.sky.visible = true;
      }
      // 仅在视图就绪（相机已建）时刷新：ensureThreeSky 在 createThreeView 相机创建之前被调用，
      // 此时跳过，由 ensureThreeView 末尾的 renderThreeView 统一刷新。
      if (tv.activeCamera && useUiStore().ui.mainView === 'three') renderThreeView();
  }

  function disposeThreeSky(): void {
      var tv = runtime.threeView;
      if (!tv) return;
      if (tv.sky) {
        try { tv.scene.remove(tv.sky); } catch (e) { /* noop */ }
        if (tv.sky.geometry) { try { tv.sky.geometry.dispose(); } catch (e) { /* noop */ } }
        if (tv.sky.material) { try { tv.sky.material.dispose(); } catch (e) { /* noop */ } }
        tv.sky = null;
      }
      if (tv.skyEnvRt) { try { tv.skyEnvRt.dispose(); } catch (e) { /* noop */ } tv.skyEnvRt = null; }
      // 地面现由 grid group 拥有（createThreeGrid），不随天空销毁；此处只释放天空专属资源。
      if (tv.skyNoiseTex) { try { tv.skyNoiseTex.dispose(); } catch (e) { /* noop */ } tv.skyNoiseTex = null; }
      if (tv.skyBackgroundTex) { try { tv.skyBackgroundTex.dispose(); } catch (e) { /* noop */ } tv.skyBackgroundTex = null; }
  }

    // ===== three/water.ts =====
    // 水面：单 pass 程序化反射。天空盒本身是计算的(方向→颜色)，水面用反射方向 R=reflect(-V,N) 复算同一
    // threeSkyColor 函数 → 直接得到该处水面应反射的天色，无需 RTT/planar reflection；无人机不进反射(零额外 draw call)。
    // 涟漪 = 复用 skyNoiseTex 在世界 XZ 做有限差分求高度场梯度 → 法线扰动(噪声图作为法线扰动)；uTime 漂移 = 动起来。
    // 菲涅尔(掠射更反光/俯视透水色) + 太阳 Blinn-Phong 粼光 + 远处淡入地平线天色 → 无缝水天交界(消除地面硬边)。
  function ensureThreeWater(): void {
      var tv = runtime.threeView;
      if (!tv || !THREE || tv.water) return;
      // 复用天空噪声纹理(涟漪法线 + 云反射共用)；天空未构建时即时烘焙一份。
      if (!tv.skyNoiseTex) tv.skyNoiseTex = bakeSkyNoiseTex();
      // 烘焙天空到立方体贴图(一次性，云冻结)：水面用反射方向采样 + 法线扰动 → 廉价倒影；失败则回落解析天空。
      tv.waterSkyTex = bakeWaterSkyTex();
      var skyTex = tv.waterSkyTex ? tv.waterSkyTex.texture : null;

      var sunDir = new THREE.Vector3(0.5, 0.78, 0.39).normalize(); // 与天空/主光同源
      var waterMat = new THREE.ShaderMaterial({
        uniforms: {
          // 共享天空 uniform（与天空盒同名 → threeSkyColor 直接复用，倒影与实天空逐像素一致）
          uTopColor: { value: new THREE.Color(0x2a63c9) },
          uHorizonColor: { value: new THREE.Color(0xc4dcf2) },
          uBottomColor: { value: new THREE.Color(0xd8dde2) },
          uSunDir: { value: sunDir },
          uSunColor: { value: new THREE.Color(0xfff3d6) },
          uTime: { value: 0 },
          uCloud: { value: three.value.sky.cloud },
          uNoiseTex: { value: tv.skyNoiseTex },
          // 水面专属
          uWave: { value: three.value.water.wave },
          uDeepColor: { value: new THREE.Color(THREE_WATER_DEEP_COLOR) },
          uShallowColor: { value: new THREE.Color(THREE_WATER_SHALLOW_COLOR) },
          // 自带相机/平面世界坐标 uniform：不依赖 Three 自动注入的 cameraPosition/modelMatrix
          // （该版本对 ShaderMaterial 片元 cameraPosition 注入不稳，曾致着色器编译失败 → 水面不绘制）。
          uCamPos: { value: new THREE.Vector3() },
          uPlanePos: { value: new THREE.Vector3() },
          // 倒影：预烘焙天空立方体贴图 + 开关（烘焙失败时 uUseSkyTex=0，回落解析天空 threeSkyColor）。
          uSkyTex: { value: skyTex },
          uUseSkyTex: { value: skyTex ? 1.0 : 0.0 }
        },
        vertexShader: [
          'varying vec3 vWorldPos;',
          'uniform vec3 uPlanePos;', // 平面世界位移(=mesh.position)；几何已 rotateX 烘焙到 XZ，mesh 无旋转
          'void main(){',
          '  vWorldPos = position + uPlanePos;', // 世界坐标 = 顶点(已烘焙朝向) + 平面位移
          '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
          '}'
        ].join('\n'),
        fragmentShader: [
          'varying vec3 vWorldPos;',
          'uniform vec3 uTopColor;',
          'uniform vec3 uHorizonColor;',
          'uniform vec3 uBottomColor;',
          'uniform vec3 uSunDir;',
          'uniform vec3 uSunColor;',
          'uniform float uTime;',
          'uniform float uCloud;',
          'uniform sampler2D uNoiseTex;',
          'uniform float uWave;',
          'uniform vec3 uDeepColor;',
          'uniform vec3 uShallowColor;',
          'uniform vec3 uCamPos;', // 相机世界坐标(每帧由 alignThreeWater 写入)
          'uniform samplerCube uSkyTex;', // 预烘焙天空立方体贴图(倒影源)
          'uniform float uUseSkyTex;',    // 1=采样纹理，0=解析天空(烘焙失败回落)
          THREE_SKY_COLOR_FN, // 共享天空颜色函数（烘焙失败时回落用）
          // 平缓涟漪(小河感)：几组低频正弦叠加 → 连续柔和起伏。刻意不采样噪声纹理，
          // 避免高频噪声在远处因平铺走样成"颗粒凸起"。
          // 频率刻意取互不可约值(0.143/0.181/0.097/0.223，非同一小数的整数倍)——否则合成场会有
          // 有限宏观周期(如旧 0.14/0.18/0.10/0.22 同为 0.02 倍→周期 ~314 单位)→ 肉眼可见"一块一块"规则平铺。
          // 多加一档离轴(非 0/90/±45°)小振幅细节，进一步打破栅格感。扰动随距离衰减见下(distFade)。
          'float waveH(vec2 p){',
          '  float t = uTime;',
          '  float w = 0.0;',
          '  w += sin(p.x * 0.143 + t * 0.90) * 0.50;',
          '  w += sin(p.y * 0.181 - t * 0.70) * 0.40;',
          '  w += sin((p.x + p.y) * 0.097 + t * 0.50) * 0.35;',
          '  w += sin((p.x - p.y) * 0.223 + t * 0.80) * 0.20;',
          '  w += sin((p.x * 1.30 + p.y * 0.70) * 0.183 - t * 0.60) * 0.15;',
          '  return w;',
          '}',
          'void main(){',
          '  float dist = length(uCamPos - vWorldPos);',
          // 扰动按「点到相机距离」衰减：近处明显涟漪 → 远处完全平静(镜面反射天空)，近似真实海面。
          // NEAR 内全幅、NEAR→FAR 平滑衰减到 0；远处淡入天色(见下)前水面早已平静 → 过渡自然。
          '  float distFade = 1.0 - smoothstep(float(' + THREE_WATER_WAVE_NEAR + '), float(' + THREE_WATER_WAVE_FAR + '), dist);',
          // 法线扰动：正弦高度场有限差分(步长较大→低频柔和法线) → 轻微倾斜，把倒影打碎成涟漪。
          '  float e = 2.0;',
          '  float h0 = waveH(vWorldPos.xz);',
          '  float hx = waveH(vWorldPos.xz + vec2(e, 0.0));',
          '  float hz = waveH(vWorldPos.xz + vec2(0.0, e));',
          '  float amp = uWave * ' + THREE_WATER_WAVE_AMP + ' * distFade;',
          '  vec3 N = normalize(vec3((h0 - hx) * amp, 1.0, (h0 - hz) * amp));',
          '  vec3 V = normalize(uCamPos - vWorldPos);',
          '  vec3 R = reflect(-V, N);',
          // 倒影：优先采样预烘焙天空立方体贴图(法线扰动已打碎倒影=涟漪)；烘焙失败回落解析天空。
          '  vec3 sky;',
          '  if (uUseSkyTex > 0.5) {',
          '    sky = textureCube(uSkyTex, R).rgb;',
          '  } else {',
          '    sky = threeSkyColor(R);',
          '  }',
          // Schlick 菲涅尔：掠射→全反射天色，俯视→透水体本色。指数3+高 FRESNEL0 → 大多数角度反射占主导(近镜面)。
          '  float f = ' + THREE_WATER_FRESNEL0 + ' + (1.0 - ' + THREE_WATER_FRESNEL0 + ') * pow(1.0 - max(dot(V, N), 0.0), 3.0);',
          '  vec3 water = mix(uDeepColor, uShallowColor, clamp(N.y - 0.6, 0.0, 1.0) * 2.0);', // 偏向更亮的浅色
          '  vec3 col = mix(water, sky, clamp(f, 0.0, 1.0));',
          // 太阳水面粼光：扰动法线把高光碎成粼光；远处随 distFade 衰减，避免远方亮斑。
          '  vec3 H = normalize(uSunDir + V);',
          '  col += uSunColor * (pow(max(dot(N, H), 0.0), float(' + THREE_WATER_SHININESS + ')) * ' + THREE_WATER_GLINT + ') * distFade;',
          // 地平线淡入按俯角(depression=sin 俯角，与相机高度无关)：高空俯视正下方仍水色、仅地平线带融天色 →
          // 任意相机距离/轨迹尺度水都可见。旧按绝对距离 [1000,3000] 淡入时，大航线相机拉远后正下方水面距离超阈值会被整片淡成天色「看不到」。
          '  float depression = clamp((uCamPos.y - vWorldPos.y) / max(dist, 1e-4), 0.0, 1.0);',
          '  col = mix(col, uHorizonColor, 1.0 - smoothstep(float(' + THREE_WATER_HORIZON_FADE_SKY + '), float(' + THREE_WATER_HORIZON_FADE_WATER + '), depression));',
          '  gl_FragColor = vec4(col, 1.0);',
          '}'
        ].join('\n'),
        transparent: false,
        depthWrite: false,
        // 水面不写深度：地面在其后绘制(renderOrder 更高)按画家算法直接盖掉水面颜色，重叠区不做深度比较 →
        // 彻底消除高空/远距离深度精度不足导致的地面↔水面 z-fight 闪烁（两个共面层都写深度时，精度会让二者逐像素随机胜负）。
        // depthTest 仍开：水面与先绘制的无人机/线条等(写深度者)保持正确遮挡，只是不留自己的深度给地面去比。
        side: THREE.FrontSide, // 仅渲染朝上的正面（+Y），与地面一致
        fog: false,
        toneMapped: false
      });

      // 旋转烘焙进几何（rotateX 返回 this）：mesh 无旋转 → 顶点局部坐标即世界朝向，
      // 顶点着色器里 vWorldPos = position + uPlanePos 才正确（无需 modelMatrix）。
      var waterGeom = new THREE.PlaneGeometry(THREE_WATER_SIZE, THREE_WATER_SIZE).rotateX(-Math.PI / 2);
      var water = new THREE.Mesh(waterGeom, waterMat);
      // mesh.rotation 不设(已烘焙)；position 由 alignThreeWater 每帧对齐：相机 XZ + grid 的 Y(下沉到机身底部)。
      water.frustumCulled = false;     // 每帧钉到相机 XZ，AABB 不稳；关裁剪保始终绘制
      water.renderOrder = 1;           // 先于地面(ground=2)绘制：水面画完(不写深度)→ 地面后画直接覆盖重叠区(画家算法，无 z-fight)
      water.name = 'three-water';
      tv.water = water;
      tv.scene.add(water);
      alignThreeWater();
      // 不在此处 renderThreeView：createThreeView 在相机创建之前调用本函数，渲染会经 resizeThreeView
      // 读未建相机的 aspect 而崩。渲染交给调用方——createThreeView 末尾 applyLighting、onWaterToggle 末尾均会渲染。
  }

  function disposeThreeWater(): void {
      var tv = runtime.threeView;
      if (!tv || !tv.water) return;
      try { tv.scene.remove(tv.water); } catch (e) { /* noop */ }
      if (tv.water.geometry) { try { tv.water.geometry.dispose(); } catch (e) { /* noop */ } }
      if (tv.water.material) { try { tv.water.material.dispose(); } catch (e) { /* noop */ } }
      tv.water = null;
      if (tv.waterSkyTex) { try { tv.waterSkyTex.dispose(); } catch (e) { /* noop */ } tv.waterSkyTex = null; }
  }

    // 每帧对齐水面：钉到相机 XZ（infinite-ocean 技巧）+ 与 grid 同高(下沉到机身底部) + 同步自带相机/平面 uniform。
  function alignThreeWater(): void {
      var tv = runtime.threeView;
      if (!tv || !tv.water) return;
      var cam = tv.activeCamera || tv.perspectiveCamera;
      if (!cam) return;
      tv.water.position.x = cam.position.x;
      tv.water.position.z = cam.position.z;
      // 水面略低于地面：地面在 grid.position.y(机身底部)，水面再下沉机身半高的 25%，给出一道可见台阶。
      // 反 z-fight 由「水面 depthWrite:false + 地面后绘制(画家算法)」负责(见 ensureThreeWater)，此间隙只管近处台阶观感。
      // 不抬地面 → 不会把无人机半埋(机身已被归一化到很小)。
      if (tv.grid) tv.water.position.y = tv.grid.position.y - (tv.droneHalfHeight || 0) * 0.25;
      // 自带 uniform：相机世界坐标 + 平面世界位移(=mesh.position，与 modelMatrix 平移一致)。
      var u = tv.water.material && tv.water.material.uniforms;
      if (u) {
        u.uCamPos.value.copy(cam.position);
        u.uPlanePos.value.set(tv.water.position.x, tv.water.position.y, tv.water.position.z);
      }
  }

    // 水面 uniform 每帧推进：uTime 驱动涟漪漂移(与回放无关)、uWave 实时同步滑杆、uCloud 同步云量(倒影与天空一致)。
  function updateThreeWaterUniforms(ts: number): void {
      var tv = runtime.threeView;
      if (!tv || !tv.water || !tv.water.material) return;
      var u = tv.water.material.uniforms;
      if (!u) return;
      u.uTime.value = (ts || 0) / 1000;
      u.uWave.value = three.value.water.wave;
      u.uCloud.value = three.value.sky.cloud;
  }


    // ===== three/postprocessing.ts =====
    // 主视图统一后处理链：RenderPass → [SSAOPass] → [FXAA ShaderPass] → OutputPass。
    // FXAA(默认) 或 SSAO 任一开启即走 composer；各 pass 用 enabled 开关，运行时切 FXAA/SSAO 无需重建视图。
    // OutputPass 恒定收尾：负责 linear→sRGB + tone mapping 写屏（FXAAShader 不做色彩转换，必须由 OutputPass 编码，否则画面发暗）。
    // 主透视相机 perspectiveCamera 在 normal/lock/fps 间是同一实例、仅位姿变，故构建时绑定一次。
  function ensureMainComposer(): void {
      var tv = runtime.threeView;
      if (!tv || !tv.renderer || !tv.scene || !tv.perspectiveCamera) return;
      if (tv.mainComposer) return;
      var w = Math.max(1, tv.mainEl.clientWidth);
      var h = Math.max(1, tv.mainEl.clientHeight);
      var composer = new EffectComposer(tv.renderer);
      var renderPass = new RenderPass(tv.scene, tv.perspectiveCamera);
      var ssaoPass = new SSAOPass(tv.scene, tv.perspectiveCamera, w, h);
      ssaoPass.output = SSAOPass.OUTPUT.Default; // 美图 × AO
      var fxaaPass = new ShaderPass(FXAAShader);
      var outputPass = new OutputPass();
      composer.addPass(renderPass);
      composer.addPass(ssaoPass);
      composer.addPass(fxaaPass);
      composer.addPass(outputPass);
      // 自定义标记位：跟踪上次 setSize 的尺寸与 SSAO 是否已按机型校准（挂在 composer 上 any）。
      composer._apmW = 0;
      composer._apmH = 0;
      composer._apmCalibrated = false;
      tv.mainComposer = composer;
      tv.mainRenderPass = renderPass;
      tv.mainSsaoPass = ssaoPass;
      tv.mainFxaaPass = fxaaPass;
      tv.mainOutputPass = outputPass;
      // 首次构建即按 drawing buffer 对齐 RT + FXAA uniform（resizeThreeView 每帧也会同步）。
      syncMainComposerSize();
  }

    // 按 main.aa / view.ssao 置主 composer 各 pass 的 enabled：末端 OutputPass 恒开。
  function syncMainComposerPasses(): void {
      var tv = runtime.threeView;
      if (!tv || !tv.mainComposer) return;
      if (tv.mainSsaoPass) tv.mainSsaoPass.enabled = !!three.value.view.ssao;
      if (tv.mainFxaaPass) tv.mainFxaaPass.enabled = three.value.render.main.aa === 'fxaa';
  }

    // 主 composer RT 钉到 drawing buffer 尺寸（= cssW × pixelRatio），FXAA resolution uniform 同步。
    // 仅尺寸变化时 setSize（render target 重分配昂贵；每帧调用故做缓存比对）。
  function syncMainComposerSize(): void {
      var tv = runtime.threeView;
      if (!tv || !tv.renderer || !tv.mainComposer) return;
      var canvas = tv.renderer.domElement;
      var dbW = Math.max(1, canvas.width || 1);
      var dbH = Math.max(1, canvas.height || 1);
      if (tv.mainComposer._apmW !== dbW || tv.mainComposer._apmH !== dbH) {
        tv.mainComposer.setSize(dbW, dbH);
        tv.mainComposer._apmW = dbW;
        tv.mainComposer._apmH = dbH;
      }
      if (tv.mainFxaaPass) tv.mainFxaaPass.material.uniforms['resolution'].value.set(1 / dbW, 1 / dbH);
  }

    // 首次拿到无人机模型后，按其世界包围球校准 SSAO 采样半径（场景为 GPS 米制，机身经缩放后仅几单位，
    // upstream 默认 kernelRadius=8 会让采样飞离表面、AO 失效）。取包围球对角线的 8% 作半径，仅校准一次。
  function calibrateMainSsao(): void {
      var tv = runtime.threeView;
      if (!tv || !tv.mainComposer || tv.mainComposer._apmCalibrated || !tv.drone) return;
      var box = new THREE.Box3().setFromObject(tv.drone);
      if (isFinite(box.min.x) && box.max.x > box.min.x) {
        var size = box.getSize(new THREE.Vector3()).length();
        if (tv.mainSsaoPass) tv.mainSsaoPass.kernelRadius = Math.max(0.05, size * 0.08);
        tv.mainComposer._apmCalibrated = true;
      }
  }

  function toggleThreeSsao(): void {
      three.value.view.ssao = !three.value.view.ssao;
      // SSAO 开启需要 composer；视图内即构建（pass.enabled 由下帧 renderThreeView→syncMainComposerPasses 置位）。
      if (three.value.view.ssao && useUiStore().ui.mainView === 'three') {
        ensureThreeView();
        ensureMainComposer();
      }
  }

    // 姿态仪后处理链：RenderPass → [FXAA ShaderPass] → OutputPass（无 SSAO，画布小）。attitude.aa==='fxaa' 时走 composer。
  function ensureAttitudeComposer(): void {
      var tv = runtime.threeView;
      if (!tv || !tv.attitudeRenderer || !tv.attitudeScene || !tv.attitudeCamera) return;
      if (tv.attitudeComposer) return;
      var composer = new EffectComposer(tv.attitudeRenderer);
      var renderPass = new RenderPass(tv.attitudeScene, tv.attitudeCamera);
      var fxaaPass = new ShaderPass(FXAAShader);
      var outputPass = new OutputPass();
      composer.addPass(renderPass);
      composer.addPass(fxaaPass);
      composer.addPass(outputPass);
      composer._apmW = 0;
      composer._apmH = 0;
      tv.attitudeComposer = composer;
      tv.attitudeRenderPass = renderPass;
      tv.attitudeFxaaPass = fxaaPass;
      tv.attitudeOutputPass = outputPass;
      syncAttitudeComposerSize();
  }

  function syncAttitudeComposerPasses(): void {
      var tv = runtime.threeView;
      if (!tv || !tv.attitudeComposer) return;
      // 姿态仪仅 FXAA 可开关（OutputPass 恒开）。
      if (tv.attitudeFxaaPass) tv.attitudeFxaaPass.enabled = three.value.render.attitude.aa === 'fxaa';
  }

  function syncAttitudeComposerSize(): void {
      var tv = runtime.threeView;
      if (!tv || !tv.attitudeRenderer || !tv.attitudeComposer) return;
      var canvas = tv.attitudeRenderer.domElement;
      var dbW = Math.max(1, canvas.width || 1);
      var dbH = Math.max(1, canvas.height || 1);
      if (tv.attitudeComposer._apmW !== dbW || tv.attitudeComposer._apmH !== dbH) {
        tv.attitudeComposer.setSize(dbW, dbH);
        tv.attitudeComposer._apmW = dbW;
        tv.attitudeComposer._apmH = dbH;
      }
      if (tv.attitudeFxaaPass) tv.attitudeFxaaPass.material.uniforms['resolution'].value.set(1 / dbW, 1 / dbH);
  }

    // 销毁后处理资源（主/姿态 composer 与各 pass 的 render target/材质），由 destroyThreeView 调用，避免 WebGL 泄漏。
  function disposeThreePostfx(): void {
      var tv = runtime.threeView;
      if (!tv) return;
      if (tv.mainComposer) { try { tv.mainComposer.dispose(); } catch (e) { /* noop */ } }
      if (tv.mainSsaoPass) { try { tv.mainSsaoPass.dispose(); } catch (e) { /* noop */ } }
      tv.mainComposer = null; tv.mainRenderPass = null; tv.mainSsaoPass = null; tv.mainFxaaPass = null; tv.mainOutputPass = null;
      if (tv.attitudeComposer) { try { tv.attitudeComposer.dispose(); } catch (e) { /* noop */ } }
      tv.attitudeComposer = null; tv.attitudeRenderPass = null; tv.attitudeFxaaPass = null; tv.attitudeOutputPass = null;
  }

    // ===== three/telemetry.ts =====
  function ensureThreeTelemetry(): void {
      if (three.value.telemetry.loaded || three.value.telemetry.loading) return;
      loadThreeTelemetry();
      loadDroneModel();
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

  function onThreeAttitudeSourceChange(): void {
      // 姿态源切换：attitudeCurves 已预载所有源，updateThreeCurrent 实时按新源取值(liveAttitude)，
      // 不再重载遥测、不重置播放位置。遥测尚未加载时走原加载流程。
      if (!three.value.telemetry.loaded) ensureThreeTelemetry();
  }

  function onThreePositionSourceChange(): void {
      // 位置源切换改变轨迹几何(x/y/z)，重新抓取 lat/lng/alt 曲线并重建采样。
      // 不重置播放时刻与相机：buildThreeSamples 保留当前 timeMs；相机角度保持，网格/缩放由
      // updateThreeSceneData→fitThreeCamera 按新 maxRadius 自适应（int32+飞点清洗后尺度已正常）。
      if (runtime.threeView) runtime.threeView.pathKey = '';
      three.value.telemetry.loaded = false;
      ensureThreeTelemetry();
  }

    // ===== 姿态(实时取值) =====
    // 预载所有姿态源(ahr2/att/attDes)的 roll/pitch/yaw 曲线解析结果 → runtime.attitudeCurves。
    // 之后主/虚影无人机都实时按源取值(liveAttitude)，切换源零开销、不重载遥测/不重置播放。走 CurveManager 全局缓存。
  async function loadAttitudeCurves(): Promise<void> {
      var tv = runtime.threeView;
      if (!tv) return;
      var presets = threeAttitudePresets();
      var cm = useCurveManagerStore();
      var out: Record<string, AttitudeLive> = {};
      var fetches: Promise<any>[] = [];
      for (var key in presets) {
        var p = presets[key];
        if (p.kind === 'quat' && p.quat) {
          // PX4：四元数 q[0..3]，存 quat；liveAttitude 实时 quatToEulerDeg 折成欧拉。
          var qs = [
            findTelemetryCurve([p.quat[0].type], [p.quat[0].field]),
            findTelemetryCurve([p.quat[1].type], [p.quat[1].field]),
            findTelemetryCurve([p.quat[2].type], [p.quat[2].field]),
            findTelemetryCurve([p.quat[3].type], [p.quat[3].field]),
          ];
          if (qs[0] && qs[1] && qs[2] && qs[3]) {
            out[key] = { kind: 'quat', q: [qs[0], qs[1], qs[2], qs[3]] };
            for (var qi = 0; qi < 4; qi++) fetches.push(cm.get(qs[qi].type, qs[qi].field).catch(function () { return null as any; }));
          }
        } else if (p.roll && p.pitch && p.yaw) {
          // APM：欧拉角 roll/pitch/yaw，角度插值。
          var roll = findTelemetryCurve([p.roll.type], [p.roll.field]);
          var pitch = findTelemetryCurve([p.pitch.type], [p.pitch.field]);
          var yaw = findTelemetryCurve([p.yaw.type], [p.yaw.field]);
          if (roll && pitch && yaw) {
            out[key] = { kind: 'euler', roll: roll, pitch: pitch, yaw: yaw };
            fetches.push(cm.get(roll.type, roll.field).catch(function () { return null as any; }));
            fetches.push(cm.get(pitch.type, pitch.field).catch(function () { return null as any; }));
            fetches.push(cm.get(yaw.type, yaw.field).catch(function () { return null as any; }));
          }
        }
      }
      await Promise.all(fetches);
      tv.attitudeCurves = out;
      // 风数据源：DCM.VWN/VWE/VWD 优先(含 VWD → 3D 风向量)；缺则 XKF2.VWN/VWE(无 VWD → 退化为水平方向)。N/E 同源。
      var wn = findTelemetryCurve(['DCM'], ['VWN']);
      var we = findTelemetryCurve(['DCM'], ['VWE']);
      var wd = findTelemetryCurve(['DCM'], ['VWD']);
      if (!wn || !we) { wn = findTelemetryCurve(['XKF2'], ['VWN']); we = findTelemetryCurve(['XKF2'], ['VWE']); wd = null; }
      if (wn && we) {
        var wFetches: Promise<any>[] = [
          cm.get(wn.type, wn.field).catch(function () { return null as any; }),
          cm.get(we.type, we.field).catch(function () { return null as any; }),
        ];
        if (wd) wFetches.push(cm.get(wd.type, wd.field).catch(function () { return null as any; }));
        await Promise.all(wFetches);
        tv.windCurves = { n: wn, e: we, d: wd };
      } else {
        tv.windCurves = null;
      }
  }

    // 仅释放虚影的克隆材质；几何与主无人机共享，不可 dispose(否则毁主无人机)。
  function disposeGhostMaterials(obj: THREE.Object3D | null): void {
      if (!obj) return;
      obj.traverse(function (child: any) {
        if (child.material) {
          var m = child.material;
          if (Array.isArray(m)) { for (var i = 0; i < m.length; i++) { try { m[i].dispose(); } catch (e) {} } }
          else { try { m.dispose(); } catch (e) {} }
        }
      });
  }

    // 重建虚影：克隆主无人机、材质改半透明。位置/缩放随主无人机，方向由 applyGhostPose 每帧设。
  function rebuildGhostDrone(): void {
      var tv = runtime.threeView;
      if (!tv || !THREE) return;
      if (tv.ghostDrone) {
        tv.scene.remove(tv.ghostDrone);
        disposeGhostMaterials(tv.ghostDrone);
        tv.ghostDrone = null;
      }
      if (!three.value.view.compareAttitude || !tv.drone) return;
      var ghost = tv.drone.clone(true);
      ghost.traverse(function (child: any) {
        if (child.isMesh && child.material) {
          var src = Array.isArray(child.material) ? child.material[0] : child.material;
          var m = src.clone();
          m.transparent = true;
          m.opacity = 0.3;
          m.depthWrite = false;
          child.material = m;
        }
      });
      ghost.name = 'ghost-drone';
      tv.ghostDrone = ghost;
      tv.scene.add(ghost);
  }

    // 开关姿态对比：开 → 建虚影(姿态曲线已由 loadAttitudeCurves 预载)；关 → 移除虚影。
  function onCompareAttitudeToggle(): void {
      var tv = runtime.threeView;
      if (three.value.view.compareAttitude) {
        rebuildGhostDrone();
      } else if (tv && tv.ghostDrone) {
        tv.scene.remove(tv.ghostDrone);
        disposeGhostMaterials(tv.ghostDrone);
        tv.ghostDrone = null;
      }
  }

    // 切换第二姿态源：实时按 attitudeCurves 取值，无需重载。
  function onCompareSourceChange(): void {
      // no-op：liveAttitude 每帧按 compareSource 取值。
  }

  function resetThreeTelemetry(): void {
      three.value.playback.playing = false;
      three.value.telemetry.loaded = false;
      three.value.telemetry.samples = [];
      three.value.telemetry.meta = {};
      three.value.mission.versions = null;
      three.value.current = { speed: null, verticalSpeed: null, altitude: null, baroAlt: null, rcRoll: null, rcPitch: null, rcThrottle: null, rcYaw: null, x: null, y: null, z: null, north: null, east: null, down: null };
      three.value.curves.volt = [];
      three.value.curves.motor = [];
      three.value.rc.invert = { roll: false, pitch: false };
      three.value.playback.timeMs = 0;
      three.value.view.cameraSeeded = false;
      three.value.view.lockSeeded = false;
      three.value.telemetry.error = '';
      destroyThreeView();
  }

  // 换日志/换格式后校正姿态/位置/对比源：若当前选中 key 不在新格式 profile 的源列表里，回退到 profile 默认。
  // 保证下拉总有合法选中项（如 APM→PX4 时 'ahr2' 不存在 → 改 'vehicle_attitude'）。在 log.ts applyLoadedLog 调用。
  function resetSourceSelection(): void {
      var profile = currentProfile();
      var aSrcs = profile.attitudeSources || [];
      var pSrcs = profile.positionSources || [];
      var aKeys = aSrcs.map(function (s) { return s.key; });
      var pKeys = pSrcs.map(function (s) { return s.key; });
      if (aKeys.indexOf(three.value.view.attitudeSource) < 0) three.value.view.attitudeSource = profile.defaultAttitude || aKeys[0] || '';
      if (pKeys.indexOf(three.value.view.positionSource) < 0) three.value.view.positionSource = profile.defaultPosition || pKeys[0] || '';
      if (aKeys.indexOf(three.value.view.compareSource) < 0) {
        // 对比源默认：首个期望(isDesired)源，否则主姿态源。
        var des = aSrcs.filter(function (s) { return s.isDesired; })[0];
        three.value.view.compareSource = des ? des.key : (profile.defaultAttitude || aKeys[0] || '');
      }
  }

  // 当前位置源的高度是否为绝对海拔(MSL)。PX4 vehicle_global_position.alt 是 MSL→地图直接定位、不加地表补偿；
  // APM POS.RelHomeAlt 是相对(AGL)→地图须加地表补偿。供 maplibre 无人机图层决定是否 queryTerrainElevation。
  function positionAltIsMSL(): boolean {
      var profile = currentProfile();
      var src = (profile.positionSources || []).filter(function (s: PositionSource) { return s.key === three.value.view.positionSource; })[0];
      return !!(src && src.altIsMSL);
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

    // 跨源定位优先链：返回首个"同一条消息里同时含 Lat+Lng"的类型对应的 lat/lng 定义，
    // 保证经纬度同源(时间网格一致)，避免 lat 取自 A、lng 取自 B 的错配；alt 由调用方另行跨源取。
    // 链中任一类型命中即用其经纬度；全无则返回 null（调用方据此落到 NED）。
  function findGeoCurveSource(chain: string[][]): { lat: { type: string; field: string; key: string }; lng: { type: string; field: string; key: string } } | null {
      for (var ci = 0; ci < chain.length; ci++) {
        var types = chain[ci] || [];
        for (var ti = 0; ti < types.length; ti++) {
          var lat = findTelemetryCurve([types[ti]], ['Lat', 'LAT']);
          if (!lat) continue;
          var lng = findTelemetryCurve([types[ti]], ['Lng', 'Lon', 'LON']);
          if (!lng) continue;
          return { lat: lat, lng: lng };
        }
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
      if (!THREE) {
        three.value.telemetry.error = '缺少 web/vendor/three.module.min.js';
        return;
      }
      three.value.telemetry.loading = true;
      three.value.telemetry.error = '';

      var profile = currentProfile();
      var aPresets = threeAttitudePresets();
      var pPresets = threePositionPresets();
      var attitudePreset: AttitudeSource | undefined = aPresets[three.value.view.attitudeSource] || aPresets[profile.defaultAttitude];
      var positionPreset: PositionSource | undefined = pPresets[three.value.view.positionSource] || pPresets[profile.defaultPosition];
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
      // alt 候选：选定源优先，再其余位置源；每源用其 alt FieldSource。
      var altCandidates: { types: string[]; fields: string[] }[] = [];
      if (positionPreset && positionPreset.alt) altCandidates.push({ types: [positionPreset.alt.type], fields: [positionPreset.alt.field] });
      for (var ai = 0; ai < posSrcs.length; ai++) {
        if (posSrcs[ai] === positionPreset || !posSrcs[ai].alt) continue;
        altCandidates.push({ types: [posSrcs[ai].alt!.type], fields: [posSrcs[ai].alt!.field] });
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
        alt: findTelemetryCurveFrom(altCandidates),
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
        // 仅 alt 单位确定（米）故采用；lat/lng 单位(degE7 vs 度)待核，暂不用作家点。
        homeAlt: profile.homePosition ? resolveFs(profile.homePosition.alt) : null,
        // 解锁检测字段（PX4 vehicle_status.armed）：buildThreeSamples 据此找首解锁时刻作高度零点。APM 走事件 id，为 null。
        armed: (profile.armedDetection && profile.armedDetection.kind === 'field') ? resolveFs(profile.armedDetection.source) : null
      };

      // 电机顺序依赖 SERVOx_FUNCTION 参数，先确保参数已加载（失败则回退 RCOU 原序）。
      await ensureParametersLoaded();
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
        var curves: Record<string, any> = {};
        var voltCurves: NamedCurve[] = [];
        var motorCurves: NamedCurve[] = [];
        items.forEach(function (item: any) {
          if (!item) return;
          if (item.volt) { voltCurves.push({ label: item.label, type: item.type, field: item.field }); return; }
          if (item.motor) { motorCurves.push({ label: item.label, type: item.type, field: item.field }); return; }
          if (item.curve) curves[item.name] = item.curve;
        });
        three.value.curves.volt = voltCurves;
        three.value.curves.motor = motorCurves;
        var hasGeo = curves.lat && curves.lng;
        var hasLocal = curves.px && curves.py;
        if (!hasGeo && !hasLocal) {
          three.value.telemetry.error = '未找到可用于3D轨迹的位置字段（GPS Lat/Lng 或 POS/XKF/NKF 位置）。';
          three.value.telemetry.loaded = true;
          return;
        }
        // geo(Lat/Lng)优先：buildThreeSamples 走 int32 全精度读取，已恢复 1cm 精度（不再有 float32 量化），
        // 且 geo 提供 geoOrigin 供地图轨迹叠加。仅当日志无 geo 经纬度时才回退 NED(米)。
        buildThreeSamples(curves, hasGeo, rcKind, attIsQuat);
        // 诊断提示：NED 优先后下拉框不再反映真实位置源，弹 toast 亮出实际来源，
        // 便于判断漂移是走 NED(米,精确) 还是回退到了 geo(lat/lng, float32 量化)。
        showToast('3D 位置源: ' + (three.value.telemetry.meta.position || '未知'), 'info');
        // 位置来源缺失提示：所选来源没有 Lat/Lng 时告知用户（会回退到局部 NED 或报错）。
        if (!curves.lat || !curves.lng) {
          showToast('未找到 ' + (positionPreset ? positionPreset.label : '所选') + ' 的 Lat/Lng 字段，位置将回退到局部 NED 或无法显示', 'info');
        }
        // 姿态来源缺失提示：euler 缺 Roll/Pitch/Yaw 或 quat 缺 q[0..3] 时告知用户（姿态会归零）。
        var hasAtt = attIsQuat ? (curves.q1 && curves.q2 && curves.q3 && curves.q4) : (curves.roll && curves.pitch && curves.yaw);
        if (!hasAtt) {
          showToast('未找到 ' + (attitudePreset ? attitudePreset.label : '所选') + ' 的姿态字段，无人机姿态将归零', 'info');
        }
        three.value.telemetry.loaded = true;
        // 预载所有姿态源曲线 → 之后切换主/对比姿态源都实时取值，不重载遥测。
        loadAttitudeCurves();
        // 原 $nextTick(ensureThreeView) → 改为箭头以保留 store self。
        nextTick(() => ensureThreeView());
      } catch (e: any) {
        three.value.telemetry.error = '3D遥测加载失败: ' + e.message;
      } finally {
        three.value.telemetry.loading = false;
      }
  }

  function buildThreeSamples(curves: Record<string, any>, useGeo: boolean, rcKind: 'pwm' | 'normalized', attIsQuat: boolean): void {
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

      // geo 模式先扫 lat 曲线：确定原点(首个有效经纬度)与有效点计数。有效点不足 2 且有 NED 时回退 NED，
      // 避免原点取到 0 或整段无定位造成空轨迹。
      // 经纬度全精度：lat/lng 在 body 里是精确 int32(格式 'L'=度×1e7)，Float32Array 会截断到 ~0.2m，
      // 叠加在真实抖动上比 APM(全精度 double) 更狠。取原始 int32 列，(latInt-lat0Int)*scale*110540
      // 全程 float64，恢复 1cm。非 int32 字段回退 Float32 路径。
      var latI32 = useGeo && curves.lat ? cm.rawInt32Column(curves.lat.def.type, curves.lat.def.field) : null;
      var lngI32 = useGeo && curves.lng ? cm.rawInt32Column(curves.lng.def.type, curves.lng.def.field) : null;
      var geoExact = !!(latI32 && lngI32);
      var lat0i = 0, lng0i = 0;
      var lat0 = 0, lng0 = 0, cosLat = 1, geoValid = 0;
      if (useGeo && curves.lat && curves.lat.binary) {
        var latBin = curves.lat.binary;
        for (var gi = 0; gi < latBin.count; gi++) {
          var glat = geoExact ? latI32.values[gi] : latBin.buffer[gi * 2 + 1];
          var glng = geoExact ? lngI32.values[gi] : at(curves.lng, latBin.baseTimeMs + latBin.buffer[gi * 2], 0);
          if (!validGeo(glat, glng)) continue;
          geoValid++;
          if (geoValid === 1) {
            if (geoExact) { lat0i = glat; lng0i = glng; }
            else { lat0 = glat; lng0 = glng; }
          }
        }
        if (geoValid < 2 && curves.px && curves.py) useGeo = false;
        else cosLat = Math.cos((geoExact ? lat0i * latI32.scale : lat0) * Math.PI / 180);
      }

      var baseBin = useGeo ? curves.lat.binary : curves.px.binary;
      var baseN = baseBin.count;
      var baseT0 = baseBin.baseTimeMs;
      var samples = [];
      // 高度零点取解锁时刻（首次 ARMED/AUTO_ARMED）的取值，而非首采样：起飞即 y=0、爬升为正，
      // 避免解锁前被搬运/未定位使首采样高度偏高、起飞后钻到地下。仅改垂直零点（geo 的 alt / NED 的 down），
      // 不动水平原点（lat0/lng0、east0/north0 仍取首采样）。无 ARMED 事件 → tArm=null → 回退首采样（原行为）。
      // EV.Id：10=ARMED, 15=AUTO_ARMED（见 module/logdefs/events.go）。
      // 高度零点取解锁时刻的取值，而非首采样：起飞即 y=0、爬升为正，避免解锁前搬运/未定位使首采样偏高、起飞后钻到地下。
      // 解锁时刻按格式检测：APM=首次 ARMED/AUTO_ARMED 事件 id；PX4=vehicle_status.armed 首次===armedValue。
      // 仅改垂直零点；水平原点(lat0/lng0、east0/north0)仍取首采样。无解锁 → 回退首采样（原行为）。
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
          var ac = curves.armed;
          if (ac && ac.binary) {
            for (var bi = 0; bi < ac.binary.count; bi++) {
              if (ac.binary.buffer[bi * 2 + 1] === armedDet.armedValue) return ac.binary.baseTimeMs + ac.binary.buffer[bi * 2];
            }
          }
          return null;
        }
        return null;
      })();
      // 高度零点：有家点高度(PX4 home_position.alt，米)优先（相对家高）；否则解锁时刻取值；再否则首采样。
      var alt0 = curves.homeAlt && curves.homeAlt.binary
        ? firstV(curves.homeAlt, 0)
        : (tArm != null ? at(curves.alt, tArm, firstV(curves.alt, 0)) : firstV(curves.alt, 0));
      var east0 = useGeo ? 0 : firstV(curves.px, 0);
      var north0 = useGeo ? 0 : firstV(curves.py, 0);
      var down0 = useGeo && curves.alt ? -alt0 : (curves.pz ? (tArm != null ? at(curves.pz, tArm, firstV(curves.pz, 0)) : firstV(curves.pz, 0)) : -alt0);
      var maxRadius = 1;

      for (var i = 0; i < baseN; i++) {
        var t = baseT0 + baseBin.buffer[i * 2];
        var north, east, down, alt;
        if (useGeo) {
          if (geoExact) {
            var li = latI32.values[i], ln = lngI32.values[i];
            if (!validGeo(li, ln)) continue; // 跳过无定位/飞点行
            north = (li - lat0i) * latI32.scale * 110540;   // 整数差 ×scale，float64 全精度
            east = (ln - lng0i) * lngI32.scale * cosLat * 111320;
          } else {
            var lat = baseBin.buffer[i * 2 + 1];
            var lng = at(curves.lng, t, lng0);
            if (!validGeo(lat, lng)) continue; // 跳过无定位/飞点行
            north = (lat - lat0) * 110540;
            east = (lng - lng0) * cosLat * 111320;
          }
          alt = at(curves.alt, t, alt0);
          down = -(alt - alt0);
        } else {
          east = at(curves.px, t, east0) - east0;
          north = at(curves.py, t, north0) - north0;
          down = curves.pz ? at(curves.pz, t, down0) - down0 : 0;
          alt = curves.alt ? at(curves.alt, t, alt0) : alt0 - down;
        }

        var x = east * THREE_UNITS_PER_METER;
        var y = -down * THREE_UNITS_PER_METER;
        var z = -north * THREE_UNITS_PER_METER;
        var speed = logHorizontalSpeedAt(curves, t);
        var verticalSpeed = logVerticalSpeedAt(curves, t);
        // 姿态：euler(APM roll/pitch/yaw，角度插值) 或 quat(PX4 q[0..3]→quatToEulerDeg 折成欧拉度)。
        // 下游全程只认欧拉度，故 quat 在此折成 roll/pitch/yaw，sample/makeDroneQuaternion/姿态仪契约不变。
        var roll: number, pitch: number, yaw: number;
        if (attIsQuat) {
          var e = quatToEulerDeg(at(curves.q1, t, 0), at(curves.q2, t, 0), at(curves.q3, t, 0), at(curves.q4, t, 0));
          roll = e.roll; pitch = e.pitch; yaw = e.yaw;
        } else {
          roll = at(curves.roll, t, 0, true);
          pitch = at(curves.pitch, t, 0, true);
          yaw = at(curves.yaw, t, 0, true);
        }
        var sample = {
          t: t, x: x, y: y, z: z,
          north: north, east: east, down: down,
          roll: roll,
          pitch: pitch,
          yaw: yaw,
          speed: speed,
          verticalSpeed: verticalSpeed,
          altitude: alt,
          // 气压高度独立于位置高度，缺失时为 null（面板显示 -）。
          baroAlt: at(curves.baroAlt, t, null),
          // 遥控器四通道原始 PWM，缺失为 null。
          rcRoll: at(curves.rcRoll, t, null),
          rcPitch: at(curves.rcPitch, t, null),
          rcThrottle: at(curves.rcThrottle, t, null),
          rcYaw: at(curves.rcYaw, t, null)
        };
        maxRadius = Math.max(maxRadius, Math.abs(x), Math.abs(z), Math.abs(y));
        samples.push(sample);
      }
      three.value.telemetry.samples = samples;
      // 保留当前播放时刻：切换位置源时不同源时间跨度基本一致，落在新区间内则保持，否则回起点。
      var prevT = three.value.playback.timeMs;
      var firstT = samples.length ? samples[0].t : 0;
      var lastT = samples.length ? samples[samples.length - 1].t : 0;
      three.value.playback.timeMs = (prevT >= firstT && prevT <= lastT) ? prevT : firstT;
      // 按 RCIN↔实际姿态 的相关性自动判定横滚/俯仰打杆方向是否取反，比读 RCx_REVERSED 参数更可靠
      // （后者只含飞控软件反向，不含遥控器硬件极性）。
      three.value.rc.invert = computeRcInvert(samples);
      three.value.telemetry.meta = {
        position: (useGeo ? curves.lat.def.type + '.Lat/Lng' : curves.px.def.type + ' NED') + ' -> XYZ x' + THREE_UNITS_PER_METER,
        attitude: attIsQuat
          ? (curves.q1 ? curves.q1.def.type + '.q (quat→euler)' : 'quat 缺失')
          : (curves.roll ? curves.roll.def.key : 'Roll') + ' / ' + (curves.pitch ? curves.pitch.def.field : 'Pitch') + ' / ' + (curves.yaw ? curves.yaw.def.field : 'Yaw'),
        speed: (curves.speed ? curves.speed.def.key : (curves.velN && curves.velE ? curves.velN.def.key + ' + ' + curves.velE.def.key : '未找到日志速度字段')),
        verticalSpeed: curves.verticalSpeed ? curves.verticalSpeed.def.key + ' (down取反)' : '未找到垂直速度字段',
        altitude: curves.alt ? curves.alt.def.key : '由局部Z估算',
        baroAlt: curves.baroAlt ? curves.baroAlt.def.key : '未找到气压高度',
        rc: curves.rcRoll ? curves.rcRoll.def.type + ' RC' : '未找到 RC',
        // RC 值类型：pwm(APM RCIN / PX4 input_rc，1000-2000) | normalized(MAVLink -1..1)。驱动 RC HUD 显示分支。
        rcKind: rcKind,
        volt: three.value.curves.volt && three.value.curves.volt.length
          ? three.value.curves.volt.map(function (c) { return c.label; }).join(' · ')
          : '未找到电压字段',
        motor: three.value.curves.motor && three.value.curves.motor.length
          ? three.value.curves.motor[0].type + ' ×' + three.value.curves.motor.length
          : '未找到电机输出',
        maxRadius: maxRadius,
        scale: THREE_UNITS_PER_METER,
        // 保留地理原点供"航线"叠加层复用同一投影（仅 GPS 轨迹时可用）。geoExact 时用 int32 精确原点(度)。
        geoOrigin: useGeo ? { lat0: geoExact ? lat0i * latI32.scale : lat0, lng0: geoExact ? lng0i * lngI32.scale : lng0, alt0: alt0, cosLat: cosLat } : null,
        // 调试面板用：实际位置源字段，供实时取原始值与转换 XYZ 对照，定位精度/计算问题。
        posSource: {
          useGeo: useGeo, geoExact: geoExact,
          lat: curves.lat ? curves.lat.def : null, lng: curves.lng ? curves.lng.def : null, alt: curves.alt ? curves.alt.def : null,
          px: curves.px ? curves.px.def : null, py: curves.py ? curves.py.def : null, pz: curves.pz ? curves.pz.def : null
        }
      };
      updateThreeCurrent();
  }
  return {
    // state
    three, threeMainEl, threeAttitudeEl, threePlayheadEl, threePlayheadTagEl,
    // getters
    threeTimeRange, threePlaybackRange, threeTimelineValue, threeTimelinePct,
    threeCurrentTimeLabel, threeDebugInfo, threeEndTimeLabel, threeModeSegments,
    // actions
    registerThreeMain, registerThreeAttitude, registerThreePlayhead, registerThreePlayheadTag,
    ensureThreeView, positionAttitudeCamera, createThreeView, applyLighting,
    onLightingChange, onLightingToggle, updateThreeSkyUniforms, onSkyToggle,
    onSkyCloudChange, onDroneScaleChange, onGroundToggle, onWaterToggle,
    onWaterWaveChange, updateThreeSceneData, currentThreeSampleIndex, updateThreeProgressPath,
    fitThreeCamera, computeDroneBaseScale, updateThreeDroneScale, alignThreeGrid,
    createThreeGrid, updateThreeCameraMode, resizeThreeView, updateThreeFrame,
    updateThreePropellers, spinPropellers, applyPropellerBlurColor,
    updateThreeCurrent, liveAttitude, applyGhostPose, makeDroneQuaternion,
    applyDronePose, renderThreeView, destroyThreeView, disposeThreeObjects,
    toggleFullTrajectory, toggleThreePath, toggleThreeRcLayout, onMainAaChange,
    onMainResolutionChange, onMainFpsChange, onAttitudeAaChange, onAttitudeResolutionChange,
    detectGpuTier, effectivePixelRatio, resolveTier, onQualityChange,
    setMainView, setThreeViewMode, setThreeCameraMode, seedThreeFpsFromCamera,
    seedThreeCameraBehindDrone, seedThreeLockOrbit, updateThreeFpsMotion, bindThreeControls,
    threeWindowFromZoom, bindThreeCurveChartInteractions, rebuildThreeCurveChart,
    updateThreePlayhead, threeChartGridRect, threePixelForTime, threeTimeForPixel,
    refreshThreePlayhead, onThreePlayheadDown, seekThreeByClientX, toggleThreeCurveAxis,
    onThreeCurveResizeDown, applyThreeFpsKey, resetThreeFpsKeys, threeFpsAxes,
    threeFpsApplyLook, logHorizontalSpeedAt, logVerticalSpeedAt, lerpAngle,
    sampleAtTime, mixNullable, toggleThreeMissionRoute, toggleThreeWaypoints, rebuildThreeMissionVersions,
    activeMissionVersionAt, missionAltIsRelative, computeMissionPoints, missionLatLngPoints,
    updateThreeMissionRoute, getVertices, resolveDroneModelName, loadDroneModel,
    buildLowpolyDroneModel, addLowpolyMotor, addLowpolyProp, onModelChange,
    loadThreeMainDroneModel, makeLatRing, makeMeridian, createAttitudeSphere,
    rebuildAttitudeAxes, rebuildWindArrow, updateWindArrow, updateAttitudeArcs,
    loadThreeAttributeDroneModel, buildTierMaterial, applyMaterialTier, applyExtraDroneModel,
    collectPropellers, advanceThreePlayback, toggleThreePlayback, onThreeTimelineInput,
    seekThreeByPct, formatMetric, rcAvailable,
    computeRcInvert, rcCorrSign, rcNorm, rcKnobStyleX,
    rcKnobStyleY, formatPwm, motorsAvailable, currentMotors, currentVoltage,
    motorBarPct, motorSaturated, bakeEnv, ensureThreeEnv,
    disposeThreeEnv, createSkyMaterial, bakeWaterSkyTex, ensureThreeSky,
    bakeSkyNoiseTex, bakeSkyBackground, applySkyTier, disposeThreeSky,
    ensureThreeWater, disposeThreeWater, alignThreeWater, updateThreeWaterUniforms,
    ensureMainComposer, syncMainComposerPasses, syncMainComposerSize, calibrateMainSsao,
    toggleThreeSsao, ensureAttitudeComposer, syncAttitudeComposerPasses, syncAttitudeComposerSize,
    disposeThreePostfx, ensureThreeTelemetry, threeAttitudePresets, threePositionPresets,
    onThreeAttitudeSourceChange, onThreePositionSourceChange, loadAttitudeCurves,
    disposeGhostMaterials, rebuildGhostDrone, onCompareAttitudeToggle, onCompareSourceChange,
    resetThreeTelemetry, resetSourceSelection, positionAltIsMSL, telemetryType, telemetryField, findTelemetryCurve,
    findTelemetryCurveFrom, findGeoCurveSource, collectVoltCurves, ensureParametersLoaded,
    servoFuncToChannelMap, collectMotorCurves, fetchTelemetryCurve, loadThreeTelemetry,
    buildThreeSamples, currentPropellerPwms,
  };
});
