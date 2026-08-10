package dataflash

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"strings"
	"testing"

	"drone-log-analyzer/app/modules/parser"
)

func newTestLogFile() *parser.LogFile {
	return parser.NewLogFile("test", "apm")
}

func TestTextParserCreatesInstanceCurveTypes(t *testing.T) {
	lf := newTestLogFile()
	ingestTextLine(lf, "FMT, 1, 24, GPS, QBIIB, TimeUS,I,GMS,GWk,Alt", 1)
	ingestTextLine(lf, "FMT, 2, 16, BAT, IBf, TimeMS,Instance,Volt", 2)

	ingestTextLine(lf, "GPS, 1000000, 0, 129600000, 2200, 42", 3)
	ingestTextLine(lf, "GPS, 1100000, 1, 129600100, 2200, 43", 4)
	ingestTextLine(lf, "BAT, 1000, 0, 12.1", 5)
	ingestTextLine(lf, "BAT, 1000, 1, 12.2", 6)

	if _, ok := lf.Curves["GPS1"]; !ok {
		t.Fatalf("missing GPS1 instance curves")
	}
	if _, ok := lf.Curves["GPS2"]; !ok {
		t.Fatalf("missing GPS2 instance curves")
	}
	if _, ok := lf.Curves["BAT1"]; !ok {
		t.Fatalf("missing BAT1 instance curves")
	}
	if _, ok := lf.Curves["BAT2"]; !ok {
		t.Fatalf("missing BAT2 instance curves")
	}
	if got := lf.Curves["GPS1"]["Alt"].Values()[0]; got != 42 {
		t.Fatalf("GPS1 Alt = %v, want 42", got)
	}
	if got := lf.Curves["GPS2"]["Alt"].Values()[0]; got != 43 {
		t.Fatalf("GPS2 Alt = %v, want 43", got)
	}
}

func TestFirstGPSTimeSetsUTCBaseAndShiftsPriorPoints(t *testing.T) {
	lf := newTestLogFile()
	ingestTextLine(lf, "FMT, 1, 12, ATT, If, TimeMS,Roll", 1)
	ingestTextLine(lf, "FMT, 2, 24, GPS, QBIIB, TimeUS,I,GMS,GWk,Alt", 2)
	ingestTextLine(lf, "ATT, 500, 12.5", 3)

	ingestTextLine(lf, "GPS, 1000000, 0, 129600000, 2200, 42", 4)

	expectedGPSMs, ok := gpsFieldUnixMillis(lf.FormatsByName["GPS"], []any{"1000000", "0", "129600000", "2200", "42"})
	if !ok {
		t.Fatalf("test GPS time did not produce UTC milliseconds")
	}
	expectedBase := expectedGPSMs - 1000
	if !lf.Summary.HasUTC {
		t.Fatalf("Summary.HasUTC = false, want true")
	}
	if got := lf.Summary.StartUnixSecs; got != int64(expectedBase/1000) {
		t.Fatalf("StartUnixSecs = %d, want %d", got, int64(expectedBase/1000))
	}
	if got := lf.Curves["ATT"]["Roll"].Times()[0]; got != expectedBase+500 {
		t.Fatalf("prior ATT timestamp = %v, want %v", got, expectedBase+500)
	}
	if got := lf.Curves["GPS1"]["Alt"].Times()[0]; got != expectedBase+1000 {
		t.Fatalf("GPS timestamp = %v, want %v", got, expectedBase+1000)
	}
}

func TestFirstGPSTimeAcceptsCommonFieldAliases(t *testing.T) {
	lf := newTestLogFile()
	ingestTextLine(lf, "FMT, 1, 24, GPS, QBIIB, TimeUS,I,TowMS,GPSWeek,Alt", 1)
	ingestTextLine(lf, "GPS, 1000000, 0, 129600000, 2200, 42", 2)

	if !lf.Summary.HasUTC {
		t.Fatalf("GPS aliases did not set UTC base")
	}
	if got := lf.Curves["GPS1"]["Alt"].Times()[0]; got <= 1000000000000 {
		t.Fatalf("GPS alias timestamp = %v, want Unix milliseconds", got)
	}
}

func TestMessageLogExtractsTextAndTime(t *testing.T) {
	lf := newTestLogFile()
	ingestTextLine(lf, "FMT, 1, 72, MSG, QZ, TimeUS,msg", 1)
	ingestTextLine(lf, "MSG, 1234000, EKF lane switch", 2)

	if got := lf.Messages[2]; got != "EKF lane switch" {
		t.Fatalf("message text = %q, want %q", got, "EKF lane switch")
	}
	if got := lf.MessageTimes[2]; got != 1234 {
		t.Fatalf("message time = %v, want 1234", got)
	}
}

func TestParameterLogUsesNamedFieldsAndKeepsLastValue(t *testing.T) {
	lf := newTestLogFile()
	ingestTextLine(lf, "FMT, 1, 32, PARM, QNff, TimeUS,Name,Value,Default", 1)
	ingestTextLine(lf, "PARM, 1000, ATC_RAT_RLL_P, 0.135, 0.100", 2)
	ingestTextLine(lf, "PARM, 2000, ATC_RAT_RLL_P, 0.145, 0.100", 3)

	if got := lf.Parameters["ATC_RAT_RLL_P"]; got != 0.145 {
		t.Fatalf("parameter value = %v, want last value 0.145", got)
	}
	if _, ok := lf.Parameters["1000"]; ok {
		t.Fatalf("timestamp was stored as a parameter name")
	}
}

func TestCommandTimeShiftedWhenUTCTimeBaseSetLater(t *testing.T) {
	lf := newTestLogFile()
	ingestTextLine(lf, "FMT, 1, 44, CMD, QHHHffffLLfB, TimeUS,CTot,CNum,CId,Prm1,Prm2,Prm3,Prm4,Lat,Lng,Alt,Frame", 1)
	ingestTextLine(lf, "FMT, 2, 24, GPS, QBIIB, TimeUS,I,GMS,GWk,Alt", 2)

	ingestTextLine(lf, "CMD, 500000, 1, 0, 16, 0, 0, 0, 0, 0, 0, 0, 3", 3)
	before := lf.Commands[0].TimeMs

	ingestTextLine(lf, "GPS, 1000000, 0, 129600000, 2200, 42", 4)

	if !lf.Summary.HasUTC {
		t.Fatalf("GPS should have established UTC base")
	}
	after := lf.Commands[0].TimeMs
	if after <= before {
		t.Fatalf("command time not shifted: %v -> %v", before, after)
	}
	expectedBase, _ := gpsFieldUnixMillis(lf.FormatsByName["GPS"], []any{"1000000", "0", "129600000", "2200", "42"})
	want := (expectedBase - 1000) + 500
	if after != want {
		t.Fatalf("shifted command time = %v, want %v", after, want)
	}
}

func TestCommandLogExtractsMissionWaypoints(t *testing.T) {
	lf := newTestLogFile()

	ingestTextLine(lf, "FMT, 76, 44, CMD, QHHHffffLLfB, TimeUS,CTot,CNum,CId,Prm1,Prm2,Prm3,Prm4,Lat,Lng,Alt,Frame", 1)

	ingestTextLine(lf, "CMD, 500000, 4, 0, 16, 0.000000, 0.000000, 0.000000, 0.000000, 341234567, -1181234567, 100.500000, 3", 2)

	ingestTextLine(lf, "CMD, 600000, 4, 1, 22, 0.000000, 0.000000, 0.000000, 0.000000, 0, 0, 25.000000, 3", 3)

	if len(lf.Commands) != 2 {
		t.Fatalf("commands extracted = %d, want 2", len(lf.Commands))
	}

	wp := lf.Commands[0]
	if wp.Sequence != 0 || wp.Command != 16 {
		t.Fatalf("waypoint seq/CId = %v/%v, want 0/16", wp.Sequence, wp.Command)
	}
	if wp.CommandTotal != 4 {
		t.Fatalf("command_total = %v, want 4", wp.CommandTotal)
	}
	if got := wp.Latitude; got < 34.12 || got > 34.13 {
		t.Fatalf("latitude = %v, want ~34.1234567 degrees", got)
	}
	if got := wp.Longitude; got > -118.12 || got < -118.13 {
		t.Fatalf("longitude = %v, want ~-118.1234567 degrees", got)
	}
	if wp.Altitude != 100.5 {
		t.Fatalf("altitude = %v, want 100.5", wp.Altitude)
	}
	if wp.Frame != 3 {
		t.Fatalf("frame = %v, want 3", wp.Frame)
	}

	tk := lf.Commands[1]
	if tk.Command != 22 || tk.Latitude != 0 || tk.Longitude != 0 {
		t.Fatalf("takeoff = %+v, want CId 22 with zero coords", tk)
	}
}

func TestMAVCLogExtractsMAVLinkCommands(t *testing.T) {
	lf := newTestLogFile()

	ingestTextLine(lf, "FMT, 78, 40, MAVC, QBBBBBHffffiifBB, TimeUS,TS,TC,SS,SC,Fr,Cmd,P1,P2,P3,P4,X,Y,Z,Res,WL", 1)

	ingestTextLine(lf, "MAVC, 500000, 255, 1, 254, 190, 3, 16, 0.000000, 0.000000, 0.000000, 0.000000, 341234567, -1181234567, 100.500000, 0, 0", 2)

	ingestTextLine(lf, "MAVC, 600000, 255, 1, 254, 190, 0, 120, 1.000000, 0.000000, 0.000000, 0.000000, 0, 0, 0.000000, 0, 1", 3)

	if len(lf.MAVLinkCommands) != 2 {
		t.Fatalf("mavlink commands extracted = %d, want 2", len(lf.MAVLinkCommands))
	}

	wp := lf.MAVLinkCommands[0]
	if wp.Command != 16 || wp.Frame != 3 {
		t.Fatalf("waypoint Cmd/Frame = %v/%v, want 16/3", wp.Command, wp.Frame)
	}
	if wp.TargetSystem != 255 || wp.TargetComponent != 1 || wp.SourceSystem != 254 || wp.SourceComponent != 190 {
		t.Fatalf("sysids = %v/%v/%v/%v, want 255/1/254/190", wp.TargetSystem, wp.TargetComponent, wp.SourceSystem, wp.SourceComponent)
	}
	if got := wp.Latitude; got < 34.12 || got > 34.13 {
		t.Fatalf("latitude = %v, want ~34.1234567 degrees", got)
	}
	if got := wp.Longitude; got > -118.12 || got < -118.13 {
		t.Fatalf("longitude = %v, want ~-118.1234567 degrees", got)
	}
	if wp.Altitude != 100.5 {
		t.Fatalf("altitude = %v, want 100.5", wp.Altitude)
	}
	if wp.Result != 0 || wp.WasCommandLong {
		t.Fatalf("result/WL = %v/%v, want 0/false", wp.Result, wp.WasCommandLong)
	}

	servo := lf.MAVLinkCommands[1]
	if servo.Command != 120 || servo.Param1 != 1 || !servo.WasCommandLong {
		t.Fatalf("servo cmd = %+v, want Cmd 120, P1 1, WL true", servo)
	}
	if servo.Latitude != 0 || servo.Longitude != 0 {
		t.Fatalf("servo coords = %v/%v, want 0/0", servo.Latitude, servo.Longitude)
	}
}

func TestValidHeaderUTCSecondsAreAccepted(t *testing.T) {
	lf := newTestLogFile()
	if err := scanBinary(lf, strings.NewReader(""), 0, 1780000000); err != nil {
		t.Fatalf("scanBinary returned error: %v", err)
	}

	if !lf.Summary.HasUTC {
		t.Fatalf("valid header UTC seconds should be accepted")
	}
	if got := lf.Summary.StartUnixSecs; got != 1780000000 {
		t.Fatalf("StartUnixSecs = %d, want 1780000000", got)
	}
}

func TestSetTimeBaseShiftsExistingPointsOnce(t *testing.T) {
	lf := newTestLogFile()
	fd := &parser.FormatDef{Name: "ATT", FieldNames: []string{"TimeMS", "Roll"}, FormatStr: "If"}
	lf.StoreTextCurveValues("ATT", fd, []any{float64(500), float64(12)}, 500, 1, "")

	lf.SetTimeBase(100000)
	lf.SetTimeBase(200000)

	if got := lf.Curves["ATT"]["Roll"].Times()[0]; got != 100500 {
		t.Fatalf("timestamp after repeated base set = %v, want 100500", got)
	}
}

func TestInvalidUTCValuesAreRejected(t *testing.T) {
	if isPlausibleUTCSec(0) {
		t.Fatalf("zero UTC seconds should be rejected")
	}
	if isPlausibleUTCSec(^uint32(0)) {
		t.Fatalf("0xFFFFFFFF UTC seconds should be rejected")
	}
	if isPlausibleUTCSec(4294967295) {
		t.Fatalf("2106-era UTC seconds should be rejected")
	}

	fd := &parser.FormatDef{
		Name:       "GPS",
		FieldNames: []string{"TimeUS", "I", "GMS", "GWk", "Alt"},
		FormatStr:  "QBIIB",
	}
	if _, ok := gpsFieldUnixMillis(fd, []any{"1000000", "0", "0", "65535", "42"}); ok {
		t.Fatalf("unreasonable GPS week should not produce UTC time")
	}
}

func findTypeField(tb *parser.TypeBody, name string) *parser.TypeField {
	for i := range tb.Fields {
		if tb.Fields[i].Name == name {
			return &tb.Fields[i]
		}
	}
	return nil
}

func TestBuildTypeBodyInterleavedAndExtract(t *testing.T) {
	lf := newTestLogFile()

	ingestTextLine(lf, "FMT, 1, 20, ATT, Ifff, TimeMS,Roll,Pitch,Yaw", 1)
	ingestTextLine(lf, "ATT, 100, 1.5, 2.5, 3.5", 2)
	ingestTextLine(lf, "ATT, 200, 10.0, 20.0, 30.0", 3)

	ingestTextLine(lf, "FMT, 2, 14, MIX, Ihf, TimeMS,Count,Val", 4)
	ingestTextLine(lf, "MIX, 1000, 7, 0.25", 5)
	ingestTextLine(lf, "MIX, 2000, -3, 0.75", 6)

	lf.Finalize()

	tb := lf.TypeBodies["ATT"]
	if tb == nil {
		t.Fatalf("missing ATT TypeBody")
	}
	if tb.RowCount != 2 {
		t.Fatalf("ATT rowCount=%d want 2", tb.RowCount)
	}
	if len(tb.Fields) != 4 {
		t.Fatalf("ATT fieldCount=%d want 4 (TimeMS,Roll,Pitch,Yaw)", len(tb.Fields))
	}
	roll := findTypeField(tb, "Roll")
	if roll == nil || roll.GLType != parser.GLFloat32 {
		t.Fatalf("Roll glType=%v want Float32", roll)
	}
	if roll.Count != 2 {
		t.Fatalf("Roll count=%d want 2", roll.Count)
	}
	if tb.BaseTimeMs != 100 {
		t.Fatalf("ATT baseTimeMs=%v want 100", tb.BaseTimeMs)
	}

	cdRoll := lf.Curves["ATT"]["Roll"]
	bin := lf.CurveBytes(cdRoll)
	if len(bin) != parser.CurveBinHeader+2*8 {
		t.Fatalf("CurveBytes len=%d want %d", len(bin), parser.CurveBinHeader+2*8)
	}
	d0 := math.Float32frombits(binary.LittleEndian.Uint32(bin[parser.CurveBinHeader : parser.CurveBinHeader+4]))
	v0 := math.Float32frombits(binary.LittleEndian.Uint32(bin[parser.CurveBinHeader+4 : parser.CurveBinHeader+8]))
	if d0 != 0 || v0 != 1.5 {
		t.Fatalf("Roll row0 delta/val=%v/%v want 0/1.5", d0, v0)
	}
	d1 := math.Float32frombits(binary.LittleEndian.Uint32(bin[parser.CurveBinHeader+8 : parser.CurveBinHeader+12]))
	v1 := math.Float32frombits(binary.LittleEndian.Uint32(bin[parser.CurveBinHeader+12 : parser.CurveBinHeader+16]))
	if d1 != 100 || v1 != 10.0 {
		t.Fatalf("Roll row1 delta/val=%v/%v want 100/10", d1, v1)
	}

	tbMix := lf.TypeBodies["MIX"]
	if tbMix == nil {
		t.Fatalf("missing MIX TypeBody")
	}

	cnt := findTypeField(tbMix, "Count")
	if cnt == nil {
		t.Fatalf("Count field missing")
	}
	val := findTypeField(tbMix, "Val")
	if val == nil {
		t.Fatalf("Val field missing")
	}
	body := lf.TypeBodyBytes("MIX")
	if len(body) < parser.TypeBinHeader {
		t.Fatalf("MIX body nil/short")
	}
	if binary.LittleEndian.Uint32(body[0:4]) != parser.TypeBinMagic {
		t.Fatalf("MIX body magic mismatch")
	}

	c0 := parser.ReadFieldGL(body, parser.TypeBinHeader+0*tbMix.Stride+cnt.Offset, cnt.GLType)
	c1 := parser.ReadFieldGL(body, parser.TypeBinHeader+1*tbMix.Stride+cnt.Offset, cnt.GLType)
	if c0 != 7 || c1 != -3 {
		t.Fatalf("Count values=%v/%v want 7/-3", c0, c1)
	}

	vv0 := parser.ReadFieldGL(body, parser.TypeBinHeader+0*tbMix.Stride+val.Offset, val.GLType)
	vv1 := parser.ReadFieldGL(body, parser.TypeBinHeader+1*tbMix.Stride+val.Offset, val.GLType)
	if vv0 != 0.25 || vv1 != 0.75 {
		t.Fatalf("Val values=%v/%v want 0.25/0.75", vv0, vv1)
	}

	schema := lf.TypeSchema()
	attSchema, ok := schema["ATT"]
	if !ok || attSchema.Stride != tb.Stride {
		t.Fatalf("schema ATT stride mismatch: %v vs %v", attSchema.Stride, tb.Stride)
	}
}

func TestPackedAccumBinary(t *testing.T) {
	lf := newTestLogFile()
	defer lf.CloseSpool()
	fdMIX := &parser.FormatDef{MsgType: 2, MsgLen: 13, Name: "MIX", FormatStr: "Ihf", FieldNames: []string{"TimeMS", "Count", "Val"}}
	lf.FormatsByName["MIX"] = fdMIX
	fdGEO := &parser.FormatDef{MsgType: 3, MsgLen: 11, Name: "GEO", FormatStr: "IL", FieldNames: []string{"TimeMS", "Lat"}}
	lf.FormatsByName["GEO"] = fdGEO

	mix1 := make([]byte, 10)
	binary.LittleEndian.PutUint32(mix1[0:4], 1000)
	binary.LittleEndian.PutUint16(mix1[4:6], uint16(int16(7)))
	binary.LittleEndian.PutUint32(mix1[6:10], math.Float32bits(0.25))
	mix2 := make([]byte, 10)
	binary.LittleEndian.PutUint32(mix2[0:4], 2000)
	binary.LittleEndian.PutUint16(mix2[4:6], 0xFFFD)
	binary.LittleEndian.PutUint32(mix2[6:10], math.Float32bits(0.75))
	ingestBinaryRecord(lf, fdMIX, mix1, 1)
	ingestBinaryRecord(lf, fdMIX, mix2, 2)

	geo1 := make([]byte, 8)
	binary.LittleEndian.PutUint32(geo1[0:4], 5000)
	binary.LittleEndian.PutUint32(geo1[4:8], uint32(int32(345678901)))
	ingestBinaryRecord(lf, fdGEO, geo1, 3)

	lf.Finalize()

	tbMIX := lf.TypeBodies["MIX"]
	if tbMIX == nil {
		t.Fatalf("missing MIX TypeBody")
	}
	if tbMIX.RowCount != 2 {
		t.Fatalf("MIX rowCount=%d want 2", tbMIX.RowCount)
	}
	cnt := findTypeField(tbMIX, "Count")
	if cnt == nil || cnt.GLType != parser.GLInt16 || cnt.Scale != 1 {
		t.Fatalf("Count glType=%v scale=%v want Int16/1", cnt.GLType, cnt.Scale)
	}
	val := findTypeField(tbMIX, "Val")
	if val == nil || val.GLType != parser.GLFloat32 || val.Scale != 1 {
		t.Fatalf("Val glType=%v scale=%v want Float32/1", val.GLType, val.Scale)
	}
	body := lf.TypeBodyBytes("MIX")

	c0 := parser.ReadFieldGL(body, parser.TypeBinHeader+0*tbMIX.Stride+cnt.Offset, cnt.GLType)
	c1 := parser.ReadFieldGL(body, parser.TypeBinHeader+1*tbMIX.Stride+cnt.Offset, cnt.GLType)
	if c0 != 7 || c1 != -3 {
		t.Fatalf("Count raw=%v/%v want 7/-3", c0, c1)
	}

	d0 := int32(binary.LittleEndian.Uint32(body[parser.TypeBinHeader+0*tbMIX.Stride:]))
	d1 := int32(binary.LittleEndian.Uint32(body[parser.TypeBinHeader+1*tbMIX.Stride:]))
	if d0 != 0 || d1 != 1000 {
		t.Fatalf("MIX deltaMs=%v/%v want 0/1000", d0, d1)
	}

	tbGEO := lf.TypeBodies["GEO"]
	if tbGEO == nil {
		t.Fatalf("missing GEO TypeBody")
	}
	lat := findTypeField(tbGEO, "Lat")
	if lat == nil || lat.GLType != parser.GLInt32 || lat.Scale != 1e-7 {
		t.Fatalf("Lat glType=%v scale=%v want Int32/1e-7", lat.GLType, lat.Scale)
	}
	bodyG := lf.TypeBodyBytes("GEO")
	latRaw := parser.ReadFieldGL(bodyG, parser.TypeBinHeader+0*tbGEO.Stride+lat.Offset, lat.GLType)
	if latRaw != 345678901 {
		t.Fatalf("Lat raw=%v want 345678901", latRaw)
	}
	if lat.Min != 34.5678901 {
		t.Fatalf("Lat min=%v want 34.5678901 (scaled)", lat.Min)
	}
}

func TestAllInfFieldSanitizesMinMax(t *testing.T) {
	lf := newTestLogFile()
	defer lf.CloseSpool()

	fd := &parser.FormatDef{MsgType: 4, MsgLen: 13, Name: "ALT", FormatStr: "Iff", FieldNames: []string{"TimeMS", "Roll", "DSAlt"}}
	lf.FormatsByName["ALT"] = fd

	mk := func(tms uint32, roll, dsalt float32) []byte {
		b := make([]byte, 12)
		binary.LittleEndian.PutUint32(b[0:4], tms)
		binary.LittleEndian.PutUint32(b[4:8], math.Float32bits(roll))
		binary.LittleEndian.PutUint32(b[8:12], math.Float32bits(dsalt))
		return b
	}
	ingestBinaryRecord(lf, fd, mk(1000, 1.5, float32(math.Inf(1))), 1)
	ingestBinaryRecord(lf, fd, mk(2000, -0.5, float32(math.Inf(1))), 2)

	lf.Finalize()

	tb := lf.TypeBodies["ALT"]
	if tb == nil {
		t.Fatalf("missing ALT TypeBody")
	}
	dsAlt := findTypeField(tb, "DSAlt")
	if dsAlt == nil {
		t.Fatalf("DSAlt field missing")
	}
	if math.IsInf(dsAlt.Min, 0) || math.IsInf(dsAlt.Max, 0) {
		t.Fatalf("DSAlt min/max still non-finite: %v/%v", dsAlt.Min, dsAlt.Max)
	}
	roll := findTypeField(tb, "Roll")
	if roll.Min != -0.5 || roll.Max != 1.5 {
		t.Fatalf("Roll min/max=%v/%v want -0.5/1.5 (finite values must be preserved)", roll.Min, roll.Max)
	}

	if _, err := json.Marshal(lf.TypeSchema()); err != nil {
		t.Fatalf("TypeSchema JSON marshal failed: %v", err)
	}
}

func TestComputeDurationBinaryPath(t *testing.T) {
	lf := newTestLogFile()
	defer lf.CloseSpool()
	fdGPS := &parser.FormatDef{MsgType: 5, MsgLen: 13, Name: "GPS", FormatStr: "Qff", FieldNames: []string{"TimeUS", "Lat", "Lng"}}
	lf.FormatsByName["GPS"] = fdGPS
	mk := func(tus uint64) []byte {
		b := make([]byte, 16)
		binary.LittleEndian.PutUint64(b[0:8], tus)
		binary.LittleEndian.PutUint32(b[8:12], math.Float32bits(34.0))
		binary.LittleEndian.PutUint32(b[12:16], math.Float32bits(118.0))
		return b
	}
	ingestBinaryRecord(lf, fdGPS, mk(1_000_000), 1)
	ingestBinaryRecord(lf, fdGPS, mk(61_000_000), 2)
	lf.ComputeDuration([]string{"GPS"})
	if lf.Summary.DurationSecs != 60.0 {
		t.Fatalf("DurationSecs=%v want 60", lf.Summary.DurationSecs)
	}
}
