package knowledge

import "testing"

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
