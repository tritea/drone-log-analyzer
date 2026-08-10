package maptiles

import "net/http"

// Provider is the abstraction every tile source implements. Implementations
// describe themselves (ID/Name/Attribution), build a tile URL, and fetch the
// tile bytes (typically via the shared MBTiles cache with an upstream fallback).
type Provider interface {
	ID() string
	Name() string
	Attribution() string

	TileURL(z, x, y int) string

	Fetch(z, x, y int) ([]byte, error)
}

// URLFunc maps a (zoom, column, row) triple to an upstream tile URL.
type URLFunc func(z, x, y int) string

// TileSource is the default Provider: an MBTiles-backed cache in front of an
// upstream HTTP tile server addressed by urlBuilder.
type TileSource struct {
	key        string
	label      string
	credit     string
	store      *MBTilesStorage
	http       *http.Client
	urlBuilder URLFunc
}

// NewTileSource wires a TileSource around the given cache, HTTP client and URL
// builder.
func NewTileSource(id, name, attribution string, storage *MBTilesStorage, client *http.Client, urlFn URLFunc) *TileSource {
	return &TileSource{
		key:        id,
		label:      name,
		credit:     attribution,
		store:      storage,
		http:       client,
		urlBuilder: urlFn,
	}
}

// ID returns the provider's stable identifier.
func (s *TileSource) ID() string { return s.key }

// Name returns the human-readable provider name.
func (s *TileSource) Name() string { return s.label }

// Attribution returns the provider's attribution string, if any.
func (s *TileSource) Attribution() string { return s.credit }

// TileURL returns the upstream URL for the given tile.
func (s *TileSource) TileURL(z, x, y int) string { return s.urlBuilder(z, x, y) }

// Fetch returns the tile bytes, satisfying the cache first and falling back to
// an upstream download on a miss.
func (s *TileSource) Fetch(z, x, y int) ([]byte, error) {
	return s.store.Get(s.key, z, x, y, func() ([]byte, error) {
		return HTTPFetch(s.http, s.urlBuilder(z, x, y), s.key)
	})
}
