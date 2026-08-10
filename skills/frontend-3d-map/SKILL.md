---
name: frontend-3d-map
description: 飞控日志分析器（Drone Log Analyzer）3D 地图（MapLibre GL + three.js 自定义图层）与主 3D 场景（three.js）渲染的硬核规则与踩坑。涉及文件：frontend/src/utils/maplibre-drone-layer.ts（MapLibre 自定义图层：无人机模型 + 3D 轨迹/航线）、frontend/src/utils/drone-model.ts（四元数）、frontend/src/stores/maplibre.ts、frontend/src/stores/three.ts、frontend/src/components/map/MapLibreView.vue。当用户要改 3D 地图、MapLibre 自定义图层、无人机模型/缩放/材质、3D 轨迹或航线渲染、锁定/追逐相机、inline GLSL 着色器、或遇到「无人机不显示/在地下/抖动/消失」「轨迹贴地/飘」「缩放就消失」之类症状时**必须先读本文件**。关键词：maplibre、3d 地图、custom layer、customlayerinterface、three.js、glsl、shadermaterial、无人机模型、轨迹、航线、锁定相机、floating origin、altitude、terrain、瓦片。
---

# 3D 地图（MapLibre + three.js）渲染规则

本文是**踩坑沉淀的硬规则**，每条都附「为什么」和「症状」。改 3D 地图、自定义图层、无人机模型/材质、3D 轨迹/航线、锁定相机、inline GLSL 前，**先读这里**——这些坑都表现为「静默不渲染」或「位置错乱」，调试极费时。

涉及文件：[`utils/maplibre-drone-layer.ts`](../../frontend/src/utils/maplibre-drone-layer.ts)（自定义图层 + 材质）、[`utils/drone-model.ts`](../../frontend/src/utils/drone-model.ts)（四元数）、[`stores/maplibre.ts`](../../frontend/src/stores/maplibre.ts)（视图状态/锁定相机）、[`stores/three.ts`](../../frontend/src/stores/three.ts)（遥测采样/profile）、[`components/map/MapLibreView.vue`](../../frontend/src/components/map/MapLibreView.vue)。底图/瓦片是 Go 侧 provider + MBTiles 缓存，见 [docs/map-tiles.md](../../docs/map-tiles.md)；主 3D 场景（`components/three/Scene.vue`）与此**独立**，见末节。

> maplibre-gl 版本 **5.24**（见 `package.json`）。注意：5.24 **没有** `getFreeCameraOptions`（那是 Mapbox），不能直接设相机位置，只能 center+zoom+bearing+pitch。

## 1. 架构：自定义图层共享 MapLibre 的 GL 上下文

3D 地图的无人机模型 + 3D 轨迹/航线由一个 MapLibre `CustomLayerInterface` 渲染，它**共享 MapLibre 的 WebGL 上下文**给一个 `THREE.WebGLRenderer`（[`maplibre-drone-layer.ts`](../../frontend/src/utils/maplibre-drone-layer.ts)）。后果：

- **MeshStandardMaterial 在这个共享上下文里不可靠**（渲染黑/闪烁，根因未查，直接避免）——无人机用自写 `ShaderMaterial`（见 §4）。
- **不能复用主 3D 场景的 GLB**：地图图层有自己的 `GLTFLoader` 单独加载（`map.droneModel`），模型/缩放与主场景**完全独立**（见 §3）。
- `onAdd` 里**必须** `state.camera = new THREE.Camera()`——state 初始化是 `camera: null`，而 `render()` 会 `state.camera.projectionMatrix.fromArray(...)`。漏建 → `render()` 每帧抛错 → **整个自定义图层（无人机+线+标记）静默全不画**（错误只在 devtools console）。这是历次「没有无人机/没有线」的真因，模型/矩阵一直没问题。
- **不要** `gl.enable(CULL_FACE)`；只调 `renderer.resetState()`。

## 2. 变换矩阵（核心配方）

无人机：`camera.projectionMatrix = mainMatrix · T · scale(s,-s,s) · Rx(π/2) · R_attitude`。要点：

- 用 `options.defaultProjectionData.mainMatrix`，**不要** `options.modelViewProjectionMatrix`——本 maplibre 版本里后者会把整个图层投影到屏外 → 不可见。
- **负 Y 缩放 `scale(s,-s,s)` 必需**（mercator y 朝南）；漏了模型镜像、pitch/roll 反向。
- 参考实现：maplibre.org 的 add-a-3d-model-using-threejs 示例。

3D 轨迹/航线：`THREE.Line` 在**单独的 `lineScene`**，顶点预烘焙成 mercator 单位（`MercatorCoordinate.fromLngLat(lnglat, altMeters)`），只用 `projectionMatrix = mvp`（**无 body 变换**）。**不要**用 GeoJSON `line` 图层画悬浮轨迹——它会贴地形/忽略 z，看着是扁的「2D 版」。

## 3. 无人机模型与缩放（与主 3D 场景独立）

- **缩放用固定世界尺寸，不要用 constant-screen-size**。`pxPerMerc` 的 `s = targetPx/(modelMaxDim·|mainMatrix[0]|·canvasW/2)` 在本版本不可靠（会算出不可见尺寸）。改用 **`meterInMercatorCoordinateUnits()`**：`modelScale = meterInMerc · 1000 / modelMaxDim`（~1000 m 跨度，典型缩放下可见）。
- 模型与缩放存 `map.droneModel`（`'glb'`|`'lowpoly'`，默认 `lowpoly`）+ `map.droneScale`（默认 3，比主场景的 1 大），经 settings 持久化，UI 在 Settings.vue「3D 地图无人机」。lowpoly 在 `onAdd` 同步构建（立即可见），GLB 异步加载后 `handle.replaceModel` 替换。
- 模型替换/换日志时**必须** `disposeObject3D` 释放 geometry+material+textures（GLB 的 map/normalMap/envMap），否则 GPU 显存涨。

## 4. 无人机材质：自写 ShaderMaterial + 深度规则

材质链路在 `buildSimpleMaterial`（`maplibre-drone-layer.ts`）：**自包含 `ShaderMaterial`，在 shader 内算着色**，绕开 three.js 的灯光系统。

- **着色公式**（半球主导的天穹感，顶面最亮）：`shade = 0.30(ambient) + 0.60·hemi + 0.10·diff`，其中 `hemi = N.z*0.5+0.5`（世界 +Z=上），`diff = max(dot(N, uLightDir), 0)`，`uLightDir = normalize(1,-0.6,0.45)`，`uColor` = 每网格 cfg.color。调参史：0.45 directional「太离谱」；0.62 ambient+0.26 hemi「分不清上下」。最终半球主导。
- **深度标志**：`depthTest:true, depthWrite:true, transparent:true, side:DoubleSide`，且 `render()` 在 `renderer.render(scene,camera)` **前**调 `renderer.clearDepth()`。理由：早先 `depthTest:false`+DoubleSide 让背面 bleed 成污渍（three.js 透明排序在机身+机臂+桨的相交处不可靠）；`depthTest:false`+FrontSide 从上方看藏了暗底面 → 空壳感。开了深度后 DoubleSide 由深度缓冲正确自遮挡（干净、无 bleed、掠射角仍见底面）。**`clearDepth()` 每帧擦掉地形深度**，使无人机只与**自己**做遮挡、永不被地形藏（等同于 `depthTest:false` 的「始终可见」语义，但无 bleed）。历史原因：depthTest 当初置 false 是 altitude-basis 的安全网（无人机算到地下时深度会藏住它）；`clearDepth` 保留了这个安全网。线/航点保持 `depthTest:false`（不读深度，不受 clearDepth 影响）。`renderOrder=10` 让无人机画在透明线（3/4）之后，颜色在上。
- 可切换：`map.droneShaded`（持久化，Settings.vue「着色增强」，默认 on）。on=ShaderMaterial 着色；off=`buildFlatMaterial`→`MeshBasicMaterial`（低配/iGPU 兜底）。`setShaded(on)` 每帧调用、O(1) 跳过未变；换材质走 `reapplyMaterials()`（按 `userData._apmMatConfig` 重建、dispose 旧的，geometry/GLB scene 不动）。**看到扁平无人机先查 `map.droneShaded` 再「修」**。

> 主 3D 场景（`drone-model.ts` 的 Scene）**不受此影响**——它仍用 MeshStandardMaterial + 真实灯光。

### GLSL ES 1.00 坑（ShaderMaterial 默认就是 1.00）

- **整数字面量会静默炸掉编译**。ShaderMaterial 默认 GLSL ES 1.00，**没有隐式 int→float**。把 JS 数字拼进 inline GLSL 时，整数值的常量（如 `120`）会变成 GLSL 字面量 `120`（int），`pow(x, 120)` / `smoothstep(1500, 4500, d)` 编译失败 → 整个 shader program 无效 → mesh 静默不画（console 只有 `useProgram: program not valid` + "too many errors"）。**`String(120.0)` 在 JS 里仍是 `"120"`**，所以在常量里写 `.0` 没用。
  - **正确**：拼进 inline GLSL 的整数值常量，外面包 `float(...)`：`pow(x, float(' + THREE_X + '))`、`smoothstep(float(' + A + '), float(' + B + '), d)`。浮点值（0.18、1.5、2.2）裸写没问题。
- ShaderMaterial 会自动注入 `position`/`normal`/`normalMatrix`/`modelViewMatrix`/`projectionMatrix`——**不要重新声明**它们（RawShaderMaterial 才需要）；**不要声明 `precision`**（THREE 会 prepend）。
- 字面量都写 `.0`（如 `0.30`、`0.5`）。
- 水面等 inline shader 用**自己的 uniforms**（`uCamPos`/`uPlanePos` 每帧在 `alignThreeWater` 设），**不用** three 的自动 `cameraPosition`/`modelMatrix`——新 shader 沿用此约定。

## 5. 高度基准：相对起飞点，统一一个 home 地表高

**高度是相对起飞点（height-above-home），不是 MSL。** APM `POS.RelHomeAlt` 与任务 `aboveHome` 都是相对 home；PX4 `vehicle_global_position.alt` 是 MSL（profile 里 `altIsMSL=true` 标注）。

- **基准点必须是起飞/home 点，不是无人机当前位置。** 每帧拿无人机脚下 DEM（`gndElev(curLngLat)+alt`）会让无人机随地形起伏（飞过山头被抬高）。航线/航点若不补偿，无人机会永远高于航线。
- **正确做法**：DEM 只在 **home 坐标查一次**（`homeGndElev`，缓存；home 固定 → 无每帧查询），然后**四个元素**（无人机 altMeters、已飞轨迹 alt、航线 aboveHome、航点 aboveHome）统一过一个函数：
  `renderAltForMerc(rawAlt, isMSL) = (homeGndElev != null && !isMSL) ? homeGndElev + rawAlt : rawAlt`。MSL 数据（PX4）跳过加法（已是 MSL）；航线/航点恒为 aboveHome 所以恒加。
  - 地形 **OFF** → `homeGndElev` 永不查询（null）→ 全部走 `rawAlt`，单一相对系，仍对齐（这就是 GCJ-02 底图强制关地形时不暴露此 bug 的原因）。
  - `MercatorCoordinate.fromLngLat(lnglat, altMeters)` 的 z 参数期望 MSL——所以相对高度必须加 `homeGndElev` 补偿，否则地形 ON 时无人机沉到地表下（「看起来在地下」；早期模型放大到 ~1km 时被掩盖）。
- **DEM tile 首次可能未加载完**：`queryTerrainElevation` 返回 null → 回退 `map.once('idle', tryQuery)`（地形解码后重试一次），不要用一次性查询永远留 null。`homeGndElev` 就绪后 `rebuildRouteAbs/rebuildWaypointAbs/rebuildTrackAbs` 从缓存的 raw 坐标重算烘焙 mercator z + `recomputeTransform`；`setPose` 在 `altIsMSL` 翻转时也调 `rebuildTrackAbs`（轨迹高度共享 altMeters 的基准）。
- `map.queryTerrainElevation` 是**重的同步 DEM 查询**——如非要用，gate 在 `playing || timeChanged`，**绝不每帧**。

## 6. 缩放抖动/消失 = mercator float32 抖动 → 浮动原点

**症状**：缩小到 ~zoom 10 以外无人机闪烁后消失（隐约可见）；调 `modelScale`、关 `depthTest` 都没用。**根因**：GPU 在 float32 里算 `mainMatrix × vertex`；mercator 世界坐标 ~0.5 而无人机 ~1e-5，view 矩阵的相机相对减法吃掉每顶点差值 → 抖动，相机拉远时放大成 z-fighting。maplibre 的 Babylon 示例为这个开了 `useHighPrecisionMatrix`；three.js 没开关。

**修复 = 浮动原点 / 相机相对渲染**（`render()` 里）：

1. 相机 mercator：`map.transform.getCameraLngLat()` + `getCameraAltitude()` → `MercatorCoordinate.fromLngLat`（5.24 无 `getFreeCameraOptions`）。
2. `relMvp = fromArray(mainMatrix) × T(cam)` 抵消 view 的 `T(-cam)`（依赖标准 lookAt 的 `view = R×T(-cam)`）→ `projection×R`。
3. 模型平移变成 `(tx-camX, ty-camY, tz-camZ)`，`camera.projectionMatrix = relMvp`。
4. 线顶点：`trackPositions`/`routePositions` 存**绝对** mercator，`offsetLinesToCamera()` 每帧把 `abs-cam` 写进单独的 geometry renderBuf（CPU double 减法）。

GPU 只看到米级小数 → 模型和线的抖动都没了。早先的 `MeshBasicMaterial + depthTest:false + renderOrder` 仍作为 z-fighting 兜底，但不再是主修复。

## 7. 锁定/追逐相机（[`stores/maplibre.ts`](../../frontend/src/stores/maplibre.ts) updateMapLibreLive + bindMapLibreLockControls）

状态在 `runtime.mapLibreView`（`lockActive/lockBearing/lockPitch/lockCamDist/lockZoomAnchor/lockAppliedKey/lockHandlers`），开关是 `map.lockView`（MapLibreView.vue），默认自由轨道。四条硬规则：

1. **每帧移动相机必须用 `map.jumpTo({center, ...})`（或 `setCenter`），不要 `transform.setCenter`（@internal）。** 内部 `transform.setCenter` 只写 `_center`、不走 `map._update()` → `SourceCache` 的瓦片覆盖不刷新 → 无人机飞出初始视口后**不再加载底图/地形瓦片**（空白）。`jumpTo` 走 `_update` → 瓦片会加载。
2. **每帧 `jumpTo` 会打断 MapLibre 内置手势**（`dragRotate`/`scrollZoom`）→ 锁定下右键旋转/滚轮缩放失效。修复 = 像 3D 场景 `bindThreeControls` 那样接管鼠标：锁定时禁用内置 handler（`dragPan/dragRotate/scrollZoom/doubleClickZoom/boxZoom/touchZoomRotate/touchPitch`），在 `map.getCanvas()` 上绑自己的 pointer（bearing/pitch）+ wheel（zoom），写进 `lockBearing/lockPitch/...`，每帧用**一个** `jumpTo` 写入 center+bearing+pitch+zoom 全部（单写者；按 `lockAppliedKey` 跳过未变，避免空转 move 事件）。解锁时恢复 handler + 解绑。`contextmenu` 要 `preventDefault`（WebView2 右键菜单会吃掉拖拽）。
3. **俯仰相机下居中抬高物体**：`center` 必须是相机→物体射线落地的点，不是物体的地面点。几何：AGL 高度 `a`、maplibre `pitch`（0=正下、90=水平），偏移 = `a·tan(pitch)` 米沿当前 bearing 向前，即 `center = objGround + (a·tan(pitch)) along bearing`。这样物体正好在相机→center 轴上 → 屏幕中心，且**与 zoom 无关**（任意 zoom 都居中，zoom 只取景）。pitch=0 偏移=0（退化的正下跟随，也对）。
4. **zoom 必须由相机→无人机距离 D 推导，不能固定。** 固定 zoom 时无人机直爬升会看起来逼近相机（变大）→ 用户得手动缩出。正确：相机→center 距离 `L` 只由 zoom 决定（`L ∝ 2^(-zoom)`，与 pitch 无关）且 `L = D + a/cos(pitch)`（D=相机→无人机视线距离）。每帧 `zoom = z0 - log2(L_target/L0)`。保持 D 恒定 → 相机高度 `H = a + D·cos(pitch)` 精确跟随爬升 → **屏幕尺寸恒定**。锁定瞬间用实时相机标定锚点 `{z0,L0}` 一次：`L0 = getCameraAltitude()/cos(getPitch())`，`D0 = L0 - alt0/cos(LOCK_SEED_PITCH)`（用目标 pitch，首帧 `L_target=L0 → zoom=z0`，无跳变；只有 pitch→55° + 重新居中）。**滚轮不再写 zoom，而是把 D 缩放 ×1.15**（恒定屏幕尺寸现在是 D 的属性；pitch 拖拽不改变尺寸，只重新取景）。注意 `getCameraAltitude()` 是 MSL，地形 ON 时 L0 标定会吃进地表高、D0 偏斜（同 §5 的 AGL-vs-MSL 问题）；多数地图此地地形 OFF（GCJ-02 底图），实测精确。

## 8. 杂项硬规则

- **永不每帧 `map.resize()`** —— 它重算 transform、杀死拖拽惯性/缩放缓动（症状：拖不动、缩放僵硬）。只在视图变可见的上升沿调一次。
- **无人机姿态用 `makeDroneQuaternionMercator`**（[`drone-model.ts`](../../frontend/src/utils/drone-model.ts)）：`Ry(+yaw)·Rx(-pitch)·Rz(-roll)`，**不要**主 3D 场景 `makeDroneQuaternion` 用的 `uav = Ry(π)` 翻转。错了 → 180° 偏航。
- `sampleAtTime(timeMs)` 返回的插值样本**没有 `north`/`east`**（只有 `x/y/z/roll/pitch/yaw/altitude/...`）。回放时读 `sample.north/east` 会得 **NaN** → 无人机+标记飞出屏（暂停在 `points[0]` 正常，因为返回完整 `points[0]`）。从始终存在的场景坐标恢复：`east = x / THREE_UNITS_PER_METER`、`north = -z / THREE_UNITS_PER_METER`（`buildThreeSamples`：`x=east*1.5`、`z=-north*1.5`）。

## 9. 待解决（改之前先看，别重复踩）

- **航线 `Line2`（橙色任务航线）在拉近/靠近时整条消失。** 试过 `trackLine.frustumCulled = false` **没修好**（用户：「改了也是一样」）→ **不是视锥剔除**，已回退。`Line2`/`LineSegmentsGeometry.setPositions()` 本就每帧重算 `boundingSphere`，剔除本就是弱假设。真因未知——再查前**别假设是剔除**。待查方向：浮动原点下 `Line2` 粗线 quad 的近/远裁剪（顶点是 `abs-cam`，拉近时近裁面可能吞掉短航线）、`LineMaterial.resolution`、或放大的无人机模型（`renderOrder=10`、`depthWrite`）在拉近时盖住了航线。

## 主 3D 场景（`components/three/Scene.vue`）与此独立

主 3D 场景用**自己的** WebGL 上下文、`MeshStandardMaterial` + 真实灯光、`makeDroneQuaternion`（含 `Ry(π)` 翻转）、模型缩放默认 1。本文 §1–§4 的「共享上下文」限制**只适用于 MapLibre 自定义图层**，不要把主场景的写法套到地图图层上，反之亦然。两者共享的只有：遥测来自 [`stores/three.ts`](../../frontend/src/stores/three.ts) 的 profile 驱动采样（见 [docs/frontend.md §profile](../../docs/frontend.md#格式无关的字段源-profile)）。
