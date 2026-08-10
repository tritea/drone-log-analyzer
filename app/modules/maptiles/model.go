package maptiles

// MaxZoom is the highest zoom level supported by the cache.
const MaxZoom = 18

// ProviderInfo describes a registered tile provider for listing UIs.
type ProviderInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Attribution string `json:"attribution,omitempty"`
}

// ProviderCacheStat reports the on-disk footprint of one provider's tiles.
type ProviderCacheStat struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SizeBytes int64  `json:"sizeBytes"`
	TileCount int64  `json:"tileCount"`
}
