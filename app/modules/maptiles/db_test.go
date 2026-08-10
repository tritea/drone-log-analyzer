package maptiles

import (
	"testing"
)

func TestTMSInvertedRow(t *testing.T) {
	cases := []struct {
		z, y int
		want int64
	}{
		{0, 0, 0}, {1, 0, 1}, {1, 1, 0}, {2, 0, 3}, {2, 3, 0},
		{18, 0, 262143}, {18, 262143, 0},
	}
	for _, c := range cases {
		if got := tmsInvertedRow(c.z, c.y); got != c.want {
			t.Errorf("tmsInvertedRow(z=%d,y=%d)=%d want %d", c.z, c.y, got, c.want)
		}
	}
}

func TestDBOps(t *testing.T) {
	db, err := initDB(t.TempDir() + "/ops.mbtiles")
	if err != nil {
		t.Fatalf("initDB: %v", err)
	}
	defer db.Close()
	now := unixNow()

	if ins, err := insertTileRow(db, "osm", 5, 10, 15, []byte{0x89, 0x50}, now); err != nil || !ins {
		t.Fatalf("insert: ins=%v err=%v", ins, err)
	}

	if ins, err := insertTileRow(db, "osm", 5, 10, 15, []byte{0x89, 0x50}, now); err != nil || ins {
		t.Fatalf("dup insert should be ignored: ins=%v", ins)
	}

	data, created, ok, err := loadTileRow(db, "osm", 5, 10, 15)
	if err != nil || !ok || len(data) != 2 || created != now {
		t.Fatalf("get: ok=%v data=%v created=%d err=%v", ok, data, created, err)
	}

	if _, _, ok, _ := loadTileRow(db, "osm", 5, 10, 16); ok {
		t.Fatal("expected miss for (osm,5,10,16)")
	}
	if _, _, ok, _ := loadTileRow(db, "amap_vector", 5, 10, 15); ok {
		t.Fatal("expected miss for different provider sharing z/x/y")
	}

	oldLen, replaced, err := replaceTileRow(db, "osm", 5, 10, 15, []byte{0x89, 0x50, 0x4e, 0x47}, now)
	if err != nil || !replaced || oldLen != 2 {
		t.Fatalf("refresh: replaced=%v oldLen=%d err=%v", replaced, oldLen, err)
	}

	prov, total, err := aggregateSizes(db)
	if err != nil || total != 4 || prov["osm"] != 4 {
		t.Fatalf("sizes: %+v total=%d err=%v", prov, total, err)
	}

	if n, _ := countProviderTiles(db, "osm"); n != 1 {
		t.Fatalf("count=%d want 1", n)
	}
}

func TestDBDeleteByCutoffLRU(t *testing.T) {
	db, _ := initDB(t.TempDir() + "/lru.mbtiles")
	defer db.Close()

	for i := 0; i < 5; i++ {
		if _, err := insertTileRow(db, "osm", 3, i, 0, make([]byte, 100), int64(1000+i)); err != nil {
			t.Fatalf("insert i=%d: %v", i, err)
		}
	}

	freed, err := purgeStaleRows(db, 1002)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if freed["osm"] != 300 {
		t.Fatalf("freed=%d want 300", freed["osm"])
	}
	if n, _ := countProviderTiles(db, "osm"); n != 2 {
		t.Fatalf("remaining=%d want 2", n)
	}
}

func TestDBClearProvider(t *testing.T) {
	db, _ := initDB(t.TempDir() + "/clr.mbtiles")
	defer db.Close()
	insertTileRow(db, "osm", 2, 0, 0, []byte("aaaa"), 1)
	insertTileRow(db, "amap_vector", 2, 0, 0, []byte("bb"), 1)
	if freed, err := wipeProvider(db, "osm"); err != nil || freed != 4 {
		t.Fatalf("clear osm: freed=%d err=%v", freed, err)
	}
	if n, _ := countProviderTiles(db, "osm"); n != 0 {
		t.Fatalf("osm count=%d want 0", n)
	}
	if n, _ := countProviderTiles(db, "amap_vector"); n != 1 {
		t.Fatalf("amap_vector count=%d want 1 (other providers untouched)", n)
	}
}
