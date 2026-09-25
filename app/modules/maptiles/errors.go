// Package maptiles provides an on-disk MBTiles-backed tile cache and a uniform
// Provider abstraction over upstream tile servers (OSM, Esri, Bing, AMap).
//
// The cache layers a small in-memory LRU on top of a single SQLite database,
// de-duplicates concurrent misses with singleflight, tracks per-provider byte
// sizes, evicts least-recently-used tiles when full, and batches last_used
// touches for throughput.
package maptiles

import "errors"

// Sentinel errors returned by the tile service and storage layer.
var (
	// ErrUnknownProvider is returned when a provider id is not registered with
	// the TileService.
	ErrUnknownProvider = errors.New("unknown map provider")
	// ErrInvalidTile is returned when tile coordinates fall outside the legal
	// range for the given zoom level.
	ErrInvalidTile = errors.New("invalid tile coordinates")
)
