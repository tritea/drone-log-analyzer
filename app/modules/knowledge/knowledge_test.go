package knowledge

import (
	"slices"
	"strings"
	"testing"
)

func TestForFormat(t *testing.T) {
	if err := LoadError(); err != nil {
		t.Fatalf("load error: %v", err)
	}
	apm := ForFormat("apm")
	if apm == nil || len(apm.Groups) == 0 {
		t.Fatal("apm knowledge base empty")
	}
	if _, ok := apm.Groups["GPS"]; !ok {
		t.Fatal("apm KB missing GPS group")
	}
	fm, ok := apm.Field("GPS", "NSats")
	if !ok {
		t.Fatal("apm KB missing GPS.NSats")
	}
	if len(fm.Thresholds) != 2 || fm.Thresholds[0].Op != "lt" || fm.Thresholds[0].Value != 8 {
		t.Errorf("NSats thresholds = %+v", fm.Thresholds)
	}

	if got := ForFormat("nope"); len(got.Groups) != 0 {
		t.Errorf("unknown format should yield empty KB, got %d groups", len(got.Groups))
	}
}

// TestEnumValuesCarried GPS 定位状态在各格式使用不同刻度（dataflash 0~8、
// tlog 0~6、ulog 0~5），枚举取值必须随字段下发（values），否则模型会拿
// 训练记忆里其他体系的枚举表误读。
func TestEnumValuesCarried(t *testing.T) {
	cases := []struct{ format, group, field string }{
		{"apm", "GPS", "Status"},
		{"tlog", "GPS_RAW_INT", "FixType"},
		{"ulog", "vehicle_gps_position", "fix_type"},
	}
	for _, c := range cases {
		fm, ok := ForFormat(c.format).Field(c.group, c.field)
		if !ok {
			t.Errorf("%s KB missing %s.%s", c.format, c.group, c.field)
			continue
		}
		if len(fm.Values) < 4 {
			t.Errorf("%s %s.%s values = %v, want enum scale (>=4 项)", c.format, c.group, c.field, fm.Values)
		}
		// 关键锚点：RTK 固定解的数值因格式而异，逐库校验防串。
		want := map[string]string{"apm": "6=RTK固定", "tlog": "6=RTK固定", "ulog": "5=RTK 固定"}[c.format]
		if !slices.Contains(fm.Values, want) {
			t.Errorf("%s %s.%s values 缺 %q（刻度串库）: %v", c.format, c.group, c.field, want, fm.Values)
		}
	}
}

func TestGroupInstanceFallback(t *testing.T) {
	apm := ForFormat("apm")
	if _, ok := apm.Groups["GPS2"]; ok {
		t.Fatal("GPS2 should not exist as explicit entry")
	}
	if apm.Group("GPS2") == nil {
		t.Fatal("GPS2 should fall back to GPS")
	}
	if apm.Group("NOPE") != nil {
		t.Fatal("NOPE should be nil")
	}
}

func TestTlogKnowledge(t *testing.T) {
	tlog := ForFormat("tlog")
	if len(tlog.Groups) < 30 {
		t.Fatalf("tlog KB too small: %d groups", len(tlog.Groups))
	}
	// 核心消息条目与字段名（须与 gomavlib 解析产出的列名一致）。
	if _, ok := tlog.Field("GPS_RAW_INT", "SatellitesVisible"); !ok {
		t.Error("tlog KB missing GPS_RAW_INT.SatellitesVisible")
	}
	if _, ok := tlog.Field("GLOBAL_POSITION_INT", "RelativeAlt"); !ok {
		t.Error("tlog KB missing GLOBAL_POSITION_INT.RelativeAlt")
	}
	if _, ok := tlog.Field("EKF_STATUS_REPORT", "VelocityVariance"); !ok {
		t.Error("tlog KB missing EKF_STATUS_REPORT.VelocityVariance")
	}
	// 多实例回退：SCALED_IMU2 → SCALED_IMU。
	if _, ok := tlog.Groups["SCALED_IMU2"]; ok {
		t.Error("SCALED_IMU2 should not be an explicit entry")
	}
	if _, ok := tlog.Field("SCALED_IMU2", "Xacc"); !ok {
		t.Error("SCALED_IMU2 should fall back to SCALED_IMU")
	}
	// 固件差异描述：EKF_STATUS_REPORT 应标注 ArduPilot 专用。
	if gm := tlog.Group("EKF_STATUS_REPORT"); gm == nil || !strings.Contains(gm.Description, "ArduPilot 专用") {
		t.Errorf("EKF_STATUS_REPORT description should mark ArduPilot-only, got %v", gm)
	}
}

func TestUlogKnowledge(t *testing.T) {
	ulog := ForFormat("ulog")
	if len(ulog.Groups) < 20 {
		t.Fatalf("ulog KB too small: %d groups", len(ulog.Groups))
	}
	// 数组展开字段名（带下标）。
	if _, ok := ulog.Field("sensor_combined", "accelerometer_m_s2[2]"); !ok {
		t.Error("ulog KB missing sensor_combined.accelerometer_m_s2[2]")
	}
	if _, ok := ulog.Field("vehicle_attitude", "q[0]"); !ok {
		t.Error("ulog KB missing vehicle_attitude.q[0]")
	}
	if _, ok := ulog.Field("battery_status", "voltage_v"); !ok {
		t.Error("ulog KB missing battery_status.voltage_v")
	}
	if _, ok := ulog.Field("estimator_innovations", "gps_hvel_innov"); !ok {
		t.Error("ulog KB missing estimator_innovations.gps_hvel_innov")
	}
	// 新旧话题双注册。
	if ulog.Group("ekf2_innovations") == nil {
		t.Error("ulog KB missing legacy ekf2_innovations topic")
	}
	// 阈值格式。
	fm, ok := ulog.Field("vehicle_gps_position", "satellites_used")
	if !ok || len(fm.Thresholds) != 2 || fm.Thresholds[0].Op != "lt" || fm.Thresholds[0].Value != 8 {
		t.Errorf("satellites_used thresholds = %+v", fm.Thresholds)
	}
}

func TestClass(t *testing.T) {
	tests := []struct {
		veh, frame, air string
		want            VehicleClass
	}{
		{"Copter", "QUADROTOR", "", ClassMultirotor},
		{"Copter", "", "multirotor", ClassMultirotor},
		{"Plane", "", "", ClassFixedWing},
		{"", "QuadPlane", "", ClassVtol},
		{"", "HELI_08_QUAD", "", ClassHelicopter},
		{"Rover", "", "", ClassRover},
		{"Sub", "", "", ClassSub},
		{"", "", "", ClassUnknown},
	}
	for _, tt := range tests {
		if got := Class(tt.veh, tt.frame, tt.air); got != tt.want {
			t.Errorf("Class(%q,%q,%q) = %v, want %v", tt.veh, tt.frame, tt.air, got, tt.want)
		}
	}
}

func TestFilterGroup(t *testing.T) {
	apm := ForFormat("apm")
	// CTUN.SAlt appliesTo 多旋翼系：fixedwing 应被剔除。
	copter := FilterGroup(apm.Group("CTUN"), ClassMultirotor)
	plane := FilterGroup(apm.Group("CTUN"), ClassFixedWing)
	if _, ok := copter.Fields["SAlt"]; !ok {
		t.Error("multirotor should see CTUN.SAlt")
	}
	if _, ok := plane.Fields["SAlt"]; ok {
		t.Error("fixedwing should NOT see CTUN.SAlt")
	}
	// unknown 机型不过滤。
	unknown := FilterGroup(apm.Group("CTUN"), ClassUnknown)
	if _, ok := unknown.Fields["SAlt"]; !ok {
		t.Error("unknown class should see everything")
	}
	if FilterGroup(nil, ClassMultirotor) != nil {
		t.Error("nil group should stay nil")
	}
}

func TestForParams(t *testing.T) {
	if err := LoadError(); err != nil {
		t.Fatalf("load error: %v", err)
	}
	apm := ForParams("apm")
	if len(apm.Params) < 1000 {
		t.Fatalf("apm params too small: %d", len(apm.Params))
	}
	if pm, ok := apm.Lookup("MOT_THST_HOVER"); ok {
		if pm.Description == "" {
			t.Error("MOT_THST_HOVER missing description")
		}
	} else {
		t.Error("apm params missing MOT_THST_HOVER")
	}
	// 机型归类：悬停油门不应只属于 sub。
	if pm, ok := apm.Lookup("MOT_THST_HOVER"); ok && !Applies(pm.AppliesTo, ClassMultirotor) {
		t.Errorf("MOT_THST_HOVER appliesTo = %v, multirotor missing", pm.AppliesTo)
	}
	// Q_ 前缀（QuadPlane）应只属于 vtol。
	if pm, ok := apm.Lookup("Q_ENABLE"); ok && (len(pm.AppliesTo) != 1 || pm.AppliesTo[0] != "vtol") {
		t.Errorf("Q_ENABLE appliesTo = %v, want [vtol]", pm.AppliesTo)
	}

	ulog := ForParams("ulog")
	if pm, ok := ulog.Lookup("MC_ROLLRATE_P"); ok {
		if pm.Default == nil || *pm.Default != 0.15 {
			t.Errorf("MC_ROLLRATE_P default = %v, want 0.15", pm.Default)
		}
	} else {
		t.Error("ulog params missing MC_ROLLRATE_P")
	}

	// tlog = apm + ulog 合并。
	tlog := ForParams("tlog")
	if _, ok := tlog.Lookup("MOT_THST_HOVER"); !ok {
		t.Error("tlog merged params missing MOT_THST_HOVER (apm side)")
	}
	if _, ok := tlog.Lookup("MC_ROLLRATE_P"); !ok {
		t.Error("tlog merged params missing MC_ROLLRATE_P (ulog side)")
	}

	// 前缀分组。
	if got := ParamGroup("EK3_SRC1_POSXY"); got != "EK3" {
		t.Errorf("ParamGroup = %q, want EK3", got)
	}
	if _, ok := ForParams("apm").ParamGroupMeta("MOT"); !ok {
		t.Error("MOT group meta missing")
	}
	if got := ForParams("nope"); len(got.Params) != 0 {
		t.Errorf("unknown format should yield empty param KB, got %d", len(got.Params))
	}
}
