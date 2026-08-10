package dataflash

import (
	"encoding/binary"
	"math"
	"strings"

	"drone-log-analyzer/app/modules/parser"
)

// readPrimitive decodes a single little-endian value of the given format code
// from data[offset:]. It returns the decoded value and the number of bytes
// consumed.
func readPrimitive(ch byte, data []byte, offset int) (any, int) {
	switch ch {
	case 'b':
		return int8(data[offset]), 1
	case 'B':
		return data[offset], 1
	case 'h':
		return int16(binary.LittleEndian.Uint16(data[offset:])), 2
	case 'H':
		return binary.LittleEndian.Uint16(data[offset:]), 2
	case 'i':
		return int32(binary.LittleEndian.Uint32(data[offset:])), 4
	case 'I':
		return binary.LittleEndian.Uint32(data[offset:]), 4
	case 'q':
		return int64(binary.LittleEndian.Uint64(data[offset:])), 8
	case 'Q':
		return binary.LittleEndian.Uint64(data[offset:]), 8
	case 'f':
		return math.Float32frombits(binary.LittleEndian.Uint32(data[offset:])), 4
	case 'd':
		return math.Float64frombits(binary.LittleEndian.Uint64(data[offset:])), 8
	case 'c':
		return float64(int16(binary.LittleEndian.Uint16(data[offset:]))) / 100.0, 2
	case 'C':
		return float64(binary.LittleEndian.Uint16(data[offset:])) / 100.0, 2
	case 'e':
		return float64(int32(binary.LittleEndian.Uint32(data[offset:]))) / 100.0, 4
	case 'E':
		return float64(binary.LittleEndian.Uint32(data[offset:])) / 100.0, 4
	case 'L':
		return float64(int32(binary.LittleEndian.Uint32(data[offset:]))) / 1e7, 4
	case 'n':
		return strings.TrimRight(string(data[offset:offset+4]), "\x00"), 4
	case 'N':
		return strings.TrimRight(string(data[offset:offset+16]), "\x00"), 16
	case 'M':
		return data[offset], 1
	case 'Z':
		return strings.TrimRight(string(data[offset:offset+64]), "\x00"), 64
	default:
		return nil, 0
	}
}

// indexOfNamedField returns the position of the first field whose name matches
// any of the candidates (case-insensitive, trimmed), or -1 if none match.
func indexOfNamedField(fd *parser.FormatDef, names ...string) int {
	for i, fn := range fd.FieldNames {
		f := strings.ToLower(strings.TrimSpace(fn))
		for _, n := range names {
			if f == strings.ToLower(strings.TrimSpace(n)) {
				return i
			}
		}
	}
	return -1
}

// byteOffsetOfField computes the byte offset of field idx within a record by
// summing the byte widths of the preceding format characters.
func byteOffsetOfField(fd *parser.FormatDef, idx int) int {
	off := 0
	for i := 0; i < idx && i < len(fd.FormatStr); i++ {
		off += byteWidthOf(fd.FormatStr[i])
	}
	return off
}

// readFieldByName decodes the first field matching any candidate name.
func readFieldByName(fd *parser.FormatDef, data []byte, names ...string) (any, bool) {
	idx := indexOfNamedField(fd, names...)
	if idx < 0 || idx >= len(fd.FormatStr) {
		return nil, false
	}
	v, _ := readPrimitive(fd.FormatStr[idx], data, byteOffsetOfField(fd, idx))
	return v, true
}

// readAllFields decodes every field of a binary record into a slice, stopping
// at the end of data.
func readAllFields(fd *parser.FormatDef, data []byte) []any {
	values := make([]any, 0, len(fd.FormatStr))
	off := 0
	for i := 0; i < len(fd.FormatStr); i++ {
		if off >= len(data) {
			break
		}
		val, size := readPrimitive(fd.FormatStr[i], data, off)
		values = append(values, val)
		off += size
	}
	return values
}

// readTimeMillis extracts the TimeMS/Time (millis) or TimeUS (micros /1000)
// timestamp from a binary record.
func readTimeMillis(fd *parser.FormatDef, data []byte) float64 {
	for i, fn := range fd.FieldNames {
		if i >= len(fd.FormatStr) {
			break
		}
		if isTimestampField(fn) {
			v, _ := readPrimitive(fd.FormatStr[i], data, byteOffsetOfField(fd, i))
			return normalizeTimeMicros(fn, parser.ToFloat64(v))
		}
	}
	return 0
}

// readInstanceId extracts the Instance/I/Inst field of a binary record.
func readInstanceId(fd *parser.FormatDef, data []byte) (int, bool) {
	for i, fn := range fd.FieldNames {
		if i >= len(fd.FormatStr) {
			break
		}
		if isInstanceField(fn) {
			v, _ := readPrimitive(fd.FormatStr[i], data, byteOffsetOfField(fd, i))
			return toInstanceId(parser.ToFloat64(v))
		}
	}
	return 0, false
}

// gpsBytesUnixMillis decodes GPS week/GMS fields from a binary record and
// returns the corresponding Unix milliseconds.
func gpsBytesUnixMillis(fd *parser.FormatDef, data []byte) (float64, bool) {
	wk, okW := readFieldByName(fd, data, "GWk", "GPSWeek", "Week", "Wk")
	gms, okG := readFieldByName(fd, data, "GMS", "GTimeMS", "GPSTimeMS", "TOW", "Tow", "TowMS", "TimeOfWeekMS", "MS")
	if !okW || !okG {
		return 0, false
	}
	return weekMSToUnixMillis(parser.ToFloat64(wk), parser.ToFloat64(gms))
}

func isTimestampField(fn string) bool {
	return fn == "TimeMS" || fn == "Time" || fn == "TimeUS"
}

func isInstanceField(fn string) bool {
	return fn == "I" || fn == "Instance" || fn == "Inst"
}

func normalizeTimeMicros(fn string, raw float64) float64 {
	if fn == "TimeUS" {
		return raw / 1000.0
	}
	return raw
}

func toInstanceId(v float64) (int, bool) {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
		return 0, false
	}
	return int(v), true
}
