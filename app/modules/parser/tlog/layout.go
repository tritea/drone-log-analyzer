package tlog

import (
	"encoding/binary"
	"fmt"
	"math"
	"reflect"
	"strings"

	"drone-log-analyzer/app/modules/parser"
)

// messageLayout is the decoded shape of one MAVLink message type: the FMT
// definition, the packed body length, and the closures that serialize each
// field into a scratch buffer.
type messageLayout struct {
	formatName string
	def        *parser.FormatDef
	bodyLen    int
	packers    []func(v reflect.Value, b []byte)
}

// glTypeFor maps a scalar reflect.Kind to its wire GLType and byte size.
// Float64 collapses to Float32 (size 4) to match MAVLink's float-only wire
// encoding.
func glTypeFor(k reflect.Kind) (gl parser.FieldGLType, size int, ok bool) {
	switch k {
	case reflect.Uint8, reflect.Bool:
		return parser.GLUint8, 1, true
	case reflect.Int8:
		return parser.GLInt8, 1, true
	case reflect.Uint16:
		return parser.GLUint16, 2, true
	case reflect.Int16:
		return parser.GLInt16, 2, true
	case reflect.Uint32:
		return parser.GLUint32, 4, true
	case reflect.Int32:
		return parser.GLInt32, 4, true
	case reflect.Float32, reflect.Float64:
		return parser.GLFloat32, 4, true
	}
	return 0, 0, false
}

// unitScaleFor returns the multiplier that converts a raw field into display
// units: 1e-7 for integer lat/lon degrees, 1e-3 for integer altitudes in
// millimeters, 0.01 for integer centi-units (velocity/accuracy/current/
// distance), and radian->degree for attitude angles. Other fields return 1.
func unitScaleFor(name string, k reflect.Kind) float64 {
	low := strings.ToLower(name)
	if isIntKind(k) {
		switch {
		case (k == reflect.Int32 || k == reflect.Uint32) && isGeographicField(low):
			return 1e-7
		case k == reflect.Int32 && isAltitudeField(low):
			return 1e-3
		case isCentiField(low):
			return 0.01
		}
	}
	if (k == reflect.Float32 || k == reflect.Float64) && isAngleRadians(low) {
		return 180 / math.Pi
	}
	return 1
}

func isIntKind(k reflect.Kind) bool {
	switch k {
	case reflect.Int16, reflect.Uint16, reflect.Int32, reflect.Uint32:
		return true
	}
	return false
}

// isCentiField reports whether an integer field uses MAVLink's ×100 wire
// encoding: velocities in cm/s (vel/vx/vy/vz/airspeed), accuracies in cm
// (eph/epv/hacc/...), current in centi-ampere, distances in cm.
// Voltages are deliberately excluded — BATTERY2 uses mV while ESC_STATUS
// uses cV, so the name alone cannot disambiguate them.
func isCentiField(low string) bool {
	switch low {
	case "vel", "vx", "vy", "vz", "airspeed",
		"eph", "epv", "hacc", "vacc", "velacc", "hdgacc",
		"currentbattery",
		"currentdistance", "mindistance", "maxdistance":
		return true
	}
	return false
}

func isGeographicField(low string) bool {
	return low == "lat" || low == "lon" || low == "lng" || low == "latint" || low == "lonint" ||
		strings.Contains(low, "latitude") || strings.Contains(low, "longitude")
}

func isAngleRadians(low string) bool {
	switch low {
	case "roll", "pitch", "yaw", "rollspeed", "pitchspeed", "yawspeed":
		return true
	}
	return false
}

func isAltitudeField(low string) bool {
	switch low {
	case "alt", "relative_alt", "relativealt", "altitude", "alt_ellipsoid", "altellipsoid",
		"altitudemonotonic", "altitudeamsl", "altitudelocal", "altituderelative",
		"altitudeterrain", "bottomclearance":
		return true
	}
	return false
}

// origTypeName renders the FMT-style source type name for a reflect.Kind.
func origTypeName(k reflect.Kind) string {
	switch k {
	case reflect.Uint8:
		return "uint8"
	case reflect.Int8:
		return "int8"
	case reflect.Uint16:
		return "uint16"
	case reflect.Int16:
		return "int16"
	case reflect.Uint32:
		return "uint32"
	case reflect.Int32:
		return "int32"
	case reflect.Float32:
		return "float"
	case reflect.Float64:
		return "double"
	}
	return ""
}

// formatNameFromMessage converts a Go struct name (e.g. "MessageAttitude")
// into the MAVLink FMT name (e.g. "ATTITUDE"), inserting underscores at
// lower/upper-case boundaries and uppercasing every letter.
func formatNameFromMessage(typeName string) string {
	s := strings.TrimPrefix(typeName, "Message")
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' && i > 0 {
			prev := s[i-1]
			if (prev >= 'a' && prev <= 'z') || (prev >= '0' && prev <= '9') {
				b.WriteByte('_')
			}
		}
		if c >= 'a' && c <= 'z' {
			c -= 32
		}
		b.WriteByte(c)
	}
	return b.String()
}

// buildMessageLayout reflects over rt's exported fields and produces the
// messageLayout used to pack instances into the curve body. Arrays of int8 /
// uint8 are treated as opaque bytes and skipped (no per-element columns).
func buildMessageLayout(rt reflect.Type) *messageLayout {
	def := &parser.FormatDef{Name: formatNameFromMessage(rt.Name())}
	b := &layoutBuilder{def: def}
	for i := 0; i < rt.NumField(); i++ {
		sf := rt.Field(i)
		if !sf.IsExported() {
			continue
		}
		b.addField(sf, i)
	}
	return &messageLayout{
		formatName: def.Name,
		def:        def,
		bodyLen:    b.off,
		packers:    b.packs,
	}
}

// layoutBuilder accumulates FieldLayout entries and packer closures while
// computing each field's byte offset.
type layoutBuilder struct {
	def   *parser.FormatDef
	packs []func(v reflect.Value, b []byte)
	off   int
}

func (b *layoutBuilder) addField(sf reflect.StructField, idx int) {
	if sf.Type.Kind() == reflect.Array {
		b.expandArray(sf, idx)
		return
	}
	if _, _, ok := glTypeFor(sf.Type.Kind()); ok {
		b.addScalar(sf.Name, sf.Type.Kind(), idx, -1)
	}
}

func (b *layoutBuilder) expandArray(sf reflect.StructField, idx int) {
	elem := sf.Type.Elem().Kind()
	if _, _, ok := glTypeFor(elem); !ok || elem == reflect.Uint8 || elem == reflect.Int8 {
		return
	}
	for j := 0; j < sf.Type.Len(); j++ {
		b.addScalar(fmt.Sprintf("%s[%d]", sf.Name, j), elem, idx, j)
	}
}

func (b *layoutBuilder) addScalar(name string, k reflect.Kind, fieldIdx, arrIdx int) {
	gl, size, _ := glTypeFor(k)
	b.def.FieldNames = append(b.def.FieldNames, name)
	b.def.Layout = append(b.def.Layout, parser.FieldLayout{
		Name: name, GLType: gl, Size: size, Scale: unitScaleFor(name, k),
		Offset: b.off, InBody: true, OrigType: origTypeName(k),
	})
	b.packs = append(b.packs, newFieldPacker(k, fieldIdx, arrIdx, b.off))
	b.off += size
}

// newFieldPacker returns a closure that writes one field's value into buffer
// at offset dst using little-endian encoding.
func newFieldPacker(k reflect.Kind, fieldIdx, arrIdx, dst int) func(v reflect.Value, b []byte) {
	get := func(v reflect.Value) reflect.Value {
		f := v.Field(fieldIdx)
		if arrIdx >= 0 {
			f = f.Index(arrIdx)
		}
		return f
	}
	switch k {
	case reflect.Uint8, reflect.Bool:
		return func(v reflect.Value, b []byte) { b[dst] = uint8(get(v).Uint()) }
	case reflect.Int8:
		return func(v reflect.Value, b []byte) { b[dst] = byte(int8(get(v).Int())) }
	case reflect.Uint16:
		return func(v reflect.Value, b []byte) { binary.LittleEndian.PutUint16(b[dst:], uint16(get(v).Uint())) }
	case reflect.Int16:
		return func(v reflect.Value, b []byte) { binary.LittleEndian.PutUint16(b[dst:], uint16(int16(get(v).Int()))) }
	case reflect.Uint32:
		return func(v reflect.Value, b []byte) { binary.LittleEndian.PutUint32(b[dst:], uint32(get(v).Uint())) }
	case reflect.Int32:
		return func(v reflect.Value, b []byte) { binary.LittleEndian.PutUint32(b[dst:], uint32(int32(get(v).Int()))) }
	case reflect.Float32, reflect.Float64:
		return func(v reflect.Value, b []byte) {
			binary.LittleEndian.PutUint32(b[dst:], math.Float32bits(float32(get(v).Float())))
		}
	}
	return nil
}
