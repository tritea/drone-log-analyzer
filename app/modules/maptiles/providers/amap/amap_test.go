package amap

import (
	"strings"
	"testing"
)

func TestSubdomain(t *testing.T) {
	cases := []struct {
		x, y, want int
	}{
		{0, 0, 1}, {1, 0, 3}, {0, 1, 2}, {1, 1, 4}, {2, 2, 3},
	}
	for _, c := range cases {
		if got := hostIndex(c.x, c.y); got != c.want {
			t.Errorf("hostIndex(%d,%d)=%d want %d", c.x, c.y, got, c.want)
		}
	}
}

func TestVectorTileURL(t *testing.T) {

	url := NewVector(nil, nil).TileURL(7, 80, 40)
	if !strings.Contains(url, "webrd01.is.autonavi.com") {
		t.Errorf("unexpected amap vector url: %s", url)
	}
}

func TestRoadTileURL(t *testing.T) {
	url := NewRoad(nil, nil).TileURL(7, 80, 40)
	if !strings.Contains(url, "webst01.is.autonavi.com") {
		t.Errorf("unexpected amap road url: %s", url)
	}
}
