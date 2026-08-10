import { ref } from 'vue'
import { defineStore } from 'pinia'
import maplibregl from 'maplibre-gl'
import { Vector2 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { runtime, type MapLibreRuntime } from '@/modules/shared/runtime'
import type { TemplateRefTarget } from '@/modules/shared/utils/dom'
import { wgs84ToGcj02, gcj02ToWgs84 } from '@/modules/shared/utils/geo/gcj02'
import { createDroneModelLayer, type BaseTone, type DronePose, type WaypointPose, type CustomModelSpec } from '@/modules/map-3d/renderer/drone-layer'
import { resolveDroneModelName } from '@/modules/shared/utils/drone-model'
import { TRAJ_MAX_POINTS, THREE_UNITS_PER_METER, THREE_DEFAULT_DRONE_MODEL } from '@/constants'
import { useUiStore } from '@/modules/shared/ui-store'
import { useScene3dStore } from '@/modules/scene-3d'
import { useMapStateStore } from '@/modules/shared/map-state'
import { useCommandsStore } from '@/modules/commands'
import { useLogStore } from '@/modules/log'
import { useCustomModelsStore } from '@/modules/custom-models'
import { useCustomModelGroupsStore, expandGroupToSpecs, tileLatLng, groupNameOfAnchor, tileName, anchorName } from '@/modules/custom-models'
import type { TelemetrySample } from '@/types'

const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const DEM_MAXZOOM = 14
const DRONE_LAYER_ID = 'drone-3d-model'
const LOCK_SEED_PITCH = 55
const LOCK_CAM_DIST_MIN = 10         
const LOCK_CAM_DIST_MAX = 20000      

function inferBasemapTone(providerId: string): BaseTone {
  return providerId.indexOf('satellite') >= 0 ? 'dark' : 'light'
}

export const useMap3dStore = defineStore('map-3d', () => {
  const mapLibreEl = ref<HTMLElement | null>(null)
  function registerMapLibreMain(el: TemplateRefTarget): void {
    mapLibreEl.value = el instanceof HTMLElement ? el : null;
  }

  const customModelsPanelOpen = ref(false)
  function toggleCustomModelsPanel(): void {
    const next = !customModelsPanelOpen.value
    customModelsPanelOpen.value = next
    if (!next) setGizmoActive(false) 
  }
  function closeCustomModelsPanel(): void { customModelsPanelOpen.value = false; setGizmoActive(false) }

  let lastActive = false
  let cmdRequested = false

  function sampleLatLng(s: TelemetrySample, o: { lat0: number; lng0: number; cosLat: number }): { lat: number; lng: number } {
    const north = s.north != null ? s.north : -s.z / THREE_UNITS_PER_METER
    const east = s.east != null ? s.east : s.x / THREE_UNITS_PER_METER
    return { lat: o.lat0 + north / 110540, lng: o.lng0 + east / (o.cosLat * 111320) }
  }

  function coordFor(s: TelemetrySample, o: { lat0: number; lng0: number; cosLat: number }): { lat: number; lng: number } {
    const ll = sampleLatLng(s, o)
    const mapStore = useMapStateStore()
    if (!mapStore.mapCoordNeedsGcj02()) return ll
    const [lat, lng] = wgs84ToGcj02(ll.lat, ll.lng)
    return { lat, lng }
  }


  function ensureMapLibre(): void {
    if (runtime.mapLibreView) return
    const el = mapLibreEl.value
    if (!el) return
    const cms = useCustomModelsStore()
    if (!cms.loaded) cms.loadCustomModels().then(() => syncCustomModels())
    const cmg = useCustomModelGroupsStore()
    if (!cmg.loaded) cmg.loadModelGroups().then(() => syncCustomModels())
    const mapStore = useMapStateStore()
    const threeStore = useScene3dStore()
    const providerId = mapStore.map.providerId || 'esri_satellite'

    const map = new maplibregl.Map({
      container: el,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: ['/map/provider/' + providerId + '/{z}/{x}/{y}'],
            tileSize: 256,
            maxzoom: 18,
            attribution: mapStore.currentAttribution(),
          },
        },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
      },
      center: [120, 30],
      zoom: 13,
      pitch: 45,
      maxZoom: 20,
      attributionControl: { compact: true }, 
      transformCameraUpdate: (next) => {
          return { ...next, elevation: 0 };
        }
    })
    map.setCenterClampedToGround(false)

    map.on('click', handleMapClick)

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left')

    const terrainAllowed = !mapStore.mapCoordNeedsGcj02()
    const wantTerrain = mapStore.map.terrainOn && terrainAllowed

    map.on('load', () => {
      if (!runtime.mapLibreView) return
      map.addSource('track', { type: 'geojson', data: emptyFC() })
      map.addSource('waypoints-line', { type: 'geojson', data: emptyFC() })

      if (wantTerrain && !map.getSource('terrain')) {
        map.addSource('terrain', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_MAXZOOM })
      }
      if (wantTerrain) map.setTerrain({ source: 'terrain', exaggeration: 1.0 })

      const logStore = useLogStore()
      const summary = logStore.log.summary
      const modelName = resolveDroneModelName(summary?.frame, summary?.airframe)
      const origin = threeStore.three.telemetry.meta.geoOrigin
      const handle = createDroneModelLayer({
        droneModelName: modelName,
        airframe: summary?.airframe,
        baseTone: inferBasemapTone(providerId),
        initialPose: { lng: origin?.lng0 || 120, lat: origin?.lat0 || 30, altMeters: origin?.alt0 || 0, roll: 0, pitch: 0, yaw: 0 },
      })
      try { map.addLayer(handle.layer) } catch (e) {  }

      handle.setHome(origin?.lng0 || 120, origin?.lat0 || 30)
      runtime.mapLibreView!.drone = handle
      runtime.mapLibreView!.droneLayerId = DRONE_LAYER_ID
      runtime.mapLibreView!.droneModelName = modelName
      runtime.mapLibreView!.terrainOn = wantTerrain

      rebuildMapLibrePath()
      rebuildMapLibreWaypoints()
      syncCustomModels()
      fitToTrack()
    })

    runtime.mapLibreView = {
      map, drone: null, droneLayerId: DRONE_LAYER_ID, droneModelName: '', waypointMarkers: [],
      trackCoordsFull: [], lastTimeMs: -1, lastElev: 0, lastTeleKey: '', lastMissionKey: -1,
      providerId, terrainOn: wantTerrain,
      lockActive: false, lockBearing: 0, lockPitch: LOCK_SEED_PITCH, lockCamDist: 3, lockZoomAnchor: null, lockAppliedKey: '', lockHandlers: null,
      gizmoActive: false, gizmoTarget: null, gizmoHandlers: null,
    }
  }

  function disposeMapLibre(): void {
    const ml = runtime.mapLibreView
    if (!ml) return
    if (ml.lockHandlers) unbindMapLibreLockControls(ml)
    if (ml.gizmoHandlers) unbindGizmoControls(ml)
    if (ml.drone) ml.drone.dispose()
    ml.waypointMarkers.forEach((m) => m.remove())
    ml.waypointMarkers = []
    ml.map.off('click', handleMapClick)
    ml.map.remove()
    runtime.mapLibreView = null
    lastActive = false
    cmdRequested = false
  }

  function applyDesiredMapDroneModel(ml: MapLibreRuntime): void {
    const drone = ml.drone
    if (!drone || !drone.state) return
    const want = useMapStateStore().map.droneModel || 'lowpoly'
    if (drone.state.modelType === want) return
    const summary = useLogStore().log.summary
    const name = resolveDroneModelName(summary?.frame, summary?.airframe)
    const airframe = summary?.airframe
    if (want === 'lowpoly') {
      drone.replaceModel({ name, airframe, lowpoly: true })
      return
    }
    const loader = new GLTFLoader()
    const tryLoad = (n: string): void => {
      loader.load(`vendor/${n}.glb`,
        (gltf: any) => {
          if (runtime.mapLibreView === ml && ml.drone === drone
            && (useMapStateStore().map.droneModel || 'lowpoly') === 'glb' && drone.state.modelType !== 'glb') {
            drone.replaceModel({ name: n, airframe, lowpoly: false, glbScene: gltf.scene })
          }
        },
        undefined,
        () => { if (n !== THREE_DEFAULT_DRONE_MODEL) tryLoad(THREE_DEFAULT_DRONE_MODEL) },
      )
    }
    tryLoad(name)
  }

  // ============ 轨迹 / 航点重建 ============

  function rebuildMapLibrePath(): void {
    const ml = runtime.mapLibreView
    if (!ml) return
    const src = ml.map.getSource('track') as maplibregl.GeoJSONSource | undefined
    if (!src) return
    const threeStore = useScene3dStore()
    const samples = threeStore.three.telemetry.samples
    const origin = threeStore.three.telemetry.meta.geoOrigin
    if (!samples.length || !origin) { ml.trackCoordsFull = []; src.setData(emptyFC()); return }
    const coords: number[][] = []
    for (let i = 0; i < samples.length; i++) {
      const c = coordFor(samples[i], origin)
      const alt = samples[i].altitude ?? 0
      coords.push([c.lng, c.lat, alt])
    }
    ml.trackCoordsFull = coords
    ml.lastTeleKey = samples.length + '|' + (origin.lat0 + ',' + origin.lng0)
    ml.lastTimeMs = -1 // 强制重画已飞段
  }

  function rebuildMapLibreWaypoints(): void {
    const ml = runtime.mapLibreView
    if (!ml) return
    // 清旧标记。
    ml.waypointMarkers.forEach((m) => m.remove())
    ml.waypointMarkers = []
    const threeStore = useScene3dStore()
    const mapStore = useMapStateStore()
    const pts = threeStore.missionLatLngPoints()
    if (!ml.drone) return
    if (!pts || !pts.length) {
      ml.drone.setRoute([])
      ml.drone.setWaypoints([])
      return
    }
    // 3D 航线连线（浮在飞行高度）+ DOM 编号标记。3D 球已弃用：常规 zoom 下亚像素，深色描边还会盖成黑点
    // （与深色无人机混淆）；且 SpriteText 序号在共享 GL 上下文的自定义图层里不渲染。改用 DOM 标记，
    // 浏览器布局渲染、高对比、任意底色可见、与 GL 无关。
    const routeCoords: [number, number, number][] = []
    const wpPoses: WaypointPose[] = []
    for (const p of pts) {
      const ll = mapStore.mapCoordNeedsGcj02() ? (() => { const [lat, lng] = wgs84ToGcj02(p.lat, p.lng); return { lat, lng } })() : { lat: p.lat, lng: p.lng }
      routeCoords.push([ll.lng, ll.lat, p.alt ?? 0])
      wpPoses.push({ lng: ll.lng, lat: ll.lat, alt: p.alt ?? 0, label: p.label, isHome: p.isHome })
    }
    // 3D 航线连线 + 3D 航点(实心彩球 + 公告牌序号)：高度用 aboveHome（相对 home，与 sample.altitude 同基准），保留 3D 高度。
    ml.drone.setRoute(routeCoords)
    ml.drone.setWaypoints(wpPoses)
    const active = threeStore.activeMissionVersionAt(threeStore.three.playback.timeMs)
    ml.lastMissionKey = active ? active.startTime : -1
  }

  function fitToTrack(): void {
    const ml = runtime.mapLibreView
    if (!ml || !ml.trackCoordsFull.length) return
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
    for (const c of ml.trackCoordsFull) {
      if (c[0] < minLng) minLng = c[0]; if (c[0] > maxLng) maxLng = c[0]
      if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1]
    }
    if (!isFinite(minLng)) return
    ml.map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, pitch: 45 })
  }

  // 一键聚焦到无人机当前位置（3D MapLibre）：未锁定→一次性 jumpTo 到无人机地面点（保持当前
  // pitch/bearing，zoom 取 max(当前,16) 保证看清）；锁定中→锁定本身已居中跟随，把俯仰重置回
  // 追逐 seed(55°) 并强制下帧重新居中。无人机仍每帧 setPose 移动，未锁定时相机停住（仅一次性）。
  function focusDrone(): void {
    const ml = runtime.mapLibreView
    if (!ml || !ml.map.getSource('track')) return
    const threeStore = useScene3dStore()
    const samples = threeStore.three.telemetry.samples
    const origin = threeStore.three.telemetry.meta.geoOrigin
    if (!samples.length || !origin) return
    const mapStore = useMapStateStore()
    if (mapStore.map.lockView && ml.lockActive) {
      // 锁定中：重置俯仰到追逐 seed，下帧 updateMapLibreLive 按新 pitch 重新居中（center 几何随 pitch 变）。
      ml.lockPitch = LOCK_SEED_PITCH
      ml.lockAppliedKey = ''
      return
    }
    // 未锁定：一次性 jumpTo 到无人机当前位置（保持当前 pitch/bearing）。lockView=false 时
    // updateMapLibreLive 不在 lock 分支，不会每帧覆盖 → 视角停在此处（一次性，符合「仅跳转一次」）。
    const timeMs = threeStore.three.playback.timeMs
    const idx = threeStore.currentThreeSampleIndex(timeMs)
    const sample = threeStore.sampleAtTime(timeMs) || samples[idx]
    if (!sample) return
    const c = coordFor(sample, origin)
    // 俯仰相机下 center 须是「相机过无人机的视线射线落地点」，而非无人机地面点（否则 pitch 越大
    // 无人机越偏屏幕上方，切到 3D 时 pitch=45 会偏得明显）。几何同 updateMapLibreLive 锁定分支：
    // d = altAgl·tan(pitch)，沿当前 bearing 朝前偏移无人机地面点。pitch=0(正下方) → d=0 → 地面点。
    const pitchDeg = ml.map.getPitch() || 0
    const bearingDeg = ml.map.getBearing() || 0
    const altAgl = Math.max(0, sample.altitude ?? 0)
    const pitchRad = pitchDeg * Math.PI / 180
    const d = altAgl * Math.tan(pitchRad)
    let clat = c.lat, clng = c.lng
    if (d > 0) {
      const bearingRad = bearingDeg * Math.PI / 180
      const cosLat = Math.cos(c.lat * Math.PI / 180) || 1e-6
      clat = c.lat + (d * Math.cos(bearingRad)) / 111320
      clng = c.lng + (d * Math.sin(bearingRad)) / (111320 * cosLat)
    }
    ml.map.jumpTo({ center: [clng, clat], zoom: Math.max(ml.map.getZoom(), 16) })
  }

  // ============ 锁定模式：自处理鼠标交互（仿 3D 主场景 bindThreeControls） ============

  // 每 frame 的 jumpTo 会打断 MapLibre 自带手势动画（dragRotate/scrollZoom）→ 锁定时改由我们自己处理
  // 拖拽(bearing/pitch) + 滚轮(zoom)，并禁用 MapLibre 这些手势避免双重触发。状态写进 ml.lock*，
  // 每帧由 updateMapLibreLive 一次 jumpTo 统一写入（center+bearing+pitch+zoom），既跟随又应用用户操作。

  function setMapLibreBuiltInHandlers(ml: MapLibreRuntime, enabled: boolean): void {
    const keys = ['dragPan', 'dragRotate', 'scrollZoom', 'doubleClickZoom', 'boxZoom', 'touchZoomRotate', 'touchPitch']
    for (const k of keys) {
      const h = (ml.map as any)[k]
      if (h && typeof h.disable === 'function') { if (enabled) h.enable(); else h.disable() }
    }
  }

  function bindMapLibreLockControls(ml: MapLibreRuntime): void {
    const canvas = ml.map.getCanvas()
    let dragging = false
    let lastX = 0, lastY = 0
    // 拖拽 → 改 bearing(水平)/pitch(竖直)；滚轮 → 改相机到无人机距离 D。只改 ml.lock*，下一帧 jumpTo 统一生效（单一写入者）。
    // 系数 0.25 度/像素，方向与 3D 主场景一致（右拖 bearing 减、上拖朝地平线）；可按手感微调。
    const onDown = (e: PointerEvent): void => {
      dragging = true; lastX = e.clientX; lastY = e.clientY
      try { canvas.setPointerCapture(e.pointerId) } catch (_) { /* 忽略 */ }
    }
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX; lastY = e.clientY
      ml.lockBearing = (ml.lockBearing - dx * 0.25) % 360
      const maxP = ml.map.getMaxPitch()
      ml.lockPitch = Math.max(0, Math.min(maxP, ml.lockPitch - dy * 0.25))
      ml.lockAppliedKey = ''  // 强制下一帧应用
    }
    const onUp = (e: PointerEvent): void => {
      dragging = false
      try { canvas.releasePointerCapture(e.pointerId) } catch (_) { /* 忽略 */ }
    }
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      // 滚轮改相机到无人机的视线距离 D（等比缩放，符合「拉近/推远」直觉）；zoom 由每帧据 D 反算，此处不直接写 zoom。
      const ratio = e.deltaY > 0 ? 1.15 : 1 / 1.15
      ml.lockCamDist = Math.max(LOCK_CAM_DIST_MIN, Math.min(LOCK_CAM_DIST_MAX, ml.lockCamDist * ratio))
      ml.lockAppliedKey = ''
    }
    const onCtx = (e: Event): void => { e.preventDefault() }  // 禁右键菜单（WebView2 下会抢走拖拽）
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onCtx)
    ml.lockHandlers = { canvas, onDown, onMove, onUp, onWheel, onCtx }
  }

  function unbindMapLibreLockControls(ml: MapLibreRuntime): void {
    const h = ml.lockHandlers
    if (!h) return
    h.canvas.removeEventListener('pointerdown', h.onDown)
    h.canvas.removeEventListener('pointermove', h.onMove)
    h.canvas.removeEventListener('pointerup', h.onUp)
    h.canvas.removeEventListener('pointercancel', h.onUp)
    h.canvas.removeEventListener('wheel', h.onWheel)
    h.canvas.removeEventListener('contextmenu', h.onCtx)
    ml.lockHandlers = null
  }

  // ============ 每帧更新 ============

  function updateMapLibreLive(): void {
    const ml = runtime.mapLibreView
    if (!ml || !ml.map.getSource('track')) return
    const threeStore = useScene3dStore()
    const samples = threeStore.three.telemetry.samples
    const origin = threeStore.three.telemetry.meta.geoOrigin
    if (!samples.length || !origin) return
    const timeMs = threeStore.three.playback.timeMs
    const playing = threeStore.three.playback.playing
    const timeChanged = timeMs !== ml.lastTimeMs
    const idx = threeStore.currentThreeSampleIndex(timeMs)
    const sample = threeStore.sampleAtTime(timeMs) || samples[idx]
    if (!sample) return

    const mapStore = useMapStateStore()
    const c = coordFor(sample, origin)

    // 无人机位姿：先用 sample.altitude 直接做 altMeters（POS.ALT 可能本就是绝对高度），
    // 同时把 rawAlt/homeAlt 传给图层画彩球诊断——看哪个高度公式落在地形上。
    if (ml.drone && (playing || timeChanged)) {
      ml.drone.setPose({
        lng: c.lng, lat: c.lat,
        altMeters: sample.altitude ?? 0,
        roll: sample.roll || 0, pitch: sample.pitch || 0, yaw: sample.yaw || 0,
        rawAlt: sample.altitude ?? 0,
        homeAlt: origin.alt0 ?? 0,
        altIsMSL: threeStore.positionAltIsMSL(),
      })
    }
    // 模型尺寸倍率：用 3D 地图独立的 map.droneScale（非主场景 three.droneScale）——地图需更大才可见。
    if (ml.drone) ml.drone.setScaleMultiplier(mapStore.map.droneScale || 1)
    // 着色增强开关：每帧同步（setShaded 内部 O(1) 跳过）；!==false 让旧配置缺省视为开。低端机可关省 GPU。
    if (ml.drone) ml.drone.setShaded(mapStore.map.droneShaded !== false)
    // 桨自转联动：喂入各桨当前 PWM（主 3D 同源的 func→通道映射），图层 render 据此驱动——电机停→地图桨也停。
    // threeView 未就绪时 currentPropellerPwms 返回 []，图层自动回退固定转速（无电机数据时不卡）。
    if (ml.drone) ml.drone.setPropellerPwms(threeStore.currentPropellerPwms(timeMs))

    // 锁定追逐视角（自由轨道，仿 3D 主场景）：center 锁到「相机过无人机的视线射线打到的地面点」（跟随平移 +
    // 高度/俯角补偿）；bearing/pitch/zoom 由自处理的鼠标改（拖拽/滚轮），每帧一次 jumpTo 把 center+bearing+pitch+zoom 统一写入。
    // 接管鼠标是因为每帧 jumpTo 跟随会打断 MapLibre 自带 dragRotate/scrollZoom 动画（否则右键转不动）。
    // 必须用公共 jumpTo（走 map._update → SourceCache.update）：transform.setCenter 只写 _center、不刷瓦片覆盖
    // → 飞出初始范围后底图/地形块不加载（已实测）。
    const lock = mapStore.map.lockView
    if (lock !== ml.lockActive) {
      ml.lockActive = lock
      if (lock) {
        setMapLibreBuiltInHandlers(ml, false)                    // 禁自带手势，避免与我们处理的双重触发/被打断
        ml.lockBearing = ml.map.getBearing() || 0
        // 锁定基准：相机到 center 距离 L(米) 由 zoom 唯一决定、与 pitch 无关。
        // 从当前实际相机高度 H0 与当前 pitch 反推 L0；每帧 D→zoom 反算以此为锚（zoom=z0-log2(L_target/L0)）。
        const z0 = ml.map.getZoom()
        const pCurRad = (ml.map.getPitch() || 0) * Math.PI / 180
        const H0 = ml.map.transform.getCameraAltitude() || 0
        const L0 = Math.max(1, pCurRad ? H0 / Math.cos(pCurRad) : H0)  // pitch=0(nadir) 退化为 H0
        ml.lockZoomAnchor = { z0, L0 }
        ml.lockPitch = LOCK_SEED_PITCH
        // 初始 D：用目标 pitch 反算，使首帧 L_target=D+alt0/cos(pitch)=L0 → zoom=z0（视角不突跳，仅 pitch 变 55°+center 居中）。
        const alt0 = Math.max(0, sample.altitude ?? 0)
        const lpRad = LOCK_SEED_PITCH * Math.PI / 180
        ml.lockCamDist = Math.max(LOCK_CAM_DIST_MIN, L0 - alt0 / Math.max(1e-3, Math.cos(lpRad)))
        ml.lockAppliedKey = ''
        bindMapLibreLockControls(ml)
      } else {
        unbindMapLibreLockControls(ml)
        setMapLibreBuiltInHandlers(ml, true)
      }
    }
    if (lock) {
      // 目标 center：无人机有高度 + 相机倾斜，center 须是「相机过无人机的视线射线打到的地面点」才居中。
      //   d = a·tan(pitch)（pitch: 0=正下方 90=水平），沿 ml.lockBearing 朝前偏移无人机地面点。
      //   几何已验证：无人机恰在此 center 的相机视轴上 → 屏幕正中，且与 zoom 无关。
      //   pitch=0(正下方) → d=0 → center=无人机地面点（退化为正下方跟随，亦正确）。
      const pitchRad = ml.lockPitch * Math.PI / 180
      const cosP = Math.max(1e-3, Math.cos(pitchRad))           // 防 pitch→90° 发散（maxPitch 默认 85°，余量足够）
      const altAgl = Math.max(0, sample.altitude ?? 0)          // 离地高度(AGL；地形开时 center 贴地、本地地面同高 → 用 AGL)
      const d = altAgl * Math.tan(pitchRad)                      // 无人机地面点→center 水平距离(米，朝 bearing 前方)
      let clat = c.lat, clng = c.lng
      if (d > 0) {
        const bearingRad = ml.lockBearing * Math.PI / 180
        const cosLat = Math.cos(c.lat * Math.PI / 180) || 1e-6
        clat = c.lat + (d * Math.cos(bearingRad)) / 111320
        clng = c.lng + (d * Math.sin(bearingRad)) / (111320 * cosLat)
      }
      // zoom 据「相机到无人机视线距离 D」反算：L(相机到center)=D+altAgl/cos(pitch)，而 L∝2^(-zoom) →
      //   zoom=z0-log2(L_target/L0)。无人机升高→altAgl↑→L_target↑→zoom↓→相机同量升高，D 恒定=屏幕大小恒定。
      const anchor = ml.lockZoomAnchor
      const Ltgt = ml.lockCamDist + altAgl / cosP
      const zoomRaw = anchor ? anchor.z0 - Math.log2(Ltgt / anchor.L0) : ml.map.getZoom()
      const zoomC = Math.max(ml.map.getMinZoom(), Math.min(ml.map.getMaxZoom(), zoomRaw))
      // 每帧把 center+bearing+pitch+zoom 一次 jumpTo 写入（已禁自带手势，无中断）。状态无变化时跳过，避免空转触发 move 事件。
      const key = clng.toFixed(7) + ',' + clat.toFixed(7) + ',' + ml.lockBearing.toFixed(2) + ',' + ml.lockPitch.toFixed(2) + ',' + zoomC.toFixed(3)
      if (key !== ml.lockAppliedKey) {
        ml.lockAppliedKey = key
        ml.map.jumpTo({ center: [clng, clat], bearing: ml.lockBearing, pitch: ml.lockPitch, zoom: zoomC })
      }
    }

    // 轨迹/航线/航点显隐开关（与 2D 地图共用 showPath/showWaypoints，3D 新增 showRoute）。
    // 每帧设 visible，暂停下切换也即时生效；count<2 的空轨迹 visible=true 也不画（无段）。
    if (ml.drone) {
      const s = ml.drone.state
      if (s.trackLine) s.trackLine.visible = mapStore.map.showPath
      if (s.routeLine) s.routeLine.visible = mapStore.map.showRoute
      if (s.waypointGroup) s.waypointGroup.visible = mapStore.map.showWaypoints
    }

    // 已飞 3D 轨迹切片（暂停时 timeMs 不变 → 跳过）。坐标即原始 [lng,lat,MSL高度]。
    if (!timeChanged) return
    ml.lastTimeMs = timeMs
    if (!ml.drone) return
    const end = Math.max(1, idx + 1)
    // 3D 地图走 floating origin，每帧要把线顶点减相机坐标并重传 GPU；全量轨迹点多了会卡死。
    // 故 3D 地图始终限可见段为最近 TRAJ_MAX_POINTS 个点（fullTrajectory 只在主 3D 场景生效）。
    const start = Math.max(0, end - TRAJ_MAX_POINTS)
    ml.drone.setTrack(ml.trackCoordsFull as [number, number, number][], start, end)
  }

  // ============ rAF 入口（由 three.ts updateThreeFrame 调用） ============

  // 同步 custom-models store 的模型到图层（全量；scene 未就绪时 setCustomModels 缓存为 pending，onAdd 后应用）。
  // 模型经纬度存 WGS-84；高德(GCJ-02)底图下转 GCJ-02 再喂图层（与无人机/轨迹同源，对齐底图）。
  function syncCustomModels(): void {
    const drone = runtime.mapLibreView?.drone
    if (!drone) return
    const cms = useCustomModelsStore()
    const cmg = useCustomModelGroupsStore()
    const gcj = useMapStateStore().mapCoordNeedsGcj02()
    const specs: CustomModelSpec[] = cms.models.map((m) => {
      let lon = m.lon, lat = m.lat
      if (gcj) { const [glat, glng] = wgs84ToGcj02(m.lat, m.lon); lat = glat; lon = glng }
      return { name: m.name, url: cms.modelUrl(m.file), lon, lat, alt: m.alt, yaw: m.yaw, pitch: m.pitch, roll: m.roll, scale: m.scale, hidden: !!m.hidden }
    })
    // 模型组：展开成 tile spec + 虚拟锚点 spec（WGS-84），逐 spec 转 GCJ（锚点也转，供 gizmo 定位）。
    for (const g of cmg.groups) {
      for (const s of expandGroupToSpecs(g, cms.modelUrl)) {
        if (gcj) { const [glat, glng] = wgs84ToGcj02(s.lat, s.lon); s.lat = glat; s.lon = glng }
        specs.push(s)
      }
    }
    drone.setCustomModels(specs)
  }

  // 实时编辑单个模型位姿（滑杆拖动，不持久化、不重载 GLB）。patch 的 lon/lat 是 WGS-84，
  // 高德底图下转 GCJ-02 再传图层（图层只认底图坐标）。
  function updateCustomModelPose(name: string, patch: Partial<Pick<CustomModelSpec, 'lon' | 'lat' | 'alt' | 'yaw' | 'pitch' | 'roll' | 'scale'>>): void {
    const drone = runtime.mapLibreView?.drone
    if (!drone) return
    const layerPatch = { ...patch }
    if (patch.lon != null && patch.lat != null && useMapStateStore().mapCoordNeedsGcj02()) {
      const [glat, glng] = wgs84ToGcj02(patch.lat, patch.lon)
      layerPatch.lon = glng; layerPatch.lat = glat
    }
    drone.updateCustomModelPose(name, layerPatch)
  }

  // 实时同步一个组的锚点 + 所有 tile 位姿到图层（不重载 GLB、不全量重建）。
  // gizmo 拖动组中心 / 面板滑杆改组中心·bearing·spacing·scale 时调。坐标 WGS-84，GCJ 由 updateCustomModelPose 转。
  function syncGroupPose(groupName: string): void {
    const drone = runtime.mapLibreView?.drone
    if (!drone) return
    const cmg = useCustomModelGroupsStore()
    const g = cmg.groups.find((x) => x.name === groupName)
    if (!g) return
    updateCustomModelPose(anchorName(groupName), { lon: g.lon, lat: g.lat, alt: g.alt, scale: g.scale })
    for (const t of g.tiles) {
      if (!t.file) continue
      const { lon, lat } = tileLatLng(g, t.row, t.col)
      updateCustomModelPose(tileName(groupName, t.row, t.col), {
        lon, lat, alt: g.alt, yaw: t.yaw, scale: g.scale,
      })
    }
  }

  // 解析 gizmo target name → 起始 lon/lat/alt + 拖动回调（统一单个模型 vs 组锚点）。
  // 组锚点名以 __grp_ 开头（groupNameOfAnchor）；单个模型走 custom-models store。
  function resolveGizmoTarget(name: string): {
    lon: number; lat: number; alt: number
    onMove: (lon: number, lat: number, alt: number) => void
  } | null {
    const gName = groupNameOfAnchor(name)
    if (gName) {
      const cmg = useCustomModelGroupsStore()
      const g = cmg.groups.find((x) => x.name === gName)
      if (!g) return null
      return {
        lon: g.lon, lat: g.lat, alt: g.alt,
        onMove: (lon, lat, alt) => {
          g.lon = lon; g.lat = lat; g.alt = alt // 改 store（WGS-84，驱动面板输入框）
          syncGroupPose(gName) // 整组 tile 联动平移（不重载 GLB）
        },
      }
    }
    const cms = useCustomModelsStore()
    const m = cms.models.find((x) => x.name === name)
    if (!m) return null
    return {
      lon: m.lon, lat: m.lat, alt: m.alt,
      onMove: (lon, lat, alt) => {
        m.lon = lon; m.lat = lat; m.alt = alt
        updateCustomModelPose(name, { lon, lat, alt })
      },
    }
  }

  // 地图点击拾取：点击 lngLat 是底图坐标（高德=GCJ-02）。图层用底图坐标；store 存 WGS-84（高德需反转换）。
  function handleMapClick(e: maplibregl.MapMouseEvent): void {
    const lon = e.lngLat.lng, lat = e.lngLat.lat
    // 组中心拾取（优先）：点击坐标是底图坐标（高德=GCJ-02），图层用底图坐标；store 存 WGS-84。
    const cmg = useCustomModelGroupsStore()
    const gName = cmg.picking
    if (gName) {
      runtime.mapLibreView?.drone?.updateCustomModelPose(anchorName(gName), { lon, lat })
      let wlon = lon, wlat = lat
      if (useMapStateStore().mapCoordNeedsGcj02()) { const [rlat, rlng] = gcj02ToWgs84(lat, lon); wlat = rlat; wlon = rlng }
      cmg.applyPickedPosition(gName, wlon, wlat)
      syncGroupPose(gName) // 整组 tile 联动到新中心
      return
    }
    // 单个模型拾取。
    const cms = useCustomModelsStore()
    const name = cms.picking
    if (!name) return
    runtime.mapLibreView?.drone?.updateCustomModelPose(name, { lon, lat })
    let wlon = lon, wlat = lat
    if (useMapStateStore().mapCoordNeedsGcj02()) { const [rlat, rlng] = gcj02ToWgs84(lat, lon); wlat = rlat; wlon = rlng }
    cms.applyPickedPosition(name, wlon, wlat)
  }

  // === 自定义模型手柄编辑模式：拦截地图手势 + 自绘三轴手柄拖动改经纬高 ===
  // setGizmoActive 直接做 bind/unbind（仿 bindMapLibreLockControls）；编辑时禁所有地图手势，只能拖手柄。
  function setGizmoActive(on: boolean, name?: string): void {
    const ml = runtime.mapLibreView
    if (!ml) return
    const target = on ? (name ?? null) : null
    // gizmoTarget 总是同步到 layer（防收起面板时漏隐藏手柄）；bind/unbind 用边沿避免重复挂监听。
    ml.gizmoTarget = target
    if (ml.drone) ml.drone.setGizmoTarget(target)
    if (on === ml.gizmoActive) return
    ml.gizmoActive = on
    if (on) {
      setMapLibreBuiltInHandlers(ml, false)
      bindGizmoControls(ml)
    } else {
      if (ml.gizmoHandlers) unbindGizmoControls(ml)
      setMapLibreBuiltInHandlers(ml, true)
    }
  }

  // 拖动位移→经纬高（NED 转换）：屏幕像素→米（wpMpp）→ east/north/alt → 经纬度增量（sampleLatLng 公式）。
  // X 轴=经度(dx→dEast→dLng)、Y 轴=纬度(dy→dNorth→dLat)、Z 轴=高度(dy→dAlt)。在起点上累加（绝对，非增量漂移）。
  function bindGizmoControls(ml: MapLibreRuntime): void {
    const canvas = ml.map.getCanvas()
    const drone = ml.drone
    if (!drone) return
    let dragging = false
    let axis: 'x' | 'y' | 'z' | null = null
    let startX = 0, startY = 0
    let startLon = 0, startLat = 0, startAlt = 0
    const onDown = (e: PointerEvent): void => {
      if (!ml.gizmoTarget) return
      const rect = canvas.getBoundingClientRect()
      const ndc = new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      const hit = drone.hitTestGizmo(ndc)
      if (!hit) return // 未命中手柄：编辑时不转视角，忽略
      axis = hit; dragging = true; startX = e.clientX; startY = e.clientY
      const tgt = ml.gizmoTarget ? resolveGizmoTarget(ml.gizmoTarget) : null
      if (tgt) { startLon = tgt.lon; startLat = tgt.lat; startAlt = tgt.alt }
      try { canvas.setPointerCapture(e.pointerId) } catch (_) { /* 忽略 */ }
    }
    const onMove = (e: PointerEvent): void => {
      if (!dragging || !axis || !ml.gizmoTarget) return
      const dx = e.clientX - startX, dy = e.clientY - startY
      const origin = useScene3dStore().three.telemetry.meta.geoOrigin
      const lat0 = origin?.lat0 ?? 0
      const cosLat = origin?.cosLat ?? Math.cos(lat0 * Math.PI / 180)
      const wpMpp = 156543.03392 * Math.cos(lat0 * Math.PI / 180) / Math.pow(2, ml.map.getZoom())
      // 屏幕位移按地图 bearing 旋转投影到世界东/北（否则地图转向后拖动方向会反）。
      // 推导：屏幕上(0,-1)=世界方位 bearing=(sinB,cosB)；屏幕右(1,0)=(cosB,-sinB)；屏幕下=(−sinB,−cosB)。
      const B = (ml.map.getBearing() || 0) * Math.PI / 180
      const cB = Math.cos(B), sB = Math.sin(B)
      let dLon = 0, dLat = 0, dAlt = 0
      if (axis === 'x') dLon = ((dx * cB - dy * sB) * wpMpp) / (cosLat * 111320)
      else if (axis === 'y') dLat = ((-dx * sB - dy * cB) * wpMpp) / 110540
      else dAlt = -dy * wpMpp
      const newLon = startLon + dLon, newLat = startLat + dLat, newAlt = startAlt + dAlt
      const tgt = ml.gizmoTarget ? resolveGizmoTarget(ml.gizmoTarget) : null
      if (tgt) tgt.onMove(newLon, newLat, newAlt) // 单个:改 store+图层位姿；组:改组中心+整组联动
    }
    const onUp = (e: PointerEvent): void => {
      dragging = false; axis = null
      try { canvas.releasePointerCapture(e.pointerId) } catch (_) { /* 忽略 */ }
    }
    const onWheel = (e: WheelEvent): void => { e.preventDefault() } // 编辑时禁缩放
    const onCtx = (e: Event): void => { e.preventDefault() }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onCtx)
    ml.gizmoHandlers = { canvas, onDown, onMove, onUp, onWheel, onCtx }
  }

  function unbindGizmoControls(ml: MapLibreRuntime): void {
    const h = ml.gizmoHandlers
    if (!h) return
    h.canvas.removeEventListener('pointerdown', h.onDown)
    h.canvas.removeEventListener('pointermove', h.onMove)
    h.canvas.removeEventListener('pointerup', h.onUp)
    h.canvas.removeEventListener('pointercancel', h.onUp)
    h.canvas.removeEventListener('wheel', h.onWheel)
    h.canvas.removeEventListener('contextmenu', h.onCtx)
    ml.gizmoHandlers = null
  }

  function renderMapLibre(): void {
    const mapStore = useMapStateStore()
    const threeStore = useScene3dStore()
    const active = useUiStore().ui.mainView === 'three' && mapStore.map.active && mapStore.map.renderer === '3d'

    if (!active) {
      if (lastActive && runtime.mapLibreView) runtime.mapLibreView.map.repaint = false
      lastActive = false
      return
    }
    const rising = !lastActive
    lastActive = true

    // 提供商/地形策略变化 → 整图重建（raster source URL + 地形开关都变了）。
    const cur = runtime.mapLibreView
    if (cur && cur.providerId !== mapStore.map.providerId) {
      disposeMapLibre()
    }
    if (!runtime.mapLibreView) {
      threeStore.ensureThreeTelemetry()
      ensureMapLibre()
    }
    const ml = runtime.mapLibreView
    if (!ml) return

    // 仅在上升沿（视图由隐藏转可见）resize 一次：每帧 resize 会打断 MapLibre 拖拽惯性/缩放动画，
    // 导致拖不动、缩放生硬。容器后续尺寸变化 MapLibre 自带 ResizeObserver 会处理。
    if (rising) ml.map.resize()

    // 轨迹变化（换日志/换源）。
    const threeStore2 = threeStore
    const samples = threeStore2.three.telemetry.samples
    const origin = threeStore2.three.telemetry.meta.geoOrigin
    const teleKey = samples.length + '|' + (origin ? (origin.lat0 + ',' + origin.lng0) : '')
    if (ml.map.getSource('track') && teleKey !== ml.lastTeleKey) rebuildMapLibrePath()

    // 换日志/换机型 → 重建无人机模型图层（load 时按当时 airframe 建的，换日志后机型可能变）。
    if (ml.drone && ml.map.getLayer(ml.droneLayerId)) {
      const summary = useLogStore().log.summary
      const modelName = resolveDroneModelName(summary?.frame, summary?.airframe)
      if (modelName !== ml.droneModelName) {
        ml.map.removeLayer(ml.droneLayerId)
        ml.drone.dispose()
        const o = origin
        const handle = createDroneModelLayer({
          droneModelName: modelName,
          airframe: summary?.airframe,
          baseTone: inferBasemapTone(useMapStateStore().map.providerId),
          initialPose: { lng: o?.lng0 || 120, lat: o?.lat0 || 30, altMeters: o?.alt0 || 0, roll: 0, pitch: 0, yaw: 0 },
        })
        try { ml.map.addLayer(handle.layer) } catch (e) { /* 忽略 */ }
        handle.setHome(o?.lng0 || 120, o?.lat0 || 30)
        ml.drone = handle
        ml.droneModelName = modelName
      }
    }
    // 按配置(map.droneModel)切换 glb/lowpoly：airframe 重建后新句柄是 lowpoly，这里按需升级为 GLB。
    if (ml.drone) applyDesiredMapDroneModel(ml)

    // 航点懒加载 + 重建。
    const cmdStore = useCommandsStore()
    if (!cmdStore.commands.loaded && !cmdRequested) {
      cmdRequested = true
      cmdStore.loadCommands().then(() => rebuildMapLibreWaypoints())
    } else if (cmdStore.commands.loaded && ml.map.getSource('waypoints-line')) {
      const mv = threeStore2.activeMissionVersionAt(threeStore2.three.playback.timeMs)
      const key = mv ? mv.startTime : -1
      if (key !== ml.lastMissionKey) rebuildMapLibreWaypoints()
    }

    // 持续重绘：自定义图层里的无人机/标记必须在 setPose 之后才有正确坐标；若 paint=false，
    // 首帧（pose 还没设）画完就不再重绘，无人机会卡在 (0,0) 屏幕外永远看不见。queryTerrainElevation
    // 已门控（不再每帧查），所以常开重绘不会卡。
    ml.map.repaint = true

    updateMapLibreLive()
  }

  // 手动切换地形（TerrainControl 之外的工具栏开关）。
  function applyTerrain(on: boolean): void {
    const ml = runtime.mapLibreView
    if (!ml) return
    const mapStore = useMapStateStore()
    const want = on && !mapStore.mapCoordNeedsGcj02()
    if (want && !ml.terrainOn) {
      if (!ml.map.getSource('terrain')) {
        ml.map.addSource('terrain', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_MAXZOOM })
      }
      ml.map.setTerrain({ source: 'terrain', exaggeration: 1.0 })
      ml.terrainOn = true
    } else if (!want && ml.terrainOn) {
      ml.map.setTerrain(null)
      ml.terrainOn = false
    }
  }

  return {
    mapLibreEl, registerMapLibreMain,
    customModelsPanelOpen, toggleCustomModelsPanel, closeCustomModelsPanel,
    ensureMapLibre, disposeMapLibre, renderMapLibre,
    rebuildMapLibrePath, rebuildMapLibreWaypoints, updateMapLibreLive,
    syncCustomModels, updateCustomModelPose, syncGroupPose, setGizmoActive,
    applyTerrain, fitToTrack, focusDrone,
  }
})

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}
