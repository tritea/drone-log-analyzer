# API 参考

> 前端不再走 HTTP `/api`，而是经 `frontend/src/services/{log,map,config}` 的 client 调 Wails 绑定。绑定结构体在 [app/transport/wails](../app/transport/wails)（`LogAPI`/`MapAPI`/`ConfigAPI`/`HostAPI`），方法内部调 [app/services](../app/services) 对应服务（`func(ctx, req)(resp, error)`，与传输无关）。
> 响应字段名以代码为准，本表用于快速查阅。唯一的 HTTP 路由是瓦片（见末节）。

## 加载与状态（LogAPI / HostAPI）

| 绑定方法 | 服务方法 | 说明 | 入参 |
|----------|----------|------|------|
| `HostAPI.PickLogPath` | —（Wails 专有） | 弹 OS 原生文件对话框，返回所选 `.bin/.log` 绝对路径；取消返回 `""` | — |
| `LogAPI.Load` | `logservice.Load` | 按路径解析日志并装入，返回摘要 | `{path}`（支持 `~` 展开） |
| `LogAPI.Status` | `logservice.Status` | 当前是否已加载日志及文件名 | — |

`Status` → `{loaded: bool, fileName: string}`。

`Load` 成功 → `summary`（字段同 `Summary`）。桌面端 UI 文件加载首选 `PickLogPath` + `Load` 两步（先弹对话框取路径、再解析）；拖放文件则经 `HostAPI.Startup` 注册的原生 `OnFileDrop` → `logservice.Load` → `"log:loaded"` 事件触发同一加载路径。

## 日志数据（LogAPI → logservice）

| 绑定方法 | 入参 | 返回要点 |
|----------|------|----------|
| `LogAPI.MessageTypes` | — | 数值型消息类型数组：`name`、`fields`（仅数值字段，已剔除时间/ID 字段）、`count` |
| `LogAPI.Fields` | `{type}` | 字段信息：`name`、`type`（格式字符）、`min/max/count`、`isNumeric` |
| `LogAPI.CurveData` | `{type, field}` | 单字段曲线**二进制**（28B 头 + `count*8` 交错 `[deltaMs,value]`，GPU/LineChart 直消费） |
| `LogAPI.TypeSchema` | — | 全量 type 元信息表（VAO 描述符）：每 type 的字段 `name/glType/byteOffset/min/max/count` + `stride` + `baseTimeMs` + `rowCount` |
| `LogAPI.TypeBody` | `{type}` | 某 type 的 per-type interleaved **二进制** body（小端，前端按 `DataView` 切单字段视图） |
| `LogAPI.Summary` | — | 日志摘要：`filename/fileSizeKB/vehicleType/firmwareVersion/.../durationSecs/totalLines/frame/typeCount` |
| `LogAPI.Parameters` | — | 参数数组 `{name, value}`（按名排序） |
| `LogAPI.Commands` | — | 航点命令（任务序列）：`{timeMs,commandTotal,sequence,command,commandName,param1..4,latitude,longitude,altitude,frame,frameName}`（按 sequence 排序） |
| `LogAPI.MAVLinkCommands` | — | 执行过的 MAVLink 命令（MAVC）：含 target/source、frame/command、params、result（按时间排序） |
| `LogAPI.ModeChanges` | — | 飞行模式变化 `{lineno, timeMs, mode, modeNum}`（按时间排序） |
| `LogAPI.Messages` | — | 文本消息 `{lineno, timeMs, message}`（按时间排序） |
| `LogAPI.Errors` | — | 错误 `{lineno, timeMs, subsys, eCode, subsysName, errorCode, description}`（按时间排序） |
| `LogAPI.Events` | — | 事件 `{lineno, timeMs, id, name}`（按时间排序） |
| `LogAPI.Browse` | `{type}` | 该类型全部字段原始值：`{type, fields:[...], data:{field:[values]}}` |
| `LogAPI.LogDefs` | — | ArduPilot 静态枚举（EV/ERR 名称表）+ 当前日志 unit 表：`{eventNames, errorSubsystems, errorCodes, generalErrorCodes, units}` |

> `Errors` 的 `description` 来自 `subsys + eCode` 名称（[app/modules/logdefs](../app/modules/logdefs)）；`LogDefs` 一次性下发，前端据此组合 `ERR.ECode` 的 per-point label 与各曲线 unit。

## 曲线字段与状态（ConfigAPI → configservice）

| 绑定方法 | 说明 |
|----------|------|
| `ConfigAPI.ListFieldEntries` | 全部曲线字段：`{templates, path}` |
| `ConfigAPI.SaveFieldEntry` | 新建/更新字段项（同名覆盖，带 `createdAt/updatedAt`）；返回最新列表 |
| `ConfigAPI.DeleteFieldEntry` | `{name}` 删除字段项；返回最新列表 |
| `ConfigAPI.GetCurveState` | 当前激活曲线集：`{activeCurves, updatedAt, path}` |
| `ConfigAPI.SaveCurveState` | 保存激活曲线集 |

模板结构：`{name, kind:"field"|"group", curves:[{type,field,visible,color?,scale,offset,scaleInput?,offsetInput?}], scale, offset, ...}`。
持久化目录在 `<UserConfigDir>/DroneLogAnalyzer/`：`curve_templates_v1.json`、`curve_state_v1.json`、`toolbar_settings_v1.json`、`flight_metrics_v1.json`（均为前端 POST 任意 JSON 落盘、GET 读回，后端不定义 schema）。

## 地图底图（MapAPI → mapservice；瓦片走 HTTP）

「可视化」视图内的「地图」渲染项：前端 Leaflet（2D）/ MapLibre（3D）通过 Go 中转取瓦片，Go 侧按 provider 抽象（`esri_satellite` / `amap_vector` / `amap_road` / `bing_road` / `osm`），单一共享 MBTiles 缓存，缓存优先、未命中抓取上游并落盘。

| 绑定方法 / 路由 | 说明 |
|----------------|------|
| `MapAPI.Providers` | 可用底图列表（仅 enabled）：`{providers:[{id,name,attribution}], path, updatedAt}` |
| `MapAPI.CacheStats` | 各源磁盘占用：`{dir, capBytes, providers:[{id,name,sizeBytes,tileCount}], totalBytes}` |
| `MapAPI.ClearCache` | 清空所有源缓存 → `{ok:true}` |
| `MapAPI.ClearCacheProvider` | `{provider}` 清空指定源缓存 |
| `GET /map/provider/:provider/:z/:x/:y` | 单张 XYZ 瓦片（PNG/JPEG）；**唯一 HTTP 路由**，`mapservice.GetTile` 提供，缓存命中直接返回、未命中抓取上游并缓存 |

- 瓦片路由保留 HTTP（Leaflet/MapLibre 按 URL 加载 `/map/provider/{id}/{z}/{x}/{y}`），进程内同源（Wails AssetServer.Handler），无独立端口；其余地图接口经 `MapAPI` 绑定。
- **缓存设计**（provider 抽象 / 单一共享 MBTiles / `Get` 读取管线 LRU→SQLite→fallback / `last_used` 缓冲写 / 淘汰到 80% / 启动时 `incremental_vacuum` / 启用源合并）详见 [map-tiles.md](map-tiles.md)。
