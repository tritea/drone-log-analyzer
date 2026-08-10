// Package providers wires the built-in tile providers (Esri, AMap, Bing, OSM)
// into a ready-to-use maptiles.TileService backed by a shared MBTiles cache.
package providers

import (
	"path/filepath"

	"drone-log-analyzer/app/modules/maptiles"
	"drone-log-analyzer/app/modules/maptiles/providers/amap"
	"drone-log-analyzer/app/modules/maptiles/providers/bing"
	"drone-log-analyzer/app/modules/maptiles/providers/esri"
	"drone-log-analyzer/app/modules/maptiles/providers/osm"
)

// NewDefaultTileService opens the shared MBTiles cache under cacheDir and
// returns a TileService preconfigured with all built-in providers, in the
// canonical display order.
func NewDefaultTileService(cacheDir string) (*maptiles.TileService, error) {
	storage, err := maptiles.OpenStorage(filepath.Join(cacheDir, "tiles.mbtiles"), maptiles.DefaultMaxCacheBytes)
	if err != nil {
		return nil, err
	}
	client := maptiles.SharedHTTPClient()

	builtins := []maptiles.Provider{
		esri.New(storage, client),
		amap.NewVector(storage, client),
		amap.NewRoad(storage, client),
		bing.New(storage, client),
		osm.New(storage, client),
	}
	return maptiles.NewTileService(storage, builtins, cacheDir), nil
}
