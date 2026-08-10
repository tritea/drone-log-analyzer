# AGENTS.md — 开发约束

> 本文件是 agent/开发者的**约束清单**：模块边界、不变量、禁止行为、构建须知。
> 用户向介绍/快速上手/构建步骤见 [README.md](README.md)；设计详见 [docs/](docs/)。

飞控日志分析（Drone Log Analyzer）是本地运行的飞控日志分析桌面应用（Wails v2 壳）。后端 Go 按 `app/` 三层组织，前端 Vue 3 + Three.js + 自绘 LineChart + MapLibre/Leaflet，经 Vite 编译后由 Go `//go:embed` 嵌入。

## 文档地图

| 想了解 | 去看 |
|--------|------|
| 是什么 / 怎么跑 / 怎么打包 | [README.md](README.md) |
| 后端三层设计、多格式 parser、传输抽象、数据流 | [docs/architecture.md](docs/architecture.md) |
| 前端目录、setup store、传输 client、3D/地图/chart、profile | [docs/frontend.md](docs/frontend.md) |
| 接口/绑定/路由字段 | [docs/api.md](docs/api.md) |
| 瓦片 provider / MBTiles 缓存管线 | [docs/map-tiles.md](docs/map-tiles.md) |
| 前端编码规范（Vue/Pinia/TS） | [skills/web-vue-standards](skills/web-vue-standards/SKILL.md) |
| 3D / MapLibre 渲染硬核规则 | [skills/frontend-3d-map](skills/frontend-3d-map/SKILL.md) |

## 模块边界（依赖只能自上而下）

```
transport  →  services  →  modules
(wails/http)   (log/map/cfg)   (parser/logdefs/maptiles)
```

- **services 不 import transport**；业务逻辑与传输解耦，加传输层不改 service。
- **modules 不 import services**；modules 是纯工具。
- service 方法统一 `(ctx, req) → (resp, error)`，错误用包级 sentinel；DTO 在 `service.go` 同包 `model.go` + 跨服务共享在 `app/model/`。
- service 接口带 `ctx`，Wails 绑定方法**不带 ctx**（IPC 无每请求 ctx，内部用 `context.Background()`）——ctx 是留给未来 http 传输透传的。
- 传输抽象 = service 接口本身；**不**为 wails/http 强造共享 `Transport` 接口（反模式）。

## 文件组织（小文件 + 文件夹包裹）

- **文件保持小**：单个文件目标几百行；接近/超过 ~800 行就拆。高内聚低耦合，按域/功能组织，不按类型堆。
- **拆分用文件夹包裹**：拆出的多个片段放进一个**以域命名的文件夹**，而不是在同级摊一堆兄弟文件（会乱）。范例：后端 [`app/modules/parser/`](app/modules/parser)（一个域一个文件夹，内含 format/binary/text/records... 协作文件）、[`app/services/logservice/dataflash/`](app/services/logservice/dataflash)；前端 [`frontend/src/views/Home/`](frontend/src/views/Home)（`index.vue` + `components/CenterStage.vue` 等子组件）。
- **拆不动的，靠顺序 + 命名收敛**：有些东西不便机械拆分（如一个 Pinia store 的状态/计算/函数围绕同一域，强行拆反而割裂；一个紧密的解析流程同理）。这种情况**不硬拆**，而用统一的垂直顺序与命名让它易读——前端 store 顺序见 [skills/web-vue-standards](skills/web-vue-standards/SKILL.md#大-store-靠顺序收敛不硬拆)。判断标准：拆完是否还要互相 import 大量内部细节？是 → 别拆，整理顺序。
- **类型/常量按作用域放**：**跨域共享**的类型/常量进中心位置（前端 `types/index.ts`、`constants/index.ts`；后端跨服务 DTO 在 `app/model/` 与各 service 包的 `model.go`）；**只在一个文件夹内用的**类型/常量，就地放该文件夹的 `types.ts`/`const.ts`（或域命名的 `xxxx.ts`），不要塞进中心把中心撑大、也别散到根目录。需要私有 `types.ts`/`const.ts` 的模块，本身就该是个**文件夹**。范例：前端 [`services/log/types.ts`](frontend/src/services/log/types.ts)、[`chart/types.ts`](frontend/src/chart/types.ts) 是文件夹私有类型；[`types/index.ts`](frontend/src/types/index.ts) 是跨 store 共享状态（`UiState`/`LogState`...）。

## 构建须知（务必遵守）

- **构建/运行必须用 `wails build` / `wails dev`**：它们注入正确的 build tag（production 用 `desktop,production`，dev 用 `dev`）。裸 `go build`/`go run` 缺 tag，不是正确的桌面构建（Wails 会告警），也不要用裸 `go build` 产出发行 exe（缺 Windows 清单/图标）。
- 前端 `//go:embed all:frontend/dist`：手动跑 `go build`/`go run` 前先构建前端（`make web`），否则 embed 因目录缺失失败。`wails build`/`wails dev` 会自动构建前端。
- **`make` 是可选便利**（Makefile 封装了底层命令）。若机器上 `make` 不可用或损坏，直接跑底层命令（Makefile 里的变量即命令清单）：
  - dev：`wails dev`
  - build：`wails build`
  - 前端：`node node_modules/vite/bin/vite.js build`
  - 类型检查：`node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`
  - 重新生成绑定：`wails generate module`
- 改 Go 绑定方法（`transport/wails/*API` 的导出方法）后，跑 `wails generate module` 重生成 `frontend/src/wailsjs/`——**不要手改 `wailsjs/`**。
- `package.json` / `node_modules/` 在**仓库根**，不在 `frontend/`；node 命令在根目录跑，不要 `cd frontend`。首次/换机先 `npm install`。

## 禁止行为

| 禁止 | 应做 |
|------|------|
| 裸 `go build`/`go run` 跑/产出桌面应用 | `wails build` / `wails dev` |
| 手改 `frontend/src/wailsjs/` | 改 Go 绑定后 `wails generate module` |
| service import transport / modules import services | 依赖只向下 |
| 为 wails/http 强造共享 Transport 接口 | 抽象即 service 接口本身 |
| parser 兜底加载器（dataflash）排在精确 magic 之前 | blank-import 顺序 `ulog → tlog → dataflash` |
| 在 store 模块顶层 `const x = useXxxStore()` | 在 setup 函数/computed/函数体内调用（惰性，避循环依赖） |
| 把 ECharts/Three/MapLibre 实例塞进 Pinia state | 放 [`utils/runtime.ts`](frontend/src/utils/runtime.ts) 容器 |
| store 里散落 `fetch` / 直接碰 `wailsjs` | 经 `services/{log,map,config}` 的 client |
| 直接解构 store 拿 state（丢响应式） | `storeToRefs(store)` |
| `camera.rotation.set(euler)` / 直接赋位置 | 四元数 slerp / 位置 lerp |
| 单文件膨胀（>~800 行不拆） | 拆成小文件，用文件夹包裹 |
| 拆出的文件在同级摊一堆 | 放进以域命名的文件夹（如 `views/Home/`、`parser/`） |
| 用 CDN `<script>` / `window.XXX` | npm + ES import |

## 关键不变量

- **日志格式只增不改**：新格式 = 新 parser loader 子包（`init()` 注册，`Match` 兜底放最后）+ 新前端 profile 文件（`registerProfile`），不动核心解析、`ParseFile`、three/地图/面板逻辑。
- **主图是自绘 [`LineChart`](frontend/src/chart/line-chart.ts)**，不是 ECharts（已移除）。`runtime.mainChart` 是 `LineChart` 实例。
- **拖放已禁用**（go-webview2 bug，[main.go](main.go) 注释）：加载日志只走「打开文件」按钮（`HostAPI.PickLogPath` → `LogAPI.Load`）。相关拖放代码注释保留待上游修复。
- **瓦片缓存放可执行文件旁的 `db/`**（`<exeDir>/db/tiles.mbtiles`），不放用户配置目录/C 盘。
- **高德底图是 GCJ-02**：3D 地图用高德时须关地形 DEM。

## 项目改名

模块路径 `drone-log-analyzer`（旧 `apm-log-analyzer`）。[`appcfg.MigrateConfigDir`](app/config/paths.go) 在 main.go 启动早期把旧配置目录 `APMLogAnalyzer` 一次性迁移到 `DroneLogAnalyzer`（幂等，须在任何 service 读配置前执行）。
