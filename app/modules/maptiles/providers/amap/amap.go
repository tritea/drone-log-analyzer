package amap

import (
	"fmt"
	"net/http"

	"drone-log-analyzer/app/modules/maptiles"
)

// hostIndex picks the AMap subdomain (1..4) for a tile using the standard
// (x*2+y)%4 scheme, which spreads load across the AMap CDN.
func hostIndex(x, y int) int {
	return (x*2+y)%4 + 1
}

// NewVector builds the AMap vector (road + label) tile provider.
func NewVector(storage *maptiles.MBTilesStorage, client *http.Client) maptiles.Provider {
	return maptiles.NewTileSource(
		"amap_vector",
		"高德矢量地图",
		"© AutoNavi (高德)",
		storage,
		client,
		func(z, x, y int) string {
			n := hostIndex(x, y)
			return fmt.Sprintf("https://webrd0%d.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x=%d&y=%d&z=%d", n, x, y, z)
		},
	)
}

// NewRoad builds the AMap road-overlay tile provider.
func NewRoad(storage *maptiles.MBTilesStorage, client *http.Client) maptiles.Provider {
	return maptiles.NewTileSource(
		"amap_road",
		"高德路标地图",
		"© AutoNavi (高德)",
		storage,
		client,
		func(z, x, y int) string {
			n := hostIndex(x, y)
			return fmt.Sprintf("https://webst0%d.is.autonavi.com/appmaptile?style=8&x=%d&y=%d&z=%d", n, x, y, z)
		},
	)
}
