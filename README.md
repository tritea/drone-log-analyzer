# 飞控日志分析 (Drone Log Analyzer)

[English](README.en.md) | 简体中文

本地运行的飞控日志分析桌面应用。支持多格式飞控日志：

- **ArduPilot Dataflash**（`.bin` / `.log`）—— 二进制与文本日志
- **PX4 ULog**（`.ulg`）
- **MAVLink tlog**（`.tlog`）—— 遥测日志

## 功能

**曲线分析**
- 任意消息字段的曲线绘制，多曲线叠加对比
- 曲线缩放、平移、按需显示/隐藏
- 飞行模式时间线标注，消息事件与曲线联动

**3D 飞行回放**
- 三维姿态与航线回放，无人机模型实时跟随日志数据
- 姿态仪表、桨叶与舵面动态效果
- 时间轴拖动控制回放进度，曲线/3D/地图同步联动

**地图可视化**
- 2D 地图航线显示，瓦片本地缓存加速
- 3D 地球视图，支持全球地形与三维轨迹

**数据浏览**
- 飞控参数查看与搜索
- 飞行事件与文本消息浏览
- 原始消息行查看

**AI 分析**
- 内置 AI 助手，自动生成飞行分析报告

**其他**
- 中文 / 英文界面切换
- 本地运行，日志数据不出本机

## 环境要求

- Go 1.25 或更高版本
- Node.js（首次/换机后在仓库根执行 `npm install`）
- 可选：[Wails CLI](https://wails.io/)（`go install github.com/wailsapp/wails/v2/cmd/wails@latest`）

## 编译与运行

```bash
make dev        # = wails dev，运行桌面应用并热更新
make build      # = wails build -> build/bin/DroneLogAnalyzer.exe
```

> ⚠️ **必须用 `wails build` / `wails dev`**（自动注入正确 build tag 与 Windows 清单/图标），不要用裸 `go run`/`go build` 产出发行 exe。若本机没有 `make`，直接跑 `wails dev` / `wails build`。

## 使用说明

1. 启动程序（桌面窗口自动弹出）。
2. 点击「选择日志文件」加载 `.bin` / `.log` / `.ulg` / `.tlog`。
3. 选择消息类型和字段查看曲线。
4. 查看参数、飞行模式、文本消息和原始消息行。
