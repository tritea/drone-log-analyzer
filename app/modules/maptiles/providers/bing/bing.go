package bing

import (
	"fmt"
	"net/http"
	"strings"

	"drone-log-analyzer/app/modules/maptiles"
)

// encodeQuadKey converts a slippy-map (z,x,y) triple into the Bing/Quadkey
// string used by the VirtualEarth tile service. Each zoom step contributes one
// digit in {0,1,2,3} derived from the corresponding x/y bits (y in the high
// position).
func encodeQuadKey(z, x, y int) string {
	var b strings.Builder
	for i := z; i > 0; i-- {
		digit := 0
		mask := 1 << (i - 1)
		if x&mask != 0 {
			digit++
		}
		if y&mask != 0 {
			digit += 2
		}
		fmt.Fprintf(&b, "%d", digit)
	}
	return b.String()
}

// New builds the Bing road tile provider.
func New(storage *maptiles.MBTilesStorage, client *http.Client) maptiles.Provider {
	return maptiles.NewTileSource(
		"bing_road",
		"Bing街道地图",
		"© Microsoft Corporation",
		storage,
		client,
		func(z, x, y int) string {
			key := encodeQuadKey(z, x, y)
			return fmt.Sprintf("https://t.ssl.ak.dynamic.tiles.virtualearth.net/comp/ch/%s?mkt=zh-CN&it=GB,LC&shading=hill&n=t&og=2505&cstl=s23&o=webp&ur=hk", key)
		},
	)
}
