package dataflash

import "drone-log-analyzer/app/modules/parser"

// glTypeForCode maps a DataFlash format character to its WebGL field type and
// the scale factor applied when rendering raw integer values as floats.
func glTypeForCode(ch byte) (parser.FieldGLType, float64, bool) {
	switch ch {
	case 'b':
		return parser.GLInt8, 1, true
	case 'B', 'M':
		return parser.GLUint8, 1, true
	case 'h':
		return parser.GLInt16, 1, true
	case 'H':
		return parser.GLUint16, 1, true
	case 'i':
		return parser.GLInt32, 1, true
	case 'I':
		return parser.GLUint32, 1, true
	case 'f':
		return parser.GLFloat32, 1, true
	case 'c':
		return parser.GLInt16, 0.01, true
	case 'C':
		return parser.GLUint16, 0.01, true
	case 'e':
		return parser.GLInt32, 0.01, true
	case 'E':
		return parser.GLUint32, 0.01, true
	case 'L':
		return parser.GLInt32, 1e-7, true
	default:
		return 0, 0, false
	}
}

// byteWidthOf reports the on-disk size in bytes of a single format character.
func byteWidthOf(ch byte) int {
	switch ch {
	case 'b', 'B', 'M':
		return 1
	case 'h', 'H', 'c', 'C':
		return 2
	case 'i', 'I', 'e', 'E', 'L', 'f':
		return 4
	case 'q', 'Q', 'd':
		return 8
	case 'n':
		return 4
	case 'N':
		return 16
	case 'Z':
		return 64
	default:
		return 0
	}
}

// assembleLayout derives the per-field byte layout of a FormatDef from its
// FormatStr/FieldNames. It is idempotent: a format that already has a layout
// or no format string is left untouched.
func assembleLayout(fd *parser.FormatDef) {
	if len(fd.Layout) > 0 || len(fd.FormatStr) == 0 {
		return
	}
	off := 0
	for i := 0; i < len(fd.FormatStr); i++ {
		ch := fd.FormatStr[i]
		size := byteWidthOf(ch)
		glType, scale, inBody := glTypeForCode(ch)
		if i < len(fd.FieldNames) {
			fd.Layout = append(fd.Layout, parser.FieldLayout{
				Name:     fd.FieldNames[i],
				GLType:   glType,
				Size:     size,
				Scale:    scale,
				Offset:   off,
				InBody:   inBody,
				OrigType: string(ch),
			})
		}
		off += size
	}
}
