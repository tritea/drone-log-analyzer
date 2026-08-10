package maptiles

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

func stubFallback(t *testing.T, hits *int32, tile []byte) (*httptest.Server, func() ([]byte, error)) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(hits, 1)
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(tile)
	}))
	fb := func() ([]byte, error) { return HTTPFetch(srv.Client(), srv.URL+"/tile", "test") }
	return srv, fb
}

func TestStorageMissFetchHit(t *testing.T) {
	var hits int32
	tile := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A}
	srv, fb := stubFallback(t, &hits, tile)
	defer srv.Close()

	st, err := OpenStorage(t.TempDir()+"/s.mbtiles", 1<<20)
	if err != nil {
		t.Fatalf("OpenStorage: %v", err)
	}
	defer st.Close()

	d1, err := st.Get("test", 5, 10, 15, fb)
	if err != nil || !bytes.Equal(d1, tile) {
		t.Fatalf("get (miss): %v %v", err, d1)
	}
	if h := atomic.LoadInt32(&hits); h != 1 {
		t.Fatalf("after miss: hits=%d want 1", h)
	}

	if d2, _ := st.Get("test", 5, 10, 15, fb); !bytes.Equal(d2, tile) {
		t.Fatal("lru mismatch")
	}
	if h := atomic.LoadInt32(&hits); h != 1 {
		t.Fatalf("after lru hit: hits=%d want 1", h)
	}

	st.mem.Purge()
	if d3, _ := st.Get("test", 5, 10, 15, fb); !bytes.Equal(d3, tile) {
		t.Fatal("db mismatch")
	}
	if h := atomic.LoadInt32(&hits); h != 1 {
		t.Fatalf("after db hit: hits=%d want 1", h)
	}

	if sz := st.SizeByProvider()["test"]; sz != int64(len(tile)) {
		t.Fatalf("size=%d want %d", sz, len(tile))
	}
}

func TestStorageSingleflight(t *testing.T) {
	var hits int32
	tile := []byte("png-bytes-here")
	srv, fb := stubFallback(t, &hits, tile)
	defer srv.Close()

	st, _ := OpenStorage(t.TempDir()+"/sf.mbtiles", 1<<20)
	defer st.Close()

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := st.Get("test", 6, 1, 1, fb); err != nil {
				t.Errorf("get: %v", err)
			}
		}()
	}
	wg.Wait()
	if h := atomic.LoadInt32(&hits); h != 1 {
		t.Fatalf("singleflight: fallback hits=%d want 1", h)
	}
}

func TestStorageEvictionBounded(t *testing.T) {
	st, err := OpenStorage(t.TempDir()+"/e.mbtiles", 350)
	if err != nil {
		t.Fatalf("OpenStorage: %v", err)
	}
	defer st.Close()

	for i := 0; i < 20; i++ {
		if ins, err := insertTileRow(st.handle, "test", 4, i, 0, make([]byte, 100), int64(1000+i)); err != nil || !ins {
			t.Fatalf("insert i=%d: ins=%v err=%v", i, ins, err)
		}
		st.adjustBytes("test", 100)
		st.enforceCap()
	}

	if sz := st.totalBytes(); sz > 350 {
		t.Fatalf("eviction did not bound size: %d bytes (cap 350)", sz)
	}
}

func TestStorageClear(t *testing.T) {
	st, _ := OpenStorage(t.TempDir()+"/c.mbtiles", 1<<20)
	defer st.Close()
	st.saveNew("osm", 2, 0, 0, []byte("12345"))
	st.saveNew("amap_vector", 2, 0, 0, []byte("67890"))
	if st.totalBytes() == 0 {
		t.Fatal("expected non-zero size")
	}
	if err := st.Clear("osm"); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	sz := st.SizeByProvider()
	if sz["osm"] != 0 || sz["amap_vector"] != 5 {
		t.Fatalf("after clear osm: %+v", sz)
	}
	if err := st.ClearAll(); err != nil {
		t.Fatalf("ClearAll: %v", err)
	}
	if st.totalBytes() != 0 {
		t.Fatalf("after ClearAll: %d", st.totalBytes())
	}
}
