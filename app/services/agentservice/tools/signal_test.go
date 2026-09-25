package tools

import (
	"reflect"
	"testing"

	"drone-log-analyzer/app/modules/fieldstats"
)

// TestExpandQueries 锁住一条查询里的多字段名展开：各字段共享该条的
// 操作/窗口，省去逐字段重复写参数。
func TestExpandQueries(t *testing.T) {
	s, e := 100.0, 200.0
	in := []signalQuery{{
		Name: "CTUN.Alt, CTUN.DAlt；GPS.NSats", Operation: "minmax", StartSec: &s, EndSec: &e,
	}, {
		Name: "GPS.VZ", Operation: "raw",
	}}
	got := expandQueries(in)
	if len(got) != 4 {
		t.Fatalf("expanded to %d queries, want 4", len(got))
	}
	wantNames := []string{"CTUN.Alt", "CTUN.DAlt", "GPS.NSats", "GPS.VZ"}
	for i, w := range wantNames {
		if got[i].Name != w {
			t.Errorf("q[%d].Name = %q, want %q", i, got[i].Name, w)
		}
	}
	// 展开后共享原条目的操作与窗口（指针也指向同一值）。
	for i := 0; i < 3; i++ {
		if got[i].Operation != "minmax" || got[i].StartSec != &s {
			t.Errorf("expanded q[%d] lost op/window", i)
		}
	}
}

// TestDedupeQueries 锁住批量查询去重：模型曾在一次 queries 里塞 23 条
// 同名查询（CTUN.Alt×23 + ATT.Yaw + GPS.Yaw），逐条执行会把相同结果
// 放大返回。同字段/同操作/同窗口/同阈值才判重；大小写与空白不敏感。
func TestDedupeQueries(t *testing.T) {
	raw := func(name string) signalQuery {
		return signalQuery{Name: name, Operation: "raw"}
	}
	var in []signalQuery
	for range 23 { // 复刻真实事故形态
		in = append(in, raw("CTUN.Alt"))
	}
	in = append(in, raw("ATT.Yaw"), raw("GPS.Yaw"))

	kept, dropped := dedupeQueries(in)
	if dropped != 22 || len(kept) != 3 {
		t.Fatalf("kept=%d dropped=%d, want 3/22", len(kept), dropped)
	}

	s, e := 100.0, 200.0
	cases := []struct {
		name string
		in   []signalQuery
		kept int
		drop int
	}{
		{"同字段同操作不同窗口", []signalQuery{
			{Name: "CTUN.Alt", Operation: "raw"},
			{Name: "CTUN.Alt", Operation: "raw", StartSec: &s, EndSec: &e},
		}, 2, 0},
		{"同字段不同操作", []signalQuery{raw("CTUN.Alt"),
			{Name: "CTUN.Alt", Operation: "minmax"}}, 2, 0},
		{"大小写与空白不敏感", []signalQuery{
			{Name: " ctun.ALT ", Operation: " RAW "}, raw("CTUN.Alt")}, 1, 1},
		{"阈值不同不判重", []signalQuery{
			{Name: "GPS.NSats", Operation: "abnormal"},
			{Name: "GPS.NSats", Operation: "abnormal", Threshold: &s}}, 2, 0},
		{"max_points 不同不判重", []signalQuery{
			{Name: "CTUN.Alt", Operation: "raw", MaxPoints: 600},
			{Name: "CTUN.Alt", Operation: "raw", MaxPoints: 2000}}, 2, 0},
	}
	for _, c := range cases {
		kept, dropped := dedupeQueries(c.in)
		if len(kept) != c.kept || dropped != c.drop {
			t.Errorf("%s: kept=%d dropped=%d, want %d/%d", c.name, len(kept), dropped, c.kept, c.drop)
		}
	}
}

// TestRLEPoints 锁住连续同值压缩：枚举/死通道类字段的长段同值压成
// [t0,值,t1]，短段与变化点保持 [t,v]。
func TestRLEPoints(t *testing.T) {
	// 30 个连续 0 + 两个 1 + 三个 5 + 单个 9。
	times := make([]float64, 0, 36)
	values := make([]float64, 0, 36)
	for i := range 30 {
		times, values = append(times, float64(i)), append(values, 0)
	}
	times, values = append(times, 30, 31), append(values, 1, 1)
	times, values = append(times, 32, 33, 34), append(values, 5, 5, 5)
	times, values = append(times, 35), append(values, 9)

	got := rlePoints(times, values)
	want := [][]float64{
		{0, 0, 29},       // 30 个 0 → 一行
		{30, 1}, {31, 1}, // 2 连发不压缩
		{32, 5, 34}, // 3 连发压缩
		{35, 9},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("rlePoints = %v, want %v", got, want)
	}
	if rlePoints(nil, nil) != nil {
		t.Error("empty input should give nil")
	}
}

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

// TestAbnLevelMergeAndCap 锁住越限段的两层防线：相邻毛刺段合并（振动
// 信号在阈值附近抖动曾切出 1600+ 段、单条结果 90k 字符），每级截断
// 到上限且总越限秒按合并后全量计。
func TestAbnLevelMergeAndCap(t *testing.T) {
	deps := Deps{}

	// 毛刺段：1.0/1.2/1.4s（间隔 0.2s ≤1s 合并）与孤立段 10s。
	blips := []fieldstats.Segment{
		{Start: 1.0, End: 1.0, Worst: 15.2, Extent: 0.2},
		{Start: 1.2, End: 1.2, Worst: 16.9, Extent: 1.9},
		{Start: 1.4, End: 1.4, Worst: 15.1, Extent: 0.1},
		{Start: 10.0, End: 12.0, Worst: 18.0, Extent: 3.0},
	}
	rows, total := abnLevel(deps, blips)
	if len(rows) != 2 {
		t.Fatalf("merged rows = %d, want 2", len(rows))
	}
	// 合并段取更恶劣的 worst/extent，首末时刻张开。
	want := []any{1.0, 1.4, "", "", 16.9, 1.9}
	if !reflect.DeepEqual(rows[0], want) {
		t.Errorf("merged row = %v, want %v", rows[0], want)
	}
	if total != 2.4 { // (1.4-1.0) + (12-10)
		t.Errorf("total = %v, want 2.4", total)
	}

	// 截断：120 个间隔 >1s 的孤立段 → 段行 50 个，总秒按全量。
	var many []fieldstats.Segment
	for i := range 120 {
		many = append(many, fieldstats.Segment{Start: float64(i) * 10, End: float64(i)*10 + 1, Worst: 20, Extent: 5})
	}
	rows, total = abnLevel(deps, many)
	if len(rows) != maxAbnSegments {
		t.Errorf("capped rows = %d, want %d", len(rows), maxAbnSegments)
	}
	if total != 120.0 {
		t.Errorf("total = %v, want 120.0（全量总秒，不随截断丢失）", total)
	}
}
