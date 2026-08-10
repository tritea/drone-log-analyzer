package jsonstore

import (
	"strings"
	"testing"

	"drone-log-analyzer/app/services/configservice"
)

func TestCleanModelGroup(t *testing.T) {
	cases := []struct {
		name string
		in   configservice.ModelGroup
		want configservice.ModelGroup
	}{
		{
			name: "defaults rows/cols/spacing/scale",
			in:   configservice.ModelGroup{Name: "g", Rows: 0, Cols: 0, Spacing: 0, Scale: 0},
			want: configservice.ModelGroup{Name: "g", Rows: 1, Cols: 1, Spacing: 10, Scale: 1},
		},
		{
			name: "filters out-of-range tiles",
			in: configservice.ModelGroup{Name: "g", Rows: 2, Cols: 2, Spacing: 5, Scale: 1,
				Tiles: []configservice.ModelGroupTile{
					{Row: 0, Col: 0, File: "a.glb"},
					{Row: 1, Col: 1, File: "b.glb"},
					{Row: 2, Col: 0, File: "out.glb"},
					{Row: 0, Col: 5, File: "out2.glb"},
				}},
			want: configservice.ModelGroup{Name: "g", Rows: 2, Cols: 2, Spacing: 5, Scale: 1,
				Tiles: []configservice.ModelGroupTile{
					{Row: 0, Col: 0, File: "a.glb"},
					{Row: 1, Col: 1, File: "b.glb"},
				}},
		},
		{
			name: "filters empty-file and duplicate tiles",
			in: configservice.ModelGroup{Name: "g", Rows: 1, Cols: 1, Spacing: 5, Scale: 1,
				Tiles: []configservice.ModelGroupTile{
					{Row: 0, Col: 0, File: "a.glb"},
					{Row: 0, Col: 0, File: "dup.glb"},
					{Row: 0, Col: 0, File: ""},
				}},
			want: configservice.ModelGroup{Name: "g", Rows: 1, Cols: 1, Spacing: 5, Scale: 1,
				Tiles: []configservice.ModelGroupTile{
					{Row: 0, Col: 0, File: "a.glb"},
				}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := cleanModelGroup(tc.in)
			if got.Rows != tc.want.Rows || got.Cols != tc.want.Cols || got.Spacing != tc.want.Spacing || got.Scale != tc.want.Scale {
				t.Errorf("basic fields = rows=%d cols=%d spacing=%v scale=%v, want %+v", got.Rows, got.Cols, got.Spacing, got.Scale, tc.want)
			}
			if len(got.Tiles) != len(tc.want.Tiles) {
				t.Fatalf("tiles len = %d, want %d (%+v)", len(got.Tiles), len(tc.want.Tiles), got.Tiles)
			}
			for i := range got.Tiles {
				if got.Tiles[i] != tc.want.Tiles[i] {
					t.Errorf("tile[%d] = %+v, want %+v", i, got.Tiles[i], tc.want.Tiles[i])
				}
			}
		})
	}
}

func TestValidateModelGroupName(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		wantErr bool
	}{
		{"empty", "", true},
		{"hash separator", "g#1", true},
		{"anchor prefix", "__grp_x", true},
		{"control char", "a\nb", true},
		{"ok chinese", "组1", false},
		{"ok ascii", "survey-north", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateModelGroupName(tc.in)
			if tc.wantErr && err == nil {
				t.Errorf("expected error for %q, got nil", tc.in)
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error for %q: %v", tc.in, err)
			}
		})
	}
	t.Run("too long", func(t *testing.T) {
		if err := validateModelGroupName(strings.Repeat("a", 49)); err == nil {
			t.Error("expected error for 49-char name, got nil")
		}
	})
}
