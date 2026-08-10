package tlog

import (
	"bytes"
	"math"
	"os"
	"testing"
	"time"

	"github.com/bluenviron/gomavlib/v3/pkg/dialect"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/ardupilotmega"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/common"
	"github.com/bluenviron/gomavlib/v3/pkg/frame"
	"github.com/bluenviron/gomavlib/v3/pkg/message"
	gomavtlog "github.com/bluenviron/gomavlib/v3/pkg/tlog"
)

var baseTime = time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

type testFrame struct {
	dMs           int64
	msg           message.Message
	sysID, compID byte
}

func buildTlog(t *testing.T, frames []testFrame) []byte {
	t.Helper()
	drw := &dialect.ReadWriter{Dialect: ardupilotmega.Dialect}
	if err := drw.Initialize(); err != nil {
		t.Fatalf("init dialect: %v", err)
	}
	var buf bytes.Buffer
	w := &gomavtlog.Writer{ByteWriter: &buf, DialectRW: drw}
	if err := w.Initialize(); err != nil {
		t.Fatalf("init writer: %v", err)
	}
	for _, fr := range frames {
		sysID, compID := fr.sysID, fr.compID
		if sysID == 0 {
			sysID = 1
		}
		if compID == 0 {
			compID = 1
		}

		mp := drw.GetMessage(fr.msg.GetID())
		if mp == nil {
			t.Fatalf("message id %d not in dialect", fr.msg.GetID())
		}
		v2fr := &frame.V2Frame{
			SystemID:    sysID,
			ComponentID: compID,
			Message:     mp.Write(fr.msg, true),
		}
		v2fr.Checksum = v2fr.GenerateChecksum(mp.CRCExtra())
		entry := &gomavtlog.Entry{
			Time:  baseTime.Add(time.Duration(fr.dMs) * time.Millisecond),
			Frame: v2fr,
		}
		if err := w.Write(entry); err != nil {
			t.Fatalf("write entry: %v", err)
		}
	}
	return buf.Bytes()
}

func writeTemp(t *testing.T, data []byte) string {
	t.Helper()
	f, err := os.CreateTemp("", "tlog_test_*.tlog")
	if err != nil {
		t.Fatalf("create temp: %v", err)
	}
	if _, err := f.Write(data); err != nil {
		t.Fatalf("write temp: %v", err)
	}
	f.Close()
	t.Cleanup(func() { os.Remove(f.Name()) })
	return f.Name()
}

func TestMessageName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"MessageAttitude", "ATTITUDE"},
		{"MessageGlobalPositionInt", "GLOBAL_POSITION_INT"},
		{"MessageGpsRawInt", "GPS_RAW_INT"},
		{"MessageVfrHud", "VFR_HUD"},
		{"MessageRcChannels", "RC_CHANNELS"},
		{"MessageServoOutputRaw", "SERVO_OUTPUT_RAW"},
		{"MessageSysStatus", "SYS_STATUS"},
		{"MessageBatteryStatus", "BATTERY_STATUS"},
	}
	for _, c := range cases {
		if got := formatNameFromMessage(c.in); got != c.want {
			t.Errorf("formatNameFromMessage(%q)=%q want %q", c.in, got, c.want)
		}
	}
}

func TestMavTypeToVehicle(t *testing.T) {
	cases := []struct {
		t                            common.MAV_TYPE
		vehicle, frameName, airframe string
	}{
		{common.MAV_TYPE_QUADROTOR, "Copter", "QUADROTOR", "multirotor"},
		{common.MAV_TYPE_HEXAROTOR, "Copter", "HEXAROTOR", "multirotor"},
		{common.MAV_TYPE_TRICOPTER, "Copter", "TRICOPTER", "multirotor"},
		{common.MAV_TYPE_FIXED_WING, "Plane", "FIXED_WING", ""},
		{common.MAV_TYPE_GROUND_ROVER, "Rover", "ROVER", ""},
		{common.MAV_TYPE_SUBMARINE, "Sub", "SUBMARINE", ""},
		{common.MAV_TYPE_VTOL_TILTROTOR, "Plane", "VTOL", "vtol"},
	}
	for _, c := range cases {
		v, fr, af := decodeVehicle(c.t)
		if v != c.vehicle || fr != c.frameName || af != c.airframe {
			t.Errorf("decodeVehicle(%v)=(%q,%q,%q) want (%q,%q,%q)",
				c.t, v, fr, af, c.vehicle, c.frameName, c.airframe)
		}
	}
}

func TestModeName(t *testing.T) {
	if got := flightModeLabel("Copter", 4); got != "GUIDED" {
		t.Errorf("copter mode 4 = %q want GUIDED", got)
	}
	if got := flightModeLabel("Plane", 11); got != "RTL" {
		t.Errorf("plane mode 11 = %q want RTL", got)
	}
}

func TestParseEndToEnd(t *testing.T) {
	frames := []testFrame{
		{0, &ardupilotmega.MessageHeartbeat{
			Type: common.MAV_TYPE_QUADROTOR, Autopilot: common.MAV_AUTOPILOT_ARDUPILOTMEGA,
			BaseMode: 0, CustomMode: 0, SystemStatus: 4, MavlinkVersion: 3}, 0, 0},
		{0, &ardupilotmega.MessageAttitude{
			TimeBootMs: 0, Roll: 0.1, Pitch: 0.2, Yaw: 0.3, Rollspeed: 0.01, Pitchspeed: 0.02, Yawspeed: 0.03}, 0, 0},
		{100, &ardupilotmega.MessageAttitude{
			TimeBootMs: 100, Roll: 0.15, Pitch: 0.25, Yaw: 0.35, Rollspeed: 0.01, Pitchspeed: 0.02, Yawspeed: 0.03}, 0, 0},
		{200, &ardupilotmega.MessageAttitude{
			TimeBootMs: 200, Roll: 0.2, Pitch: 0.3, Yaw: 0.4, Rollspeed: 0.01, Pitchspeed: 0.02, Yawspeed: 0.03}, 0, 0},
		{50, &ardupilotmega.MessageGlobalPositionInt{
			TimeBootMs: 50, Lat: int32(37 * 1e7), Lon: int32(-122 * 1e7), Alt: 10000, RelativeAlt: 5000,
			Vx: 0, Vy: 0, Vz: 0, Hdg: 0}, 0, 0},
		{30, &ardupilotmega.MessageStatustext{Severity: 6, Text: "test message"}, 0, 0},
		{40, &ardupilotmega.MessageParamValue{ParamId: "ANGLE_MAX", ParamValue: 5.0,
			ParamType: 9, ParamCount: 1, ParamIndex: 0}, 0, 0},
		{60, &ardupilotmega.MessageMissionItemInt{
			TargetSystem: 1, TargetComponent: 1, Seq: 0, Frame: 0, Command: 16,
			Current: 1, Autocontinue: 1, Param1: 0, Param2: 0, Param3: 0, Param4: 0,
			X: int32(37 * 1e7), Y: int32(-122 * 1e7), Z: 10, MissionType: 0}, 0, 0},
		{70, &ardupilotmega.MessageBatteryStatus{
			Id: 0, BatteryFunction: 0, Type: 0, Temperature: 0,
			Voltages:       [10]uint16{12000, 12000, 12000, 12000, 65535, 65535, 65535, 65535, 65535, 65535},
			CurrentBattery: 0, CurrentConsumed: 0, EnergyConsumed: 0, BatteryRemaining: 0,
			VoltagesExt: [4]uint16{65535, 65535, 65535, 65535}}, 0, 0},
		{300, &ardupilotmega.MessageHeartbeat{
			Type: common.MAV_TYPE_QUADROTOR, Autopilot: common.MAV_AUTOPILOT_ARDUPILOTMEGA,
			BaseMode: 0, CustomMode: 4, SystemStatus: 4, MavlinkVersion: 3}, 0, 0},
	}
	data := buildTlog(t, frames)
	path := writeTemp(t, data)

	lf, err := tlogBackend{}.Parse(path)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}

	if lf.Summary.Format != "tlog" {
		t.Errorf("Format=%q want tlog", lf.Summary.Format)
	}
	if lf.Summary.VehicleType != "Copter" {
		t.Errorf("VehicleType=%q want Copter", lf.Summary.VehicleType)
	}
	if lf.Summary.Frame != "QUADROTOR" {
		t.Errorf("Frame=%q want QUADROTOR", lf.Summary.Frame)
	}
	if lf.Summary.Airframe != "multirotor" {
		t.Errorf("Airframe=%q want multirotor", lf.Summary.Airframe)
	}
	if lf.Summary.FirmwareVersion != "ArduPilot" {
		t.Errorf("FirmwareVersion=%q want ArduPilot", lf.Summary.FirmwareVersion)
	}
	if !lf.Summary.HasUTC {
		t.Errorf("HasUTC=false want true")
	}
	if lf.Summary.DurationSecs <= 0 {
		t.Errorf("DurationSecs=%v want >0", lf.Summary.DurationSecs)
	}

	cd := lf.GetCurveData("ATTITUDE", "Roll", "")
	if cd == nil {
		t.Fatalf("ATTITUDE.Roll curve missing")
	}
	vals := lf.CurveValues(cd)
	if len(vals) != 3 {
		t.Fatalf("ATTITUDE.Roll count=%d want 3", len(vals))
	}
	r2d := 180.0 / math.Pi
	wantRoll := []float64{0.1 * r2d, 0.15 * r2d, 0.2 * r2d}
	for i, v := range vals {
		if math.Abs(v-wantRoll[i]) > 1e-3 {
			t.Errorf("ATTITUDE.Roll[%d]=%v want %v (deg)", i, v, wantRoll[i])
		}
	}

	lat := lf.GetCurveData("GLOBAL_POSITION_INT", "Lat", "")
	if lat == nil {
		t.Fatalf("GLOBAL_POSITION_INT.Lat curve missing")
	}
	latVals := lf.CurveValues(lat)
	if len(latVals) != 1 || math.Abs(latVals[0]-37.0) > 1e-6 {
		t.Errorf("Lat=%v want 37.0", latVals)
	}

	found := false
	for _, msg := range lf.Messages {
		if msg == "test message" {
			found = true
		}
	}
	if !found {
		t.Errorf("STATUSTEXT 'test message' not in Messages: %v", lf.Messages)
	}

	if v, ok := lf.Parameters["ANGLE_MAX"]; !ok || math.Abs(v-5.0) > 1e-6 {
		t.Errorf("Parameters[ANGLE_MAX]=%v ok=%v want 5.0", v, ok)
	}

	v0 := lf.GetCurveData("BATTERY_STATUS", "Voltages[0]", "")
	if v0 == nil {
		t.Fatalf("BATTERY_STATUS.Voltages[0] curve missing (array not expanded?)")
	}
	if vv := lf.CurveValues(v0); len(vv) != 1 || vv[0] != 12000 {
		t.Errorf("Voltages[0]=%v want 12000", vv)
	}
	if lf.GetCurveData("BATTERY_STATUS", "Voltages[4]", "") == nil {
		t.Errorf("Voltages[4] curve missing")
	}
	if lf.GetCurveData("BATTERY_STATUS", "VoltagesExt[0]", "") == nil {
		t.Errorf("VoltagesExt[0] curve missing (VoltagesExt array not expanded?)")
	}

	if len(lf.Commands) != 1 {
		t.Fatalf("Commands len=%d want 1", len(lf.Commands))
	}
	c := lf.Commands[0]
	if c.Command != 16 || c.Sequence != 0 {
		t.Errorf("cmd Command=%d Seq=%d want 16/0", c.Command, c.Sequence)
	}
	if math.Abs(c.Latitude-37.0) > 1e-6 || math.Abs(c.Longitude-(-122.0)) > 1e-6 || math.Abs(c.Altitude-10) > 1e-6 {
		t.Errorf("cmd lat=%v lon=%v alt=%v want 37/-122/10", c.Latitude, c.Longitude, c.Altitude)
	}

	if len(lf.ModeChanges) != 1 {
		t.Fatalf("ModeChanges len=%d want 1: %+v", len(lf.ModeChanges), lf.ModeChanges)
	}
	for _, mc := range lf.ModeChanges {
		if mc.Mode != "GUIDED" {
			t.Errorf("mode change = %q want GUIDED", mc.Mode)
		}
	}

	if _, ok := lf.FormatsByName["ATTITUDE"]; !ok {
		t.Errorf("FormatsByName missing ATTITUDE")
	}
}
