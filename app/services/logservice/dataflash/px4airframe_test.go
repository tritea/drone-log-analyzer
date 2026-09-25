package dataflash

import (
	"testing"

	logparser "drone-log-analyzer/app/modules/parser"
)

func TestClassifyPX4Airframe(t *testing.T) {
	tests := []struct {
		id           int
		wantFrame    string
		wantAirframe string
	}{

		{4001, "QUADROTOR", "multirotor"},
		{4041, "QUADROTOR", "multirotor"},
		{4500, "QUADROTOR", "multirotor"},
		{4901, "QUADROTOR", "multirotor"},
		{5001, "QUADROTOR", "multirotor"},

		{6001, "HEXAROTOR", "multirotor"},
		{7001, "HEXAROTOR", "multirotor"},
		{11001, "HEXAROTOR", "multirotor"},

		{8001, "OCTOROTOR", "multirotor"},
		{9001, "OCTOROTOR", "multirotor"},
		{12001, "OCTOROTOR", "multirotor"},

		{2100, "", "vtol"},
		{2106, "", "vtol"},
		{3000, "", "vtol"},

		{13000, "", "vtol"},
		{13030, "", "vtol"},
		{13100, "", "vtol"},
		{13200, "", "vtol"},

		{14001, "QUADROTOR", "multirotor"},
		{16001, "QUADROTOR", "multirotor"},
		{24001, "QUADROTOR", "multirotor"},
		{2500, "QUADROTOR", "multirotor"},
		{17002, "QUADROTOR", "multirotor"},
		{50000, "QUADROTOR", "multirotor"},
		{1001, "QUADROTOR", "multirotor"},
		{0, "QUADROTOR", "multirotor"},
	}
	for _, tt := range tests {
		frame, airframe := classifyPX4Airframe(tt.id)
		if frame != tt.wantFrame || airframe != tt.wantAirframe {
			t.Errorf("classifyPX4Airframe(%d) = (%q, %q), want (%q, %q)",
				tt.id, frame, airframe, tt.wantFrame, tt.wantAirframe)
		}
	}
}

func TestClassifyPX4FromLog(t *testing.T) {
	t.Run("hexa_from_param", func(t *testing.T) {
		lg := &logparser.LogFile{Parameters: map[string]float64{"SYS_AUTOSTART": 6001}}
		if frame, airframe := classifyPX4FromLog(lg); frame != "HEXAROTOR" || airframe != "multirotor" {
			t.Errorf("got (%q, %q), want (HEXAROTOR, multirotor)", frame, airframe)
		}
	})
	t.Run("missing_param_defaults_quad", func(t *testing.T) {
		lg := &logparser.LogFile{Parameters: map[string]float64{}}
		if frame, airframe := classifyPX4FromLog(lg); frame != "QUADROTOR" || airframe != "multirotor" {
			t.Errorf("got (%q, %q), want (QUADROTOR, multirotor)", frame, airframe)
		}
	})
	t.Run("nil_param_map_defaults_quad", func(t *testing.T) {
		lg := &logparser.LogFile{}
		if frame, airframe := classifyPX4FromLog(lg); frame != "QUADROTOR" || airframe != "multirotor" {
			t.Errorf("got (%q, %q), want (QUADROTOR, multirotor)", frame, airframe)
		}
	})
}
