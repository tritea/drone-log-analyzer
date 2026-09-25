import { ref } from 'vue'
import { defineStore } from 'pinia'
import * as Cesium from 'cesium'
import { runtime, type EarthRuntime, type EarthLockHandlers } from '@/modules/shared/runtime'
import type { TemplateRefTarget } from '@/modules/shared/utils/dom'
import { wgs84ToGcj02, gcj02ToWgs84 } from '@/modules/shared/utils/geo/gcj02'
import { resolveDroneModelName, pwmToAngularVelocity } from '@/modules/shared/utils/drone-model'
import { createTerrariumTerrainProvider } from '@/modules/earth/renderer/terrain-provider'
import { measureGlbBox } from '@/modules/earth/renderer/glb-box'
import { getLowpolyGlbUrl, disposeLowpolyGlbCache } from '@/modules/earth/renderer/lowpoly-glb'
import { useCurveManagerStore } from '@/modules/curves'
import { TRAJ_MAX_POINTS, THREE_UNITS_PER_METER, THREE_PROPELLER_ORDER, THREE_PROPELLER_ACCEL_TAU, THREE_PROPELLER_DECEL_TAU } from '@/constants'
import { useUiStore } from '@/modules/shared/ui-store'
import { useView3dStore } from '@/modules/view3d'
import { usePlaybackStore, isEarthSolo } from '@/modules/playback'
import { useMapStateStore } from '@/modules/shared/map-state'
import { useCommandsStore } from '@/modules/commands'
import { useLogStore } from '@/modules/log'
import { useCustomModelsStore } from '@/modules/custom-models'
import { useCustomModelGroupsStore, expandGroupToSpecs } from '@/modules/custom-models'
import { useTilesetsStore, tilesetEntryUrl, tilesetHasManualPosition } from '@/modules/tilesets'
import type { Tileset } from '@/modules/tilesets'
import type { CustomModelSpec } from '@/modules/custom-models'
import type { TelemetrySample } from '@/types'

const LOCK_SEED_PITCH = -40
const LOCK_RANGE_DEFAULT = 80
const LOCK_RANGE_MIN = 5
const LOCK_RANGE_MAX = 20000
// 自由视角球坐标距离范围：近到模型贴脸、远到全球视角。
const EARTH_ORBIT_RANGE_MIN = 5
const EARTH_ORBIT_RANGE_MAX = 2e7
// GLB 机头轴与 Cesium heading 参考差约 90°（实测"多了 90 度"），补偿之；若整体方向反了改 +Math.PI/2。
const DRONE_HEADING_OFFSET = -Math.PI / 2
// vendor/ 下有真实 GLB 的机型；其余机型（HEXA-X/OCTO-X 等）按真实轴数程序化生成 lowpoly GLB。
const VENDOR_DRONE_MODELS = new Set(['QUAD-X', 'VTOL'])

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
    const idx = usePlaybackStore().currentThreeSampleIndex(usePlaybackStore().playback.timeMs)
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
      // 高度基准切到日志绝对海拔：轨迹/航点立即按新基准重建；
      // home DEM 采样就绪后 refreshHomeGroundElev 回调再刷一次（仅 altMsl 缺失的兜底路径受影响）。
      rebuildEarthPath()
      rebuildEarthWaypoints()
    } else if (!want && rt.terrainOn) {
      rt.viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider()
      rt.terrainOn = false
      rt.homeGroundElev = 0
      // 高度基准切回相对 home（近椭球面）：重建轨迹/航点。
      rebuildEarthPath()
      rebuildEarthWaypoints()
    }
  }

  function refreshHomeGroundElev(rt: EarthRuntime): void {
    const origin = usePlaybackStore().telemetry.meta.geoOrigin
    if (!origin || !rt.terrainOn) return
    const pos = [Cesium.Cartographic.fromDegrees(origin.lng0, origin.lat0)]
    Cesium.sampleTerrainMostDetailed(rt.viewer.terrainProvider, pos)
      .then((updated: Cesium.Cartographic[]): void => {
        if (rt === runtime.earthView && updated[0]) {
          rt.homeGroundElev = updated[0].height
          // DEM 高就绪：重建轨迹/航点（仅 altMsl 缺失的兜底路径与自定义模型贴地受影响）。
          rebuildEarthPath()
          rebuildEarthWaypoints()
        }
      })
      .catch((): void => {  })
  }


  // 球坐标 → camera.setView：注视点 target（Cartesian3）+ heading/pitch（度）+ range（米）。
  // 相机位置 = 注视点 ENU 系下「反视线」方向 range 米处；朝向用 **direction+up** 向量对
  // （而非 heading/pitch/roll 欧拉）——pitch 翻越 ±90°（天顶/地下仰视）时欧拉的 heading 会
  // 瞬间反转 180° 造成画面闪跳，向量对天然连续无万向锁。up 与 direction 正交且含天顶分量：
  //   direction(ENU) = (sin h·cos p, cos h·cos p, sin p)，up(ENU) = (−sin h·sin p, −cos h·sin p, cos p)。
  // 统一替代 lookAt（锚定 transform，跟随时闪）；setView 不锚定 transform，无残留。
  function setOrbitView(rt: EarthRuntime, target: Cesium.Cartesian3, headingDeg: number, pitchDeg: number, range: number): void {
    const h = Cesium.Math.toRadians(headingDeg)
    const p = Cesium.Math.toRadians(pitchDeg)
    const cosP = Math.cos(p)
    const sinP = Math.sin(p)
    const sinH = Math.sin(h)
    const cosH = Math.cos(h)
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(target)
    const rot = Cesium.Matrix4.getRotation(transform, new Cesium.Matrix3())
    const dirEnu = new Cesium.Cartesian3(sinH * cosP, cosH * cosP, sinP)
    const upEnu = new Cesium.Cartesian3(-sinH * sinP, -cosH * sinP, cosP)
    const direction = Cesium.Matrix3.multiplyByVector(rot, dirEnu, new Cesium.Cartesian3())
    const up = Cesium.Matrix3.multiplyByVector(rot, upEnu, new Cesium.Cartesian3())
    const offset = Cesium.Cartesian3.multiplyByScalar(dirEnu, -range, new Cesium.Cartesian3())
    const dest = Cesium.Matrix4.multiplyByPoint(transform, offset, new Cesium.Cartesian3())
    rt.viewer.camera.setView({ destination: dest, orientation: { direction, up } })
  }

  // 自由视角统一球坐标模型：ssc 内置手势全部禁用（绕地心旋转/沿视线缩放会与球坐标状态冲突），
  // 交互全部自管（bindEarthOrbitControls）：左/右键拖拽=绕屏幕中心地表锚点旋转，滚轮/中键=距离缩放。
  function configureFreeCameraControls(viewer: Cesium.Viewer): void {
    const ssc = viewer.scene.screenSpaceCameraController
    ssc.enableRotate = false
    ssc.enableZoom = false
    ssc.enableTilt = false
    ssc.enableLook = false
    ssc.enableTranslate = false
    // 碰撞检测必须关：它每帧把贴地/地下的相机自动抬升，与我们的 setView 拉锯——
    // 视角停在贴地/地下位置时不拖拽也一直抖。球坐标 setView 完全接管相机位置（地下就地下）。
    ssc.enableCollisionDetection = false
    ;(viewer.canvas as HTMLCanvasElement).addEventListener('contextmenu', (e: Event): void => { e.preventDefault() })
  }

  // 自由视角交互（球坐标 + setView）：与锁定视角同一套 heading/pitch/range 计算，但用 camera.setView
  // 应用（不锚定 transform，flyTo/锁定切换无 lookAtTransform 残留）。球坐标每次手势开始惰性重建
  // （锚点=屏幕中心地表点、姿态/距离读当前相机），focusDrone/锁定等移动过相机后自动取新状态。
  function bindEarthOrbitControls(rt: EarthRuntime): void {
    const canvas = rt.viewer.canvas as HTMLCanvasElement
    let mode: 'rotate' | 'zoom' | null = null
    let lastX = 0
    let lastY = 0

    // 锚点取屏幕中心对应的地表点：绕中心旋转视觉最稳，中心点不动画面绕它转。
    const pickAnchor = (): Cesium.Cartesian3 | null => {
      const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2)
      const ray = rt.viewer.camera.getPickRay(center)
      if (!ray) return null
      return rt.viewer.scene.globe.pick(ray, rt.viewer.scene)
        ?? rt.viewer.camera.pickEllipsoid(center, rt.viewer.scene.globe.ellipsoid)
    }

    const initOrbitState = (): boolean => {
      const picked = pickAnchor()
      // 仰视/视线穿天时屏幕中心可能拾不到地表（pickEllipsoid 相机在椭球内沿外向射线无交点）：
      // 沿用旧锚点只刷新相机姿态，保证任何角度都能继续转。
      const center = picked ?? (rt.freeOrbit ? rt.freeOrbit.center : null)
      if (!center) return false
      const cam = rt.viewer.camera
      rt.freeOrbit = {
        center,
        heading: Cesium.Math.toDegrees(cam.heading),
        pitch: Cesium.Math.toDegrees(cam.pitch),
        range: Cesium.Cartesian3.distance(cam.positionWC, center),
      }
      return true
    }

    // 应用球坐标（统一走 setOrbitView → camera.setView）。
    const applyOrbit = (): void => {
      const o = rt.freeOrbit
      if (!o) return
      setOrbitView(rt, o.center, o.heading, o.pitch, o.range)
    }

    const onDown = (e: PointerEvent): void => {
      if (rt.lockActive) return  // 锁定模式由 lock handlers 接管
      if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
      if (!initOrbitState()) return
      mode = e.button === 1 ? 'zoom' : 'rotate'
      lastX = e.clientX
      lastY = e.clientY
      // 按下瞬间立即按球坐标自洽化一次：init 的球坐标由「地表锚点+相机当前姿态/距离」拼出，
      // 与相机实际位置有微小偏差（锚点是地表点，相机原看向轨迹中心——离地数十米）；
      // 不先应用的话，第一次拖动 onMove 会把相机「吸附」到球坐标位置，产生一次性横跳
      // （症状：无人机被拉到后面再回来）。按下时吸附无感，之后拖拽全程连续。
      applyOrbit()
      try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    const onMove = (e: PointerEvent): void => {
      if (!mode || !rt.freeOrbit) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      if (mode === 'rotate') {
        rt.freeOrbit.heading = (rt.freeOrbit.heading - dx * 0.3) % 360
        // pitch 全程 360°（与主 3D 场景自由相机同体验）：可从正上方翻转到仰视，
        // 归一到 (-180,180]；越过 ±90° 后画面随相机翻转（无 up 约束）。
        rt.freeOrbit.pitch = (((rt.freeOrbit.pitch - dy * 0.3) % 360) + 540) % 360 - 180
      } else {
        rt.freeOrbit.range = Math.max(EARTH_ORBIT_RANGE_MIN, Math.min(EARTH_ORBIT_RANGE_MAX, rt.freeOrbit.range * Math.exp(dy * 0.0015)))
      }
      applyOrbit()
    }
    const onUp = (e: PointerEvent): void => {
      if (!mode) return
      mode = null
      try { canvas.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    const onWheel = (e: WheelEvent): void => {
      if (rt.lockActive) return
      e.preventDefault()
      if (!rt.freeOrbit && !initOrbitState()) return
      const ratio = e.deltaY > 0 ? 1.18 : 1 / 1.18
      rt.freeOrbit!.range = Math.max(EARTH_ORBIT_RANGE_MIN, Math.min(EARTH_ORBIT_RANGE_MAX, rt.freeOrbit!.range * ratio))
      applyOrbit()
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    rt.orbitHandlers = { canvas, onDown, onMove, onUp, onWheel }
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
    // 瓦片 LOD/缓存收敛（帧率优先，用户确认"减少视距上绘制距离"）：SSE 2→4——瓦片需求量约降到 1/4
    // （近视距轻微变糊，测绘 3D Tiles 精度不受影响，其 SSE 独立按 tileset 配置）；tileCache 100→300
    // ——平移/环绕往返时瓦片少被驱逐重载（少一次网络+解码+上传）。相机移动（瓦片流入）期帧率明显更稳。
    viewer.scene.globe.maximumScreenSpaceError = 4
    viewer.scene.globe.tileCacheSize = 300
    // 关地形背面剔除：pitch 转 360° 时相机会到地形/地面之下，默认背面剔除会让地下视角
    // 每帧剔除结果不稳定 → 画面一直闪；关掉后从内部也能稳定看到地形面。
    viewer.scene.globe.backFaceCulling = false
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
      lockAppliedPos: null,
      lockAppliedHeading: 0,
      lockAppliedPitch: 0,
      lockAppliedRange: 0,
      lockHandlers: null,
      orbitHandlers: null,
      freeOrbit: null,
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
      removeLiveSync: null,
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

    const origin = usePlaybackStore().telemetry.meta.geoOrigin
    if (origin) {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(origin.lng0, origin.lat0, 2000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-50), roll: 0 },
      })
    }

    // 每帧管线挂 preUpdate（scene.update 之前）：实体位姿属性必须在 visualizer 读值【之前】写好——
    // 挂 preRender 是晚一拍的（update 已消费旧值才触发）：模型渲染 pos(t-1) 而相机是 pos(t)，
    // 相机静止时仅 16ms 延迟无感，相机一动（锁定追逐/手动环绕）模型就在移动背景里来回“游”
    // （实测抖动、移动视角更明显的根因）。preUpdate：同帧写入→同帧 update 消费→同帧渲染，零偏差。
    // earth 独占时整条可视化帧管线在此驱动（earthSoloFrame），外部 rAF 链（frame-loop）已交棒退出。
    rt.removeLiveSync = viewer.scene.preUpdate.addEventListener((): void => earthSoloFrame(rt))

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
      h.canvas.removeEventListener('wheel', h.onWheel)
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
    if (rt.removeLiveSync) {
      rt.removeLiveSync()
      rt.removeLiveSync = null
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
    disposeLowpolyGlbCache()
  }


  function rebuildEarthPath(): void {
    const rt = runtime.earthView
    if (!rt) return
    const samples = usePlaybackStore().telemetry.samples
    const origin = usePlaybackStore().telemetry.meta.geoOrigin
    if (!samples.length || !origin) {
      rt.trackCoordsFull = []
      return
    }
    const coords: number[][] = []
    for (let i = 0; i < samples.length; i++) {
      const c = coordFor(samples[i], origin)
      // 高度按当前基准出：地形开=日志绝对海拔（sampleHeight 内处理），地形关=相对 home。
      coords.push([c.lng, c.lat, sampleHeight(rt, samples[i])])
    }
    rt.trackCoordsFull = coords
    rt.lastTeleKey = samples.length + '|' + origin.lat0 + ',' + origin.lng0 + ',' + origin.alt0
    flownEndIdx = -1
  }

  function rebuildEarthWaypoints(): void {
    const rt = runtime.earthView
    if (!rt) return
    for (const e of rt.waypointEntities) rt.viewer.entities.remove(e)
    rt.waypointEntities = []
    const threeStore = useView3dStore()
    const mapStore = useMapStateStore()
    const origin = usePlaybackStore().telemetry.meta.geoOrigin
    const pts = threeStore.missionGeoPoints()
    if (!pts || !pts.length) {
      if (rt.routeEntity) {
        rt.viewer.entities.remove(rt.routeEntity)
        rt.routeEntity = null
      }
      return
    }
    const gcj = mapStore.mapCoordNeedsGcj02()
    // 航点高度是 aboveHome：地形开 → home 海拔（日志 geoOrigin.alt0）+ aboveHome（与轨迹同基准，不做校准）；
    // 地形关 → aboveHome 原值（近椭球面）。
    const wpBase = rt.terrainOn && origin ? origin.alt0 : 0
    const routePositions: Cesium.Cartesian3[] = []
    for (const p of pts) {
      let lat = p.lat
      let lng = p.lng
      if (gcj) {
        const [glat, glng] = wgs84ToGcj02(p.lat, p.lng)
        lat = glat
        lng = glng
      }
      const h = wpBase + (p.alt ?? 0)
      routePositions.push(Cesium.Cartesian3.fromDegrees(lng, lat, h))
      // RTL 等无 label 点只参与航线连线，不画航点标记（与 2D 地图 !p.label 约定一致）。
      if (!p.label) continue
      const isHome = !!p.isHome
      rt.waypointEntities.push(
        rt.viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lng, lat, h),
          point: {
            pixelSize: 2,
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
    const active = threeStore.missionVersionAt(usePlaybackStore().playback.timeMs)
    rt.lastMissionKey = active ? active.startTime : -1
  }

  function fitToTrack(): void {
    const rt = runtime.earthView
    if (!rt || !rt.trackCoordsFull.length) return
    // 锁定跟随激活时不做全景 fit——锁定 preRender 会立即把相机带到无人机（默认 80m），
    // 两者竞争视角造成开局一次拉远/拉近跳变；锁定本身就是"定位"。
    if (rt.lockActive) return
    const pts = rt.trackCoordsFull.map((c) => Cesium.Cartesian3.fromDegrees(c[0], c[1], c[2]))
    const sphere = Cesium.BoundingSphere.fromPoints(pts)
    rt.freeOrbit = null // 相机被移动：球坐标状态作废，下次交互惰性重建
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
      rt.lockAppliedPos = null // 强制下一帧重应用
      return
    }
    const threeStore = useView3dStore()
    const samples = usePlaybackStore().telemetry.samples
    const origin = usePlaybackStore().telemetry.meta.geoOrigin
    if (!samples.length || !origin) return
    const timeMs = usePlaybackStore().playback.timeMs
    const idx = usePlaybackStore().currentThreeSampleIndex(timeMs)
    const sample = usePlaybackStore().sampleAtTime(timeMs) || samples[idx]
    if (!sample) return
    const c = coordFor(sample, origin)
    const h = sampleHeight(rt, sample)
    const pos = Cesium.Cartesian3.fromDegrees(c.lng, c.lat, h)
    rt.freeOrbit = null // 相机被移动：球坐标状态作废，下次交互惰性重建
    setOrbitView(rt, pos, Cesium.Math.toDegrees(rt.viewer.camera.heading), -35, 300)
  }


  async function rebuildDroneEntity(rt: EarthRuntime, name: string): Promise<void> {
    // 入口立即标记机型名：既作 render 循环守卫（updateEarthLive 里 rt.droneModelName !== modelName），
    // 又作 await 后 stale 守卫（快速切机型时旧 rebuild 自动退出，不建孤儿 entity）。
    rt.droneModelName = name
    // 模型形态复用「地图无人机模型」设置（与 map-3d 共享 map.droneModel）：
    //   lowpoly：所有机型程序化（含 QUAD-X/VTOL）；glb：有 vendor GLB 用之，无则 lowpoly 回退（尽量精细）。
    // 记入 rt.droneModelMode，既作 render 循环守卫，又作 await 后 stale 守卫（快速切形态时旧 rebuild 退出）。
    const droneMode = useMapStateStore().map.droneModel === 'glb' ? 'glb' : 'lowpoly'
    rt.droneModelMode = droneMode
    // 桨叶配置：机型→桨序，取 name/dir/func；angles/omegas 清零。
    // 用真实机型名取桨序（HEXA-X/OCTO-X 已在 THREE_PROPELLER_ORDER 定义，不再压成 QUAD-X）。
    const cfg = THREE_PROPELLER_ORDER[name] ?? THREE_PROPELLER_ORDER['QUAD-X']!
    rt.propellerNodes = cfg.map((p) => p.name)
    rt.propellerDirs = cfg.map((p) => p.dir)
    rt.propellerFuncs = cfg.map((p, i) => (p.func != null ? p.func : 33 + i))
    rt.propellerAngles = cfg.map(() => 0)
    rt.propellerOmegas = cfg.map(() => 0)
    rt.propellerLastTick = 0

    // uri 解析：lowpoly 形态（或 glb 形态下无 vendor GLB 的机型）→ 按真实轴数程序化生成 lowpoly GLB（blob URL）；
    // glb 形态且有 vendor GLB（QUAD-X/VTOL）→ 用真实 GLB。导出失败兜底 QUAD-X.glb（保证飞行器始终可见）。
    const wantLowpoly = droneMode === 'lowpoly' || !VENDOR_DRONE_MODELS.has(name)
    let uri: string
    try {
      uri = wantLowpoly ? await getLowpolyGlbUrl(name) : 'vendor/' + name + '.glb'
    } catch (err) {
      console.error('[earth] lowpoly GLB 导出失败，回退 QUAD-X.glb:', name, err)
      uri = 'vendor/QUAD-X.glb'
    }
    // stale 守卫：await 期间 earth 已 dispose、机型已变、或形态已切 → 放弃（旧 entity 仍在，无闪烁、不重复建孤儿）。
    if (rt !== runtime.earthView || rt.droneModelName !== name || rt.droneModelMode !== droneMode) return
    // 推迟清理旧 entity 到 await 之后：await 期间旧 entity 保留可见，且 !droneEntity 不为真（render 不重复触发）。
    if (rt.droneEntity) {
      rt.viewer.entities.remove(rt.droneEntity)
      rt.droneEntity = null
    }

    // GLB 模型：nodeTransformations 对桨叶节点施加绕本地 Y 的旋转（GLB 节点 rotation=identity，转轴即 Y）；
    // ModelGraphics.nodeTransformations 是 PropertyBag，rotation 用 CallbackProperty 每帧读累积角度返回四元数。
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
    // 挂 preUpdate 推进桨叶角度（仅挂一次，viewer 生命周期内复用；disposeEarth 时移除）：
    // nodeTransformations 的 CallbackProperty 在 scene.update 读 rt.propellerAngles——同为 preUpdate
    // 写入即同帧消费（与位姿管线同一相位）。spinEarthPropellers 用真实 PWM 推进它。
    if (!rt.removePropRender) {
      rt.removePropRender = rt.viewer.scene.preUpdate.addEventListener((): void => spinEarthPropellers(rt))
    }
  }

  // 读真实电机 PWM（不依赖 3D 视图/view3dMain）：从 three.curves.motor + SERVO_FUNC→通道映射(servoFuncToChannelMap)
  // + 曲线管理器取每桨 PWM。与主 3D 的 propellerPwm 同源，但脱离 view3dMain.propellers——earth 激活时 3D 场景常未建，
  // 旧路径 currentPropellerPwms 因此返回 [] 致桨永远不转。无电机曲线→[]（无数据→停，按用户「没 PWM 怎么还转」不假转）；
  // 电机停(PWM≈1000)→pwmToAngularVelocity=0→桨停（物理一致）。
  function earthPropellerPwms(rt: EarthRuntime, t: number): Array<number | null> {
    const n = rt.propellerFuncs.length
    if (!n) return []
    const motors = usePlaybackStore().curves.motor as Array<{ type?: string; field?: string }> | undefined
    const list = motors && motors.length ? motors : null
    if (!list) return []
    const funcMap = usePlaybackStore().servoFuncToChannelMap()
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
    const pwms = earthPropellerPwms(rt, usePlaybackStore().playback.timeMs)
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


  function enterLock(rt: EarthRuntime): void {
    rt.freeOrbit = null // 球坐标状态作废：锁定接管相机，退出后自由交互重新惰性建立
    rt.lockHeading = Cesium.Math.toDegrees(rt.viewer.camera.heading)
    rt.lockPitch = LOCK_SEED_PITCH
    rt.lockRange = LOCK_RANGE_DEFAULT
    rt.lockAppliedPos = null // 强制下一帧重应用
    bindEarthLockControls(rt)
  }

  function exitLock(rt: EarthRuntime): void {
    unbindEarthLockControls(rt)
    rt.freeOrbit = null
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
      // pitch 不限制，360° 全程（与自由视角一致）：可翻到仰视/从下方看，归一到 (-180,180]。
      rt.lockPitch = (((rt.lockPitch - dy * 0.25) % 360) + 540) % 360 - 180
      rt.lockAppliedPos = null // 强制下一帧重应用
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
      rt.lockAppliedPos = null // 强制下一帧重应用
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


  // 渲染高（米，Cesium 高度）：地形开 → 直接用日志绝对海拔（与 DEM 同基准，不做任何校准/修正——
  // 起飞点 DEM 校准已按用户要求去掉）；altMsl 缺失（日志无绝对高字段）兜底 home 点 DEM 高 + 相对高。
  // 地形关（椭球面）→ 相对 home 高（近地面显示）。
  function sampleHeight(rt: EarthRuntime, sample: TelemetrySample): number {
    const rel = sample.altitude ?? 0
    if (!rt.terrainOn) return rel
    return sample.altMsl != null ? sample.altMsl : rt.homeGroundElev + rel
  }

  // earth 渲染循环内唯一的每帧管线（挂 scene.preUpdate，scene.update/渲染前执行）。
  // 相位必须是 preUpdate 而非 preRender：visualizer 在 scene.update 里读实体位姿属性，
  // preRender 时已消费完旧值——写进去的位姿晚一帧生效（模型 t-1 vs 相机 t，移动视角时模型来回“游”）。
  // earth 独占时整条可视化帧管线搬进 Cesium 自身默认渲染循环（不再经外部 frame-loop rAF 调用——
  // 两链并行会在瓦片加载期相互挤压帧预算 + 相位交错，无人机位置一顿一顿）：
  //   推进 → 每帧数据/播放头/姿态仪输出（view3d）→ reconcile（mapFps 节流）→ 无人机位姿/锁定相机，
  // 随后 scene.update 消费 → 渲染——推进/采样/位姿/渲染严格同一时钟且同帧生效。
  // 非独占（view3dMain 存活的过渡态）只做位姿/相机同步，其余仍由 frame-loop 驱动（防双跑）。
  // earth 独占判定 isEarthSolo() 由 modules/playback 提供（frame-loop 与此处共用同一份，防两边漂移）。
  function earthSoloFrame(rt: EarthRuntime): void {
    if (rt !== runtime.earthView) return // stale 监听：viewer 已被 dispose/替换
    if (isEarthSolo()) {
      usePlaybackStore().advanceThreePlayback(performance.now())
      const scene = useView3dStore()
      try { scene.applyFrameOutputs(); } catch { /* 输出异常不拖垮渲染 */ }
      try { scene.renderDial(); } catch { /* 同上 */ }
      // reconcile 节流（mapFps，与 frame-loop 地图分支同一节奏/同一时间戳基准）。
      const mapFps = useMapStateStore().map.mapFps
      const now = performance.now()
      if (mapFps <= 0 || now - runtime.frameLoop.lastMapRenderTs >= 1000 / mapFps) {
        runtime.frameLoop.lastMapRenderTs = now
        try { renderEarth(); } catch { /* reconcile 异常不拖垮渲染 */ }
      }
    }
    // reconcile 内 renderEarth 失活分支会 disposeEarth——之后绝不能再摸已销毁的 viewer。
    if (rt !== runtime.earthView) return
    syncDronePoseAndLockCamera(rt)
  }

  // 无人机位姿 + 锁定相机同步（earthSoloFrame 尾段，每个渲染帧、渲染前执行）。
  function syncDronePoseAndLockCamera(rt: EarthRuntime): void {
    const mapStore = useMapStateStore()
    const samples = usePlaybackStore().telemetry.samples
    const origin = usePlaybackStore().telemetry.meta.geoOrigin
    if (!samples.length || !origin) return
    const timeMs = usePlaybackStore().playback.timeMs
    const idx = usePlaybackStore().currentThreeSampleIndex(timeMs)
    const sample = usePlaybackStore().sampleAtTime(timeMs) || samples[idx]
    if (!sample) return

    const c = coordFor(sample, origin)
    const h = sampleHeight(rt, sample)
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
      // 精确比较（勿再量化去重）：播放中插值位置每帧都在变 → 相机全帧率跟随、与模型同帧同步；
      // 暂停时 fromDegrees 对同样输入逐位相同 → equals 命中跳过，零多余 setView。
      // 旧版 0.1m/0.01° 量化 key 让相机以「速度×10Hz」步进——模型 60fps 全速走、相机量化跳，
      // 屏上模型被来回甩（慢速段尤甚，即"拉回去又拉回来"）。
      const p = rt.lockAppliedPos
      if (!p ||
        !Cesium.Cartesian3.equals(p, dronePos) ||
        rt.lockAppliedHeading !== rt.lockHeading ||
        rt.lockAppliedPitch !== rt.lockPitch ||
        rt.lockAppliedRange !== rt.lockRange) {
        rt.lockAppliedPos = Cesium.Cartesian3.clone(dronePos, p ?? new Cesium.Cartesian3())
        rt.lockAppliedHeading = rt.lockHeading
        rt.lockAppliedPitch = rt.lockPitch
        rt.lockAppliedRange = rt.lockRange
        setOrbitView(rt, dronePos, rt.lockHeading, rt.lockPitch, rt.lockRange)
      }
    }
  }

  function updateEarthLive(): void {
    const rt = runtime.earthView
    if (!rt) return
    const mapStore = useMapStateStore()
    if (rt.trackEntity) rt.trackEntity.show = mapStore.map.showPath
    if (rt.routeEntity) rt.routeEntity.show = mapStore.map.showRoute
    for (const w of rt.waypointEntities) w.show = mapStore.map.showWaypoints
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

  // earth 视图是否激活（renderEarth 的判定；延迟销毁的微任务里复检用）。
  function earthViewActive(): boolean {
    const mapStore = useMapStateStore()
    return useUiStore().ui.mainView === 'three' && mapStore.map.active && mapStore.map.renderer === 'earth'
  }

  function renderEarth(): void {
    const mapStore = useMapStateStore()
    const threeStore = useView3dStore()
    const active = earthViewActive()

    if (!active) {
      // 直接重建策略：失活即销毁（disposeEarth 内含 lastActive 复位）。Cesium viewer 连地形/影像
      // 缓存动辄数百 MB，suspend 挂起保留=内存下不来（实测切走后 1G+ 不降）；切回时重建即有。
      // 本函数可能从 viewer 自身 preRender（earthSoloFrame reconcile）调进来——同步 destroy 会让
      // 本次渲染后半段摸已销毁对象，微任务延后到渲染完成后销毁（期间状态翻回激活则不销毁）。
      queueMicrotask((): void => {
        if (runtime.earthView && !earthViewActive()) disposeEarth()
      })
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
      usePlaybackStore().ensureThreeTelemetry()
      ensureEarth()
    }
    rt = runtime.earthView
    if (!rt) return

    rt.viewer.useDefaultRenderLoop = true
    if (rising) rt.viewer.resize()

    const samples = usePlaybackStore().telemetry.samples
    const origin = usePlaybackStore().telemetry.meta.geoOrigin
    const teleKey = samples.length + '|' + (origin ? origin.lat0 + ',' + origin.lng0 + ',' + origin.alt0 : '')
    if (teleKey !== rt.lastTeleKey) rebuildEarthPath()

    const summary = useLogStore().log.summary
    const modelName = resolveDroneModelName(summary?.frame, summary?.airframe)
    const droneMode = useMapStateStore().map.droneModel === 'glb' ? 'glb' : 'lowpoly'
    if ((!rt.droneEntity && !rt.droneModelInFlight) || rt.droneModelName !== modelName || rt.droneModelMode !== droneMode) {
      rt.droneModelInFlight = true
      void rebuildDroneEntity(rt, modelName).finally((): void => { rt.droneModelInFlight = false })
    }

    const cmdStore = useCommandsStore()
    if (!cmdStore.commands.loaded && !cmdRequested) {
      cmdRequested = true
      cmdStore.loadCommands().then((): void => rebuildEarthWaypoints())
    } else if (cmdStore.commands.loaded) {
      const mv = threeStore.missionVersionAt(usePlaybackStore().playback.timeMs)
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

  // 挂起（suspendEarth）已删除：直接重建策略下失活一律 disposeEarth——viewer 不再存活空转，
  // 也就无需关默认渲染循环兜底（关了反而要在每处恢复，历史上还漏过：切回曲线后 60fps 空转烧 GPU）。

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
