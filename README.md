# 飞控日志分析 (Drone Log Analyzer)

Drone Log Analyzer 是一个本地运行的飞控日志分析工具，支持多格式日志：ArduPilot Dataflash（`.bin` / `.log`）、PX4 ULog（`.ulg`）、MAVLink 遥测日志（`.tlog`）。它可以加载日志文件，自动识别格式并解析消息类型与数字字段，在 **Wails 桌面窗口**中查看自绘 GPU 折线（Three.js LineChart）、3D 姿态/航线、2D/3D 地图定位、参数、飞行模式、文本消息和原始消息行。

后端 Go 按 `app/` 三层组织（services / transport / modules），业务逻辑在 `app/services`（与传输无关），由 `app/transport/wails` 绑定为 Wails 方法；前端 Vue 3 + Three.js，经 Vite 编译后由 Go `//go:embed` 嵌入，最终由 **Wails v2** 作为桌面壳同源服务——**不再打开浏览器**，关闭窗口即退出进程。

## 功能概览

- 支持多种飞控日志格式（可插拔加载器，按文件 magic / 扩展名自动识别）：
  - **ArduPilot Dataflash**（`.bin` / `.log`，`Format=apm`）—— 二进制与文本日志
  - **PX4 ULog**（`.ulg`，`Format=ulog`）
  - **MAVLink tlog**（`.tlog`，`Format=tlog`）—— 遥测日志，自动解析机型/飞行模式、参数、任务航点、执行命令
- 自动读取消息结构（FMT / ULog 格式定义），展示消息类型和可绘制的数值字段。
- 支持单曲线和批量曲线接口，图表支持缩放、选中字段恢复。
- 提供参数、飞行模式、文本消息和原始消息浏览。
- 桌面窗口：**原生文件对话框**选日志加载；关窗即退进程（无需心跳看门狗）。

## 环境要求

- Go 1.25 或更高版本
- Node.js（首次/换机后 `npm install`）
- Windows 下可选安装 `make`
- 可选：[Wails CLI](https://wails.io/)（`go install github.com/wailsapp/wails/v2/cmd/wails@latest`），用于 `wails dev` 热更新与 `wails build` 打包

## 快速运行

在项目根目录执行：

```bash
make dev        # = wails dev，运行桌面应用并热更新
```

`make dev` 由 Wails 注入正确的 build tag（`dev`），启动 vite dev server 与 **Wails 桌面窗口**（标题「飞控日志分析」，1400×900），前端改动热更新。

> ⚠️ Wails 应用**必须带正确的 build tag**（production 用 `desktop,production`，dev 用 `dev`），由 `wails build`/`wails dev` 自动注入。**不要用裸 `go run`/`go build`** 运行或产出桌面应用——缺 tag 时不是正确的桌面构建（Wails 会告警 "will not build without the correct build tags"）。

## 构建

构建桌面可执行文件（由 `wails build` 统一完成：前端 + Go + Windows 清单/图标/版本）：

```bash
make build      # = wails build -> build/bin/DroneLogAnalyzer.exe
```

构建完成后运行：

```bash
build/bin/DroneLogAnalyzer.exe
```

> 打包构建**必须用 `wails build`**（`make build` 已封装）。不要用裸 `go build` 产出发行 exe——它不注入 Windows 清单/图标，且旧的 `icon.syso` 已移除（否则会报 `too many .rsrc sections`）。日常运行/开发用 `make dev`（= `wails dev`，HMR，需 wails CLI）。

如果本机安装了 `make`，常用目标：

```bash
make check    # go vet + go build（-tags desktop,production）+ 前端类型检查
make web      # 构建前端 -> frontend/dist
make build    # wails build -> build/bin/DroneLogAnalyzer.exe（打包，含清单/图标）
make dev      # wails dev 运行桌面应用 + 热更新（HMR）
make bindings # 改 Go 绑定方法后重新生成 frontend/src/wailsjs
```

## 检查命令

建议在提交或打包前执行：

```bash
go test ./...
go vet ./...
go build -buildvcs=false ./...
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit
```

或直接：

```bash
make check
```

> **本机 npm 坑**：`npm run build` / `npm run typecheck` 在本机可能失败，一律用 `node node_modules/.../*.js` 直调（Makefile 已如此）。

## 文件加载方式

桌面端加载日志走 Wails 原生能力，**不走前端上传**：

- **选择文件按钮** → 前端 `hostClient.pickLogPath()`（Wails 绑定 `HostAPI.PickLogPath`，[app/transport/wails/hostapi.go](app/transport/wails/hostapi.go)）弹 OS 原生对话框取路径 → 再 `logClient.load({path})`（`LogAPI.Load`）由 `logservice` 解析 → 返回摘要。
- **拖放文件到窗口**（**当前已禁用**） → 设计上由 Wails 原生 `OnFileDrop`（`HostAPI.Startup` 注册）拿绝对路径 → `logservice.Load` 解析 → `"log:loaded"` 事件通知前端。但原生 `OnFileDrop` 在部分 Windows WebView2 运行时不触发（go-webview2 bug），无应用层修法，相关代码已注释保留待上游修复；目前加载日志走「打开文件」按钮。
- 两条路径共用 `logservice.Load`（见 [app/services/logservice/](app/services/logservice/)）。

> 文件对话框与拖放是 Wails 专有能力（不进抽象 service 接口）；其余日志数据接口（types/fields/curve.bin/summary/parameters/…）前端均经 `frontend/src/services/log` 的 client 走 Wails 绑定。

## 使用说明

1. 启动程序（桌面窗口自动弹出）。
2. 点击「选择日志文件」加载 `.bin` / `.log` / `.ulg` / `.tlog`（拖放当前已禁用，见上文「文件加载方式」）。
3. 选择消息类型和字段查看曲线。
4. 查看参数、飞行模式、文本消息和原始消息行。

## 深入参考

按需查阅，避免一次读取过大：

- [docs/architecture.md](docs/architecture.md) — 后端三层设计、多格式 parser、传输抽象、数据流
- [docs/frontend.md](docs/frontend.md) — 前端目录、setup store、传输 client、3D/地图/chart、profile
- [docs/api.md](docs/api.md) — 接口/绑定/路由字段
- [docs/map-tiles.md](docs/map-tiles.md) — 瓦片 provider / MBTiles 缓存管线
- [skills/web-vue-standards](skills/web-vue-standards/SKILL.md) — 前端编码规范（Vue/Pinia/TS）
- [skills/frontend-3d-map](skills/frontend-3d-map/SKILL.md) — 3D/MapLibre 渲染硬核规则

> 开发约束（模块边界、禁止行为、不变量）见 [AGENTS.md](AGENTS.md)。

## API / 服务契约

前端不再走 HTTP `/api`，而是经 `frontend/src/services/{log,map,config}` 的 client 调 Wails 绑定（`app/transport/wails` 的 `LogAPI`/`MapAPI`/`ConfigAPI`/`HostAPI`），绑定方法内部调对应 `app/services/*` 服务。各 client 是接口 + Wails 实现，换传输（如未来加回 HTTP）只改实现、不改调用方。

| 域 | 绑定结构体 | 服务 | 主要方法 |
|----|-----------|------|---------|
| 日志 | `LogAPI` | `logservice` | Load / Status / Summary / MessageTypes / Fields / TypeSchema / CurveData(二进制) / TypeBody(二进制) / Parameters / Commands / MAVLinkCommands / ModeChanges / Messages / Errors / Events / Browse / LogDefs |
| 地图 | `MapAPI` | `mapservice` | Providers / CacheStats / ClearCache / ClearCacheProvider（瓦片走 HTTP，见下） |
| 配置 | `ConfigAPI` | `configservice` | GetSettings / SaveSettings / GetFlightMetrics / SaveFlightMetrics / GetCurveState / SaveCurveState / ListFieldEntries / SaveFieldEntry / DeleteFieldEntry |
| 宿主 | `HostAPI` | —（Wails 专有） | PickLogPath（原生文件对话框）/ Startup（拖放→logservice.Load→emit 事件）|

> 唯一的 HTTP 路由：瓦片 `GET /map/provider/{id}/{z}/{x}/{y}`（Leaflet 按 URL 加载，进程内同源，无独立端口）。其余接口均经 Wails 绑定。
> 请求/响应字段详见 [docs/api.md](docs/api.md)。

## 项目结构

```text
main.go                       Wails 桌面壳：组装 services → transport，embed frontend/dist，跑 wails
app/
  config/                     持久化路径（用户配置目录 / 瓦片缓存目录）
  services/                   领域服务，与传输无关，方法统一 func(ctx, req)(resp, error)
    logservice/               日志服务：加载/解析/曲线二进制/参数/命令/模式/消息/错误/事件…
    mapservice/               地图服务：底图 provider / 缓存 / 瓦片（GetTile）
    configservice/            配置服务：settings/flight-metrics/curve-state/field-entries
  transport/                  传输层适配（抽象在 service 接口）
    wails/                    LogAPI/MapAPI/ConfigAPI/HostAPI 绑定结构体（每结构体一文件）
    http/                     仅瓦片代理路由（其余接口经 Wails 绑定）
  modules/                    其他工具
    parser/                   多格式日志解析器核心 + dataflash/ulog/tlog 子包（可插拔，init() 自注册）
    logdefs/                  ArduPilot 静态枚举（EV events / ERR errors / mission）
    maptiles/                 瓦片 provider + MBTiles 缓存
  model/                      跨服务共享 DTO/错误
frontend/                     Vue 3 + Three.js + 自绘 LineChart 前端（TypeScript，Vite 编译）
  src/services/{log,map,config}/   前端 client 接口镜像三服务 + Wails 实现，换传输只改 index.ts
  src/chart/                  自绘折线模块（line-chart.ts = LineChart，原 GPUChart）
  src/wailsjs/                Wails 生成的前端绑定（go/wails/*、runtime；勿手改）
wails.json                    Wails 项目配置
```

- 后端业务在 `app/services`（transport-agnostic）；`app/transport/wails` 绑定各 service；`app/transport/http` 仅瓦片（瓦片按 URL，Leaflet 直接消费）。
- 地图瓦片 `/map/provider/{id}/{z}/{x}/{y}` 保留 HTTP；其余接口前端走 Wails 绑定（经 `frontend/src/services/*` 的 client）。
- Wails 绑定方法首参为 `context.Context`（Wails v2 注入，不暴露给 JS）；内部以 service 接口调用。
