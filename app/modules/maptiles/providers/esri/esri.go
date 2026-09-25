package esri

import (
	"fmt"
	"net/http"

	"drone-log-analyzer/app/modules/maptiles"
)

// arcGisTileURL is the Esri World Imagery tile template. Note it expects tiles
// addressed as z/y/x (row before column), unlike most slippy-map services.
const arcGisTileURL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/%d/%d/%d"

// New builds the Esri World Imagery (satellite) tile provider.
func New(storage *maptiles.MBTilesStorage, client *http.Client) maptiles.Provider {
	return maptiles.NewTileSource(
		"esri_satellite",
		"Esri 卫星影像",
		"Imagery © Esri, Maxar, Earthstar Geographics",
		storage,
		client,
		// Esri's /tile/z/y/x addressing swaps y and x relative to the canonical
		// slippy-map order.
		func(z, x, y int) string {
			return fmt.Sprintf(arcGisTileURL, z, y, x)
		},
	)
}
