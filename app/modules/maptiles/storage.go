package maptiles

import (
	"database/sql"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"sync"
	"time"

	lru "github.com/hashicorp/golang-lru/v2/expirable"
	"golang.org/x/sync/singleflight"
)

// Cache sizing / freshness knobs.
const (
	// DefaultMaxCacheBytes is the on-disk cache ceiling applied when no explicit
	// capacity is given to OpenStorage.
	DefaultMaxCacheBytes int64 = 500 * 1024 * 1024

	// Internal tuning constants for the storage layer.
	staleAfter        = 7 * 24 * time.Hour // when a cached tile is considered stale and eligible for background refresh
	memCacheSlots     = 2000               // in-memory LRU entry cap
	memCacheTTL       = 5 * time.Minute    // in-memory LRU entry lifetime
	touchFlushCadence = 30 * time.Second   // how often last_used touches are flushed to disk
)

// providerStat is the on-disk footprint of one provider's cached tiles as
// tracked in memory: total blob bytes and row count.
type providerStat struct {
	bytes int64
	tiles int64
}

// MBTilesStorage is an MBTiles-backed tile cache: an in-memory LRU in front of
// a single SQLite database, with singleflight de-duplication of concurrent
// misses, size accounting per provider, LRU eviction, and batched last_used
// updates.
type MBTilesStorage struct {
	handle *sql.DB

	capacity int64
	mem      *lru.LRU[string, []byte]
	dedup    singleflight.Group

	statsMu   sync.RWMutex
	statsByID map[string]providerStat

	touchMu        sync.Mutex
	pendingTouches map[string]touchEntry

	halt    chan struct{}
	workers sync.WaitGroup
}

// OpenStorage opens (or creates) the MBTiles database at path, seeding the
// per-provider byte/tile counters with a single aggregate scan — the only full
// scan of the process; every later write updates the counters incrementally.
// capBytes <= 0 selects DefaultMaxCacheBytes.
func OpenStorage(path string, capBytes int64) (*MBTilesStorage, error) {
	if capBytes <= 0 {
		capBytes = DefaultMaxCacheBytes
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create db dir %s: %w", filepath.Dir(path), err)
	}

	handle, err := initDB(path)
	if err != nil {
		return nil, err
	}

	statsByID, err := aggregateStats(handle)
	if err != nil {
		handle.Close()
		return nil, fmt.Errorf("seed cache stats: %w", err)
	}

	st := &MBTilesStorage{
		handle:         handle,
		capacity:       capBytes,
		mem:            lru.NewLRU[string, []byte](memCacheSlots, nil, memCacheTTL),
		statsByID:      statsByID,
		pendingTouches: map[string]touchEntry{},
		halt:           make(chan struct{}),
	}

	// Opportunistically reclaim free pages left by previous evictions.
	go func() { _, _ = handle.Exec("PRAGMA incremental_vacuum") }()
	st.workers.Add(1)
	go st.touchPump()
	return st, nil
}

// cacheKey is the canonical string key for a tile across all cache layers.
func cacheKey(provider string, z, x, y int) string {
	return fmt.Sprintf("%s/%d/%d/%d", provider, z, x, y)
}

// unixNow returns the current time as a Unix timestamp.
func unixNow() int64 { return time.Now().Unix() }

// Get returns the cached tile, populating the cache via fallback on a miss.
// Concurrent Gets for the same tile are coalesced via singleflight.
func (s *MBTilesStorage) Get(provider string, z, x, y int, fallback func() ([]byte, error)) ([]byte, error) {
	key := cacheKey(provider, z, x, y)

	if v, ok := s.mem.Get(key); ok {
		return v, nil
	}

	v, err, _ := s.dedup.Do(key, func() (interface{}, error) {
		// Re-check the memory cache inside the singleflight; another goroutine
		// may have just populated it.
		if v, ok := s.mem.Get(key); ok {
			return v, nil
		}

		data, createdAt, found, err := loadTileRow(s.handle, provider, z, x, y)
		if err != nil {
			return nil, err
		}
		if found {
			s.mem.Add(key, data)
			if time.Since(time.Unix(createdAt, 0)) > staleAfter {
				// Stale: hand back what we have and refresh in the background.
				go s.revalidate(provider, z, x, y, fallback)
			} else {
				s.recordTouch(provider, z, x, y)
			}
			return data, nil
		}

		// Cache miss: fetch upstream and persist.
		fresh, err := fallback()
		if err != nil {
			return nil, err
		}
		s.saveNew(provider, z, x, y, fresh)
		s.mem.Add(key, fresh)
		return fresh, nil
	})
	if err != nil {
		return nil, err
	}
	return v.([]byte), nil
}

// revalidate refreshes a stale tile from upstream without blocking the caller.
// It runs under a separate singleflight key so it never collides with a
// foreground Get for the same tile.
func (s *MBTilesStorage) revalidate(provider string, z, x, y int, fallback func() ([]byte, error)) {
	key := cacheKey(provider, z, x, y)
	_, _, _ = s.dedup.Do(key+"#refresh", func() (interface{}, error) {
		fresh, err := fallback()
		if err != nil {
			return nil, err
		}
		oldLen, replaced, err := replaceTileRow(s.handle, provider, z, x, y, fresh, unixNow())
		if err != nil || !replaced {
			return fresh, nil
		}
		s.adjustStat(provider, int64(len(fresh))-oldLen, 0)
		s.mem.Add(key, fresh)
		return fresh, nil
	})
}

// saveNew persists a freshly downloaded tile and runs eviction if needed.
func (s *MBTilesStorage) saveNew(provider string, z, x, y int, data []byte) {
	inserted, err := insertTileRow(s.handle, provider, z, x, y, data, unixNow())
	if err != nil || !inserted {
		return
	}
	s.adjustStat(provider, int64(len(data)), 1)
	s.enforceCap()
}

// enforceCap evicts least-recently-used tiles until the cache drops below 80%
// of its configured capacity.
func (s *MBTilesStorage) enforceCap() {
	if s.totalBytes() <= s.capacity {
		return
	}
	target := s.totalBytes() - s.capacity*8/10

	rows, err := s.handle.Query("SELECT last_used, length(tile_data) FROM tiles ORDER BY last_used ASC")
	if err != nil {
		return
	}
	var cumulative int64
	var cutoff int64 = -1
	for rows.Next() {
		var lastUsed, size int64
		if err := rows.Scan(&lastUsed, &size); err != nil {
			rows.Close()
			return
		}
		cumulative += size
		cutoff = lastUsed
		if cumulative >= target {
			break
		}
	}
	rows.Close()
	if cutoff < 0 {
		return
	}

	freed, err := purgeStaleRows(s.handle, cutoff)
	if err != nil {
		return
	}
	for provider, freedStat := range freed {
		s.adjustStat(provider, -freedStat.bytes, -freedStat.tiles)
	}
}

// recordTouch stages a last_used update for later batched persistence.
func (s *MBTilesStorage) recordTouch(provider string, z, x, y int) {
	s.touchMu.Lock()
	s.pendingTouches[cacheKey(provider, z, x, y)] = touchEntry{
		provider: provider,
		z:        z,
		x:        x,
		y:        y,
		ts:       unixNow(),
	}
	s.touchMu.Unlock()
}

// touchPump periodically flushes staged touches until the storage is closed.
func (s *MBTilesStorage) touchPump() {
	defer s.workers.Done()
	ticker := time.NewTicker(touchFlushCadence)
	defer ticker.Stop()
	for {
		select {
		case <-s.halt:
			s.drainTouches()
			return
		case <-ticker.C:
			s.drainTouches()
		}
	}
}

// drainTouches persists any staged last_used updates in a single batch.
func (s *MBTilesStorage) drainTouches() {
	s.touchMu.Lock()
	if len(s.pendingTouches) == 0 {
		s.touchMu.Unlock()
		return
	}
	entries := make([]touchEntry, 0, len(s.pendingTouches))
	for _, e := range s.pendingTouches {
		entries = append(entries, e)
	}
	s.pendingTouches = map[string]touchEntry{}
	s.touchMu.Unlock()

	_ = persistTouches(s.handle, entries)
}

// adjustStat applies byte/count deltas to a provider's in-memory footprint.
func (s *MBTilesStorage) adjustStat(provider string, dBytes, dTiles int64) {
	s.statsMu.Lock()
	cur := s.statsByID[provider]
	cur.bytes += dBytes
	cur.tiles += dTiles
	s.statsByID[provider] = cur
	s.statsMu.Unlock()
}

// totalBytes returns the sum of all providers' cached bytes.
func (s *MBTilesStorage) totalBytes() int64 {
	s.statsMu.RLock()
	defer s.statsMu.RUnlock()
	var total int64
	for _, st := range s.statsByID {
		total += st.bytes
	}
	return total
}

// snapshotStats returns a copy of the per-provider footprint counters.
func (s *MBTilesStorage) snapshotStats() map[string]providerStat {
	s.statsMu.RLock()
	defer s.statsMu.RUnlock()
	out := make(map[string]providerStat, len(s.statsByID))
	maps.Copy(out, s.statsByID)
	return out
}

// SizeByProvider returns a snapshot of cached bytes keyed by provider id.
func (s *MBTilesStorage) SizeByProvider() map[string]int64 {
	s.statsMu.RLock()
	defer s.statsMu.RUnlock()
	out := make(map[string]int64, len(s.statsByID))
	for k, v := range s.statsByID {
		out[k] = v.bytes
	}
	return out
}

// TileCount returns the number of cached tiles for the given provider, from
// the in-memory counters — no query.
func (s *MBTilesStorage) TileCount(provider string) int64 {
	s.statsMu.RLock()
	defer s.statsMu.RUnlock()
	return s.statsByID[provider].tiles
}

// Clear drops every cached tile for the given provider.
func (s *MBTilesStorage) Clear(provider string) error {
	freed, err := wipeProvider(s.handle, provider)
	if err != nil {
		return err
	}
	s.adjustStat(provider, -freed.bytes, -freed.tiles)
	return nil
}

// ClearAll drops every cached tile regardless of provider.
func (s *MBTilesStorage) ClearAll() error {
	if _, err := s.handle.Exec("DELETE FROM tiles"); err != nil {
		return err
	}
	s.statsMu.Lock()
	s.statsByID = map[string]providerStat{}
	s.statsMu.Unlock()
	return nil
}

// Close flushes pending touches and closes the database handle.
func (s *MBTilesStorage) Close() error {
	close(s.halt)
	s.workers.Wait()
	s.drainTouches()
	return s.handle.Close()
}
