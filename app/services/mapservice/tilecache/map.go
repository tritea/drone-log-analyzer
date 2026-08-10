package tilecache

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	appcfg "drone-log-analyzer/app/config"
	"drone-log-analyzer/app/modules/maptiles"
	"drone-log-analyzer/app/modules/maptiles/providers"
	"drone-log-analyzer/app/services/mapservice"
)

const mapProvidersFileName = "map_providers_v1.json"

type mapProviderConfigEntry struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

type mapProviderConfig struct {
	Providers []mapProviderConfigEntry `json:"providers"`
	UpdatedAt string                   `json:"updatedAt,omitempty"`
}

func providerConfigPath() string {
	return appcfg.ConfigPath(mapProvidersFileName)
}

type service struct {
	tiles *maptiles.TileService
}

func New(cacheDir string) mapservice.Service {
	st, err := providers.NewDefaultTileService(cacheDir)
	if err != nil {
		log.Printf("map tile service init failed: %v", err)
		return &service{}
	}
	return &service{tiles: st}
}

func (s *service) Close() error {
	if s.tiles == nil {
		return nil
	}
	return s.tiles.Close()
}

func (s *service) Available(ctx context.Context) bool {
	return s.tiles != nil
}

func (s *service) Providers(ctx context.Context) (*mapservice.ProvidersResponse, error) {
	if s.tiles == nil {
		return nil, mapservice.ErrMapUnavailable
	}
	cfg, err := loadMapProvidersConfig()
	if err != nil {
		return nil, fmt.Errorf("load map providers config: %w", err)
	}
	enabled := make([]string, 0, len(cfg.Providers))
	for _, p := range cfg.Providers {
		if p.Enabled {
			enabled = append(enabled, p.ID)
		}
	}
	return &mapservice.ProvidersResponse{
		Providers: s.tiles.ListProviders(enabled),
		Path:      providerConfigPath(),
		UpdatedAt: cfg.UpdatedAt,
	}, nil
}

func (s *service) CacheStats(ctx context.Context) (*mapservice.CacheStatsResponse, error) {
	if s.tiles == nil {
		return nil, mapservice.ErrMapUnavailable
	}
	stats, total := s.tiles.CacheStats()
	return &mapservice.CacheStatsResponse{
		Dir:        s.tiles.CacheDir(),
		CapBytes:   s.tiles.CapBytes(),
		Providers:  stats,
		TotalBytes: total,
	}, nil
}

func (s *service) ClearCache(ctx context.Context) error {
	if s.tiles == nil {
		return mapservice.ErrMapUnavailable
	}
	return s.tiles.ClearAll()
}

func (s *service) ClearCacheProvider(ctx context.Context, req mapservice.ClearCacheProviderRequest) error {
	if s.tiles == nil {
		return mapservice.ErrMapUnavailable
	}
	return s.tiles.ClearCache(req.ID)
}

func (s *service) GetTile(ctx context.Context, req mapservice.TileRequest) (*mapservice.TileResponse, error) {
	if s.tiles == nil {
		return nil, mapservice.ErrMapUnavailable
	}
	data, err := s.tiles.GetTile(req.Provider, req.Z, req.X, req.Y)
	if err != nil {
		return nil, err
	}
	return &mapservice.TileResponse{Bytes: data}, nil
}

func loadMapProvidersConfig() (mapProviderConfig, error) {
	data, err := os.ReadFile(providerConfigPath())
	if err != nil {
		if !os.IsNotExist(err) {
			return mapProviderConfig{}, err
		}
		cfg := defaultMapProviderConfig()
		_ = saveMapProvidersConfig(cfg)
		return cfg, nil
	}
	var cfg mapProviderConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return mapProviderConfig{}, err
	}
	seen := make(map[string]bool, len(cfg.Providers))
	for _, p := range cfg.Providers {
		seen[p.ID] = true
	}
	changed := false
	for _, p := range defaultMapProviderConfig().Providers {
		if !seen[p.ID] {
			cfg.Providers = append(cfg.Providers, p)
			changed = true
		}
	}
	if changed {
		_ = saveMapProvidersConfig(cfg)
	}
	return cfg, nil
}

func saveMapProvidersConfig(cfg mapProviderConfig) error {
	cfg.UpdatedAt = time.Now().Format(time.RFC3339)
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	path := providerConfigPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func defaultMapProviderConfig() mapProviderConfig {
	return mapProviderConfig{
		Providers: []mapProviderConfigEntry{
			{ID: "esri_satellite", Enabled: true},
			{ID: "osm", Enabled: true},
			{ID: "amap_vector", Enabled: true},
			{ID: "amap_road", Enabled: true},
			{ID: "bing_road", Enabled: true},
		},
	}
}
