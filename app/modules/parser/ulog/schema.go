package ulog

import (
	"fmt"
	"strings"

	"drone-log-analyzer/app/modules/parser"
)

// declField is one parsed "<ctype> <name>" token from a ULog format string.
type declField struct {
	cType string
	name  string
}

// parseTypeSpec splits a ULog format body (e.g. "uint64_t timestamp;float x")
// into its constituent field declarations.
func parseTypeSpec(spec string) []declField {
	var fields []declField
	for _, seg := range strings.Split(spec, ";") {
		seg = strings.TrimSpace(seg)
		if seg == "" {
			continue
		}
		tok := strings.Fields(seg)
		if len(tok) < 2 {
			continue
		}
		fields = append(fields, declField{cType: tok[0], name: tok[len(tok)-1]})
	}
	return fields
}

// primitiveByteLen reports the byte size of a scalar C type, defaulting to 1.
func primitiveByteLen(ctype string) int {
	switch ctype {
	case "uint8_t", "int8_t", "bool", "char":
		return 1
	case "uint16_t", "int16_t":
		return 2
	case "uint32_t", "int32_t", "float":
		return 4
	case "uint64_t", "int64_t", "double":
		return 8
	}
	return 1
}

// mapScalar maps a (possibly array) C type to its graph-layout descriptor.
// In-body scalars become chartable values; arrays and char buffers do not.
func mapScalar(ctype string) (gl parser.FieldGLType, size int, scale float64, inBody bool) {
	if i := strings.IndexByte(ctype, '['); i > 0 {
		elem := ctype[:i]
		cnt := arrayLength(ctype[i:])
		return 0, primitiveByteLen(elem) * cnt, 1, false
	}
	switch ctype {
	case "uint8_t", "bool":
		return parser.GLUint8, 1, 1, true
	case "int8_t":
		return parser.GLInt8, 1, 1, true
	case "uint16_t":
		return parser.GLUint16, 2, 1, true
	case "int16_t":
		return parser.GLInt16, 2, 1, true
	case "uint32_t":
		return parser.GLUint32, 4, 1, true
	case "int32_t":
		return parser.GLInt32, 4, 1, true
	case "float":
		return parser.GLFloat32, 4, 1, true
	case "char":
		return 0, 1, 1, false
	case "double":
		return parser.GLFloat32, 8, 1, true
	case "uint64_t", "int64_t":
		return parser.GLFloat32, 8, 1, false
	}
	return 0, 0, 1, false
}

// arrayLength parses the integer inside "[n]", returning 0 on a malformed span.
func arrayLength(s string) int {
	if len(s) < 3 || s[0] != '[' {
		return 0
	}
	end := strings.IndexByte(s, ']')
	if end < 0 {
		return 0
	}
	n := 0
	for _, c := range s[1:end] {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// assembleLayout populates fd.FieldNames and fd.Layout from the parsed
// declarations, computing per-field offsets and applying the lat/lon rule.
func assembleLayout(fd *parser.FormatDef, fields []declField) {
	fd.FieldNames = make([]string, 0, len(fields))
	off := 0
	for _, f := range fields {
		if elemType, count, ok := expandableArray(f.cType); ok {
			elemGL, elemSize, _, _ := mapScalar(elemType)
			for i := 0; i < count; i++ {
				name := fmt.Sprintf("%s[%d]", f.name, i)
				fd.FieldNames = append(fd.FieldNames, name)
				fd.Layout = append(fd.Layout, parser.FieldLayout{
					Name: name, GLType: elemGL, Size: elemSize, Scale: 1,
					Offset: off, InBody: true, OrigType: elemType,
				})
				off += elemSize
			}
			continue
		}
		gl, size, scale, inBody := mapScalar(f.cType)
		if isGeoCoord(f.name) {
			switch f.cType {
			case "int32_t", "uint32_t":
				gl, scale, inBody = parser.GLInt32, 1e-7, true
			case "double":
				gl, scale, inBody = parser.GLInt32, 1e-7, true
			}
		}
		fd.FieldNames = append(fd.FieldNames, f.name)
		fd.Layout = append(fd.Layout, parser.FieldLayout{
			Name: f.name, GLType: gl, Size: size, Scale: scale,
			Offset: off, InBody: inBody, OrigType: f.cType,
		})
		off += size
	}
}

// isGeoCoord reports whether name looks like a latitude/longitude field.
func isGeoCoord(name string) bool {
	n := strings.ToLower(name)
	switch n {
	case "lat", "lon", "lng", "latitude", "longitude":
		return true
	}
	return strings.Contains(n, "latitude") || strings.Contains(n, "longitude")
}

// expandableArray returns the element type and count for array types that the
// chart layer wants expanded into indexed sub-fields.
func expandableArray(ctype string) (elemType string, count int, expandable bool) {
	i := strings.IndexByte(ctype, '[')
	if i <= 0 {
		return "", 0, false
	}
	elemType = ctype[:i]
	count = arrayLength(ctype[i:])
	switch elemType {
	case "float", "double", "int16_t", "uint16_t", "int32_t", "uint32_t", "int64_t", "uint64_t":
		return elemType, count, true
	}
	return elemType, count, false
}
