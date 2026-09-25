package maptiles

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestServiceGetTileCacheThenFetch(t *testing.T) {
	var upstream int32
	tile := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&upstream, 1)
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(tile)
	}))
	defer srv.Close()

	storage, err := OpenStorage(t.TempDir()+"/svc.mbtiles", 1<<20)
	if err != nil {
		t.Fatalf("OpenStorage: %v", err)
	}
	defer storage.Close()
	osm := NewTileSource("osm", "OpenStreetMap", "", storage, srv.Client(),
		func(z, x, y int) string { return srv.URL + "/tile" })
	svc := NewTileService(storage, []Provider{osm}, "")

	data, err := svc.GetTile("osm", 5, 10, 15)
	if err != nil {
		t.Fatalf("GetTile (miss): %v", err)
	}
	if string(data) != string(tile) {
		t.Fatalf("tile mismatch")
	}
	if h := atomic.LoadInt32(&upstream); h != 1 {
		t.Fatalf("expected 1 upstream hit, got %d", h)
	}

	if _, err := svc.GetTile("osm", 5, 10, 15); err != nil {
		t.Fatalf("GetTile (hit): %v", err)
	}
	if h := atomic.LoadInt32(&upstream); h != 1 {
		t.Fatalf("expected upstream still 1 (cached), got %d", h)
	}
}

func TestGetTileValidation(t *testing.T) {
	storage, _ := OpenStorage(t.TempDir()+"/v.mbtiles", 1<<20)
	defer storage.Close()
	fake := NewTileSource("osm", "OpenStreetMap", "", storage, http.DefaultClient,
		func(z, x, y int) string { return "http://example.invalid" })
	svc := NewTileService(storage, []Provider{fake}, "")
	if _, err := svc.GetTile("osm", -1, 0, 0); err != ErrInvalidTile {
		t.Errorf("negative zoom: %v", err)
	}
	if _, err := svc.GetTile("osm", 0, 1, 0); err != ErrInvalidTile {
		t.Errorf("x out of range: %v", err)
	}
	if _, err := svc.GetTile("nope", 5, 10, 15); err != ErrUnknownProvider {
		t.Errorf("unknown provider: %v", err)
	}
}

func TestListProviders(t *testing.T) {
	storage, _ := OpenStorage(t.TempDir()+"/p.mbtiles", 1<<20)
	defer storage.Close()
	svc := NewTileService(storage, []Provider{
		NewTileSource("osm", "OpenStreetMap", "", storage, nil, func(z, x, y int) string { return "" }),
		NewTileSource("amap_vector", "高德矢量地图", "", storage, nil, func(z, x, y int) string { return "" }),
	}, "")
	all := svc.ListProviders(nil)
	if len(all) != 2 {
		t.Fatalf("expected 2 providers, got %d", len(all))
	}
	subset := svc.ListProviders([]string{"osm", "bogus"})
	if len(subset) != 1 || subset[0].ID != "osm" {
		t.Fatalf("expected only osm, got %+v", subset)
	}
}

func TestCacheStatsAndClear(t *testing.T) {
	storage, _ := OpenStorage(t.TempDir()+"/c.mbtiles", DefaultMaxCacheBytes)
	defer storage.Close()
	svc := NewTileService(storage, []Provider{
		NewTileSource("osm", "OpenStreetMap", "", storage, nil, func(z, x, y int) string { return "" }),
		NewTileSource("bing_road", "Bing街道地图", "", storage, nil, func(z, x, y int) string { return "" }),
	}, "")

	svc.store.saveNew("osm", 2, 0, 0, []byte("12345"))
	svc.store.saveNew("bing_road", 2, 0, 0, []byte("67890"))

	stats, total := svc.CacheStats()
	if total != 10 {
		t.Fatalf("total=%d want 10", total)
	}
	byID := map[string]int64{}
	counts := map[string]int64{}
	for _, s := range stats {
		byID[s.ID] = s.SizeBytes
		counts[s.ID] = s.TileCount
	}
	if byID["osm"] != 5 || byID["bing_road"] != 5 {
		t.Fatalf("stats by provider: %+v", byID)
	}
	if counts["osm"] != 1 || counts["bing_road"] != 1 {
		t.Fatalf("tile counts by provider: %+v", counts)
	}
	if svc.CapBytes() != DefaultMaxCacheBytes {
		t.Fatalf("CapBytes=%d want %d", svc.CapBytes(), DefaultMaxCacheBytes)
	}

	if err := svc.ClearCache("osm"); err != nil {
		t.Fatalf("ClearCache: %v", err)
	}
	stats, total = svc.CacheStats()
	if total != 5 {
		t.Fatalf("after clear osm total=%d want 5", total)
	}
	for _, s := range stats {
		if s.ID == "osm" && (s.SizeBytes != 0 || s.TileCount != 0) {
			t.Fatalf("after clear osm stat: %+v", s)
		}
		if s.ID == "bing_road" && (s.SizeBytes != 5 || s.TileCount != 1) {
			t.Fatalf("bing_road stat disturbed: %+v", s)
		}
	}
	if err := svc.ClearCache("nope"); err != ErrUnknownProvider {
		t.Fatalf("clear unknown: %v want ErrUnknownProvider", err)
	}
}
