# 飞控日志分析 (Drone Log Analyzer)

本地运行的飞控日志分析桌面应用（**Wails v2** 壳，关闭窗口即退出进程）。支持多格式飞控日志：

- **ArduPilot Dataflash**（`.bin` / `.log`）—— 二进制与文本日志
- **PX4 ULog**（`.ulg`）
- **MAVLink tlog**（`.tlog`）—— 遥测日志

## 环境要求

- Go 1.25 或更高版本
- Node.js（首次/换机后在仓库根执行 `npm install`）
- Windows 下可选安装 `make`
- 可选：[Wails CLI](https://wails.io/)（`go install github.com/wailsapp/wails/v2/cmd/wails@latest`），用于 `wails dev` 热更新与 `wails build` 打包

## 编译与运行

```bash
make dev        # = wails dev，运行桌面应用并热更新
make build      # = wails build -> build/bin/DroneLogAnalyzer.exe
```

构建产物 `build/bin/DroneLogAnalyzer.exe`（由 `wails build` 统一完成：前端 + Go + Windows 清单/图标/版本）。

> ⚠️ **必须用 `wails build` / `wails dev`**（自动注入正确 build tag）。不要用裸 `go run`/`go build` 运行或产出桌面应用——缺 tag 时不是正确的桌面构建，发行 exe 也不会包含 Windows 清单/图标。

若本机没有 `make`，直接跑底层命令：`wails dev` / `wails build`。其他常用目标：

```bash
make check    # go vet + go build（-tags desktop,production）+ 前端类型检查
make web      # 构建前端 -> frontend/dist
make bindings # 改 Go 绑定方法后重新生成 frontend/src/wailsjs
```

提交或打包前建议检查：

```bash
go test ./...
go vet ./...
go build -buildvcs=false ./...
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit
```

或直接 `make check`。

## 使用说明

1. 启动程序（桌面窗口自动弹出）。
2. 点击「选择日志文件」加载 `.bin` / `.log` / `.ulg` / `.tlog`（拖放已禁用）。
3. 选择消息类型和字段查看曲线。
4. 查看参数、飞行模式、文本消息和原始消息行。

## 更多文档

- [docs/architecture.md](docs/architecture.md) — 后端三层设计、多格式 parser、传输抽象、数据流
- [docs/frontend.md](docs/frontend.md) — 前端目录、setup store、传输 client、3D/地图/chart、profile
- [docs/api.md](docs/api.md) — 接口/绑定/路由字段
- [docs/map-tiles.md](docs/map-tiles.md) — 瓦片 provider / MBTiles 缓存管线
- 开发约束（模块边界、禁止行为、不变量）见 [AGENTS.md](AGENTS.md)
