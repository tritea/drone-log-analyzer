package maptiles

import "strings"

// TileService is the facade callers (mapservice) hold: it validates tile
// coordinates, routes fetches to the right Provider, and exposes cache stats.
type TileService struct {
	store     *MBTilesStorage
	ordered   []Provider
	byID      map[string]Provider
	cacheRoot string
}

// NewTileService builds a TileService over the given storage and providers.
// providers defines the canonical listing order returned by ListProviders.
func NewTileService(storage *MBTilesStorage, providers []Provider, cacheDir string) *TileService {
	lookup := make(map[string]Provider, len(providers))
	for _, p := range providers {
		lookup[p.ID()] = p
	}
	return &TileService{
		store:     storage,
		ordered:   providers,
		byID:      lookup,
		cacheRoot: cacheDir,
	}
}

// GetTile fetches a tile from the named provider after validating coordinates.
func (s *TileService) GetTile(providerID string, z, x, y int) ([]byte, error) {
	if err := checkTileCoords(z, x, y); err != nil {
		return nil, err
	}
	p, ok := s.byID[providerID]
	if !ok {
		return nil, ErrUnknownProvider
	}
	return p.Fetch(z, x, y)
}

// ListProviders returns ProviderInfo for each provider, optionally filtered to
// the given ids. A nil/empty filter returns every provider in registration
// order.
func (s *TileService) ListProviders(enabled []string) []ProviderInfo {
	wantAll := len(enabled) == 0
	allow := make(map[string]struct{}, len(enabled))
	for _, id := range enabled {
		allow[strings.TrimSpace(id)] = struct{}{}
	}

	out := make([]ProviderInfo, 0, len(s.ordered))
	for _, p := range s.ordered {
		if wantAll {
			out = append(out, ProviderInfo{ID: p.ID(), Name: p.Name(), Attribution: p.Attribution()})
			continue
		}
		if _, ok := allow[p.ID()]; ok {
			out = append(out, ProviderInfo{ID: p.ID(), Name: p.Name(), Attribution: p.Attribution()})
		}
	}
	return out
}

// CacheDir reports the directory holding the MBTiles database.
func (s *TileService) CacheDir() string { return s.cacheRoot }

// CapBytes reports the configured cache byte ceiling.
func (s *TileService) CapBytes() int64 { return s.store.capacity }

// CacheStats reports per-provider bytes/tile counts plus the grand total.
// Both figures come from the in-memory counters seeded once at startup and
// updated incrementally on every write — this never queries the database.
func (s *TileService) CacheStats() ([]ProviderCacheStat, int64) {
	stats := s.store.snapshotStats()
	out := make([]ProviderCacheStat, 0, len(s.ordered))
	var total int64
	for _, p := range s.ordered {
		st := stats[p.ID()]
		total += st.bytes
		out = append(out, ProviderCacheStat{
			ID:        p.ID(),
			Name:      p.Name(),
			SizeBytes: st.bytes,
			TileCount: st.tiles,
		})
	}
	return out, total
}

// ClearCache drops every cached tile for the named provider.
func (s *TileService) ClearCache(providerID string) error {
	if _, ok := s.byID[providerID]; !ok {
		return ErrUnknownProvider
	}
	return s.store.Clear(providerID)
}

// ClearAll drops every cached tile regardless of provider.
func (s *TileService) ClearAll() error {
	return s.store.ClearAll()
}

// Close flushes pending writes and closes the underlying store.
func (s *TileService) Close() error { return s.store.Close() }

// checkTileCoords verifies that (z,x,y) is a legal slippy-map coordinate:
// 0 <= z <= MaxZoom and x,y within [0, 2^z - 1].
func checkTileCoords(z, x, y int) error {
	if z < 0 || z > MaxZoom {
		return ErrInvalidTile
	}
	maxIndex := (1 << z) - 1
	if x < 0 || x > maxIndex || y < 0 || y > maxIndex {
		return ErrInvalidTile
	}
	return nil
}
