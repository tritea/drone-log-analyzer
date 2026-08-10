APP := Drone-Log-Analyzer
EXE := build/bin/DroneLogAnalyzer.exe

# Wails 应用必须带正确的 build tag：production 构建用 `desktop,production`，
# 开发用 `dev`。wails build / wails dev 已自动注入；裸 go build/go run 缺 tag，
# 编译出的不是正确的桌面应用（Wails 会告警 "will not build without the correct build tags"）。
TAGS := desktop,production

# 前端构建在本机需用 node 直调 vite/vue-tsc（见 memory npm-spawn-workaround）。
VITE := node node_modules/vite/bin/vite.js
TSC  := node node_modules/vue-tsc/bin/vue-tsc.js

.PHONY: help check web build dev bindings clean

help:
	@echo 飞控日志分析工具 (Wails v2 桌面应用) - Available targets:
	@echo   make check    - go vet + go build（-tags $(TAGS)）+ 前端类型检查 (vue-tsc)
	@echo   make web      - 构建前端 TS -> frontend/dist（node 直调 vite）
	@echo   make build    - wails build 打包桌面应用 -> $(EXE)（含 Windows 清单/图标）
	@echo   make dev      - wails dev 运行并热更新（这是运行桌面应用的方式，HMR）
	@echo   make bindings - 重新生成 wailsjs 绑定（改 Go 绑定方法后运行）
	@echo   make clean    - 清理构建产物

check:
	go vet -tags $(TAGS) ./...
	go build -buildvcs=false -tags $(TAGS) ./...
	$(TSC) --noEmit

# 前端构建：frontend/src -> frontend/dist（Go //go:embed 嵌入）。首次/换机后先 npm install。
# wails build 会自己跑一遍 frontend:build，此 target 供单独构建前端使用。
web:
	$(VITE) build

# 打包构建（必须用 wails build，它注入 desktop/production tag + Windows 清单/图标/版本）。
# 不要用裸 go build 产出发行 exe（缺 tag + 清单，且旧 icon.syso 已移除会 .rsrc 冲突）。
build:
	wails build

# 运行/开发：wails dev 注入 dev tag、启动 vite dev server 与桌面窗口、前端热更新。
# Wails 没有 “wails run”；运行桌面应用即用 wails dev（或先 make build 再跑 exe）。
dev:
	wails dev

# 改 Go 绑定方法（main.go 中 App 的导出方法）后重新生成前端 wailsjs 绑定。
bindings:
	wails generate module

clean:
	@if exist build rmdir /s /q build
	@if exist dist rmdir /s /q dist
	go clean
