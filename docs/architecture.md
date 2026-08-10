# 后端架构

> 本文讲清后端 `app/` 三层（modules → services → transport）的设计与不变量。前端架构见 [frontend.md](frontend.md)；接口字段见 [api.md](api.md)；地图缓存管线见 [map-tiles.md](map-tiles.md)。

## 三层总览

```
modules/    纯工具，无业务规则：parser（多格式日志解析）/ logdefs（静态枚举）/ maptiles（瓦片 provider + 缓存）
services/   领域服务，与传输无关：logservice / mapservice / configservice
            方法签名统一 (ctx, req) → (resp, error)；错误用 sentinel
transport/  传输适配：wails（绑定结构体，当前唯一实现）+ http（仅瓦片路由）
main.go     组装：构造 services → 注入绑定 → embed frontend/dist → wails.Run
```

依赖方向严格自上而下：`transport → services → modules`。`services` 不 import `transport`，`modules` 不 import `services`。

## 组装（main.go）

[main.go](../main.go) 做四件事：

1. `appcfg.MigrateConfigDir()` —— 项目改名（apm-log-analyzer → drone-log-analyzer），把旧配置目录 `APMLogAnalyzer` 一次性迁移到 `DroneLogAnalyzer`，须在任何 service 读配置前执行。
2. 构造三个 service（实现各在独立子包）：

   ```go
   logSvc := dataflash.New()              // app/services/logservice/dataflash
   mapSvc := tilecache.New(appcfg.CacheDir()) // app/services/mapservice/tilecache
   cfgSvc := jsonstore.New()              // app/services/configservice/jsonstore
   ```

3. blank-import 三个 parser 加载器（触发 `init()` 注册，顺序很关键，见下节）：

   ```go
   _ "drone-log-analyzer/app/modules/parser/ulog"      // 精确 magic，须先于 dataflash 兜底
   _ "drone-log-analyzer/app/modules/parser/tlog"      // .tlog 扩展名/MAVLink 帧 magic，须先于 dataflash 兜底
   _ "drone-log-analyzer/app/modules/parser/dataflash" // Match 兜底 true，放最后
   ```

4. embed 前端、绑定时注入、`wails.Run`：

   ```go
   //go:embed all:frontend/dist
   var staticFiles embed.FS
   ```

   绑定结构体直接持有 service：`&wailsapp.LogAPI{Svc: logSvc}` 等。[transport.go](../app/transport/transport.go) 另提供 `Services` 聚合容器（`{Log, Map, Config}`）供未来多传输一次性注入，当前 main.go 直接注入各绑定。

> **拖放已禁用**（[main.go](../main.go) 注释）：原生 `OnFileDrop` 在部分 Windows WebView2 运行时不触发（go-webview2 bug，wails #3563 等），无应用层修法。相关代码（`HostAPI.OnFileDrop`、前端拖放监听）注释保留，待上游修复后恢复。当前加载日志只走「打开文件」按钮 → `HostAPI.PickLogPath` → `LogAPI.Load`。

## service 契约：传输无关 + sentinel 错误

每个域 service 是一个接口，方法统一 `(ctx, req) → (resp, error)`，错误用包级 sentinel 变量，传输层据此映射状态码。以 [logservice](../app/services/logservice/service.go) 为例：

```go
var (
    ErrNoLogLoaded  = errors.New("no log loaded")
    ErrTypeNotFound = errors.New("type not found")
)

type Service interface {
    Load(ctx context.Context, req LoadRequest) (*SummaryResponse, error)
    CurveData(ctx context.Context, req CurveDataRequest) ([]byte, error)
    TypeBody(ctx context.Context, req TypeBodyRequest) ([]byte, error)
    // ...共 17 个方法 + Close()
}
```

- DTO 集中在 `service.go` 同包的 `model.go`，跨服务共享 DTO/错误在 `app/model/`。
- 实现单独占一个文件夹（`logservice/dataflash/`、`mapservice/tilecache/`、`configservice/jsonstore/`），换实现另起文件夹、不动接口。

## 传输层：抽象即 service 接口本身

[transport.go](../app/transport/transport.go) 顶部讲明设计取舍：**真正的「传输抽象」是各 service 接口本身**，**不**为 wails / http 强造一个共享 `Transport` 接口——二者绑定机制本质不同（wails 反射绑定结构体方法，http 注册路由），强造共享接口是反模式。`transport` 包只提供一个注入容器 `Services`，具体实现各自在 `transport/{wails,http}/`。

### Wails 绑定（当前唯一实现）

[transport/wails](../app/transport/wails/) 每 service 一个绑定结构体（`LogAPI`/`MapAPI`/`ConfigAPI`）+ `HostAPI`（文件对话框/拖放，Wails 专有）。**绑定方法不接收 `ctx`**（Wails IPC 无每请求 ctx），内部以 `context.Background()` 调 service：

```go
func (a *LogAPI) Load(req logservice.LoadRequest) (*logservice.SummaryResponse, error) {
    return a.Svc.Load(context.Background(), req)
}
```

service 接口仍带 `ctx`，是为**未来 http 传输层透传 `c.Request.Context()`** 留的口子——加传输不改 service。

### HTTP 传输（仅瓦片）

[transport/http/router.go](../app/transport/http/router.go) 只注册一条路由 `GET /map/provider/:provider/:z/:x/:y`。这个 gin 引擎作为 Wails `AssetServer.Handler` 在桌面进程内同源服务（**无独立监听端口**）；静态前端由 `AssetServer.Assets`（embed）提供。其余 `/api/*` 端点已迁 Wails 绑定，http 层留 TODO 待按需接回（见 router.go 注释）。

## 多格式日志解析器（可插拔加载器）

`app/modules/parser/` 是格式无关的核心；各格式加载器是子包，`init()` 自注册。

### 注册与分发

```go
// registry.go
type FormatParser interface {
    Match(head []byte, filename string) bool   // head ≥ 8B
    Parse(filename string) (*LogFile, error)
}
func Register(p FormatParser)                  // 子包 init() 调用
func ParseFile(filename string) (*LogFile, error) // 按 magic/扩展名遍历已注册加载器分发
```

新增格式 = 新增子包 + main.go 加一行 blank-import，`ParseFile` 与 `logservice` **无需改动**。

### Match 顺序与兜底

`dataflash.Match` 兜底 `return true`（APM 文本日志无固定 magic），**必须放最后**，且须先排除 ULog/MAVLink，否则 Go 包 `init()` 顺序不定时会抢匹配 `.ulg`（曾导致 ULog 被当 APM 解析）。共享判定在 [magic.go](../app/modules/parser/magic.go)：`IsULog`（前 7 字节 `55 4C 6F 67 01 12 35`）、`IsMAVLink`（`.tlog` 扩展名或帧 magic `0xFD`/`0xFE`）。所以 main.go 的 blank-import 顺序是 `ulog → tlog → dataflash`。

### 格式无关的字段布局：`FieldLayout`

`FormatDef.Layout []FieldLayout` 预算每个字段的 GL 类型/字节大小/Scale/Offset/是否进 body，让 `ensureAccum`/`buildTypeBody` 完全格式无关；各加载器只负责填 Layout。例如 ULog 的 `double` lat/lon 与 int32 都映射成 `GLInt32 + scale 1e-7`（degE7）存 body，前端复用 APM 的整数列提取路径，零前端改动（解决过 ~0.2m 漂移）。

### 格式标识透传

`LogSummary.Format`（`"apm"`/`"ulog"`/`"tlog"`）由加载器填，经 `SummaryResponse.Format` 透传到前端。`configservice` 据此**按格式分文件**（`<base>_<format>_v1.json`）+ `SetCurrentFormat` 端点 + 旧格式延迟回退迁移；前端 `applyLoadedLog` 后调 `configClient.setFormat`。前端 3D/地图/飞行数据按 format 取字段源映射，见 [frontend.md §profile](frontend.md#格式无关的字段源-profile)。

## 数据流（加载一条日志）

```
PickLogPath(HostAPI，原生对话框)  ──→  path
LogAPI.Load({path})  ──→  logservice.Load  ──→  parser.ParseFile(path)
                                                      │
                                          遍历 registered loaders，magic 命中
                                                      │
                                          loader.Parse → *LogFile（Curves/TypeBodies/Parameters/...）
                                                      │
                                          logservice 装载 + 落盘曲线 spool 文件（RAM 只留元数据）
                                                      ▼
                                          SummaryResponse（filename/format/duration/frame/...）
```

曲线数据走二进制直供 GPU（不再后端解 JSON）：`CurveData`（单字段，28B 头 + `count*8` 交错 `[deltaMs,value]`）、`TypeBody`（某 type 的 interleaved body，小端）、`TypeSchema`（全量 VAO 描述符：每字段的 `glType/byteOffset/min/max/count` + `stride` + `baseTimeMs`）。前端按 `DataView` 切单字段视图，详见 [api.md](api.md)。

## 关键不变量

| 不变量 | 含义 |
|--------|------|
| services 不 import transport | 业务与传输解耦；加传输层不改 service |
| service 方法带 ctx、绑定方法不带 | ctx 留给 http 透传；Wails 用 `context.Background()` |
| 不裸 `go build`/`go run` 出桌面应用 | 必须用 `wails build`/`wails dev` 注入 build tag（见 [README](../README.md)） |
| 不手改 `frontend/src/wailsjs/` | Wails 生成；改 Go 绑定方法后跑 `wails generate module` |
| parser 兜底加载器放最后 | dataflash `Match=true` 须排在精确 magic 之后 |
| 日志格式只增不改 | 新格式 = 新 loader 子包 + 新 profile 文件，不动核心解析与前端逻辑 |
