package osm

import (
	"strings"
	"testing"
)

func TestSubdomain(t *testing.T) {
	want := map[[2]int]string{{0, 0}: "a", {1, 0}: "b", {2, 0}: "c", {3, 0}: "a"}
	for k, v := range want {
		if got := letterFor(k[0], k[1]); got != v {
			t.Errorf("letterFor(%d,%d)=%q want %q", k[0], k[1], got, v)
		}
	}
}

func TestTileURL(t *testing.T) {
	z, x, y := 7, 80, 40
	url := New(nil, nil).TileURL(z, x, y)
	if !strings.HasPrefix(url, "https://a.tile.openstreetmap.org/7/80/40.png") {
		t.Errorf("unexpected OSM url: %s", url)
	}
}
