package bing

import (
	"strings"
	"testing"
)

func TestQuadKey(t *testing.T) {
	cases := []struct {
		z, x, y int
		want    string
	}{
		{1, 0, 0, "0"}, {1, 1, 0, "1"}, {1, 0, 1, "2"}, {1, 1, 1, "3"},
	}
	for _, c := range cases {
		if got := encodeQuadKey(c.z, c.x, c.y); got != c.want {
			t.Errorf("encodeQuadKey(%d,%d,%d)=%q want %q", c.z, c.x, c.y, got, c.want)
		}
	}
}

func TestTileURL(t *testing.T) {
	url := New(nil, nil).TileURL(7, 80, 40)
	if !strings.Contains(url, "virtualearth.net/comp/ch/") {
		t.Errorf("unexpected Bing url: %s", url)
	}
}
