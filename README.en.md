# Drone Log Analyzer

English | [简体中文](README.md)

A locally-run desktop application for flight controller log analysis. Supports multiple log formats:

- **ArduPilot Dataflash** (`.bin` / `.log`) — binary and text logs
- **PX4 ULog** (`.ulg`)
- **MAVLink tlog** (`.tlog`) — telemetry logs

## Features

**Curve Analysis**
- Plot curves of any message fields, with multi-curve overlay and comparison
- Zoom, pan, and show/hide curves on demand
- Flight mode timeline annotations, with message events linked to curves

**3D Flight Playback**
- 3D attitude and trajectory playback, drone model driven live by log data
- Attitude indicator, spinning propellers and control-surface animations
- Scrub the timeline to control playback, with curve/3D/map kept in sync

**Map Visualization**
- 2D map with flight path display and local tile caching for faster loading
- 3D globe view with worldwide terrain and 3D trajectory

**Data Browsing**
- View and search flight controller parameters
- Browse flight events and text messages
- Inspect raw message lines

**AI Analysis**
- Built-in AI assistant that automatically generates flight analysis reports

**Misc**
- Chinese / English UI switch
- Runs locally — your log data never leaves your machine

## Requirements

- Go 1.25 or later
- Node.js (run `npm install` at the repo root on first setup / new machine)
- Optional: [Wails CLI](https://wails.io/) (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)

## Build & Run

```bash
make dev        # = wails dev, run the desktop app with hot reload
make build      # = wails build -> build/bin/DroneLogAnalyzer.exe
```

> ⚠️ **Always use `wails build` / `wails dev`** (they inject the correct build tags and Windows manifest/icon). Do not produce release executables with plain `go run`/`go build`. If `make` is unavailable, run `wails dev` / `wails build` directly.

## Usage

1. Launch the app (the desktop window opens automatically).
2. Click "Select Log File" to load a `.bin` / `.log` / `.ulg` / `.tlog` file.
3. Pick message types and fields to view curves.
4. Browse parameters, flight modes, text messages and raw message lines.
