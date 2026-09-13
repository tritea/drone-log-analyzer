package tools

import (
	"reflect"
	"testing"

	"drone-log-analyzer/app/modules/knowledge"
)

func TestTrimRow(t *testing.T) {
	cases := []struct {
		name string
		in   []any
		want []any
	}{
		{"无尾nil", []any{"a", 1, ""}, []any{"a", 1, ""}},
		{"裁尾nil", []any{"a", 1, nil, nil}, []any{"a", 1}},
		{"中段nil保留", []any{"a", nil, "c"}, []any{"a", nil, "c"}},
		{"全nil", []any{nil, nil}, []any{}},
		{"空行", []any{}, []any{}},
	}
	for _, c := range cases {
		if got := trimRow(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: trimRow = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestRowCellHelpers(t *testing.T) {
	v := 1.5
	if got := ptrVal(&v); got != 1.5 {
		t.Errorf("ptrVal = %v, want 1.5", got)
	}
	if got := ptrVal(nil); got != nil {
		t.Errorf("ptrVal(nil) = %v, want nil", got)
	}
	if got := strOrNil(""); got != nil {
		t.Errorf("strOrNil(\"\") = %v, want nil", got)
	}
	if got := strOrNil("x"); got != "x" {
		t.Errorf("strOrNil(\"x\") = %v, want x", got)
	}
	if got := strsOrNil(nil); got != nil {
		t.Errorf("strsOrNil(nil) = %v, want nil", got)
	}
	if got := strsOrNil([]string{"a"}); !reflect.DeepEqual(got, any([]string{"a"})) {
		t.Errorf("strsOrNil = %v, want [a]", got)
	}
}

func TestThrRows(t *testing.T) {
	if got := thrRows(nil); got != nil {
		t.Errorf("thrRows(nil) = %v, want nil", got)
	}
	got := thrRows([]knowledge.Threshold{{Level: "warning", Op: "lt", Value: 8}})
	want := [][]any{{"warning", "lt", float64(8)}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("thrRows = %v, want %v", got, want)
	}
}

func TestNameOrID(t *testing.T) {
	if got := nameOrID("LAND", 21); got != "LAND" {
		t.Errorf("nameOrID = %q, want LAND", got)
	}
	if got := nameOrID("", 176); got != "#176" {
		t.Errorf("nameOrID = %q, want #176", got)
	}
}
