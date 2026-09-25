package jsonstore

import (
	"strings"
	"testing"

	"drone-log-analyzer/app/services/configservice"
)

func TestCleanTileset(t *testing.T) {
	cases := []struct {
		name string
		in   configservice.Tileset
		want configservice.Tileset
	}{
		{
			name: "defaults scale to 1, trims fields",
			in:   configservice.Tileset{Name: "  t  ", Dir: "  /p/t  ", Scale: 0},
			want: configservice.Tileset{Name: "t", Dir: "/p/t", Scale: 1},
		},
		{
			name: "keeps url and height offset",
			in:   configservice.Tileset{Name: "t", Url: "https://x/tileset.json", HeightOffset: 12.5, Scale: 2},
			want: configservice.Tileset{Name: "t", Url: "https://x/tileset.json", HeightOffset: 12.5, Scale: 2},
		},
		{
			name: "passes through manual lon/lat untouched",
			in:   configservice.Tileset{Name: "t", Dir: "/p/t", Lon: 114.0572, Lat: 22.5443, Scale: 1.5},
			want: configservice.Tileset{Name: "t", Dir: "/p/t", Lon: 114.0572, Lat: 22.5443, Scale: 1.5},
		},
		{
			name: "passes through rotation angles untouched",
			in:   configservice.Tileset{Name: "t", Dir: "/p/t", Yaw: 12.5, Pitch: -3, Roll: 1.5, Scale: 1},
			want: configservice.Tileset{Name: "t", Dir: "/p/t", Yaw: 12.5, Pitch: -3, Roll: 1.5, Scale: 1},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := cleanTileset(tc.in)
			if got.Name != tc.want.Name || got.Dir != tc.want.Dir || got.Url != tc.want.Url ||
				got.Scale != tc.want.Scale || got.HeightOffset != tc.want.HeightOffset ||
				got.Lon != tc.want.Lon || got.Lat != tc.want.Lat ||
				got.Yaw != tc.want.Yaw || got.Pitch != tc.want.Pitch || got.Roll != tc.want.Roll {
				t.Errorf("cleanTileset = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestValidateTilesetName(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		wantErr bool
	}{
		{"empty", "", true},
		{"forward slash", "a/b", true},
		{"back slash", "a\\b", true},
		{"control char", "a\nb", true},
		{"ok ascii", "camp-north", false},
		{"ok chinese", "北区测图", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateTilesetName(tc.in)
			if tc.wantErr && err == nil {
				t.Errorf("expected error for %q, got nil", tc.in)
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error for %q: %v", tc.in, err)
			}
		})
	}
	t.Run("too long", func(t *testing.T) {
		if err := validateTilesetName(strings.Repeat("a", 49)); err == nil {
			t.Error("expected error for 49-char name, got nil")
		}
	})
}
