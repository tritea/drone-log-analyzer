package wails

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	appcfg "drone-log-analyzer/app/config"
	"drone-log-analyzer/app/services/logservice"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type HostAPI struct {
	ctx context.Context
	Log logservice.Service
}

func (h *HostAPI) Startup(ctx context.Context) {
	h.ctx = ctx

	h.fitWindowToScreen(ctx)
}

func (h *HostAPI) PickLogPath() (string, error) {
	return runtime.OpenFileDialog(h.ctx, runtime.OpenDialogOptions{
		Title: "选择飞控日志文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "全部飞控日志 (*.bin;*.log;*.ulg;*.tlog)", Pattern: "*.bin;*.log;*.ulg;*.tlog"},
			{DisplayName: "ArduPilot Dataflash (*.bin;*.log)", Pattern: "*.bin;*.log"},
			{DisplayName: "PX4 ULog (*.ulg)", Pattern: "*.ulg"},
			{DisplayName: "MAVLink tlog (*.tlog)", Pattern: "*.tlog"},
		},
	})
}

func (h *HostAPI) ImportModel(copy bool) (string, error) {
	src, err := runtime.OpenFileDialog(h.ctx, runtime.OpenDialogOptions{
		Title: "选择 3D 模型文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "3D 模型 (*.glb;*.obj)", Pattern: "*.glb;*.obj"},
			{DisplayName: "glTF 二进制模型 (*.glb)", Pattern: "*.glb"},
			{DisplayName: "OBJ 模型 (*.obj)", Pattern: "*.obj"},
		},
	})
	if err != nil {
		return "", err
	}
	if src == "" {
		return "", nil
	}
	if copy {
		return appcfg.SaveImportedModel(src)
	}
	return src, nil
}

func (h *HostAPI) ImportModels(copy bool) ([]string, error) {
	srcs, err := runtime.OpenMultipleFilesDialog(h.ctx, runtime.OpenDialogOptions{
		Title: "选择 3D 模型文件（可多选）",
		Filters: []runtime.FileFilter{
			{DisplayName: "3D 模型 (*.glb;*.obj)", Pattern: "*.glb;*.obj"},
			{DisplayName: "glTF 二进制模型 (*.glb)", Pattern: "*.glb"},
			{DisplayName: "OBJ 模型 (*.obj)", Pattern: "*.obj"},
		},
	})
	if err != nil {
		return nil, err
	}
	if len(srcs) == 0 {
		return []string{}, nil
	}
	out := make([]string, 0, len(srcs))
	for _, src := range srcs {
		if copy {
			p, err := appcfg.SaveImportedModel(src)
			if err != nil {
				return out, err
			}
			out = append(out, p)
		} else {
			out = append(out, src)
		}
	}
	return out, nil
}

// ImportTileset opens a directory picker for a 3D Tiles dataset (a folder
// containing tileset.json). It returns the chosen directory path, optionally
// copying the tree into the app's tilesets dir when copy is true. Returns
// ("", nil) when the user cancels.
func (h *HostAPI) ImportTileset(copy bool) (string, error) {
	src, err := runtime.OpenDirectoryDialog(h.ctx, runtime.OpenDialogOptions{
		Title: "选择 3D Tiles 目录（包含 tileset.json）",
	})
	if err != nil {
		return "", err
	}
	if src == "" {
		return "", nil
	}
	// 3D Tiles standard entry point lives at the dataset root.
	if _, err := os.Stat(filepath.Join(src, "tileset.json")); err != nil {
		return "", fmt.Errorf("所选目录未找到 tileset.json: %w", err)
	}
	if copy {
		return appcfg.SaveImportedTileset(src)
	}
	return src, nil
}

func (h *HostAPI) fitWindowToScreen(ctx context.Context) {
	screens, err := runtime.ScreenGetAll(ctx)
	if err != nil || len(screens) == 0 {
		runtime.WindowCenter(ctx)
		return
	}
	screen := screens[0]
	for i := range screens {
		if screens[i].IsPrimary {
			screen = screens[i]
			break
		}
	}
	const (
		idealW = 1400
		idealH = 900
		margin = 80
		minW   = 800
		minH   = 480
	)
	w, height := idealW, idealH
	if sw := screen.Size.Width - margin; sw > 0 && w > sw {
		w = sw
	}
	if sh := screen.Size.Height - margin; sh > 0 && height > sh {
		height = sh
	}
	if w < minW {
		w = minW
	}
	if height < minH {
		height = minH
	}
	runtime.WindowSetSize(ctx, w, height)
	runtime.WindowCenter(ctx)
}
