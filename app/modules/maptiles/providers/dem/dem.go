// Package dem provides the hidden Terrarium elevation (DEM) tile provider
// backing the Cesium 3D globe terrain. Serving DEM through the same tile
// pipeline as imagery gives it the MBTiles cache and a same-origin URL for
// the embedded webview, instead of fetching AWS S3 directly from the frontend.
package dem

import (
	"fmt"
	"net/http"

	"drone-log-analyzer/app/modules/maptiles"
)

// hiddenDEM wraps a TileSource and marks it non-imagery: routable and cached
// like any tile source, but excluded from basemap pickers via Hidden.
type hiddenDEM struct {
	*maptiles.TileSource
}

// Hidden implements maptiles.hideable.
func (hiddenDEM) Hidden() bool { return true }

// NewTerrarium builds the Terrarium elevation tile provider (Mapzen/AWS
// Terrain Tiles: PNG-encoded heights, z<=14).
func NewTerrarium(storage *maptiles.MBTilesStorage, client *http.Client) maptiles.Provider {
	return hiddenDEM{maptiles.NewTileSource(
		"dem_terrarium",
		"地形高程 (Terrarium)",
		"© Mapzen/AWS Terrain Tiles",
		storage,
		client,
		func(z, x, y int) string {
			return fmt.Sprintf("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/%d/%d/%d.png", z, x, y)
		},
	)}
}
