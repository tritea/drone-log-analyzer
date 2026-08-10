package logservice

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// TestCommandEntryMarshalJSON 是 MAVLink/航点命令列表"打开某些日志闪退"的回归测试。
// MAVLink 的未用 param 槽位与不适用坐标常以 NaN/±Inf 位模式出现；float64 NaN/±Inf
// 无法被 encoding/json 编码，Wails IPC 会记 FAT 导致前端进程退出。MarshalJSON 必须把
// 非有限值转成字符串标签，保证 json.Marshal 不报错。
func TestCommandEntryMarshalJSON(t *testing.T) {
	nan := math.NaN()
	c := CommandEntry{
		TimeMs:      1_000,
		Sequence:    2,
		Command:     16,
		CommandName: "MAV_CMD_NAV_WAYPOINT",
		Param1:      nan,
		Param2:      math.Inf(1),
		Param3:      math.Inf(-1),
		Param4:      0,
		Latitude:    nan,
		Longitude:   nan,
		Altitude:    50,
		Frame:       0,
		FrameName:   "GLOBAL",
	}
	b, err := json.Marshal(c)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}
	got := string(b)
	for _, want := range []string{`"param1":"NaN"`, `"param2":"Inf"`, `"param3":"-Inf"`, `"latitude":"NaN"`, `"longitude":"NaN"`, `"altitude":50`} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %s in %s", want, got)
		}
	}
}

func TestMAVLinkCommandEntryMarshalJSON(t *testing.T) {
	nan := math.NaN()
	m := MAVLinkCommandEntry{
		TimeMs:          2_000,
		TargetSystem:    1,
		TargetComponent: 1,
		SourceSystem:    255,
		SourceComponent: 1,
		Frame:           2,
		FrameName:       "MAV_FRAME_GLOBAL",
		Command:         16,
		CommandName:     "MAV_CMD_NAV_WAYPOINT",
		Param1:          nan,
		Param2:          nan,
		Param3:          nan,
		Param4:          nan,
		Latitude:        47.3,
		Longitude:       8.5,
		Altitude:        nan,
		Result:          0,
		ResultName:      "ACCEPTED",
		WasCommandLong:  false,
	}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}
	got := string(b)
	for _, want := range []string{`"param1":"NaN"`, `"param4":"NaN"`, `"altitude":"NaN"`, `"latitude":47.3`, `"resultName":"ACCEPTED"`, `"wasCommandLong":false`} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %s in %s", want, got)
		}
	}
}
