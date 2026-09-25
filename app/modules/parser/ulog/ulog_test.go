package ulog

import (
	"encoding/binary"
	"fmt"
	"math"
	"testing"

	"drone-log-analyzer/app/modules/parser"
)

func msg(msgType byte, payload []byte) []byte {
	b := make([]byte, 3+len(payload))
	binary.LittleEndian.PutUint16(b[0:2], uint16(len(payload)))
	b[2] = msgType
	copy(b[3:], payload)
	return b
}

func TestULogParsesCurvesParamsMessages(t *testing.T) {
	var b []byte

	b = append(b, 0x55, 0x4C, 0x6F, 0x67, 0x01, 0x12, 0x35, 0x01)
	b = append(b, 0, 0, 0, 0, 0, 0, 0, 0)

	b = append(b, msg('F', []byte("test:uint64_t timestamp;float val"))...)

	a := []byte{0, 0, 0}
	a = append(a, []byte("test\x00")...)
	b = append(b, msg('A', a)...)

	d1 := []byte{0, 0}
	d1 = binary.LittleEndian.AppendUint64(d1, 1_000_000)
	d1 = binary.LittleEndian.AppendUint32(d1, math.Float32bits(1.5))
	b = append(b, msg('D', d1)...)

	d2 := []byte{0, 0}
	d2 = binary.LittleEndian.AppendUint64(d2, 2_000_000)
	d2 = binary.LittleEndian.AppendUint32(d2, math.Float32bits(2.5))
	b = append(b, msg('D', d2)...)

	mDesc := "float PARAM_X"
	m := []byte{byte(len(mDesc))}
	m = append(m, []byte(mDesc)...)
	m = binary.LittleEndian.AppendUint32(m, math.Float32bits(42.0))
	b = append(b, msg('P', m)...)

	l := []byte{6}
	l = binary.LittleEndian.AppendUint64(l, 1_500_000)
	l = append(l, []byte("hello")...)
	b = append(b, msg('L', l)...)

	s := &decodeSession{
		file:       parser.NewLogFile("test.ulg", "ulog"),
		formatByID: map[uint16]*parser.FormatDef{},
		topicByID:  map[uint16]string{},
		instByID:   map[uint16]uint8{},
	}
	if err := s.decode(b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	s.file.Finalize()

	if s.file.FormatsByName["test"] == nil {
		t.Fatal("missing format 'test'")
	}
	tb := s.file.TypeBodies["test"]
	if tb == nil {
		t.Fatal("missing TypeBody 'test'")
	}
	var valField *parser.TypeField
	for i := range tb.Fields {
		if tb.Fields[i].Name == "val" {
			valField = &tb.Fields[i]
			break
		}
	}
	if valField == nil {
		t.Fatalf("missing val field; fields=%v", tb.Fields)
	}
	if valField.GLType != parser.GLFloat32 {
		t.Fatalf("val glType=%v want Float32", valField.GLType)
	}
	body := s.file.TypeBodyBytes("test")
	v0 := parser.ReadFieldGL(body, parser.TypeBinHeader+0*tb.Stride+valField.Offset, valField.GLType)
	v1 := parser.ReadFieldGL(body, parser.TypeBinHeader+1*tb.Stride+valField.Offset, valField.GLType)
	if v0 != 1.5 || v1 != 2.5 {
		t.Fatalf("val = %v/%v, want 1.5/2.5", v0, v1)
	}
	if got := s.file.Parameters["PARAM_X"]; got != 42 {
		t.Fatalf("PARAM_X = %v, want 42", got)
	}

	if got := s.file.Messages[6]; got != "hello" {
		t.Fatalf("message = %q, want hello", got)
	}
	if s.file.Summary.DurationSecs != 1.0 {
		t.Fatalf("DurationSecs = %v, want 1.0", s.file.Summary.DurationSecs)
	}
	if s.file.Summary.Format != "ulog" {
		t.Fatalf("Format = %q, want ulog", s.file.Summary.Format)
	}
}

func TestULogTypeMapping(t *testing.T) {
	cases := []struct {
		ctype      string
		wantSize   int
		wantInBody bool
	}{
		{"uint8_t", 1, true},
		{"int16_t", 2, true},
		{"uint32_t", 4, true},
		{"float", 4, true},
		{"uint64_t", 8, false},
		{"double", 8, true},
		{"char[16]", 16, false},
		{"float[4]", 16, false},
	}
	for _, c := range cases {
		_, size, _, inBody := mapScalar(c.ctype)
		if size != c.wantSize || inBody != c.wantInBody {
			t.Errorf("mapScalar(%q) = size %d inBody %v, want size %d inBody %v", c.ctype, size, inBody, c.wantSize, c.wantInBody)
		}
	}

	fd := &parser.FormatDef{}
	assembleLayout(fd, parseTypeSpec("uint64_t timestamp;uint8_t mode;float x;float y"))
	if len(fd.Layout) != 4 {
		t.Fatalf("layout len=%d want 4", len(fd.Layout))
	}
	if fd.Layout[0].Name != "timestamp" || fd.Layout[0].Offset != 0 || fd.Layout[0].InBody {
		t.Errorf("timestamp layout wrong: %+v", fd.Layout[0])
	}
	if fd.Layout[1].Name != "mode" || fd.Layout[1].Offset != 8 {
		t.Errorf("mode layout wrong: %+v", fd.Layout[1])
	}
	if fd.Layout[2].Name != "x" || fd.Layout[2].Offset != 9 {
		t.Errorf("x layout wrong: %+v", fd.Layout[2])
	}
	if fd.Layout[3].Name != "y" || fd.Layout[3].Offset != 13 {
		t.Errorf("y layout wrong: %+v", fd.Layout[3])
	}
}

func TestULogLatLonInt32(t *testing.T) {

	fd := &parser.FormatDef{}
	assembleLayout(fd, parseTypeSpec("double latitude_deg;double longitude_deg;double pressure"))
	if len(fd.Layout) != 3 {
		t.Fatalf("layout len=%d want 3", len(fd.Layout))
	}
	for i, n := range []string{"latitude_deg", "longitude_deg"} {
		f := fd.Layout[i]
		if f.GLType != parser.GLInt32 || f.Scale != 1e-7 || f.Size != 8 {
			t.Errorf("%s layout = %+v, want GLInt32/1e-7/size8", n, f)
		}
	}
	if p := fd.Layout[2]; p.GLType != parser.GLFloat32 {
		t.Errorf("pressure layout = %+v, want GLFloat32", p)
	}

	fd2 := &parser.FormatDef{}
	assembleLayout(fd2, parseTypeSpec("int32_t lat;int32_t lon"))
	if len(fd2.Layout) != 2 {
		t.Fatalf("layout len=%d want 2", len(fd2.Layout))
	}
	for i, n := range []string{"lat", "lon"} {
		f := fd2.Layout[i]
		if f.GLType != parser.GLInt32 || f.Scale != 1e-7 || f.Size != 4 {
			t.Errorf("int32 %s layout = %+v, want GLInt32/1e-7/size4", n, f)
		}
	}
}

func TestULogNavigatorMissionItem(t *testing.T) {
	var b []byte
	b = append(b, 0x55, 0x4C, 0x6F, 0x67, 0x01, 0x12, 0x35, 0x01)
	b = append(b, 0, 0, 0, 0, 0, 0, 0, 0)

	b = append(b, msg('F', []byte("navigator_mission_item:uint64_t timestamp;uint16_t sequence_current;uint16_t nav_cmd;float latitude;float longitude;float altitude;uint8_t frame"))...)

	a := []byte{0, 10, 0}
	a = append(a, []byte("navigator_mission_item\x00")...)
	b = append(b, msg('A', a)...)

	d1 := []byte{10, 0}
	d1 = binary.LittleEndian.AppendUint64(d1, 1_000_000)
	d1 = binary.LittleEndian.AppendUint16(d1, 0)
	d1 = binary.LittleEndian.AppendUint16(d1, 16)
	d1 = binary.LittleEndian.AppendUint32(d1, math.Float32bits(47.3))
	d1 = binary.LittleEndian.AppendUint32(d1, math.Float32bits(8.5))
	d1 = binary.LittleEndian.AppendUint32(d1, math.Float32bits(500.0))
	d1 = append(d1, 3)
	b = append(b, msg('D', d1)...)

	d2 := []byte{10, 0}
	d2 = binary.LittleEndian.AppendUint64(d2, 2_000_000)
	d2 = binary.LittleEndian.AppendUint16(d2, 0)
	d2 = binary.LittleEndian.AppendUint16(d2, 16)
	d2 = binary.LittleEndian.AppendUint32(d2, math.Float32bits(11.1))
	d2 = binary.LittleEndian.AppendUint32(d2, math.Float32bits(11.1))
	d2 = binary.LittleEndian.AppendUint32(d2, math.Float32bits(111.0))
	d2 = append(d2, 3)
	b = append(b, msg('D', d2)...)

	d3 := []byte{10, 0}
	d3 = binary.LittleEndian.AppendUint64(d3, 3_000_000)
	d3 = binary.LittleEndian.AppendUint16(d3, 1)
	d3 = binary.LittleEndian.AppendUint16(d3, 22)
	d3 = binary.LittleEndian.AppendUint32(d3, math.Float32bits(0))
	d3 = binary.LittleEndian.AppendUint32(d3, math.Float32bits(0))
	d3 = binary.LittleEndian.AppendUint32(d3, math.Float32bits(0))
	d3 = append(d3, 2)
	b = append(b, msg('D', d3)...)

	d4 := []byte{10, 0}
	d4 = binary.LittleEndian.AppendUint64(d4, 4_000_000)
	d4 = binary.LittleEndian.AppendUint16(d4, 0)
	d4 = binary.LittleEndian.AppendUint16(d4, 16)
	d4 = binary.LittleEndian.AppendUint32(d4, math.Float32bits(99.9))
	d4 = binary.LittleEndian.AppendUint32(d4, math.Float32bits(99.9))
	d4 = binary.LittleEndian.AppendUint32(d4, math.Float32bits(999.0))
	d4 = append(d4, 3)
	b = append(b, msg('D', d4)...)

	s := &decodeSession{
		file:       parser.NewLogFile("test.ulg", "ulog"),
		formatByID: map[uint16]*parser.FormatDef{},
		topicByID:  map[uint16]string{},
		instByID:   map[uint16]uint8{},
	}
	if err := s.decode(b); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if len(s.file.Commands) != 3 {
		t.Fatalf("Commands len=%d, want 3 (D2 连续重复跳过, D4 回跳保留)", len(s.file.Commands))
	}
	c0 := s.file.Commands[0]
	if c0.Sequence != 0 || c0.Command != 16 || float32(c0.Latitude) != float32(47.3) || c0.Longitude != 8.5 || c0.Altitude != 500 || c0.Frame != 3 {
		t.Errorf("cmd0 = %+v, want seq0/16/47.3/8.5/500/frame3", c0)
	}
	c1 := s.file.Commands[1]
	if c1.Sequence != 1 || c1.Command != 22 {
		t.Errorf("cmd1 = %+v, want seq1/cmd22", c1)
	}
	c2 := s.file.Commands[2]
	if c2.Sequence != 0 || float32(c2.Latitude) != float32(99.9) {
		t.Errorf("cmd2 = %+v, want seq0/99.9 (回跳=任务重传保留)", c2)
	}
}

func TestULogVehicleCommand(t *testing.T) {
	var b []byte
	b = append(b, 0x55, 0x4C, 0x6F, 0x67, 0x01, 0x12, 0x35, 0x01)
	b = append(b, 0, 0, 0, 0, 0, 0, 0, 0)

	b = append(b, msg('F', []byte("vehicle_command:uint64_t timestamp;float param1;float param2;float param3;float param4;double param5;double param6;float param7;uint32_t command;uint8_t target_system;uint8_t target_component;uint8_t source_system;uint16_t source_component"))...)

	a := []byte{0, 20, 0}
	a = append(a, []byte("vehicle_command\x00")...)
	b = append(b, msg('A', a)...)

	d := []byte{20, 0}
	d = binary.LittleEndian.AppendUint64(d, 1_000_000)
	d = binary.LittleEndian.AppendUint32(d, math.Float32bits(0))
	d = binary.LittleEndian.AppendUint32(d, math.Float32bits(0))
	d = binary.LittleEndian.AppendUint32(d, math.Float32bits(0))
	d = binary.LittleEndian.AppendUint32(d, math.Float32bits(0))
	d = binary.LittleEndian.AppendUint64(d, math.Float64bits(47.3))
	d = binary.LittleEndian.AppendUint64(d, math.Float64bits(8.5))
	d = binary.LittleEndian.AppendUint32(d, math.Float32bits(100.0))
	d = binary.LittleEndian.AppendUint32(d, 16)
	d = append(d, 1)
	d = append(d, 1)
	d = append(d, 255)
	d = binary.LittleEndian.AppendUint16(d, 0)
	b = append(b, msg('D', d)...)

	s := &decodeSession{
		file:       parser.NewLogFile("test.ulg", "ulog"),
		formatByID: map[uint16]*parser.FormatDef{},
		topicByID:  map[uint16]string{},
		instByID:   map[uint16]uint8{},
	}
	if err := s.decode(b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(s.file.MAVLinkCommands) != 1 {
		t.Fatalf("MAVLinkCommands len=%d, want 1", len(s.file.MAVLinkCommands))
	}
	c := s.file.MAVLinkCommands[0]
	if c.Command != 16 {
		t.Errorf("Command=%d want 16", c.Command)
	}
	if c.Latitude != 47.3 {
		t.Errorf("Latitude(param5 double)=%v want 47.3", c.Latitude)
	}
	if c.Longitude != 8.5 {
		t.Errorf("Longitude(param6 double)=%v want 8.5", c.Longitude)
	}
	if c.Altitude != 100 {
		t.Errorf("Altitude(param7)=%v want 100", c.Altitude)
	}
	if c.TargetSystem != 1 || c.TargetComponent != 1 || c.SourceSystem != 255 {
		t.Errorf("target/source wrong: %+v", c)
	}
	if c.Result != 0 {
		t.Errorf("Result=%d want 0 (no ack yet)", c.Result)
	}
}

func TestULogVehicleCommandAck(t *testing.T) {
	var b []byte
	b = append(b, 0x55, 0x4C, 0x6F, 0x67, 0x01, 0x12, 0x35, 0x01)
	b = append(b, 0, 0, 0, 0, 0, 0, 0, 0)

	b = append(b, msg('F', []byte("vehicle_command:uint64_t timestamp;uint32_t command;uint8_t target_system"))...)
	b = append(b, msg('F', []byte("vehicle_command_ack:uint64_t timestamp;uint32_t command;uint8_t result;uint8_t result_param1;int32_t result_param2;uint8_t target_system;uint16_t target_component;bool from_external"))...)

	a1 := []byte{0, 20, 0}
	a1 = append(a1, []byte("vehicle_command\x00")...)
	b = append(b, msg('A', a1)...)
	a2 := []byte{0, 21, 0}
	a2 = append(a2, []byte("vehicle_command_ack\x00")...)
	b = append(b, msg('A', a2)...)

	dc := []byte{20, 0}
	dc = binary.LittleEndian.AppendUint64(dc, 1_000_000)
	dc = binary.LittleEndian.AppendUint32(dc, 16)
	dc = append(dc, 1)
	b = append(b, msg('D', dc)...)

	dack := []byte{21, 0}
	dack = binary.LittleEndian.AppendUint64(dack, 1_100_000)
	dack = binary.LittleEndian.AppendUint32(dack, 16)
	dack = append(dack, 0)
	dack = append(dack, 0)
	dack = binary.LittleEndian.AppendUint32(dack, 0)
	dack = append(dack, 1)
	dack = binary.LittleEndian.AppendUint16(dack, 1)
	dack = append(dack, 1)
	b = append(b, msg('D', dack)...)

	dack2 := []byte{21, 0}
	dack2 = binary.LittleEndian.AppendUint64(dack2, 1_200_000)
	dack2 = binary.LittleEndian.AppendUint32(dack2, 99)
	dack2 = append(dack2, 2)
	dack2 = append(dack2, 0)
	dack2 = binary.LittleEndian.AppendUint32(dack2, 0)
	dack2 = append(dack2, 1)
	dack2 = binary.LittleEndian.AppendUint16(dack2, 1)
	dack2 = append(dack2, 1)
	b = append(b, msg('D', dack2)...)

	s := &decodeSession{
		file:       parser.NewLogFile("test.ulg", "ulog"),
		formatByID: map[uint16]*parser.FormatDef{},
		topicByID:  map[uint16]string{},
		instByID:   map[uint16]uint8{},
	}
	if err := s.decode(b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(s.file.MAVLinkCommands) != 1 {
		t.Fatalf("MAVLinkCommands len=%d, want 1", len(s.file.MAVLinkCommands))
	}
	if s.file.MAVLinkCommands[0].Result != 0 {
		t.Errorf("Result=%d want 0 (ACCEPTED, matched ack)", s.file.MAVLinkCommands[0].Result)
	}
}

func TestExtractFloatSanitizesNaN(t *testing.T) {
	fd := &parser.FormatDef{}
	assembleLayout(fd, parseTypeSpec("float val"))
	if len(fd.Layout) != 1 {
		t.Fatalf("layout len=%d want 1", len(fd.Layout))
	}
	data := make([]byte, 4)
	for _, want := range []struct {
		name string
		bits uint32
	}{
		{"NaN", math.Float32bits(float32(math.NaN()))},
		{"+Inf", math.Float32bits(float32(math.Inf(1)))},
		{"-Inf", math.Float32bits(float32(math.Inf(-1)))},
	} {
		binary.LittleEndian.PutUint32(data, want.bits)
		v, ok := readScalarFloat(fd, data, "val")
		if !ok {
			t.Fatalf("%s: field not found", want.name)
		}
		if v != 0 {
			t.Errorf("%s = %v, want 0 (sanitized)", want.name, v)
		}
	}

	binary.LittleEndian.PutUint32(data, math.Float32bits(3.5))
	if v, _ := readScalarFloat(fd, data, "val"); v != 3.5 {
		t.Errorf("normal value = %v, want 3.5", v)
	}
}

func TestULogMessageUTCBase(t *testing.T) {
	var b []byte
	b = append(b, 0x55, 0x4C, 0x6F, 0x67, 0x01, 0x12, 0x35, 0x01)
	b = append(b, 0, 0, 0, 0, 0, 0, 0, 0)

	b = append(b, msg('F', []byte("system_time:uint64_t timestamp;uint64_t time_utc_usec"))...)
	a := []byte{0, 5, 0}
	a = append(a, []byte("system_time\x00")...)
	b = append(b, msg('A', a)...)

	ds := []byte{5, 0}
	ds = binary.LittleEndian.AppendUint64(ds, 1_000_000)
	ds = binary.LittleEndian.AppendUint64(ds, 1_700_000_000_000_000)
	b = append(b, msg('D', ds)...)

	l := []byte{6}
	l = binary.LittleEndian.AppendUint64(l, 2_000_000)
	l = append(l, []byte("armed")...)
	b = append(b, msg('L', l)...)

	s := &decodeSession{
		file:       parser.NewLogFile("test.ulg", "ulog"),
		formatByID: map[uint16]*parser.FormatDef{},
		topicByID:  map[uint16]string{},
		instByID:   map[uint16]uint8{},
	}
	if err := s.decode(b); err != nil {
		t.Fatalf("decode: %v", err)
	}

	var gotMs float64
	for _, ms := range s.file.MessageTimes {
		gotMs = ms
	}
	if math.Abs(gotMs-1_700_000_001_000.0) > 1 {
		t.Errorf("message timeMs=%v want 1700000001000 (boot+utcBase)", gotMs)
	}
}

func TestULogCurveShifted(t *testing.T) {
	var b []byte
	b = append(b, 0x55, 0x4C, 0x6F, 0x67, 0x01, 0x12, 0x35, 0x01)
	b = append(b, 0, 0, 0, 0, 0, 0, 0, 0)

	b = append(b, msg('F', []byte("system_time:uint64_t timestamp;uint64_t time_utc_usec"))...)
	b = append(b, msg('F', []byte("test:uint64_t timestamp;float val"))...)

	a0 := []byte{0, 0, 0}
	a0 = append(a0, []byte("test\x00")...)
	b = append(b, msg('A', a0)...)
	a1 := []byte{0, 1, 0}
	a1 = append(a1, []byte("system_time\x00")...)
	b = append(b, msg('A', a1)...)

	ds := []byte{1, 0}
	ds = binary.LittleEndian.AppendUint64(ds, 1_000_000)
	ds = binary.LittleEndian.AppendUint64(ds, 1_700_000_000_000_000)
	b = append(b, msg('D', ds)...)

	d1 := []byte{0, 0}
	d1 = binary.LittleEndian.AppendUint64(d1, 2_000_000)
	d1 = binary.LittleEndian.AppendUint32(d1, math.Float32bits(1.5))
	b = append(b, msg('D', d1)...)
	d2 := []byte{0, 0}
	d2 = binary.LittleEndian.AppendUint64(d2, 3_000_000)
	d2 = binary.LittleEndian.AppendUint32(d2, math.Float32bits(2.5))
	b = append(b, msg('D', d2)...)

	s := &decodeSession{
		file:       parser.NewLogFile("test.ulg", "ulog"),
		formatByID: map[uint16]*parser.FormatDef{},
		topicByID:  map[uint16]string{},
		instByID:   map[uint16]uint8{},
	}
	if err := s.decode(b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	s.file.Finalize()

	tb := s.file.TypeBodies["test"]
	if tb == nil {
		t.Fatal("missing TypeBody test")
	}

	if math.Abs(tb.BaseTimeMs-1_700_000_001_000.0) > 1 {
		t.Errorf("BaseTimeMs=%v want 1700000001000", tb.BaseTimeMs)
	}

	body := s.file.TypeBodyBytes("test")
	dms0 := int32(binary.LittleEndian.Uint32(body[parser.TypeBinHeader+0*tb.Stride : parser.TypeBinHeader+0*tb.Stride+4]))
	dms1 := int32(binary.LittleEndian.Uint32(body[parser.TypeBinHeader+1*tb.Stride : parser.TypeBinHeader+1*tb.Stride+4]))
	if dms0 != 0 {
		t.Errorf("dms[0]=%d want 0", dms0)
	}
	if dms1 != 1000 {
		t.Errorf("dms[1]=%d want 1000 (飞行时长，不应溢出)", dms1)
	}
}

func TestULogEventTopic(t *testing.T) {
	var b []byte
	b = append(b, 0x55, 0x4C, 0x6F, 0x67, 0x01, 0x12, 0x35, 0x01)
	b = append(b, 0, 0, 0, 0, 0, 0, 0, 0)

	b = append(b, msg('F', []byte("system_time:uint64_t timestamp;uint64_t time_utc_usec"))...)
	b = append(b, msg('F', []byte("event:uint64_t timestamp;uint32_t id"))...)

	aSys := []byte{0, 5, 0}
	aSys = append(aSys, []byte("system_time\x00")...)
	b = append(b, msg('A', aSys)...)
	aEv := []byte{0, 6, 0}
	aEv = append(aEv, []byte("event\x00")...)
	b = append(b, msg('A', aEv)...)

	ds := []byte{5, 0}
	ds = binary.LittleEndian.AppendUint64(ds, 1_000_000)
	ds = binary.LittleEndian.AppendUint64(ds, 1_700_000_000_000_000)
	b = append(b, msg('D', ds)...)

	d1 := []byte{6, 0}
	d1 = binary.LittleEndian.AppendUint64(d1, 2_000_000)
	d1 = binary.LittleEndian.AppendUint32(d1, 42)
	b = append(b, msg('D', d1)...)

	d2 := []byte{6, 0}
	d2 = binary.LittleEndian.AppendUint64(d2, 3_000_000)
	d2 = binary.LittleEndian.AppendUint32(d2, 7)
	b = append(b, msg('D', d2)...)

	s := &decodeSession{
		file:       parser.NewLogFile("test.ulg", "ulog"),
		formatByID: map[uint16]*parser.FormatDef{},
		topicByID:  map[uint16]string{},
		instByID:   map[uint16]uint8{},
	}
	if err := s.decode(b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(s.file.Events) != 2 {
		t.Fatalf("Events len=%d, want 2 (之前 ulog 不解析 event topic，恒为 0)", len(s.file.Events))
	}
	e0 := s.file.Events[0]
	if e0.Id != 42 {
		t.Errorf("event0 Id=%d want 42", e0.Id)
	}
	if math.Abs(e0.TimeMs-1_700_000_001_000.0) > 1 {
		t.Errorf("event0 TimeMs=%v want 1700000001000 (boot+utcBase，与曲线同基准)", e0.TimeMs)
	}
	e1 := s.file.Events[1]
	if e1.Id != 7 {
		t.Errorf("event1 Id=%d want 7", e1.Id)
	}
	if math.Abs(e1.TimeMs-1_700_000_002_000.0) > 1 {
		t.Errorf("event1 TimeMs=%v want 1700000002000", e1.TimeMs)
	}
}

func TestULogMetadataEvents(t *testing.T) {
	var b []byte
	b = append(b, 0x55, 0x4C, 0x6F, 0x67, 0x01, 0x12, 0x35, 0x01)
	b = append(b, 0, 0, 0, 0, 0, 0, 0, 0)

	jsonBlob := []byte(`{"components":{"1":{"event_groups":{"g":{"events":` +
		`{"cmd_arm":{"id":42,"message":"Armed"},"cmd_disarm":{"id":7,"message":"Disarmed"}}}}}}}`)
	key := fmt.Sprintf("char[%d] metadata_events", len(jsonBlob))
	im := []byte{0, byte(len(key))}
	im = append(im, []byte(key)...)
	im = append(im, jsonBlob...)
	b = append(b, msg('M', im)...)

	b = append(b, msg('F', []byte("event:uint64_t timestamp;uint32_t id"))...)
	a := []byte{0, 9, 0}
	a = append(a, []byte("event\x00")...)
	b = append(b, msg('A', a)...)
	d := []byte{9, 0}
	d = binary.LittleEndian.AppendUint64(d, 1_000_000)
	d = binary.LittleEndian.AppendUint32(d, 42)
	b = append(b, msg('D', d)...)

	s := &decodeSession{
		file:       parser.NewLogFile("test.ulg", "ulog"),
		formatByID: map[uint16]*parser.FormatDef{},
		topicByID:  map[uint16]string{},
		instByID:   map[uint16]uint8{},
	}
	if err := s.decode(b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(s.file.Events) != 1 || s.file.Events[0].Id != 42 {
		t.Fatalf("Events=%+v, want 1 event id=42", s.file.Events)
	}
	names := s.file.PX4EventNames
	if names == nil {
		t.Fatal("PX4EventNames nil, want parsed from metadata_events")
	}
	if names[42] != "Armed" {
		t.Errorf("PX4EventNames[42]=%q want \"Armed\"", names[42])
	}
	if names[7] != "Disarmed" {
		t.Errorf("PX4EventNames[7]=%q want \"Disarmed\"", names[7])
	}
}

func TestULogMetadataEventsKeyedByID(t *testing.T) {
	jsonBlob := []byte(`{"events":{"42":{"message":"Armed"},"7":{"message":"Disarmed"}}}`)
	names := decodeEventMetadata(jsonBlob)
	if names == nil || names[42] != "Armed" || names[7] != "Disarmed" {
		t.Fatalf("decodeEventMetadata=%+v, want 42->Armed, 7->Disarmed", names)
	}
}
