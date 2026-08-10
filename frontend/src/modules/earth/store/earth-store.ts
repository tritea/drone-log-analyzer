import { ref } from 'vue'
import { defineStore } from 'pinia'
import * as Cesium from 'cesium'
import { runtime, type EarthRuntime, type MapLibreLockHandlers } from '@/modules/shared/runtime'
import type { TemplateRefTarget } from '@/modules/shared/utils/dom'
import { wgs84ToGcj02, gcj02ToWgs84 } from '@/modules/shared/utils/geo/gcj02'
import { resolveDroneModelName, pwmToAngularVelocity } from '@/modules/shared/utils/drone-model'
import { createTerrariumTerrainProvider } from '@/modules/earth/renderer/terrain-provider'
import { measureGlbBox } from '@/modules/earth/renderer/glb-box'
import { useCurveManagerStore } from '@/modules/curves'
import { TRAJ_MAX_POINTS, THREE_UNITS_PER_METER, THREE_PROPELLER_ORDER, THREE_PROPELLER_ACCEL_TAU, THREE_PROPELLER_DECEL_TAU } from '@/constants'
import { useUiStore } from '@/modules/shared/ui-store'
import { useScene3dStore } from '@/modules/scene-3d'
import { useMapStateStore } from '@/modules/shared/map-state'
import { useCommandsStore } from '@/modules/commands'
import { useLogStore } from '@/modules/log'
import { useCustomModelsStore } from '@/modules/custom-models'
import { useCustomModelGroupsStore, expandGroupToSpecs } from '@/modules/custom-models'
import { useTilesetsStore, tilesetEntryUrl, tilesetHasManualPosition } from '@/modules/tilesets'
import type { Tileset } from '@/modules/tilesets'
import type { CustomModelSpec } from '@/modules/map-3d/renderer/drone-layer'
import type { TelemetrySample } from '@/types'

const LOCK_SEED_PITCH = -40
const LOCK_RANGE_DEFAULT = 80        
const LOCK_RANGE_MIN = 5
const LOCK_RANGE_MAX = 20000
// GLB 机头轴与 Cesium heading 参考差约 90°（实测"多了 90 度"），补偿之；若整体方向反了改 +Math.PI/2。
const DRONE_HEADING_OFFSET = -Math.PI / 2

const EMPTY_CARTESIANS: Cesium.Cartesian3[] = []

export const useEarthStore = defineStore('earth', () => {
  const earthEl = ref<HTMLElement | null>(null)
  function registerEarthMain(el: TemplateRefTarget): void {
    earthEl.value = el instanceof HTMLElement ? el : null
  }

  let lastActive = false
  let cmdRequested = false
  let lastModelsKey = ''
  let lastTilesetsKey = ''

  let dronePos: Cesium.Cartesian3 = Cesium.Cartesian3.fromDegrees(0, 0, 0)
  let droneOri: Cesium.Quaternion = Cesium.Quaternion.IDENTITY
  const dronePosProp = new Cesium.ConstantPositionProperty(dronePos)
  const droneOriProp = new Cesium.ConstantProperty(droneOri)
  const droneScaleProp = new Cesium.ConstantProperty(1)
  let flownCartesians: Cesium.Cartesian3[] = EMPTY_CARTESIANS
  let flownEndIdx = -1
  const trackPositionsProp = new Cesium.CallbackProperty((): Cesium.Cartesian3[] => {
    const rt = runtime.earthView
    if (!rt || !rt.trackCoordsFull.length) return EMPTY_CARTESIANS
    const ts = useScene3dStore()
    const idx = ts.currentThreeSampleIndex(ts.three.playback.timeMs)
    const end = Math.max(1, idx + 1)
    if (end !== flownEndIdx) {
      const start = Math.max(0, end - TRAJ_MAX_POINTS)
      flownCartesians = rt.trackCoordsFull.slice(start, end).map((c) => Cesium.Cartesian3.fromDegrees(c[0], c[1], c[2]))
      flownEndIdx = end
    }
    return flownCartesians
  }, false)

  function sampleLatLng(s: TelemetrySample, o: { lat0: number; lng0: number; cosLat: number }): { lat: number; lng: number } {
    const north = s.north != null ? s.north : -s.z / THREE_UNITS_PER_METER
    const east = s.east != null ? s.east : s.x / THREE_UNITS_PER_METER
    return { lat: o.lat0 + north / 110540, lng: o.lng0 + east / (o.cosLat * 111320) }
  }

  function coordFor(s: TelemetrySample, o: { lat0: number; lng0: number; cosLat: number }): { lat: number; lng: number } {
    const ll = sampleLatLng(s, o)
    if (!useMapStateStore().mapCoordNeedsGcj02()) return ll
    const [lat, lng] = wgs84ToGcj02(ll.lat, ll.lng)
    return { lat, lng }
  }


  function applyImagery(rt: EarthRuntime, providerId: string): void {
    rt.viewer.imageryLayers.removeAll()
    const url = '/map/provider/' + providerId + '/{z}/{x}/{y}'
    const attr = useMapStateStore().currentAttribution()
    const provider = new Cesium.UrlTemplateImageryProvider({ url, maximumLevel: 18, credit: attr || undefined })
    rt.viewer.imageryLayers.addImageryProvider(provider)
    rt.providerId = providerId
  }

  function applyTerrain(): void {
    const rt = runtime.earthView
    if (!rt) return
    const mapStore = useMapStateStore()
    const want = mapStore.map.terrainOn && !mapStore.mapCoordNeedsGcj02()
    if (want && !rt.terrainOn) {
      rt.viewer.terrainProvider = createTerrariumTerrainProvider()
      rt.terrainOn = true
      refreshHomeGroundElev(rt)
    } else if (!want && rt.terrainOn) {
      rt.viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider()
      rt.terrainOn = false
      rt.homeGroundElev = 0
    }
  }

  function refreshHomeGroundElev(rt: EarthRuntime): void {
    const origin = useScene3dStore().three.telemetry.meta.geoOrigin
    if (!origin || !rt.terrainOn) return
    const pos = [Cesium.Cartographic.fromDegrees(origin.lng0, origin.lat0)]
    Cesium.sampleTerrainMostDetailed(rt.viewer.terrainProvider, pos)
      .then((updated: Cesium.Cartographic[]): void => {
        if (rt === runtime.earthView && updated[0]) rt.homeGroundElev = updated[0].height
      })
      .catch((): void => {  })
  }


  // 自由视角鼠标映射：右键拖拽 → 旋转（默认 Cesium 右键是连续缩放）；缩放归给滚轮 + 中键拖拽。
  function configureFreeCameraControls(viewer: Cesium.Viewer): void {
    const ssc = viewer.scene.screenSpaceCameraController
    ssc.enableRotate = true
    ssc.enableZoom = true
    ssc.enableTilt = true
    ssc.enableLook = true
    // 左键拖拽旋转视角（绕地心）；右键留给自定义 orbit（绕点击点旋转，见 bindEarthOrbitControls）。
    // 禁用 look，否则其默认 [RIGHT_DRAG] 会抢走右键。
    ssc.rotateEventTypes = [Cesium.CameraEventType.LEFT_DRAG]
    ssc.lookEventTypes = []
    ssc.zoomEventTypes = [Cesium.CameraEventType.MIDDLE_DRAG, Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH]
    ;(viewer.canvas as HTMLCanvasElement).addEventListener('contextmenu', (e: Event): void => { e.preventDefault() })
  }

  // 右键「绕点击点旋转」：右键按下射线 pick 地表点为锚，拖动改 heading/pitch 绕锚转（仿无人机锁定视角）。
  // 按下时禁用 ssc 防冲突，松开解除锚定（lookAtTransform IDENTITY）并恢复 ssc。
  function bindEarthOrbitControls(rt: EarthRuntime): void {
    const canvas = rt.viewer.canvas as HTMLCanvasElement
    let orbiting = false
    let anchor: Cesium.Cartesian3 | null = null
    let heading = 0
    let pitch = 0
    let range = 0
    let lastX = 0
    let lastY = 0

    // 锚点取屏幕中心对应的地表点（而非右键点击位置）：绕中心旋转视觉最稳，中心点不动画面绕它转。
    const pickAnchor = (): Cesium.Cartesian3 | null => {
      const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2)
      const ray = rt.viewer.camera.getPickRay(center)
      if (!ray) return null
      return rt.viewer.scene.globe.pick(ray, rt.viewer.scene)
        ?? rt.viewer.camera.pickEllipsoid(center, rt.viewer.scene.globe.ellipsoid)
    }

    const onDown = (e: PointerEvent): void => {
      if (rt.lockActive) return  // 锁定模式由 lock handlers 接管右键
      if (e.button !== 2) return
      const picked = pickAnchor()
      if (!picked) return
      anchor = picked
      orbiting = true
      lastX = e.clientX
      lastY = e.clientY
      range = Cesium.Cartesian3.distance(rt.viewer.camera.position, anchor)
      heading = Cesium.Math.toDegrees(rt.viewer.camera.heading)
      pitch = Cesium.Math.toDegrees(rt.viewer.camera.pitch)
      setEarthBuiltInControls(rt.viewer, false)
      try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    const onMove = (e: PointerEvent): void => {
      if (!orbiting || !anchor) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      heading = (heading - dx * 0.3) % 360
      pitch = Math.max(-89.9, Math.min(89.9, pitch - dy * 0.3))
      rt.viewer.camera.lookAt(anchor, new Cesium.HeadingPitchRange(Cesium.Math.toRadians(heading), Cesium.Math.toRadians(pitch), range))
    }
    const onUp = (e: PointerEvent): void => {
      if (e.button !== 2 || !orbiting) return
      orbiting = false
      anchor = null
      rt.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
      setEarthBuiltInControls(rt.viewer, true)
      try { canvas.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    rt.orbitHandlers = { canvas, onDown, onMove, onUp }
  }

  function ensureEarth(): void {
    if (runtime.earthView) return
    const el = earthEl.value
    if (!el) return
    const cms = useCustomModelsStore()
    if (!cms.loaded) cms.loadCustomModels().then((): void => syncCustomModels())
    const cmg = useCustomModelGroupsStore()
    if (!cmg.loaded) cmg.loadModelGroups().then((): void => syncCustomModels())
    const cts = useTilesetsStore()
    if (!cts.loaded) cts.loadTilesets().then((): void => syncTilesets())

    const mapStore = useMapStateStore()
    const threeStore = useScene3dStore()
    const providerId = mapStore.map.providerId || 'esri_satellite'

    const viewer = new Cesium.Viewer(el, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      navigationInstructionsInitiallyVisible: false,
    })
    viewer.scene.globe.depthTestAgainstTerrain = true
    configureFreeCameraControls(viewer)

    const rt: EarthRuntime = {
      viewer,
      droneEntity: null,
      droneModelName: '',
      droneModelUri: '',
      droneBaseScale: 0,
      droneLiftPerScale: 0,
      propellerFuncs: [],
      removeDroneEntity: null,
      trackEntity: null,
      routeEntity: null,
      waypointEntities: [],
      customModelEntities: new Map(),
      customModelSpecs: new Map(),
      customModelProps: new Map(),
      pickHandler: null,
      trackCoordsFull: [],
      homeGroundElev: 0,
      providerId,
      terrainOn: false,
      lockActive: false,
      lockHeading: 0,
      lockPitch: LOCK_SEED_PITCH,
      lockRange: LOCK_RANGE_DEFAULT,
      lockAppliedKey: '',
      lockHandlers: null,
      orbitHandlers: null,
      lastTimeMs: -1,
      lastTeleKey: '',
      lastMissionKey: -1,
      tilesetPrimitives: new Map(),
      tilesetLoading: new Set(),
      tilesetBaseCarto: new Map(),
      tilesetBaseCenter: new Map(),
      tilesetGroundH: new Map(),
      propellerNodes: [],
      propellerDirs: [],
      propellerAngles: [],
      propellerOmegas: [],
      propellerLastTick: 0,
      removePropRender: null,
    }
    runtime.earthView = rt

    applyImagery(rt, providerId)
    applyTerrain()

    bindEarthPickHandler(rt)
    bindEarthOrbitControls(rt)

    rt.trackEntity = viewer.entities.add({
      polyline: {
        positions: trackPositionsProp,
        width: 2,
        material: Cesium.Color.fromCssColorString('#2563eb'),
        arcType: Cesium.ArcType.NONE,
      },
    })

    const origin = threeStore.three.telemetry.meta.geoOrigin
    if (origin) {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(origin.lng0, origin.lat0, 2000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-50), roll: 0 },
      })
    }

    rebuildEarthPath()
    rebuildEarthWaypoints()
    fitToTrack()
  }

  function disposeEarth(): void {
    const rt = runtime.earthView
    if (!rt) return
    if (rt.lockHandlers) unbindEarthLockControls(rt)
    if (rt.orbitHandlers) {
      const h = rt.orbitHandlers
      h.canvas.removeEventListener('pointerdown', h.onDown)
      h.canvas.removeEventListener('pointermove', h.onMove)
      h.canvas.removeEventListener('pointerup', h.onUp)
      h.canvas.removeEventListener('pointercancel', h.onUp)
      rt.orbitHandlers = null
    }
    if (rt.pickHandler) {
      rt.pickHandler.destroy()
      rt.pickHandler = null
    }
    if (rt.removePropRender) {
      rt.removePropRender()
      rt.removePropRender = null
    }
    try {
      rt.viewer.destroy()
    } catch {
    }
    runtime.earthView = null
    lastActive = false
    cmdRequested = false
    flownEndIdx = -1
    lastModelsKey = ''
    lastTilesetsKey = ''
  }


  function rebuildEarthPath(): void {
    const rt = runtime.earthView
    if (!rt) return
    const threeStore = useScene3dStore()
    const samples = threeStore.three.telemetry.samples
    const origin = threeStore.three.telemetry.meta.geoOrigin
    if (!samples.length || !origin) {
      rt.trackCoordsFull = []
      return
    }
    const coords: number[][] = []
    for (let i = 0; i < samples.length; i++) {
      const c = coordFor(samples[i], origin)
      coords.push([c.lng, c.lat, samples[i].altitude ?? 0])
    }
    rt.trackCoordsFull = coords
    rt.lastTeleKey = samples.length + '|' + origin.lat0 + ',' + origin.lng0
    flownEndIdx = -1 
  }

  function rebuildEarthWaypoints(): void {
    const rt = runtime.earthView
    if (!rt) return
    for (const e of rt.waypointEntities) rt.viewer.entities.remove(e)
    rt.waypointEntities = []
    const threeStore = useScene3dStore()
    const mapStore = useMapStateStore()
    const pts = threeStore.missionLatLngPoints()
    if (!pts || !pts.length) {
      if (rt.routeEntity) {
        rt.viewer.entities.remove(rt.routeEntity)
        rt.routeEntity = null
      }
      return
    }
    const gcj = mapStore.mapCoordNeedsGcj02()
    const routePositions: Cesium.Cartesian3[] = []
    for (const p of pts) {
      let lat = p.lat
      let lng = p.lng
      if (gcj) {
        const [glat, glng] = wgs84ToGcj02(p.lat, p.lng)
        lat = glat
        lng = glng
      }
      const h = p.alt ?? 0
      routePositions.push(Cesium.Cartesian3.fromDegrees(lng, lat, h))
      const isHome = !!p.isHome
      rt.waypointEntities.push(
        rt.viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lng, lat, h),
          point: {
            pixelSize: 10,
            color: isHome ? Cesium.Color.fromCssColorString('#16a34a') : Cesium.Color.fromCssColorString('#ea580c'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY, 
          },
          label: {
            text: p.label ?? '',
            font: '14px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -16),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      )
    }
    if (rt.routeEntity) rt.viewer.entities.remove(rt.routeEntity)
    rt.routeEntity = rt.viewer.entities.add({
      polyline: {
        positions: routePositions,
        width: 2,
        material: Cesium.Color.fromCssColorString('#ea580c'),
        arcType: Cesium.ArcType.NONE,
      },
    })
    const active = threeStore.activeMissionVersionAt(threeStore.three.playback.timeMs)
    rt.lastMissionKey = active ? active.startTime : -1
  }

  function fitToTrack(): void {
    const rt = runtime.earthView
    if (!rt || !rt.trackCoordsFull.length) return
    const pts = rt.trackCoordsFull.map((c) => Cesium.Cartesian3.fromDegrees(c[0], c[1], c[2]))
    const sphere = Cesium.BoundingSphere.fromPoints(pts)
    rt.viewer.camera.flyToBoundingSphere(sphere, {
      duration: 0,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), 0),
    })
  }

  function focusDrone(): void {
    const rt = runtime.earthView
    if (!rt) return
    const mapStore = useMapStateStore()
    if (mapStore.map.lockView && rt.lockActive) {
      rt.lockPitch = LOCK_SEED_PITCH
      rt.lockAppliedKey = ''
      return
    }
    const threeStore = useScene3dStore()
    const samples = threeStore.three.telemetry.samples
    const origin = threeStore.three.telemetry.meta.geoOrigin
    if (!samples.length || !origin) return
    const timeMs = threeStore.three.playback.timeMs
    const idx = threeStore.currentThreeSampleIndex(timeMs)
    const sample = threeStore.sampleAtTime(timeMs) || samples[idx]
    if (!sample) return
    const c = coordFor(sample, origin)
    const h = sampleHeight(threeStore, rt, sample)
    const pos = Cesium.Cartesian3.fromDegrees(c.lng, c.lat, h)
    rt.viewer.camera.lookAt(pos, new Cesium.HeadingPitchRange(rt.viewer.camera.heading, Cesium.Math.toRadians(-35), 300))
    rt.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  }


  function droneModelUri(name: string): string {
    return 'vendor/' + (name === 'VTOL' ? 'VTOL' : 'QUAD-X') + '.glb'
  }

  function rebuildDroneEntity(rt: EarthRuntime, name: string): void {
    // 清理旧 GLB 实体。
    if (rt.droneEntity) {
      rt.viewer.entities.remove(rt.droneEntity)
      rt.droneEntity = null
    }
    // 桨叶配置：机型→桨序，取 name/dir/func；angles/omegas 清零。
    // 非 VTOL 一律按 QUAD-X 桨序（GLB 只有 QUAD-X/VTOL，HEXA/OCTO 占位）。
    const orderName = name === 'VTOL' ? 'VTOL' : 'QUAD-X'
    const cfg = THREE_PROPELLER_ORDER[orderName] ?? THREE_PROPELLER_ORDER['QUAD-X']!
    rt.propellerNodes = cfg.map((p) => p.name)
    rt.propellerDirs = cfg.map((p) => p.dir)
    rt.propellerFuncs = cfg.map((p, i) => (p.func != null ? p.func : 33 + i))
    rt.propellerAngles = cfg.map(() => 0)
    rt.propellerOmegas = cfg.map(() => 0)
    rt.propellerLastTick = 0

    // GLB 模型：nodeTransformations 对桨叶节点施加绕本地 Y 的旋转（GLB 节点 rotation=identity，转轴即 Y）；
    // ModelGraphics.nodeTransformations 是 PropertyBag，rotation 用 CallbackProperty 每帧读累积角度返回四元数。
    const uri = droneModelUri(name)
    const nodeTransformations: Record<string, Cesium.TranslationRotationScale> = {}
    for (let i = 0; i < cfg.length; i++) {
      const idx = i
      const rotation = new Cesium.CallbackProperty(
        (_time: Cesium.JulianDate, result: Cesium.Quaternion): Cesium.Quaternion =>
          Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Y, rt.propellerAngles[idx] ?? 0, result),
        false,
      )
      const trs = new Cesium.TranslationRotationScale(
        Cesium.Cartesian3.ZERO,
        Cesium.Quaternion.IDENTITY,
        Cesium.Cartesian3.ONE,
      )
      // TRS.rotation 类型声明为 Quaternion(值)，但 PropertyBag 运行时按 Property 求值 → 断言塞入 CallbackProperty。
      ;(trs as unknown as { rotation: Cesium.CallbackProperty }).rotation = rotation
      nodeTransformations[cfg[i].name] = trs
    }
    rt.droneEntity = rt.viewer.entities.add({
      position: dronePosProp,
      orientation: droneOriProp,
      model: { uri, scale: droneScaleProp, minimumPixelSize: 48, nodeTransformations },
    })
    // 量 GLB 原生尺寸前先置 0：effectiveScale=0 时仅 minimumPixelSize(48px) 兜底显示，绝不「超级大」。
    rt.droneModelUri = uri
    rt.droneBaseScale = 0
    rt.droneLiftPerScale = 0
    void measureDroneMetrics(rt, uri, name)
    rt.droneModelName = name
    // 挂 preRender 推进桨叶角度（仅挂一次，viewer 生命周期内复用；disposeEarth 时移除）：
    // nodeTransformations 的 CallbackProperty 每帧读 rt.propellerAngles，spinEarthPropellers 用真实 PWM 推进它。
    if (!rt.removePropRender) {
      rt.removePropRender = rt.viewer.scene.preRender.addEventListener((): void => spinEarthPropellers(rt))
    }
  }

  // 读真实电机 PWM（不依赖 3D 视图/threeView）：从 three.curves.motor + SERVO_FUNC→通道映射(servoFuncToChannelMap)
  // + 曲线管理器取每桨 PWM。与主 3D 的 propellerPwm 同源，但脱离 threeView.mainPropellers——earth 激活时 3D 场景常未建，
  // 旧路径 currentPropellerPwms 因此返回 [] 致桨永远不转。无电机曲线→[]（无数据→停，按用户「没 PWM 怎么还转」不假转）；
  // 电机停(PWM≈1000)→pwmToAngularVelocity=0→桨停（物理一致）。
  function earthPropellerPwms(rt: EarthRuntime, t: number): Array<number | null> {
    const n = rt.propellerFuncs.length
    if (!n) return []
    const threeStore = useScene3dStore()
    const motors = threeStore.three.curves.motor as Array<{ type?: string; field?: string }> | undefined
    const list = motors && motors.length ? motors : null
    if (!list) return []
    const funcMap = threeStore.servoFuncToChannelMap()
    const cm = useCurveManagerStore()
    const out: Array<number | null> = []
    for (let i = 0; i < n; i++) {
      const func = rt.propellerFuncs[i]
      let curve = list[i]
      if (funcMap && funcMap[func] != null) {
        const field = 'C' + funcMap[func]
        for (let k = 0; k < list.length; k++) {
          if (list[k] && list[k].field === field) { curve = list[k]; break }
        }
      }
      out.push(curve && curve.type && curve.field ? cm.getValueAt(curve.type, curve.field, t, null) : null)
    }
    return out
  }

  // 测绘地球桨叶推进（preRender 每帧）：wall-clock dt → 真实 PWM 驱动 → 一阶滤波 → 累加角度。
  // 与主3D(spinPropellersByPwm) 同源：桨叶严格跟随电机 PWM——无电机数据→停转，电机停→桨停（不假转）。
  function spinEarthPropellers(rt: EarthRuntime): void {
    const n = rt.propellerNodes.length
    if (!n) return
    const now = performance.now()
    let dt = rt.propellerLastTick ? (now - rt.propellerLastTick) / 1000 : 0
    if (dt < 0 || dt > 0.1) dt = 0
    rt.propellerLastTick = now
    if (dt <= 0) return
    const pwms = earthPropellerPwms(rt, useScene3dStore().three.playback.timeMs)
    const havePwm = pwms.length === n
    const dirs = rt.propellerDirs
    const angles = rt.propellerAngles
    const omegas = rt.propellerOmegas
    for (let i = 0; i < n; i++) {
      // 无 PWM（pwms 为空/长度不符/单桨无值）→ target=0 → omega 一阶减到 0 → 桨停。
      const target = havePwm ? pwmToAngularVelocity(pwms[i]) : 0
      const tau = target > omegas[i] ? THREE_PROPELLER_ACCEL_TAU : THREE_PROPELLER_DECEL_TAU
      let k = dt / tau
      if (k > 1) k = 1
      omegas[i] += (target - omegas[i]) * k
      angles[i] += dirs[i] * omegas[i] * dt
    }
  }

  // 异步量 GLB 包围盒 → 算出归一化缩放与 halfH 抬升系数，写回 rt。stale 守卫：await 期间若 dispose 或换模型则不写。
  async function measureDroneMetrics(rt: EarthRuntime, uri: string, name: string): Promise<void> {
    const box = await measureGlbBox(uri)
    if (rt !== runtime.earthView || rt.droneModelUri !== uri) return
    const physBase = name === 'VTOL' ? 1.7 : 1.5
    const baseScale = physBase / box.maxDim
    rt.droneBaseScale = baseScale
    rt.droneLiftPerScale = Math.max(0, -box.minY) * baseScale
  }


  function setEarthBuiltInControls(viewer: Cesium.Viewer, enabled: boolean): void {
    const ssc = viewer.scene.screenSpaceCameraController
    ssc.enableTranslate = enabled
    ssc.enableRotate = enabled
    ssc.enableZoom = enabled
    ssc.enableTilt = enabled
    ssc.enableLook = enabled
  }

  function enterLock(rt: EarthRuntime): void {
    setEarthBuiltInControls(rt.viewer, false)
    rt.lockHeading = Cesium.Math.toDegrees(rt.viewer.camera.heading)
    rt.lockPitch = LOCK_SEED_PITCH
    rt.lockRange = LOCK_RANGE_DEFAULT
    rt.lockAppliedKey = ''
    bindEarthLockControls(rt)
  }

  function exitLock(rt: EarthRuntime): void {
    unbindEarthLockControls(rt)
    rt.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
    setEarthBuiltInControls(rt.viewer, true)
  }

  function bindEarthLockControls(rt: EarthRuntime): void {
    const canvas = rt.viewer.canvas as HTMLCanvasElement
    let dragging = false
    let lastX = 0
    let lastY = 0
    const onDown = (e: PointerEvent): void => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
      }
    }
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      rt.lockHeading = (rt.lockHeading - dx * 0.25) % 360
      rt.lockPitch = Math.max(-89, Math.min(0, rt.lockPitch - dy * 0.25))
      rt.lockAppliedKey = ''
    }
    const onUp = (e: PointerEvent): void => {
      dragging = false
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
      }
    }
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const ratio = e.deltaY > 0 ? 1.15 : 1 / 1.15
      rt.lockRange = Math.max(LOCK_RANGE_MIN, Math.min(LOCK_RANGE_MAX, rt.lockRange * ratio))
      rt.lockAppliedKey = ''
    }
    const onCtx = (e: Event): void => {
      e.preventDefault()
    } 
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onCtx)
    rt.lockHandlers = { canvas, onDown, onMove, onUp, onWheel, onCtx }
  }

  function unbindEarthLockControls(rt: EarthRuntime): void {
    const h = rt.lockHandlers
    if (!h) return
    h.canvas.removeEventListener('pointerdown', h.onDown)
    h.canvas.removeEventListener('pointermove', h.onMove)
    h.canvas.removeEventListener('pointerup', h.onUp)
    h.canvas.removeEventListener('pointercancel', h.onUp)
    h.canvas.removeEventListener('wheel', h.onWheel)
    h.canvas.removeEventListener('contextmenu', h.onCtx)
    rt.lockHandlers = null
  }


  function sampleHeight(threeStore: ReturnType<typeof useScene3dStore>, rt: EarthRuntime, sample: TelemetrySample): number {
    return threeStore.positionAltIsMSL() ? sample.altitude ?? 0 : rt.homeGroundElev + (sample.altitude ?? 0)
  }

  function updateEarthLive(): void {
    const rt = runtime.earthView
    if (!rt) return
    const threeStore = useScene3dStore()
    const mapStore = useMapStateStore()
    if (rt.trackEntity) rt.trackEntity.show = mapStore.map.showPath
    if (rt.routeEntity) rt.routeEntity.show = mapStore.map.showRoute
    for (const w of rt.waypointEntities) w.show = mapStore.map.showWaypoints

    const samples = threeStore.three.telemetry.samples
    const origin = threeStore.three.telemetry.meta.geoOrigin
    if (!samples.length || !origin) return
    const timeMs = threeStore.three.playback.timeMs
    const idx = threeStore.currentThreeSampleIndex(timeMs)
    const sample = threeStore.sampleAtTime(timeMs) || samples[idx]
    if (!sample) return

    const c = coordFor(sample, origin)
    const h = sampleHeight(threeStore, rt, sample)
    const ds = mapStore.map.droneScale || 1
    const yaw = Cesium.Math.toRadians(sample.yaw || 0)
    const pitch = Cesium.Math.toRadians(sample.pitch || 0)
    const roll = Cesium.Math.toRadians(sample.roll || 0)
    // GLB：先归一化到 ~1.5m/1.7m（droneBaseScale）再 × droneScale（直接乘原生米数会「超级大」）；
    // droneBaseScale=0（未量完）时 effectiveScale=0，仅 minimumPixelSize 兜底。halfH 抬升让模型坐落不陷地。
    droneScaleProp.setValue(rt.droneBaseScale * ds)
    const halfH = rt.droneLiftPerScale * ds
    dronePos = Cesium.Cartesian3.fromDegrees(c.lng, c.lat, h + halfH)
    dronePosProp.setValue(dronePos)
    droneOri = Cesium.Transforms.headingPitchRollQuaternion(dronePos, new Cesium.HeadingPitchRoll(yaw + DRONE_HEADING_OFFSET, pitch, roll))
    droneOriProp.setValue(droneOri)

    const wantLock = mapStore.map.lockView
    if (wantLock !== rt.lockActive) {
      rt.lockActive = wantLock
      if (wantLock) enterLock(rt)
      else exitLock(rt)
    }
    if (rt.lockActive) {
      const key =
        dronePos.x.toFixed(1) + ',' + dronePos.y.toFixed(1) + ',' + dronePos.z.toFixed(1) + ',' +
        rt.lockHeading.toFixed(2) + ',' + rt.lockPitch.toFixed(2) + ',' + rt.lockRange.toFixed(1)
      if (key !== rt.lockAppliedKey) {
        rt.lockAppliedKey = key
        rt.viewer.camera.lookAt(
          dronePos,
          new Cesium.HeadingPitchRange(Cesium.Math.toRadians(rt.lockHeading), Cesium.Math.toRadians(rt.lockPitch), rt.lockRange),
        )
      }
    }
  }

  function isGltfUrl(url: string): boolean {
    return /\.(glb|gltf)(\?|$)/i.test(url)
  }

  function buildCustomSpecs(): CustomModelSpec[] {
    const cms = useCustomModelsStore()
    const cmg = useCustomModelGroupsStore()
    const specs: CustomModelSpec[] = cms.models.map((m) => ({
      name: m.name, url: cms.modelUrl(m.file), lon: m.lon, lat: m.lat, alt: m.alt,
      yaw: m.yaw, pitch: m.pitch, roll: m.roll, scale: m.scale, hidden: !!m.hidden,
    }))
    for (const g of cmg.groups) for (const s of expandGroupToSpecs(g, cms.modelUrl)) specs.push(s)
    return specs
  }

  function applySpecToHandle(rt: EarthRuntime, s: CustomModelSpec, h: { pos: Cesium.ConstantPositionProperty; ori?: Cesium.ConstantProperty; scaleProp?: Cesium.ConstantProperty }): void {
    let lon = s.lon
    let lat = s.lat
    if (useMapStateStore().mapCoordNeedsGcj02()) {
      const [glat, glng] = wgs84ToGcj02(s.lat, s.lon)
      lat = glat
      lon = glng
    }
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, rt.homeGroundElev + (s.alt || 0))
    h.pos.setValue(pos)
    if (h.ori) {
      h.ori.setValue(
        Cesium.Transforms.headingPitchRollQuaternion(
          pos,
          new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(s.yaw || 0), Cesium.Math.toRadians(s.pitch || 0), Cesium.Math.toRadians(s.roll || 0)),
        ),
      )
    }
    if (h.scaleProp) h.scaleProp.setValue(s.scale ?? 1)
  }

  function syncCustomModels(): void {
    const rt = runtime.earthView
    if (!rt) return
    for (const e of rt.customModelEntities.values()) rt.viewer.entities.remove(e)
    rt.customModelEntities.clear()
    rt.customModelProps.clear()
    rt.customModelSpecs.clear()
    for (const s of buildCustomSpecs()) {
      rt.customModelSpecs.set(s.name, s)
      if (s.hidden || !s.url) continue 
      const pos = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(0, 0, 0))
      if (isGltfUrl(s.url)) {
        const ori = new Cesium.ConstantProperty(Cesium.Quaternion.IDENTITY)
        const scaleProp = new Cesium.ConstantProperty(s.scale ?? 1)
        const e = rt.viewer.entities.add({
          name: s.name,
          position: pos,
          orientation: ori,
          model: { uri: s.url, scale: scaleProp, minimumPixelSize: 24 },
        })
        rt.customModelEntities.set(s.name, e)
        rt.customModelProps.set(s.name, { pos, ori, scaleProp })
      } else {
        const e = rt.viewer.entities.add({
          name: s.name,
          position: pos,
          point: {
            pixelSize: 12,
            color: Cesium.Color.fromCssColorString('#ea580c'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: s.name,
            font: '12px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -14),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
        rt.customModelEntities.set(s.name, e)
        rt.customModelProps.set(s.name, { pos })
      }
      applySpecToHandle(rt, s, rt.customModelProps.get(s.name)!)
    }
  }

  function updateCustomModelPose(name: string, patch: Partial<Pick<CustomModelSpec, 'lon' | 'lat' | 'alt' | 'yaw' | 'pitch' | 'roll' | 'scale'>>): void {
    const rt = runtime.earthView
    if (!rt) return
    const s = rt.customModelSpecs.get(name)
    if (!s) return
    Object.assign(s, patch)
    const h = rt.customModelProps.get(name)
    if (h) applySpecToHandle(rt, s, h)
  }

  function syncGroupPose(groupName: string): void {
    const rt = runtime.earthView
    if (!rt) return
    const cmg = useCustomModelGroupsStore()
    const cms = useCustomModelsStore()
    const g = cmg.groups.find((x) => x.name === groupName)
    if (!g) return
    for (const s of expandGroupToSpecs(g, cms.modelUrl)) {
      rt.customModelSpecs.set(s.name, s)
      const h = rt.customModelProps.get(s.name)
      if (h) applySpecToHandle(rt, s, h)
    }
  }

  function setGizmoActive(_on: boolean, _name?: string): void {
  }

  function getMapCenter(): { lng: number; lat: number } | null {
    const rt = runtime.earthView
    if (!rt) return null
    const c = rt.viewer.camera.positionCartographic
    if (!c) return null
    return { lng: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) }
  }

  function bindEarthPickHandler(rt: EarthRuntime): void {
    const handler = new Cesium.ScreenSpaceEventHandler(rt.viewer.canvas as HTMLCanvasElement)
    handler.setInputAction((movement: { position: Cesium.Cartesian2 }): void => {
      const cms = useCustomModelsStore()
      const cmg = useCustomModelGroupsStore()
      const cts = useTilesetsStore()
      const gName = cmg.picking
      const sName = cms.picking
      const tName = cts.picking
      if (!gName && !sName && !tName) return
      // tileset 拾取强制走椭球面：避免拾到尚未定位/位置错误的瓦片自身表面。
      const picked = tName
        ? rt.viewer.camera.pickEllipsoid(movement.position)
        : (rt.viewer.scene.pickPosition(movement.position) ?? rt.viewer.camera.pickEllipsoid(movement.position))
      if (!picked) return
      const carto = Cesium.Cartographic.fromCartesian(picked)
      let lng = Cesium.Math.toDegrees(carto.longitude)
      let lat = Cesium.Math.toDegrees(carto.latitude)
      if (useMapStateStore().mapCoordNeedsGcj02()) {
        const [rlat, rlng] = gcj02ToWgs84(lat, lng)
        lat = rlat
        lng = rlng
      }
      if (tName) {
        cts.applyPickedPosition(tName, lng, lat)
        updateTilesetTransform(tName)
        return
      }
      if (gName) {
        cmg.applyPickedPosition(gName, lng, lat)
        syncGroupPose(gName)
      } else {
        cms.applyPickedPosition(sName, lng, lat)
        updateCustomModelPose(sName, { lon: lng, lat })
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    rt.pickHandler = handler
  }


  // === 3D Tiles（测绘模型）同步 ===
  // 增量 reconcile：仅对新增/删除/隐藏做 add/remove；heightOffset 微调只改 modelMatrix 不重载瓦片。
  function syncTilesets(): void {
    const rt = runtime.earthView
    if (!rt) return
    const cts = useTilesetsStore()
    const wanted = new Map<string, Tileset>()
    for (const t of cts.tilesets) {
      if (t.hidden) continue
      wanted.set(t.name, t)
    }
    // 删除已移除或被隐藏的 primitive。
    for (const [name, ts] of rt.tilesetPrimitives) {
      if (!wanted.has(name)) {
        rt.viewer.scene.primitives.remove(ts)
        rt.tilesetPrimitives.delete(name)
        rt.tilesetBaseCarto.delete(name)
        rt.tilesetBaseCenter.delete(name)
        rt.tilesetGroundH.delete(name)
      }
    }
    // 已存在的：刷新 heightOffset。
    for (const [name, ts] of rt.tilesetPrimitives) {
      const t = wanted.get(name)
      if (t) applyTilesetTransform(rt, name, t)
    }
    // 缺失且未在加载的：发起加载。
    for (const [name, t] of wanted) {
      if (rt.tilesetPrimitives.has(name) || rt.tilesetLoading.has(name)) continue
      rt.tilesetLoading.add(name)
      void loadTileset(rt, name, t)
    }
  }

  async function loadTileset(rt: EarthRuntime, name: string, t: Tileset): Promise<void> {
    let ts: Cesium.Cesium3DTileset
    try {
      ts = await Cesium.Cesium3DTileset.fromUrl(tilesetEntryUrl(t))
    } catch {
      rt.tilesetLoading.delete(name)
      return
    }
    rt.tilesetLoading.delete(name)
    // stale 守卫：await 期间可能已 dispose 或被删除/隐藏。
    if (rt !== runtime.earthView) return
    const cur = useTilesetsStore().tilesets.find((x) => x.name === name)
    if (!cur || cur.hidden || rt.tilesetPrimitives.has(name)) return
    rt.viewer.scene.primitives.add(ts)
    rt.tilesetPrimitives.set(name, ts)
    // 记录基准经纬度（弧度）作为 heightOffset 平移的稳定锚点，避免随当前 modelMatrix 叠加。
    const sphere = ts.boundingSphere
    const center = sphere ? sphere.center : null
    if (center) {
      const carto = Cesium.Cartographic.fromCartesian(center)
      rt.tilesetBaseCarto.set(name, { lon: carto.longitude, lat: carto.latitude })
      rt.tilesetBaseCenter.set(name, Cesium.Cartesian3.clone(center))
    }
    applyTilesetTransform(rt, name, cur)
    if (tilesetHasManualPosition(cur)) void sampleTilesetGround(rt, name, cur)
  }

  // 三轴旋转（度）→ 局部 ENU 旋转矩阵 R（绕模型中心/原点）。全 0 返回 null（跳过旋转乘法）。
  // yaw/pitch/roll 与自定义模型同语义（Cesium HeadingPitchRoll：yaw=heading，绕局部「上」轴）。
  function tilesetLocalRotation(t: Tileset): Cesium.Matrix4 | null {
    const yaw = t.yaw || 0
    const pitch = t.pitch || 0
    const roll = t.roll || 0
    if (yaw === 0 && pitch === 0 && roll === 0) return null
    const r3 = Cesium.Matrix3.fromHeadingPitchRoll(new Cesium.HeadingPitchRoll(
      Cesium.Math.toRadians(yaw), Cesium.Math.toRadians(pitch), Cesium.Math.toRadians(roll)))
    return Cesium.Matrix4.fromRotationTranslation(r3, Cesium.Cartesian3.ZERO)
  }

  // 定位有两种模式：
  //  · 手动定位（lon/lat 任一非零）：用 ENU 矩阵把模型局部原点放到指定经纬高，scale 在局部系内缩放（原点不动），
  //    R(yaw/pitch/roll) 在局部 ENU 内旋转（绕原点）。适合 metadata 丢失、无原生 georef 的 tileset。
  //    lon/lat 存 WGS-84，高德底图时渲染前转 GCJ-02（与底图对齐）。
  //  · 原生 georef（lon=lat=0）：用 tileset.json 自带的 root.transform。heightOffset 沿法向平移；
  //    R 绕包围球中心做 ENU 共轭旋转（刚体，保留 georef，不破坏地理参考）。scale 在此模式不支持
  //    （原地缩放自带 georef 的 tileset 需私有 API 且破坏地理参考）。
  function applyTilesetTransform(rt: EarthRuntime, name: string, t: Tileset): void {
    const ts = rt.tilesetPrimitives.get(name)
    if (!ts) return
    const heightOffset = t.heightOffset || 0
    const R = tilesetLocalRotation(t)

    if (tilesetHasManualPosition(t)) {
      let lon = t.lon
      let lat = t.lat
      if (useMapStateStore().mapCoordNeedsGcj02()) {
        const [glat, glng] = wgs84ToGcj02(t.lat, t.lon)
        lat = glat
        lon = glng
      }
      const scale = t.scale || 1
      // 基准高度：优先用已采样的地形高度缓存，次取当前已加载瓦片的同步高度，否则 0（椭球面）。
      const cachedGround = rt.tilesetGroundH.get(name)
      const liveGround = rt.viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat))
      const groundH = typeof cachedGround === 'number' ? cachedGround
        : (typeof liveGround === 'number' && isFinite(liveGround) ? liveGround : 0)
      // 模型原点放到目标经纬高：基准取地面高度（避免椭球面陷地）。模型几何原点位置因数据而异，
      // 不自动抬升（包围球半径近似会致浮空）——贴合与否用 heightOffset 微调。
      const target = Cesium.Cartesian3.fromDegrees(lon, lat, groundH + heightOffset)
      const center = rt.tilesetBaseCenter.get(name) ?? null
      // 重定向 + 平移 + 缩放 + 旋转：把模型从原产地 ENU 框架搬到 target 的 ENU 框架，让「上」对准目标地天顶。
      // 纯平移跨纬度会让模型带着原产地的倾角歪掉（地球各处法向不同），故必须按坐标重算朝向。
      // modelMatrix = targetFrame × S(scale) × R(yaw,pitch/roll) × originFrame⁻¹：origin⁻¹ 转入原产地局部 ENU（以 center 为原点），
      // R/S 在该局部空间旋转/缩放（以 center 为中心，均匀缩放与旋转可交换），targetFrame 转到目标地世界坐标。
      // scale=1 & R=null 时退化为 targetFrame × originFrame⁻¹（只重定向 + 平移），朝向贴合目标地水平面。
      if (center) {
        const originFrame = Cesium.Transforms.eastNorthUpToFixedFrame(center)
        const targetFrame = Cesium.Transforms.eastNorthUpToFixedFrame(target)
        const invOrigin = Cesium.Matrix4.inverse(originFrame, new Cesium.Matrix4())
        let local = invOrigin
        if (R) local = Cesium.Matrix4.multiply(R, local, new Cesium.Matrix4()) // R × origin⁻¹
        if (scale !== 1) {
          const S = Cesium.Matrix4.fromUniformScale(scale)
          local = Cesium.Matrix4.multiply(S, local, new Cesium.Matrix4()) // S × R × origin⁻¹
        }
        ts.modelMatrix = Cesium.Matrix4.multiply(targetFrame, local, new Cesium.Matrix4())
      } else {
        // 无初始中心（纯局部坐标模型）：直接建立目标地 ENU 框架，并就地施加旋转（绕放置点 target）。
        const base = Cesium.Transforms.eastNorthUpToFixedFrame(target)
        ts.modelMatrix = R ? Cesium.Matrix4.multiply(base, R, new Cesium.Matrix4()) : base
      }
      return
    }

    // 原生 georef：无旋转、无高度偏移 → 单位矩阵。
    if (!R && heightOffset === 0) {
      ts.modelMatrix = Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY)
      return
    }
    const base = rt.tilesetBaseCarto.get(name)
    const center = rt.tilesetBaseCenter.get(name) ?? null
    if (!R) {
      // 仅高度偏移（无旋转）：沿椭球法向平移（原行为）。
      if (!base) return
      const surface = Cesium.Cartesian3.fromRadians(base.lon, base.lat, 0.0)
      const offset = Cesium.Cartesian3.fromRadians(base.lon, base.lat, heightOffset)
      ts.modelMatrix = Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3()))
      return
    }
    // 有旋转：绕包围球中心做 ENU 共轭旋转（frame × R × frame⁻¹，frame 平移=center 使其抵消 → 刚体绕 center 转）。
    // 无 center（无包围球）则无法锚定旋转中心，跳过。heightOffset 在旋转后沿椭球法向叠加平移。
    if (!center) return
    const frame = Cesium.Transforms.eastNorthUpToFixedFrame(center)
    const invFrame = Cesium.Matrix4.inverse(frame, new Cesium.Matrix4())
    const rWorld = Cesium.Matrix4.multiply(frame, Cesium.Matrix4.multiply(R, invFrame, new Cesium.Matrix4()), new Cesium.Matrix4())
    if (heightOffset !== 0 && base) {
      const surface = Cesium.Cartesian3.fromRadians(base.lon, base.lat, 0.0)
      const offset = Cesium.Cartesian3.fromRadians(base.lon, base.lat, heightOffset)
      const tMat = Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3()))
      ts.modelMatrix = Cesium.Matrix4.multiply(tMat, rWorld, new Cesium.Matrix4())
    } else {
      ts.modelMatrix = rWorld
    }
  }

  function updateTilesetTransform(name: string): void {
    const rt = runtime.earthView
    if (!rt) return
    const cur = useTilesetsStore().tilesets.find((x) => x.name === name)
    if (!cur) return
    applyTilesetTransform(rt, name, cur)
    if (tilesetHasManualPosition(cur)) void sampleTilesetGround(rt, name, cur)
  }

  // 异步采样目标点的精确地形高度，刷新缓存并重算 modelMatrix（让模型落到地表而非椭球面）。
  // 同步 getHeight 依赖已加载瓦片不可靠；sampleTerrainMostDetailed 触发加载+精确采样。位置已变则丢弃过时结果。
  async function sampleTilesetGround(rt: EarthRuntime, name: string, t: Tileset): Promise<void> {
    if (!rt.terrainOn) return
    let lon = t.lon
    let lat = t.lat
    if (useMapStateStore().mapCoordNeedsGcj02()) {
      const [glat, glng] = wgs84ToGcj02(t.lat, t.lon)
      lat = glat
      lon = glng
    }
    const pos = [Cesium.Cartographic.fromDegrees(lon, lat)]
    try {
      const updated = await Cesium.sampleTerrainMostDetailed(rt.viewer.terrainProvider, pos)
      if (rt !== runtime.earthView) return
      const cur = useTilesetsStore().tilesets.find((x) => x.name === name)
      if (!cur || cur.lon !== t.lon || cur.lat !== t.lat) return
      const h = updated[0]?.height
      if (typeof h === 'number' && isFinite(h)) {
        rt.tilesetGroundH.set(name, h)
        applyTilesetTransform(rt, name, cur)
      }
    } catch {
      // 采样失败（无地形/网络）→ 保持 getHeight/0 兜底，用户可手动调 heightOffset。
    }
  }

  function focusTileset(name: string): void {
    const rt = runtime.earthView
    if (!rt) return
    const ts = rt.tilesetPrimitives.get(name)
    if (!ts) return
    void rt.viewer.flyTo(ts, { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), 0) })
  }

  function renderEarth(): void {
    const mapStore = useMapStateStore()
    const threeStore = useScene3dStore()
    const active = useUiStore().ui.mainView === 'three' && mapStore.map.active && mapStore.map.renderer === 'earth'

    if (!active) {
      if (lastActive && runtime.earthView) runtime.earthView.viewer.useDefaultRenderLoop = false
      lastActive = false
      return
    }
    const rising = !lastActive
    lastActive = true

    let rt = runtime.earthView
    if (rt && rt.providerId !== mapStore.map.providerId) {
      applyImagery(rt, mapStore.map.providerId)
      applyTerrain()
      // provider 变更可能伴随坐标系切换（WGS84↔GCJ-02），重算所有依赖坐标系的实体：
      // 航线/航点/路线（coordFor 转换）、自定义模型（applySpecToHandle 转换）、3D Tiles 手动定位。
      rebuildEarthPath()
      rebuildEarthWaypoints()
      syncCustomModels()
      for (const name of rt.tilesetPrimitives.keys()) updateTilesetTransform(name)
    }
    if (!runtime.earthView) {
      threeStore.ensureThreeTelemetry()
      ensureEarth()
    }
    rt = runtime.earthView
    if (!rt) return

    rt.viewer.useDefaultRenderLoop = true
    if (rising) rt.viewer.resize()

    const samples = threeStore.three.telemetry.samples
    const origin = threeStore.three.telemetry.meta.geoOrigin
    const teleKey = samples.length + '|' + (origin ? origin.lat0 + ',' + origin.lng0 : '')
    if (teleKey !== rt.lastTeleKey) rebuildEarthPath()

    const summary = useLogStore().log.summary
    const modelName = resolveDroneModelName(summary?.frame, summary?.airframe)
    if (!rt.droneEntity || rt.droneModelName !== modelName) {
      rebuildDroneEntity(rt, modelName)
    }

    const cmdStore = useCommandsStore()
    if (!cmdStore.commands.loaded && !cmdRequested) {
      cmdRequested = true
      cmdStore.loadCommands().then((): void => rebuildEarthWaypoints())
    } else if (cmdStore.commands.loaded) {
      const mv = threeStore.activeMissionVersionAt(threeStore.three.playback.timeMs)
      const key = mv ? mv.startTime : -1
      if (key !== rt.lastMissionKey) rebuildEarthWaypoints()
    }

    const cms = useCustomModelsStore()
    const cmg = useCustomModelGroupsStore()
    const modelsKey = cms.models.length + '|' + cmg.groups.length
    if (rising || modelsKey !== lastModelsKey) {
      lastModelsKey = modelsKey
      syncCustomModels()
    }

    const cts = useTilesetsStore()
    const tilesetsKey = cts.tilesets.length + '|' + cts.tilesets.filter((t) => t.hidden).length
    if (rising || tilesetsKey !== lastTilesetsKey) {
      lastTilesetsKey = tilesetsKey
      syncTilesets()
    }

    updateEarthLive()
  }

  return {
    earthEl,
    registerEarthMain,
    ensureEarth,
    disposeEarth,
    renderEarth,
    rebuildEarthPath,
    rebuildEarthWaypoints,
    updateEarthLive,
    syncCustomModels,
    updateCustomModelPose,
    syncGroupPose,
    setGizmoActive,
    getMapCenter,
    syncTilesets,
    updateTilesetTransform,
    focusTileset,
    applyImagery,
    applyTerrain,
    focusDrone,
    fitToTrack,
  }
})
