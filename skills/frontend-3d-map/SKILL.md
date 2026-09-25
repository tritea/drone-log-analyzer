# 3D 渲染规则（主 3D 场景 + Cesium 地球）

> **2026-09：MapLibre 3D 渲染器（原「地图3D」按钮）已整体移除**——自定义图层/共享 GL 上下文/mercator floating-origin/lock 相机等章节随之删除（历史经验仍在 git 历史）。3D 地图 = Cesium 地球（工具栏「3D 地图」按钮，原「测绘」）。新格式只加 profile，不动渲染层。

## 1. 渲染器格局

| 渲染项 | 实现 | 模块 |
|---|---|---|
| 播放/遥测中枢 | 播放时钟、samples 采样、曲线定义、current、单一 rAF 枢纽 | [`modules/playback`](../../frontend/src/modules/playback)（store + loop/frame-loop） |
| 2D 地图 | Leaflet | [`modules/map-2d`](../../frontend/src/modules/map-2d) |
| 3D 地图 | Cesium 地球（全球地形、3D Tiles、自定义模型、锁定视角） | [`modules/earth`](../../frontend/src/modules/earth) |
| 主 3D 场景 | three.js 独立 WebGL 上下文（纯渲染面，数据/时钟来自 playback） | [`modules/view3d`](../../frontend/src/modules/view3d) |

- `map.renderer` 类型 `'2d' | 'earth'`；持久化旧值 `'3d'` 在 settings-store 读回时迁移到 `'earth'`。
- Cesium 实例不进 Pinia state，放 [`shared/runtime.ts`](../../frontend/src/modules/shared/runtime.ts) 的 `runtime.earthView`（EarthRuntime）；锁定鼠标交互句柄类型 `EarthLockHandlers`。

## 2. 高度双基准：开地形用日志绝对海拔（altMsl），无地形用相对 home（altRel）

**位置源带两个高度字段**（profile `PositionSource`：`alt`=绝对海拔 MSL、`relAlt`=相对 home）：APM `POS.Alt`+`POS.RelHomeAlt`、tlog `GLOBAL_POSITION_INT.Alt`+`RelativeAlt`；PX4 无相对字段，由 `alt−home_position.alt` 派生。遥测 sample 同带双值：`altitude`（相对 home——HUD/锁定视角口径）+ `altMsl`（绝对海拔，可 null）。

- **开地形必须直接用日志绝对海拔，不做任何校准/修正**——与 DEM 同基准（起飞点 DEM 校准/容差贴地那套已按用户要求去掉，别加回来）。DEM 补偿只留作 `altMsl` 缺失（日志无绝对高字段）时的兜底。
- **基准点必须是起飞/home 点，不是无人机当前位置**（每帧拿脚下 DEM 会让无人机随地形起伏）。
- **Cesium 准则**：`sampleHeight`（earth-store）= terrainOn ? (`altMsl` ?? `homeGroundElev+rel`) : rel；`applyTerrain` 翻转 → `rebuildEarthPath`+`rebuildEarthWaypoints`（航点 = `origin.alt0`+aboveHome），DEM 兜底值就绪后回调里再 rebuild 一次。无人机/轨迹/航点/自定义模型都过它，别各自换算。
- **`geoOrigin.alt0` 是真 MSL home 海拔**（绝对链的 home/解锁/首采样零点）——任务绝对帧航点换算（`computeMissionPoints`/`missionLatLngPoints`）用它，别再当 0 用。
- 自定义模型高度语义是"贴地+离地高"：`homeGroundElev + alt`（home 点 DEM 近似），与无人机/轨迹基准无关，别混。
- **RTL（NAV_RETURN_TO_LAUNCH=20）不是正常航点**：`missionLatLngPoints`/`computeMissionPoints` 对它坐标恒取 home、label 置空——只连线回 home，不编号不画标记；各消费方按 `!label` 跳过标记（2D/3D 同约定）。

## 3. GLSL ES 1.00 坑（ShaderMaterial 默认就是 1.00，主场景/自绘 shader 通用）

- **整数字面量会静默炸掉编译**。ShaderMaterial 默认 GLSL ES 1.00，**没有隐式 int→float**。把 JS 数字拼进 inline GLSL 时，整数值的常量（如 `120`）会变成 GLSL 字面量 `120`（int），`pow(x, 120)` / `smoothstep(1500, 4500, d)` 编译失败 → 整个 shader program 无效 → mesh 静默不画（console 只有 `useProgram: program not valid` + "too many errors"）。**`String(120.0)` 在 JS 里仍是 `"120"`**，所以在常量里写 `.0` 没用。
  - **正确**：拼进 inline GLSL 的整数值常量，外面包 `float(...)`：`pow(x, float(' + THREE_X + '))`、`smoothstep(float(' + A + '), float(' + B + '), d)`。浮点值（0.18、1.5、2.2）裸写没问题。
- ShaderMaterial 会自动注入 `position`/`normal`/`normalMatrix`/`modelViewMatrix`/`projectionMatrix`——**不要重新声明**（RawShaderMaterial 才需要）；**不要声明 `precision`**（THREE 会 prepend）。
- 水面等 inline shader 用**自己的 uniforms**（`uCamPos`/`uPlanePos` 每帧设），**不用** three 的自动 `cameraPosition`/`modelMatrix`——新 shader 沿用此约定。

## 4. 高德（GCJ-02）底图约束

- provider id 以 `amap` 开头 = GCJ-02 坐标系：所有 WGS-84 经纬度先 `wgs84ToGcj02` 再喂图层（拾取反向 `gcj02ToWgs84`），见 `mapCoordNeedsGcj02()`。
- **GCJ 底图禁地形 DEM**（`terrainAllowed = !mapCoordNeedsGcj02()`）——DEM 是 WGS-84 网格，叠加 GCJ 底图会错位。

## 5. Cesium 地球要点（[`modules/earth`](../../frontend/src/modules/earth)）

- 地形：`applyTerrain()`（`map.terrainOn` && 非 GCJ）切 `CustomHeightmapTerrainProvider`（terrarium DEM，64×64 解码，见 `renderer/terrain-provider.ts`）；关闭回 `EllipsoidTerrainProvider`。`homeGroundElev` 由 `sampleTerrainMostDetailed` 在 home 点采样一次（兜底/贴地用），异步就绪后须 rebuild 轨迹/航点。
- 无人机模型：实体 + `headingPitchRollQuaternion`；GLB 先归一化物理尺寸（`droneBaseScale`）再乘 `droneScale`；桨叶按真实 PWM 转（nodeTransformations + preRender 推进），电机停桨停，**不做恒转兜底**。
- 锁定追逐：heading/pitch/range 状态在 rt.lock*（右键拖拽/滚轮自处理，`EarthLockHandlers`）。**相机重应用判定用精确比较（`lockAppliedPos` + 三姿态量），勿用量化 key 去重**——旧版 0.1m/0.01° 量化让相机以「速度×10Hz」步进而模型每帧插值全速走，屏上模型被来回甩（慢速段更明显）；暂停时同样输入逐位相同自动跳过。
- **相机统一 = 球坐标 + `camera.setView`，orientation 用 direction+up 向量对（勿用 heading/pitch/roll 欧拉，勿用 ssc 内置旋转/`camera.lookAt`）**：ssc 手势全禁；左/右键拖拽绕「屏幕中心地表锚点」改 heading/pitch（全 360° 无限制）、滚轮/中键改 range（`rt.freeOrbit`）。相机位置由锚点 ENU 系球坐标反算（offset = (−sin h·cos p, −cos h·cos p, −sin p)·range）；朝向由 ENU 构造 **direction=(sin h·cos p, cos h·cos p, sin p)、up=(−sin h·sin p, −cos h·sin p, cos p)** 转世界系——欧拉在 pitch 翻越 ±90° 时 heading 反转 180° 闪跳（用户实测"到地形下面一直闪"），向量对天然连续。`lookAt` 会锚定 transform 每帧跟随时闪，禁用。球坐标惰性建立：每次手势开始重取锚点+读当前相机，**onDown 先 apply 一次自洽化**（防首帧吸附跳变）；`fitToTrack`/`focusDrone`/锁定切换后置 null。`globe.backFaceCulling=false`（相机到地下时背面剔除闪烁）；**`ssc.enableCollisionDetection=false` 必须关**——碰撞检测默认每次相机更新后把低于地形的相机拽回地表，与每帧 setView 拉锯 → 贴地/地下视角不拖拽也持续抖动（用户实测"有什么在拽回去"）。无人机位姿+锁定相机挂 `scene.preUpdate`（update 消费前写入，同帧生效——挂 preRender 会晚一帧，相机一动模型就在背景里"游"）。
- **渲染器互斥与数据生命周期**：`switchRenderer(scene|map2d|earth)`——切走即销毁（`destroyThreeView`/`disposeEarth`/`disposeMap2d`），切回从头重建；**离开可视化（`setMainView('chart')`）再全量释放**：主场景+姿态仪+当前地图渲染器+遥测派生数据（`playback.releaseTelemetry`，CurveManager 缓存与曲线图共用不动），重进按需重建（用户决策）。**右栏姿态仪 `runtime.attitudeView` 可视化内常驻**（渲染器切换不销毁），随离开可视化销毁（`destroyAttitudeView`）。
- **播放推进单时钟**：rAF 枢纽在 `modules/playback/loop/frame-loop.ts`（链句柄挂 `runtime.frameLoop.raf`，勿用模块级 let——HMR 孤儿链）。**earth 独占判定 `isEarthSolo()` 只此一份**（frame-loop 与 earth preUpdate 共用 import）：earth 独占时**整条可视化帧管线交棒 Cesium 自身默认渲染循环**（`scene.preUpdate` 的 `earthSoloFrame`：推进→applyFramePoses/姿态仪→reconcile 节流→位姿/锁定相机，frame-loop rAF 链退出——两链并行会在瓦片加载期挤压帧预算+相位交错，位置一顿一顿），其余模式在 frame-loop——任何新代码不得另起第二条推进/渲染驱动链。**相位必须 preUpdate 而非 preRender**：visualizer 在 `scene.update` 读实体位姿，preRender 时旧值已被消费——写进去晚一帧（模型 t-1 vs 相机 t，移动视角时模型在背景里来回"游"，实测抖动更明显的根因）；preUpdate=同帧写入同帧消费。**失活即销毁（直接重建，无 suspend）**：`stopFrameLoop()`/`renderEarth` 失活分支都直接 `disposeEarth()`——Cesium viewer 连地形/影像缓存数百 MB，挂起保留=内存下不来（实测 1G+ 不降）。**渲染器切换即复位播放**（`switchRenderer` → `resetPlaybackToStart`：暂停+回起点）——切走的视图不在后台继续推进，无人观看的持续计算就是浪费。
- **创建期相机陷阱（姿态球偏心教训）**：`positionAttitudeCamera` 读 `runtime.attitudeView`，而 `ensureAttitudeView` 在赋值**之前**就要摆相机——必须传局部 `av` 参数；否则相机留 (0,0,0)，构建时烘死的朝向元素（背景圆/正向环 camDir）与真实相机错位。任何「从 runtime 取实例」的 helper 在创建流程内调用时都要检查这一时序。
- 拾取放置：`bindEarthPickHandler`——tileset 强制 `pickEllipsoid`（避免拾到未定位瓦片自身），模型/组用 `pickPosition ?? pickEllipsoid`。
- `sampleAtTime(t)` 插值样本**没有 north/east**（只有 x/y/z/...）——要水平分量时从场景坐标恢复：`east = x / THREE_UNITS_PER_METER`、`north = -z / THREE_UNITS_PER_METER`。

## 6. 主 3D 场景（`view3d`）与地球独立

主 3D 场景用**自己的** WebGL 上下文、`MeshStandardMaterial` + 真实灯光、`makeDroneQuaternion`（含 `Ry(π)` 翻转；Cesium 端用 `headingPitchRollQuaternion`，别互相套用）、模型缩放默认 1。相机四元数 **slerp / 位置 lerp**，不要 `rotation.set` 欧拉直赋。共享的只有：遥测来自 view3d/playback store 的 profile 驱动采样（见 [docs/frontend.md §profile](../../docs/frontend.md#格式无关的字段源-profile)）。
