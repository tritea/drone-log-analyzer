package ulog

import (
	"bytes"
	"encoding/binary"
	"math"
	"strings"

	"drone-log-analyzer/app/modules/parser"
)

// readScalarUint reads an unsigned 1/2/4-byte little-endian field by name.
func readScalarUint(fd *parser.FormatDef, data []byte, name string) (uint64, bool) {
	for _, fl := range fd.Layout {
		if fl.Name != name || !fl.InBody {
			continue
		}
		off := fl.Offset
		switch fl.Size {
		case 1:
			if off+1 <= len(data) {
				return uint64(data[off]), true
			}
		case 2:
			if off+2 <= len(data) {
				return uint64(binary.LittleEndian.Uint16(data[off : off+2])), true
			}
		case 4:
			if off+4 <= len(data) {
				return uint64(binary.LittleEndian.Uint32(data[off : off+4])), true
			}
		}
	}
	return 0, false
}

// readScalarFloat reads a 4- or 8-byte float field by name, sanitizing
// NaN/Inf values to 0 so downstream consumers never see non-finite floats.
func readScalarFloat(fd *parser.FormatDef, data []byte, name string) (float64, bool) {
	for _, fl := range fd.Layout {
		if fl.Name != name || !fl.InBody {
			continue
		}
		off := fl.Offset
		switch fl.Size {
		case 4:
			if off+4 <= len(data) {
				return cleanFloat(float64(math.Float32frombits(binary.LittleEndian.Uint32(data[off : off+4])))), true
			}
		case 8:
			if off+8 <= len(data) {
				return cleanFloat(math.Float64frombits(binary.LittleEndian.Uint64(data[off : off+8]))), true
			}
		}
	}
	return 0, false
}

// cleanFloat returns 0 for NaN/Inf, otherwise v unchanged.
func cleanFloat(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

// readScalarUint64 reads an 8-byte little-endian uint64 field by name.
func readScalarUint64(fd *parser.FormatDef, data []byte, name string) (uint64, bool) {
	for _, fl := range fd.Layout {
		if fl.Name != name || fl.Size != 8 {
			continue
		}
		if fl.Offset+8 <= len(data) {
			return binary.LittleEndian.Uint64(data[fl.Offset : fl.Offset+8]), true
		}
	}
	return 0, false
}

// readTopicTime returns the topic sample's timestamp in microseconds, or 0.
func readTopicTime(fd *parser.FormatDef, data []byte) uint64 {
	for _, fl := range fd.Layout {
		if fl.Size == 8 && looksLikeTimestamp(fl.Name) && fl.Offset+8 <= len(data) {
			return binary.LittleEndian.Uint64(data[fl.Offset : fl.Offset+8])
		}
	}
	return 0
}

// looksLikeTimestamp reports whether a field name is a ULog timestamp field.
func looksLikeTimestamp(name string) bool {
	low := strings.ToLower(name)
	return low == "timestamp" || low == "timestamp_sample" || strings.Contains(low, "timestamp")
}

// cutCString splits b at the first NUL byte, returning the string and remainder.
func cutCString(b []byte) (string, []byte) {
	if idx := bytes.IndexByte(b, 0); idx >= 0 {
		return string(b[:idx]), b[idx+1:]
	}
	return string(b), nil
}
