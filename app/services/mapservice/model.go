package mapservice

import (
	"drone-log-analyzer/app/modules/maptiles"
)

type ProvidersResponse struct {
	Providers []maptiles.ProviderInfo `json:"providers"`
	Path      string                  `json:"path"`
	UpdatedAt string                  `json:"updatedAt"`
}

type CacheStatsResponse struct {
	Dir        string                       `json:"dir"`
	CapBytes   int64                        `json:"capBytes"`
	Providers  []maptiles.ProviderCacheStat `json:"providers"`
	TotalBytes int64                        `json:"totalBytes"`
}

type ClearCacheProviderRequest struct {
	ID string `json:"id"`
}

type TileRequest struct {
	Provider string `json:"provider"`
	Z        int    `json:"z"`
	X        int    `json:"x"`
	Y        int    `json:"y"`
}

type TileResponse struct {
	Bytes []byte `json:"bytes"`
}
