package tlog

import (
	"math"
	"reflect"
	"testing"
)

func TestUnitScaleFor(t *testing.T) {
	tests := []struct {
		name string
		kind reflect.Kind
		want float64
	}{
		// 整数经纬度：1e-7 度。
		{"Lat", reflect.Int32, 1e-7},
		{"Lon", reflect.Uint32, 1e-7},
		{"LatInt", reflect.Int32, 1e-7},
		{"Longitude", reflect.Int32, 1e-7},
		{"Latitude", reflect.Float64, 1}, // 浮点经纬度已是度
		// 整数高度：毫米 → 米。
		{"Alt", reflect.Int32, 1e-3},
		{"AltitudeAmsl", reflect.Int32, 1e-3},
		{"AltitudeRelative", reflect.Int32, 1e-3},
		{"BottomClearance", reflect.Int32, 1e-3},
		{"Alt", reflect.Float32, 1}, // VFR_HUD.Alt 浮点已是米
		// 厘单位（×100 线上编码）整数：0.01。
		{"Vel", reflect.Uint16, 0.01},
		{"Vx", reflect.Int16, 0.01},
		{"Vz", reflect.Int32, 0.01},
		{"Airspeed", reflect.Int16, 0.01},
		{"HAcc", reflect.Uint32, 0.01},
		{"CurrentBattery", reflect.Int32, 0.01},
		{"CurrentDistance", reflect.Uint16, 0.01},
		// 同名浮点不受厘单位规则影响（已是物理单位）。
		{"Vx", reflect.Float32, 1},
		// 弧度姿态角 → 度。
		{"Roll", reflect.Float32, 180 / math.Pi},
		{"Yawspeed", reflect.Float64, 180 / math.Pi},
		// 无规则命中。
		{"Throttle", reflect.Uint16, 1},
	}
	for _, tt := range tests {
		if got := unitScaleFor(tt.name, tt.kind); got != tt.want {
			t.Errorf("unitScaleFor(%q, %v) = %v, want %v", tt.name, tt.kind, got, tt.want)
		}
	}
}

func TestFormatNameFromMessage(t *testing.T) {
	tests := []struct{ in, want string }{
		{"MessageAttitude", "ATTITUDE"},
		{"MessageGpsRawInt", "GPS_RAW_INT"},
		{"MessageGlobalPositionInt", "GLOBAL_POSITION_INT"},
		{"MessageEkfStatusReport", "EKF_STATUS_REPORT"},
		{"MessageServoOutputRaw", "SERVO_OUTPUT_RAW"},
	}
	for _, tt := range tests {
		if got := formatNameFromMessage(tt.in); got != tt.want {
			t.Errorf("formatNameFromMessage(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
