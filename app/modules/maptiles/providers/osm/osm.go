package osm

import (
	"fmt"
	"net/http"

	"drone-log-analyzer/app/modules/maptiles"
)

// letterFor selects the OSM subdomain letter (a, b, c) for a tile using the
// (x+y)%3 rotation that OSM requests be used to distribute load.
func letterFor(x, y int) string {
	return string(rune('a' + (x+y)%3))
}

// New builds the OpenStreetMap tile provider.
func New(storage *maptiles.MBTilesStorage, client *http.Client) maptiles.Provider {
	return maptiles.NewTileSource(
		"osm",
		"OpenStreetMap",
		"© OpenStreetMap contributors",
		storage,
		client,
		func(z, x, y int) string {
			return fmt.Sprintf("https://%s.tile.openstreetmap.org/%d/%d/%d.png", letterFor(x, y), z, x, y)
		},
	)
}
