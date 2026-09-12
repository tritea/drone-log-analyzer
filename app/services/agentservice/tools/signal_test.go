package tools

import (
	"reflect"
	"testing"

	"drone-log-analyzer/app/modules/fieldstats"
)

// TestAbnRowsShape 校验越限段行列数与列型（数值在前、时刻在后），
// 防止未来插列导致与工具描述的列序静默错位。
func TestAbnRowsShape(t *testing.T) {
	deps := Deps{} // Abs=nil：时刻列为空串，不影响列型断言
	segs := []fieldstats.Segment{{
		Start: 445.2, End: 458.7,
		Duration: 13.5, Worst: 3.2, Extent: 1.2,
	}}

	rows := abnRows(deps, segs)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	want := []any{445.2, 458.7, "", "", 3.2, 1.2}
	if !reflect.DeepEqual(rows[0], want) {
		t.Errorf("row = %v, want %v", rows[0], want)
	}
	if abnRows(deps, nil) != nil {
		t.Error("abnRows(nil) should be nil")
	}
}
