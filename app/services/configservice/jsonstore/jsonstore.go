package jsonstore

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	appcfg "drone-log-analyzer/app/config"
	"drone-log-analyzer/app/services/configservice"
)

const (
	settingsFileName     = "toolbar_settings_v1.json"
	flightMetricsBase    = "flight_metrics"
	fieldEntriesBase     = "curve_templates"
	curveStateBase       = "curve_state"
	customModelsFileName = "custom_models_v1.json"
	modelGroupsFileName  = "model_groups_v1.json"
	tilesetsFileName     = "tilesets_v1.json"
)

type service struct {
	mu           sync.Mutex
	format       string
	tilesetDirs  map[string]string
}

func New() configservice.Service {
	return &service{}
}

func (s *service) SetCurrentFormat(ctx context.Context, format string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.format = format
	return nil
}

func (s *service) currentFormat() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.format == "" {
		return "apm"
	}
	return s.format
}

func configFileName(format, base string) string {
	return fmt.Sprintf("%s_%s_v1.json", base, format)
}

func configExists(filename string) bool {
	_, err := os.Stat(appcfg.ConfigPath(filename))
	return err == nil
}

func loadConfigForFormat(format, base string, v any) error {
	fn := configFileName(format, base)
	if configExists(fn) {
		return loadConfig(fn, v)
	}
	if format == "apm" {
		return loadConfig(base+"_v1.json", v)
	}
	return nil
}

func saveConfigForFormat(format, base string, v any) error {
	return saveConfig(configFileName(format, base), v)
}

func loadConfig(filename string, v any) error {
	path := appcfg.ConfigPath(filename)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read %s: %w", filename, err)
	}
	if len(data) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, v); err != nil {
		return fmt.Errorf("parse %s: %w", filename, err)
	}
	return nil
}

func saveConfig(filename string, v any) error {
	path := appcfg.ConfigPath(filename)
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal %s: %w", filename, err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", filename, err)
	}
	return os.WriteFile(path, data, 0o644)
}

func configPath(filename string) string {
	return appcfg.ConfigPath(filename)
}
