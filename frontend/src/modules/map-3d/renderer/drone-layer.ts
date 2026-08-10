import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { MercatorCoordinate, type Map as MLMap, type CustomLayerInterface, type CustomRenderMethodInput } from 'maplibre-gl'
import { buildDroneModel, makeDroneQuaternionMercator, spinPropellersByPwm, type BuiltDroneModel } from '@/modules/shared/utils/drone-model'
import { THREE_MODEL_MATERIAL, BODY_MATERIAL, THREE_PROPELLER_ORDER, type MaterialProperties } from '@/constants'

const _t = new THREE.Matrix4()
const _sclMat = new THREE.Matrix4()
const _r = new THREE.Matrix4()
const _att = new THREE.Matrix4()
const _camT = new THREE.Matrix4()
const _relMvp = new THREE.Matrix4()
const _bbBasis = new THREE.Matrix4()
const _bbX = new THREE.Vector3()
const _bbY = new THREE.Vector3()
const _bbZ = new THREE.Vector3()
let _diagTick = 0
const WP_R = 2, HOME_R = 3, TEXT_PX = 7
const CUSTOM_MODEL_BASE_METERS = 5

export interface DronePose {
  lng: number
  lat: number
  altMeters: number
  roll: number
  pitch: number
  yaw: number
  rawAlt?: number
  homeAlt?: number
  altIsMSL?: boolean
}

export interface DroneLayerHandle {
  layer: CustomLayerInterface
  state: DroneLayerState
  setPose: (p: DronePose) => void
  setHome: (lng: number, lat: number) => void
  setScaleMultiplier: (m: number) => void
  setShaded: (on: boolean) => void
  setPropellerPwms: (pwms: (number | null)[] | null) => void
  replaceModel: (opts: { name: string; airframe?: string; lowpoly: boolean; glbScene?: THREE.Object3D }) => void
  setTrack: (coords: [number, number, number][], start: number, end: number) => void
  setRoute: (coords: [number, number, number][]) => void
  setWaypoints: (pts: WaypointPose[]) => void
  setCustomModels: (specs: CustomModelSpec[]) => void
  updateCustomModelPose: (name: string, patch: Partial<Pick<CustomModelSpec, 'lon' | 'lat' | 'alt' | 'yaw' | 'pitch' | 'roll' | 'scale'>>) => void
  setGizmoTarget: (name: string | null) => void
  hitTestGizmo: (ndc: THREE.Vector2) => 'x' | 'y' | 'z' | null
  dispose: () => void
}

export interface WaypointPose {
  lng: number
  lat: number
  alt: number
  label: string
  isHome: boolean
}

export interface CustomModelSpec {
  name: string
  url: string
  lon: number
  lat: number
  alt: number
  yaw: number
  pitch: number
  roll: number
  scale: number
  hidden: boolean
}

interface CustomModelItem extends CustomModelSpec {
  object: THREE.Object3D | null
  modelMaxDim: number
  modelHeight: number
  abs: { x: number; y: number; z: number }
}

export interface DroneLayerState {
  model: BuiltDroneModel
  scene: THREE.Scene
  trackLine: THREE.Line | null
  trackPositions: Float64Array | null
  trackAllCoords: [number, number, number][] | null
  routeLine: Line2 | null
  routePositions: Float64Array | null
  routeAllCoords: [number, number, number][] | null
  posMarker: THREE.Mesh | null
  probe: THREE.Mesh[]
  camera: THREE.Camera
  renderer: THREE.WebGLRenderer
  pose: DronePose
  tx: number
  ty: number
  tz: number
  modelMaxDim: number
  modelHeight: number
  meterInMerc: number
  scaleMultiplier: number
  shaded: boolean
  propPwms: (number | null)[] | null
  lastPropTick: number
  homeLng: number | null
  homeLat: number | null
  homeGndElev: number | null
  homeQueryPending: boolean
  waypointGroup: THREE.Group | null
  waypointAbs: { x: number; y: number; z: number }[]
  waypointAllPts: WaypointPose[]
  waypointItems: THREE.Group[]
  waypointLabels: (THREE.Mesh | null)[]
  waypointIsHome: boolean[]
  modelType: 'glb' | 'lowpoly'
  customModelGroup: THREE.Group | null
  customModels: CustomModelItem[]
  pendingCustomSpecs: CustomModelSpec[] | null
  gltfCache: Map<string, THREE.Object3D>
  gizmoGroup: THREE.Group | null
  gizmoTarget: string | null
  map: MLMap | null
}

export interface DroneLayerOptions {
  layerId?: string
  droneModelName: string
  airframe: string | undefined
  scaleMultiplier?: number
  initialPose: DronePose
  baseTone?: BaseTone
}

const MAP_SUN_DIR = new THREE.Vector3(1.0, -0.6, 0.45).normalize() 

const DRONE_VERT_SHADER = `
  varying vec3 vWorldNormal;
  void main() {
    // normalMatrix 把顶点法线旋到模型变换后的世界(mercator)朝向（view 为单位阵，故=世界系）。
    vWorldNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const DRONE_FRAG_SHADER = `
  uniform vec3 uColor;       // 该 mesh 的基色（来自 MaterialProperties.color）
  uniform vec3 uLightDir;    // 世界(mercator)系太阳方向（归一化）
  varying vec3 vWorldNormal;
  void main() {
    vec3 N = normalize(vWorldNormal);
    float diff = max(dot(N, normalize(uLightDir)), 0.0);   // 方向光塑形（左/右明暗，弱）
    float hemi = N.z * 0.5 + 0.5;                          // 半球：顶面(1.0)→底面(0.0)
    // 天光式着色：低环境光 + 强半球（顶面明显亮于侧面/底面，俯视也能一眼分辨上下——核心诉求）+ 弱方向光（轻微立体感）。
    // 调参历史：方向光 0.45「太离谱」(左暗右亮)；环境光 0.62+半球 0.26「分不清上下」(各面太接近)；
    // 现以半球为主、方向光为辅，范围约 [0.30, 0.94]，顶/侧对比明显又不刺眼。
    float shade = 0.30 + 0.60 * hemi + 0.10 * diff;
    gl_FragColor = vec4(uColor * shade, 1.0);
  }
`

function buildSimpleMaterial(cfg: MaterialProperties): THREE.Material {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(cfg.color) },
      uLightDir: { value: MAP_SUN_DIR },
    },
    vertexShader: DRONE_VERT_SHADER,
    fragmentShader: DRONE_FRAG_SHADER,
    depthTest: true,
    depthWrite: true,
    transparent: true,
    side: THREE.DoubleSide,
  })
}

function buildFlatMaterial(cfg: MaterialProperties): THREE.Material {
  return new THREE.MeshBasicMaterial({
    color: cfg.color,
    depthTest: true,
    depthWrite: true,
    transparent: true,
    side: THREE.DoubleSide,
  })
}

const MAP_BODY_COLOR_DARK_BG = 0xf2f4f7
const MAP_BODY_COLOR_LIGHT_BG = 0x1f2937
const MAP_NOSE_KEY = 'shell-nose'
const MAP_PROP_KEYS = new Set(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'throttle'])

export type BaseTone = 'light' | 'dark'
function mapBodyColorFor(tone: BaseTone): number {
  return tone === 'light' ? MAP_BODY_COLOR_LIGHT_BG : MAP_BODY_COLOR_DARK_BG
}

function buildMaplibreMaterialTable(bodyColor: number): Record<string, Record<string, MaterialProperties>> {
  const out: Record<string, Record<string, MaterialProperties>> = {}
  for (const frame of Object.keys(THREE_MODEL_MATERIAL)) {
    const src = THREE_MODEL_MATERIAL[frame]
    const dst: Record<string, MaterialProperties> = {}
    for (const node of Object.keys(src)) {
      const cfg = src[node]
      const keep = MAP_PROP_KEYS.has(node) || node === MAP_NOSE_KEY
      dst[node] = { ...cfg, color: keep ? cfg.color : bodyColor }
    }
    out[frame] = dst
  }
  return out
}

function disposeObject3D(root: THREE.Object3D): void {
  const disposed = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>()
  root.traverse((o: any) => {
    if (o.isMesh || o.isSprite) {
      if (o.geometry && !disposed.has(o.geometry)) { o.geometry.dispose(); disposed.add(o.geometry) }
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (!m || disposed.has(m)) continue
        for (const key of Object.keys(m)) {
          const v = m[key]
          if (v && v.isTexture && !disposed.has(v)) { v.dispose(); disposed.add(v) }
          if (Array.isArray(v)) { for (const t of v) { if (t && t.isTexture && !disposed.has(t)) { t.dispose(); disposed.add(t) } } }
        }
        m.dispose(); disposed.add(m)
      }
    }
  })
}

function makeNumberTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  ctx.font = 'bold 92px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 18
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  ctx.strokeStyle = '#1f2937'
  ctx.fillStyle = '#ffffff'
  ctx.strokeText(label, 64, 70)
  ctx.fillText(label, 64, 70)
  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 4
  return tex
}

export function createDroneModelLayer(opts: DroneLayerOptions): DroneLayerHandle {
  const state = {
    model: null as unknown as BuiltDroneModel,
    scene: null as unknown as THREE.Scene,
    trackLine: null as THREE.Line | null,
    trackPositions: null as Float64Array | null,
    trackAllCoords: null as [number, number, number][] | null,
    routeLine: null as Line2 | null,
    routePositions: null as Float64Array | null,
    posMarker: null as THREE.Mesh | null,
    probe: [] as THREE.Mesh[],
    camera: null as unknown as THREE.Camera,
    renderer: null as unknown as THREE.WebGLRenderer,
    pose: { ...opts.initialPose },
    modelType: 'lowpoly',
    tx: 0, ty: 0, tz: 0,
    modelMaxDim: 1,
    modelHeight: 1,
    meterInMerc: 0,
    scaleMultiplier: opts.scaleMultiplier ?? 1,
    shaded: true,
    propPwms: null,
    lastPropTick: 0,
    homeLng: null, homeLat: null, homeGndElev: null, homeQueryPending: false,
    routeAllCoords: null as [number, number, number][] | null,
    waypointGroup: null as THREE.Group | null,
    waypointAbs: [] as { x: number; y: number; z: number }[],
    waypointAllPts: [] as WaypointPose[],
    waypointItems: [] as THREE.Group[],
    waypointLabels: [] as (THREE.Mesh | null)[],
    waypointIsHome: [] as boolean[],
    customModelGroup: null as THREE.Group | null,
    customModels: [] as CustomModelItem[],
    pendingCustomSpecs: null as CustomModelSpec[] | null,
    gltfCache: new Map<string, THREE.Object3D>(),
    gizmoGroup: null as THREE.Group | null,
    gizmoTarget: null as string | null,
    map: null as MLMap | null,
  } as DroneLayerState

  const bodyColor = mapBodyColorFor(opts.baseTone ?? 'dark')
  const materialTable = buildMaplibreMaterialTable(bodyColor)
  const fallbackMaterial: MaterialProperties = { ...BODY_MATERIAL, color: bodyColor }

  function renderAltForMerc(rawAlt: number, isMSL: boolean): number {
    return (state.homeGndElev != null && !isMSL) ? state.homeGndElev + rawAlt : rawAlt
  }

  function setHome(lng: number, lat: number): void {
    if (!isFinite(lng) || !isFinite(lat)) return
    if (state.homeLng === lng && state.homeLat === lat) return
    state.homeLng = lng
    state.homeLat = lat
    state.homeGndElev = null  
    ensureHomeGround()
  }

  function ensureHomeGround(): void {
    const map = state.map
    const terrainOn = !!(map && map.getTerrain && map.getTerrain())
    if (!terrainOn || state.homeLng == null || state.homeLat == null || state.homeGndElev != null) return
    const tryQuery = (): void => {
      if (state.homeGndElev != null) return  
      const g = map!.queryTerrainElevation?.([state.homeLng!, state.homeLat!])
      if (g != null) {
        state.homeGndElev = g
        rebuildRouteAbs()
        rebuildWaypointAbs()
        rebuildTrackAbs()
        rebuildCustomModelsAbs()
        if (state.model) recomputeTransform(state.pose)
      }
    }
    if (map!.isSourceLoaded && map!.isSourceLoaded('terrain')) setTimeout(tryQuery, 0)
    else map!.once('idle', tryQuery)
  }

  function rebuildRouteAbs(): void {
    const coords = state.routeAllCoords
    const abs = state.routePositions
    if (!coords || !abs || abs.length < coords.length * 3) return
    for (let i = 0; i < coords.length; i++) {
      const mc = MercatorCoordinate.fromLngLat([coords[i][0], coords[i][1]], renderAltForMerc(coords[i][2] || 0, false))
      abs[i * 3] = mc.x
      abs[i * 3 + 1] = mc.y
      abs[i * 3 + 2] = mc.z
    }
  }

  function rebuildWaypointAbs(): void {
    const pts = state.waypointAllPts
    if (!pts.length || !state.waypointAbs.length) return
    for (let i = 0; i < pts.length && i < state.waypointAbs.length; i++) {
      const pt = pts[i]
      const mc = MercatorCoordinate.fromLngLat([pt.lng, pt.lat], renderAltForMerc(pt.alt, false))
      state.waypointAbs[i] = { x: mc.x, y: mc.y, z: mc.z }
    }
  }

  function rebuildTrackAbs(): void {
    const coords = state.trackAllCoords
    const arr = state.trackPositions
    if (!coords || !arr || arr.length < coords.length * 3) return
    const isMSL = !!state.pose.altIsMSL
    for (let i = 0; i < coords.length; i++) {
      const mc = MercatorCoordinate.fromLngLat([coords[i][0], coords[i][1]], renderAltForMerc(coords[i][2] || 0, isMSL))
      arr[i * 3] = mc.x
      arr[i * 3 + 1] = mc.y
      arr[i * 3 + 2] = mc.z
    }
  }

  function recomputeTransform(p: DronePose): void {
    const altForMerc = renderAltForMerc(p.altMeters, !!p.altIsMSL)
    if ((++_diagTick) % 60 === 0) {
      console.log('[drone-alt]', {
        altIsMSL: !!p.altIsMSL, altMeters: p.altMeters, homeAlt: p.homeAlt,
        homeGndElev: state.homeGndElev, altForMerc, lng: p.lng, lat: p.lat,
      })
    }
    const mc = MercatorCoordinate.fromLngLat([p.lng, p.lat], altForMerc)
    state.tx = mc.x
    state.ty = mc.y
    state.tz = mc.z
    state.meterInMerc = mc.meterInMercatorCoordinateUnits()
  }

  function setPose(p: DronePose): void {
    const isMSLChanged = !!state.pose.altIsMSL !== !!p.altIsMSL
    state.pose = p
    if (state.model) {
      recomputeTransform(p)
      if (isMSLChanged) rebuildTrackAbs()
    }
  }

  function setScaleMultiplier(m: number): void { state.scaleMultiplier = m > 0 ? m : 1 }

  function buildMaterial(cfg: MaterialProperties): THREE.Material {
    return state.shaded ? buildSimpleMaterial(cfg) : buildFlatMaterial(cfg)
  }

  function reapplyMaterials(): void {
    if (!state.model) return
    const disposed = new Set<THREE.Material>()
    state.model.group.traverse((o: any) => {
      if (!o.isMesh) return
      const cfg: MaterialProperties | undefined = o.userData._apmMatConfig
      if (!cfg) return
      const old = Array.isArray(o.material) ? o.material : [o.material]
      o.material = buildMaterial(cfg)
      for (const m of old) { if (m && !disposed.has(m)) { m.dispose(); disposed.add(m) } }
    })
  }

  function setShaded(on: boolean): void {
    const next = !!on
    if (state.shaded === next) return
    state.shaded = next
    reapplyMaterials()
  }

  function setPropellerPwms(pwms: (number | null)[] | null): void { state.propPwms = pwms }

  function applyModel(name: string, airframe: string | undefined, lowpoly: boolean, glbScene?: THREE.Object3D): void {
    if (!state.scene) return
    if (state.model) {
      state.scene.remove(state.model.group)
      disposeObject3D(state.model.group)
    }
    state.model = buildDroneModel(name, {
      lowpoly,
      glbScene,
      airframe,
      propOrder: THREE_PROPELLER_ORDER,
      materialTable,
      fallbackMaterial,
      buildMaterial,
    })
    state.model.group.matrixAutoUpdate = false
    state.model.group.matrixWorldNeedsUpdate = true
    state.scene.add(state.model.group)
    state.model.group.traverse((o: THREE.Object3D) => { o.renderOrder = 10 })
    const box = new THREE.Box3().setFromObject(state.model.group)
    const sz = box.getSize(new THREE.Vector3())
    state.modelMaxDim = Math.max(1e-6, Math.max(sz.x, sz.y, sz.z))
    state.modelHeight = Math.max(1e-6, sz.y)
    state.modelType = lowpoly ? 'lowpoly' : 'glb'
    recomputeTransform(state.pose)
  }

  function replaceModel(o: { name: string; airframe?: string; lowpoly: boolean; glbScene?: THREE.Object3D }): void {
    applyModel(o.name, o.airframe, o.lowpoly, o.glbScene)
  }

  function setTrack(allCoords: [number, number, number][], start: number, end: number): void {
    if (!state.scene) return
    const total = allCoords.length
    const lo = Math.max(0, start)
    const count = Math.max(0, Math.min(end, total) - lo)
    if (total < 2 || count < 2) {
      if (state.trackLine) state.trackLine.geometry.setDrawRange(0, 0)
      return
    }
    if (state.trackAllCoords !== allCoords || !state.trackPositions || state.trackPositions.length < total * 3) {
      if (state.trackLine) {
        state.scene.remove(state.trackLine)
        state.trackLine.geometry.dispose()
        ;(state.trackLine.material as THREE.Material).dispose()
      }
      state.trackAllCoords = allCoords
      state.trackPositions = new Float64Array(total * 3)
      const renderBuf = new Float32Array(total * 3)
      const arr = state.trackPositions
      const isMSL = !!state.pose.altIsMSL  
      for (let i = 0; i < total; i++) {
        const mc = MercatorCoordinate.fromLngLat([allCoords[i][0], allCoords[i][1]], renderAltForMerc(allCoords[i][2] || 0, isMSL))
        arr[i * 3] = mc.x
        arr[i * 3 + 1] = mc.y
        arr[i * 3 + 2] = mc.z
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(renderBuf, 3))
      const mat = new THREE.LineBasicMaterial({ color: 0x2563eb, depthTest: false, transparent: true })
      state.trackLine = new THREE.Line(geo, mat)
      state.trackLine.renderOrder = 3
      state.scene.add(state.trackLine)
    }
    state.trackLine.geometry.setDrawRange(lo, count)
  }

  function setRoute(coords: [number, number, number][]): void {
    if (!state.scene) return
    if (state.routeLine) {
      state.scene.remove(state.routeLine)
      state.routeLine.geometry.dispose()
      ;(state.routeLine.material as THREE.Material).dispose()
      state.routeLine = null
    }
    state.routePositions = null
    state.routeAllCoords = coords  
    if (coords.length >= 2) {
      const n = coords.length
      const abs = new Float64Array(n * 3)
      for (let i = 0; i < n; i++) {
        const mc = MercatorCoordinate.fromLngLat([coords[i][0], coords[i][1]], renderAltForMerc(coords[i][2] || 0, false))
        abs[i * 3] = mc.x
        abs[i * 3 + 1] = mc.y
        abs[i * 3 + 2] = mc.z
      }
      state.routePositions = abs
      const geo = new LineGeometry()
      geo.setPositions(Array.from(abs))
      const mat = new LineMaterial({ color: 0xea580c, linewidth: 3, transparent: true, depthTest: false })
      const canvas = state.map!.getCanvas()
      mat.resolution.set(canvas.width, canvas.height)
      const line = new Line2(geo, mat)
      line.renderOrder = 4
      state.routeLine = line
      state.scene.add(state.routeLine)
    }
  }

  function offsetLinesToCamera(camX: number, camY: number, camZ: number): void {
    if (state.trackLine && state.trackLine.visible && state.trackPositions) {
      const attr = state.trackLine.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      const abs = state.trackPositions
      const dr = state.trackLine.geometry.drawRange
      const lo = dr.start || 0
      for (let i = 0; i < dr.count; i++) {
        const i3 = (lo + i) * 3
        arr[i3] = abs[i3] - camX
        arr[i3 + 1] = abs[i3 + 1] - camY
        arr[i3 + 2] = abs[i3 + 2] - camZ
      }
      attr.clearUpdateRanges()
      attr.addUpdateRange(lo * 3, dr.count * 3)
      attr.needsUpdate = true
    }
    if (state.routeLine && state.routePositions) {
      const abs = state.routePositions
      const tmp = new Float32Array(abs.length)
      for (let i = 0; i < tmp.length; i++) {
        const m = i % 3
        tmp[i] = abs[i] - (m === 0 ? camX : m === 1 ? camY : camZ)
      }
      ;(state.routeLine.geometry as any).setPositions(tmp)
      const mat = state.routeLine.material as LineMaterial
      const canvas = state.map!.getCanvas()
      mat.resolution.set(canvas.width, canvas.height)
    }
  }

  function setWaypoints(pts: WaypointPose[]): void {
    if (state.waypointGroup) {
      state.scene.remove(state.waypointGroup)
      disposeWaypointGroup(state.waypointGroup)
      state.waypointGroup = null
    }
    state.waypointAbs = []
    state.waypointItems = []
    state.waypointLabels = []
    state.waypointIsHome = []
    state.waypointAllPts = []
    if (!state.scene || !pts.length) return
    state.waypointAllPts = pts  
    const merc = state.meterInMerc || 1e-7
    const wpMat = new THREE.MeshBasicMaterial({ color: 0xea580c, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide })
    const homeMat = new THREE.MeshBasicMaterial({ color: 0x16a34a, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide })
    const coreGeo = new THREE.SphereGeometry(WP_R, 16, 16)
    const homeCoreGeo = new THREE.SphereGeometry(HOME_R, 18, 18)
    const numGeo = new THREE.PlaneGeometry(1, 1)
    const group = new THREE.Group()
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i]
      const mc = MercatorCoordinate.fromLngLat([pt.lng, pt.lat], renderAltForMerc(pt.alt, false))
      state.waypointAbs.push({ x: mc.x, y: mc.y, z: mc.z })
      const r = pt.isHome ? HOME_R : WP_R
      const item = new THREE.Group()
      item.scale.setScalar(merc)  
      item.add(new THREE.Mesh(pt.isHome ? homeCoreGeo : coreGeo, pt.isHome ? homeMat : wpMat))
      const num = new THREE.Mesh(numGeo, new THREE.MeshBasicMaterial({ map: makeNumberTexture(pt.label), transparent: true, depthTest: false, side: THREE.DoubleSide }))
      num.renderOrder = 6
      num.position.set(0, 0, r * 2.2)  
      item.add(num)
      item.position.set(mc.x, mc.y, mc.z)  
      group.add(item)
      state.waypointItems.push(item)
      state.waypointLabels.push(num)
      state.waypointIsHome.push(pt.isHome)
    }
    group.renderOrder = 1  
    state.waypointGroup = group
    state.scene.add(group)
  }

  function disposeWaypointGroup(g: THREE.Group): void {
    disposeObject3D(g)  
  }

  let gltfLoader: GLTFLoader | null = null

  function pathOfModelUrl(url: string): string {
    const m = /(?:^|[?&])path=([^&]+)/.exec(url)
    return m ? decodeURIComponent(m[1]) : ''
  }
  function modelExtOfUrl(url: string): string {
    const abs = pathOfModelUrl(url)
    const dot = abs.lastIndexOf('.')
    return dot >= 0 ? abs.slice(dot).toLowerCase() : ''
  }
  function siblingModelUrl(url: string, newExt: string): string {
    const abs = pathOfModelUrl(url)
    const dot = abs.lastIndexOf('.')
    const base = dot >= 0 ? abs.slice(0, dot) : abs
    return `model-file?path=${encodeURIComponent(base + newExt)}`
  }

  // 重算一个自定义模型项的绝对 mercator（lon/lat/alt 变或 homeGndElev 就绪后调）。
  function recomputeCustomModelAbs(item: CustomModelItem): void {
    const mc = MercatorCoordinate.fromLngLat([item.lon, item.lat], renderAltForMerc(item.alt, false))
    item.abs = { x: mc.x, y: mc.y, z: mc.z }
  }

  // homeGndElev/基准变化后重算所有自定义模型的绝对 mercator z（同 rebuildWaypointAbs）。
  function rebuildCustomModelsAbs(): void {
    for (const it of state.customModels) recomputeCustomModelAbs(it)
  }

  // 把 GLB 的 PBR(Standard/Physical/Phong) 材质降级为 MeshBasicMaterial：共享 MapLibre GL 上下文下
  // Standard 光照不稳（黑/闪烁），Basic 不依赖灯光、保留贴图/颜色（金属/粗糙度表现丢失，是可接受代价）。
  function downgradeGltfMaterial(root: THREE.Object3D): void {
    root.traverse((o: any) => {
      if (!o.isMesh) return
      const oldMats = Array.isArray(o.material) ? o.material : [o.material]
      const newMats: THREE.Material[] = []
      for (const m of oldMats) {
        if (m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshPhongMaterial)) {
          newMats.push(new THREE.MeshBasicMaterial({
            map: (m as any).map || null,
            color: (m as any).color ? new THREE.Color().copy((m as any).color) : new THREE.Color(0xffffff),
            transparent: !!(m as any).transparent,
            opacity: (m as any).opacity ?? 1,
            side: (m as any).side ?? THREE.DoubleSide,
            depthTest: true,
            depthWrite: true,
          }))
          m.dispose()
        } else {
          newMats.push(m)
        }
      }
      o.material = Array.isArray(o.material) ? newMats : newMats[0]
    })
  }

  // clone 缓存的根 Object3D 挂到 item（共享几何/材质），量几何尺寸（缩放/抬升用）。
  function attachCustomModelObject(item: CustomModelItem, root: THREE.Object3D): void {
    const obj = root.clone(true)
    obj.matrixAutoUpdate = false
    obj.matrixWorldNeedsUpdate = true
    obj.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(obj)
    const sz = box.getSize(new THREE.Vector3())
    item.modelMaxDim = Math.max(1e-6, Math.max(sz.x, sz.y, sz.z))
    item.modelHeight = Math.max(1e-6, sz.y)
    obj.visible = !item.hidden
    item.object = obj
    state.customModelGroup?.add(obj)
  }

  // 确保 item 的 object3D 就绪：cache 命中则直接 clone；否则按扩展名异步加载 → 降级 → 入 cache → clone。
  function ensureCustomModelObject(item: CustomModelItem): void {
    if (!item.url) return // 虚拟锚点（组中心，url=''）：不加载 GLB，object 保持 null（渲染循环 if(!obj) 跳过）
    const cached = state.gltfCache.get(item.url)
    if (cached) { attachCustomModelObject(item, cached); return }

    // 加载完成统一处理：降级材质(共享 GL 上下文不做 PBR) → 入缓存 → 挂载到当前 item。
    const onLoaded = (root: THREE.Object3D): void => {
      downgradeGltfMaterial(root)
      state.gltfCache.set(item.url, root)
      // 加载期间 setCustomModels 可能已替换列表：按 name+url 重新定位当前 item 再挂载。
      const cur = state.customModels.find((m) => m.name === item.name && m.url === item.url)
      if (cur && !cur.object) attachCustomModelObject(cur, root)
    }

    // OBJ：尽力加载同名 .mtl（材质颜色），无/失败则纯几何。OBJLoader 回调直接给 Object3D（非 {scene}）。
    if (modelExtOfUrl(item.url) === '.obj') {
      const mtlUrl = siblingModelUrl(item.url, '.mtl')
      const mtlPromise: Promise<MTLLoader.MaterialCreator | null> = new MTLLoader()
        .loadAsync(mtlUrl)
        .then((m: MTLLoader.MaterialCreator): MTLLoader.MaterialCreator => { m.preload(); return m })
        .catch((): null => null) // 无同名 .mtl 或加载失败 → 纯几何（MTLLoader 的贴图解析失败也走此分支）。
      mtlPromise.then((materials) => {
        const loader = new OBJLoader() // 每次新建：setMaterials 带 per-load 状态，避免并发竞态。
        if (materials) loader.setMaterials(materials)
        loader.load(item.url, (obj) => onLoaded(obj), undefined, () => { /* 加载失败静默；store 层 toast */ })
      })
      return
    }

    // GLB / glTF（默认）：GLTFLoader 回调给 { scene }。
    if (!gltfLoader) gltfLoader = new GLTFLoader()
    gltfLoader.load(item.url, (gltf) => onLoaded(gltf.scene), undefined, () => { /* 加载失败静默；store 层 toast */ })
  }

  // 全量替换自定义模型：缓存最新 specs（pendingCustomSpecs），scene 就绪则立即构建。
  // 图层 onAdd 之前调时 scene 尚未创建 → applyCustomModels return，specs 留在 pending；
  // onAdd 末尾再调 applyCustomModels 消费 pending（启动加载的用户模型不丢失）。
  function setCustomModels(specs: CustomModelSpec[]): void {
    state.pendingCustomSpecs = specs
    applyCustomModels()
  }

  // 消费 pendingCustomSpecs：释放旧 item 的 clone（不动 gltfCache），重建 item 列表 + 触发加载。
  function applyCustomModels(): void {
    const specs = state.pendingCustomSpecs
    if (!specs || !state.scene) return
    for (const it of state.customModels) {
      if (it.object) { state.customModelGroup?.remove(it.object); disposeObject3D(it.object) }
    }
    state.customModels = []
    if (!state.customModelGroup) {
      state.customModelGroup = new THREE.Group()
      state.customModelGroup.renderOrder = 5 // 高于航点(1)/航线(2)/轨迹(3)，低于无人机(10)
      state.scene.add(state.customModelGroup)
    }
    for (const spec of specs) {
      const item: CustomModelItem = { ...spec, object: null, modelMaxDim: 1, modelHeight: 1, abs: { x: 0, y: 0, z: 0 } }
      recomputeCustomModelAbs(item)
      state.customModels.push(item)
      ensureCustomModelObject(item)
    }
  }

  // 位姿实时编辑（滑杆拖动）：只改字段，lon/lat/alt 变则重算 mercator；不重新加载 GLB。
  function updateCustomModelPose(name: string, patch: Partial<Pick<CustomModelSpec, 'lon' | 'lat' | 'alt' | 'yaw' | 'pitch' | 'roll' | 'scale'>>): void {
    const item = state.customModels.find((m) => m.name === name)
    if (!item) return
    Object.assign(item, patch)
    if (patch.lon != null || patch.lat != null || patch.alt != null) recomputeCustomModelAbs(item)
  }

  // === 三轴平移手柄（编辑模式）===
  // 3 个 Cylinder+Cone 箭头：X 红=经度/东(+X)、Y 绿=纬度/北(-Y，mercator +Y 朝南)、Z 蓝=高度/上(+Z)。
  // 用 Mesh 不用 Line（Raycaster 对 Line 的 threshold 在 mercator 单位下巨大难调）。depthTest:false 始终可见。
  function buildGizmo(): THREE.Group {
    const group = new THREE.Group()
    // 本地 1 单位 = 模型尺寸：LEN=1.0 → 轴长 = 模型长度；RAD=0.05 → 轴半径 0.05×模型（尽量细）。
    const LEN = 1.0, RAD = 0.05
    const qY = new THREE.Vector3(0, 1, 0)
    const axes = [
      { axis: 'x' as const, color: 0xef4444, dir: new THREE.Vector3(1, 0, 0) },
      { axis: 'y' as const, color: 0x22c55e, dir: new THREE.Vector3(0, -1, 0) },
      { axis: 'z' as const, color: 0x3b82f6, dir: new THREE.Vector3(0, 0, 1) },
    ]
    for (const a of axes) {
      const ag = new THREE.Group()
      ag.userData.axis = a.axis
      const mat = new THREE.MeshBasicMaterial({ color: a.color, depthTest: false, transparent: true })
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(RAD, RAD, LEN, 12), mat)
      shaft.position.y = LEN / 2
      const cone = new THREE.Mesh(new THREE.ConeGeometry(RAD * 2.5, LEN * 0.25, 12), mat)
      cone.position.y = LEN + LEN * 0.125
      ag.add(shaft, cone)
      ag.quaternion.setFromUnitVectors(qY, a.dir)
      group.add(ag)
    }
    group.renderOrder = 20 // 高于无人机(10)
    return group
  }

  // 显示/隐藏手柄在 name 模型处（null 隐藏）。首次显示时构建 group 挂 scene。
  function setGizmoTarget(name: string | null): void {
    state.gizmoTarget = name
    if (!state.gizmoGroup && name && state.scene) {
      state.gizmoGroup = buildGizmo()
      state.scene.add(state.gizmoGroup)
    }
    if (state.gizmoGroup) state.gizmoGroup.visible = !!name
  }

  // raycaster 检测点击命中哪条轴（ndc 已含 Y 翻转）；未命中/手柄隐藏返回 null。
  // 可行性：camera.matrixWorld 恒 identity 与 floating origin（物体存 abs−cam）自洽，每帧同步的
  // projectionMatrixInverse 让 unproject 正确 → 射线原点(0,0,0) 正好打到相对坐标的手柄轴上。
  function hitTestGizmo(ndc: THREE.Vector2): 'x' | 'y' | 'z' | null {
    if (!state.gizmoGroup || !state.gizmoGroup.visible) return null
    const ray = new THREE.Raycaster()
    // state.camera 是裸 THREE.Camera（非 Perspective/Orthographic），Raycaster.setFromCamera 会报错且不设射线
    // → 手动 unproject 近/远点构造射线（projectionMatrixInverse 已在 render 每帧同步，unproject 在 abs−cam 空间正确）。
    const near = new THREE.Vector3(ndc.x, ndc.y, -1).unproject(state.camera)
    const far = new THREE.Vector3(ndc.x, ndc.y, 1).unproject(state.camera)
    ray.ray.origin.copy(near)
    ray.ray.direction.copy(far).sub(near).normalize()
    const hits = ray.intersectObjects(state.gizmoGroup.children, true)
    if (!hits.length) return null
    let o: THREE.Object3D | null = hits[0].object
    while (o && o !== state.gizmoGroup) {
      if (o.userData && o.userData.axis) return o.userData.axis as 'x' | 'y' | 'z'
      o = o.parent
    }
    return null
  }

  const layer: CustomLayerInterface = {
    id: opts.layerId ?? 'drone-3d-model',
    type: 'custom',
    renderingMode: '3d',
    onAdd(map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      state.map = map
      // 共享 MapLibre 的 GL 上下文（用 MapLibre 自己的 canvas）；autoClear 在构造后关——不清 MapLibre 的帧缓冲。
      state.renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas() as HTMLCanvasElement,
        context: gl as WebGL2RenderingContext,
      })
      state.renderer.autoClear = false
      state.renderer.setClearAlpha(0)

      // 裸 Camera：每帧把 mercator→裁影矩阵直接写进 projectionMatrix（不建 PerspectiveCamera）。
      // 必须在此创建——否则 render() 访问 state.camera.projectionMatrix 会抛异常、整图层不绘制。
      state.camera = new THREE.Camera()

      state.scene = new THREE.Scene()
      // 不挂 three.js 灯光：共享 MapLibre GL 上下文下 Standard 材质光照不稳（渲染黑/时隐时现），
      // 本图层所有 mesh（无人机自写着色 ShaderMaterial / 轨迹·航线线 / 航点 Basic）均为无光照材质，
      // 明暗在无人机着色器里自算（见 buildSimpleMaterial / DRONE_FRAG_SHADER）。

      // 初始 lowpoly 同步建模（立即可见 + 量尺寸）；若配置为 GLB，maplibre.ts 就绪后 replaceModel 异步替换。
      applyModel(opts.droneModelName, opts.airframe, true)
      // scene 已就绪：消费 setCustomModels 在 onAdd 之前缓存的 specs（启动加载的用户模型）。
      applyCustomModels()
    },
    render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
      if (!state.model || !state.renderer || !state.map) return
      const renderer = state.renderer
      // 用官方 mainMatrix（world→clip），不是 modelViewProjectionMatrix——后者在本版会把整个图层投出视锥外（全不可见）。
      const mvp = options.defaultProjectionData.mainMatrix as number[]

      // === floating origin（camera-relative）：避免 mercator 大坐标(~0.5)在 GPU float32 下的大数减法抖动 ===
      // 取相机 mercator（5.24 无 getFreeCameraOptions，用 transform 公共 API）。
      const cll = state.map.transform.getCameraLngLat()
      const cam = MercatorCoordinate.fromLngLat([cll.lng, cll.lat], state.map.transform.getCameraAltitude())
      const camX = cam.x, camY = cam.y, camZ = cam.z
      // 临时诊断"模型不动/yaw偏"：看 pose 经纬度是否在变、姿态数值（定位后删除）。
      if ((++_diagTick) % 60 === 0) {
        console.log('[drone-fov]', {
          poseLng: state.pose.lng, poseLat: state.pose.lat,
          tx: state.tx, camX, dTx: state.tx - camX,
          yaw: state.pose.yaw, pitch: state.pose.pitch, roll: state.pose.roll,
        })
      }
      // relMvp = mainMatrix × T(cam)：mainMatrix = projection×view = projection×R×T(−cam)（标准 lookAt），
      // 右乘 T(cam) 抵消 view 里的 T(−cam) → relMvp = projection×R。顶点改用相对相机坐标后，GPU 不再碰大数。
      _camT.makeTranslation(camX, camY, camZ)
      _relMvp.fromArray(mvp).multiply(_camT)

      // 真实物理尺寸 × 用户倍率(scaleMultiplier=three.droneScale)：1=真实(多旋翼1.5m/VTOL1.7m)，>1 放大便于观察。
      // 真实米数随地图缩放自然变大变小（非屏幕固定大小）；倍率过小+缩小地图会亚像素不可见。
      const basePhysMeters = opts.airframe === 'vtol' ? 1.7 : 1.5
      const physMeters = basePhysMeters * (state.scaleMultiplier || 1)
      const modelScale = (state.meterInMerc > 0) ? (state.meterInMerc * physMeters) / state.modelMaxDim : 0
      // 抬起半个身高(modelHeight×modelScale/2，mercator 竖直)让模型"坐"在平移高度上。
      const halfH = (state.modelHeight * modelScale) / 2
    
      // 无人机 group 的模型矩阵：平移(相对相机) · 缩放 · Rx(π/2) · 姿态。
      // 不 flip Y：mercator +Y 朝南，机头(+Z 经 Rx 落在 -Y=北)若 flip 会翻到 +Y=南，yaw 偏 180°。
      // (官方示例 scale(s,-s,s) 是给机头 -Z 的 GLB 用的；我们 lowpoly 机头 +Z，故不 flip。)
      _t.makeTranslation(state.tx - camX, state.ty - camY, state.tz - camZ + halfH)
      _sclMat.makeScale(modelScale, modelScale, modelScale)
      _r.makeRotationX(Math.PI / 2)
      _att.makeRotationFromQuaternion(makeDroneQuaternionMercator(state.pose))
      state.model.group.matrix.copy(_t).multiply(_sclMat).multiply(_r).multiply(_att)
      state.model.group.matrixWorldNeedsUpdate = true
      // 桨叶自转：与主 3D 场景同源——有 PWM 数据时用 spinPropellersByPwm（电机停→桨停，物理一致）；
      // 未就绪(propPwms=null/长度不匹配/首帧 dt=0)回退固定转速恒转，保证总看得见「在飞」。
      const props = state.model.propellers
      const propNow = performance.now()
      // dt 与主 3D 同源处理：异常帧(负/过大，如切走归来)归零 → spinPropellersByPwm 内部 no-op
      // （桨冻结一帧、omega 保持，避免角速度大跳），而非钳到 0.1（钳会让低帧率桨视觉变慢、与主 3D 不一致）。
      let propDt = state.lastPropTick ? (propNow - state.lastPropTick) / 1000 : 0
      if (propDt < 0 || propDt > 0.1) propDt = 0
      state.lastPropTick = propNow
      if (state.propPwms && state.propPwms.length === props.length) {
        spinPropellersByPwm(props, state.propPwms, propDt)
      } else {
        // 未就绪(null/长度不匹配/换机型过渡)：回退固定转速恒转，保证总看得见「在飞」。
        for (let i = 0; i < props.length; i++) props[i].mesh.rotation.y += (props[i].dir || 1) * 0.45
      }

      // 线顶点改相对相机（trackPositions/routePositions 存绝对 mercator，每帧减 cam 写入 geometry）。
      offsetLinesToCamera(camX, camY, camZ)

      // 航点 floating origin：每帧 item.position = 绝对 mercator − cam；编号公告牌屏幕常量尺寸 + 朝相机。
      const wpZoom = state.map ? state.map.getZoom() : 13
      const wpLatRad = (state.pose.lat || 0) * Math.PI / 180
      const wpMpp = 156543.03392 * Math.cos(wpLatRad) / Math.pow(2, wpZoom)
      const labelLocal = state.meterInMerc > 0 ? TEXT_PX * wpMpp : 0  // 本地米（屏幕 TEXT_PX 像素）
      for (let i = 0; i < state.waypointItems.length; i++) {
        const a = state.waypointAbs[i]
        const px = a.x - camX, py = a.y - camY, pz = a.z - camZ
        state.waypointItems[i].position.set(px, py, pz)
        const lbl = state.waypointLabels[i]
        if (lbl) {
          lbl.scale.set(labelLocal, labelLocal, 1)
          // 球面公告牌：法线(+Z)直接朝相机(3D 全方向，含俯仰——往上抬相机也正对)，up=世界+Z 投影到平面。
          // xAxis = cross(up,z) → 平面 +X = 相机右侧 → 文字不镜像。setFromRotationMatrix 需正交右手系(满足)。
          let zx = -px, zy = -py, zz = -pz
          let zl = Math.hypot(zx, zy, zz)
          if (zl < 1e-12) { zx = 0; zy = 0; zz = 1 } else { zx /= zl; zy /= zl; zz /= zl }
          // yAxis = (0,0,1) − ((0,0,1)·z)·z  （世界 up 投影到平面，与法线正交）
          const dot = zz
          let yx = -dot * zx, yy = -dot * zy, yz = 1 - dot * zz
          let yl = Math.hypot(yx, yy, yz)
          if (yl < 1e-9) { yx = 0; yy = 1; yz = 0 } else { yx /= yl; yy /= yl; yz /= yl }
          // xAxis = cross(yAxis, zAxis)；再绕 up 翻 180°(X、Z 同取反)消除镜像——文字正立、平面仍朝相机。
          _bbBasis.makeBasis(
            _bbX.set(-(yy * zz - yz * zy), -(yz * zx - yx * zz), -(yx * zy - yy * zx)),
            _bbY.set(yx, yy, yz),
            _bbZ.set(-zx, -zy, -zz),
          )
          lbl.quaternion.setFromRotationMatrix(_bbBasis)
        }
      }

      // 自定义模型 floating origin：每帧 item.object.matrix = T(abs−cam+halfH)·S·Rx(π/2)·R(yaw,pitch,roll)。
      // 与无人机同构（有姿态），照搬其 matrix 折叠；scale 用 meterInMerc 把基准米数换算成 mercator 单位。
      if (state.customModelGroup && state.meterInMerc > 0) {
        for (const it of state.customModels) {
          const obj = it.object
          if (!obj) continue
          const physMeters = CUSTOM_MODEL_BASE_METERS * (it.scale || 1)
          const modelScale = (state.meterInMerc * physMeters) / it.modelMaxDim
          const halfH = (it.modelHeight * modelScale) / 2
          _t.makeTranslation(it.abs.x - camX, it.abs.y - camY, it.abs.z - camZ + halfH)
          _sclMat.makeScale(modelScale, modelScale, modelScale)
          _r.makeRotationX(Math.PI / 2)
          _att.makeRotationFromQuaternion(makeDroneQuaternionMercator({ roll: it.roll, pitch: it.pitch, yaw: it.yaw }))
          obj.matrix.copy(_t).multiply(_sclMat).multiply(_r).multiply(_att)
          obj.matrixWorldNeedsUpdate = true
        }
      }

      // 三轴手柄（编辑模式）：跟随选中模型（浮动原点 abs−cam）+ 屏幕固定尺寸（wpMpp 反算，缩放地图大小不变）。
      if (state.gizmoGroup) {
        // 每帧按 gizmoTarget + 模型就绪强制 visible（防收起时漏隐藏）：有 target 且模型存在才显示。
        const item = state.gizmoTarget ? state.customModels.find((m) => m.name === state.gizmoTarget) : null
        state.gizmoGroup.visible = !!(item && state.meterInMerc > 0)
        if (item && state.meterInMerc > 0) {
          state.gizmoGroup.position.set(item.abs.x - camX, item.abs.y - camY, item.abs.z - camZ)
          // 本地 1 单位 = 模型 mercator 尺寸；buildGizmo 里 LEN=1.0/RAD=0.05 决定轴长/粗细。
          const physMeters = CUSTOM_MODEL_BASE_METERS * (item.scale || 1)
          state.gizmoGroup.scale.setScalar(state.meterInMerc * physMeters)
        }
      }

      // 只 resetState + render（同官方示例）——之前多加了 setViewport/updateMatrixWorld，
      // 会污染共享 GL 上下文、把 MapLibre 的拖拽/旋转鼠标操作搞失效。
      renderer.resetState()
      state.camera.projectionMatrix.copy(_relMvp)
      // 同步逆矩阵：raycaster.setFromCamera 内部 unproject 需要（裸 Camera 不自动维护）。
      state.camera.projectionMatrixInverse.copy(_relMvp).invert()
      // 清深度缓冲后再画本图层场景：无人机材质走 depthTest（DoubleSide 靠深度正确自遮挡、消除背面穿透脏染），
      // 但清掉地形深度 → 无人机不会被地形错误隐藏（保留原 depthTest:false 的「恒可见」altitude 兜底，
      // 见 [[maplibre-three-custom-layer]]）。线/航点 depthTest:false，不读深度，不受影响。
      renderer.clearDepth()
      renderer.render(state.scene, state.camera)
    },
    onRemove(_map: MLMap, _gl: WebGLRenderingContext | WebGL2RenderingContext) {
      dispose()
    },
  }

  function disposeLine(line: THREE.Line | null): void {
    if (!line) return
    line.geometry.dispose()
    ;(line.material as THREE.Material).dispose()
  }

  function dispose(): void {
    // 幂等：store 显式调一次，map.remove()→onRemove 又调一次；首次清完即置空。
    const model = state.model
    const renderer = state.renderer
    state.model = null as unknown as BuiltDroneModel
    state.renderer = null as unknown as THREE.WebGLRenderer
    state.map = null
    disposeLine(state.trackLine); state.trackLine = null
    state.trackAllCoords = null
    if (state.routeLine) {
      state.routeLine.geometry.dispose()
      ;(state.routeLine.material as THREE.Material).dispose()
      state.routeLine = null
    }
    state.routePositions = null
    state.routeAllCoords = null
    if (state.waypointGroup) {
      disposeWaypointGroup(state.waypointGroup)
      if (state.scene) state.scene.remove(state.waypointGroup)
      state.waypointGroup = null
    }
    state.waypointAbs = []
    state.waypointItems = []
    state.waypointAllPts = []
    // 自定义模型：释放各 item 的 clone object + gltfCache 根（含几何/材质/纹理），清空 group。
    for (const it of state.customModels) { if (it.object) disposeObject3D(it.object) }
    state.customModels = []
    state.gltfCache.forEach((root) => disposeObject3D(root))
    state.gltfCache.clear()
    if (state.customModelGroup) {
      if (state.scene) state.scene.remove(state.customModelGroup)
      state.customModelGroup = null
    }
    if (state.gizmoGroup) {
      if (state.scene) state.scene.remove(state.gizmoGroup)
      disposeObject3D(state.gizmoGroup)
      state.gizmoGroup = null
    }
    state.gizmoTarget = null
    if (state.posMarker) {
      state.posMarker.geometry.dispose()
      ;(state.posMarker.material as THREE.Material).dispose()
      state.posMarker = null
    }
    state.probe.forEach((m) => {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    })
    state.probe = []
    if (model) {
      // 释放几何/材质/纹理（GLB 纹理也要，否则换日志累积泄漏）。
      disposeObject3D(model.group)
    }
    if (renderer) {
      // renderer 与 MapLibre 共享 GL 上下文——dispose 只清 three.js 的 program/buffer 跟踪，
      // 不销毁上下文（上下文归 MapLibre，由 map.remove() 释放）。
      renderer.dispose()
    }
  }

  return { layer, state, setPose, setHome, setScaleMultiplier, setShaded, setPropellerPwms, replaceModel, setTrack, setRoute, setWaypoints, setCustomModels, updateCustomModelPose, setGizmoTarget, hitTestGizmo, dispose }
}
