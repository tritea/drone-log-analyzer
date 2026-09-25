package ulog

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// coerceScalar interprets b according to a ULog info/param type string and
// returns the value as the narrowest matching Go scalar (or a trimmed string).
func coerceScalar(b []byte, typeStr string) any {
	switch {
	case strings.HasPrefix(typeStr, "char"):
		return strings.TrimRight(string(b), "\x00")
	case strings.Contains(typeStr, "uint64"), strings.Contains(typeStr, "int64"):
		if len(b) >= 8 {
			return int64(binary.LittleEndian.Uint64(b[:8]))
		}
	case strings.Contains(typeStr, "uint32"):
		if len(b) >= 4 {
			return binary.LittleEndian.Uint32(b[:4])
		}
	case strings.Contains(typeStr, "int32"):
		if len(b) >= 4 {
			return int32(binary.LittleEndian.Uint32(b[:4]))
		}
	case strings.Contains(typeStr, "uint16"):
		if len(b) >= 2 {
			return binary.LittleEndian.Uint16(b[:2])
		}
	case strings.Contains(typeStr, "int16"):
		if len(b) >= 2 {
			return int16(binary.LittleEndian.Uint16(b[:2]))
		}
	case strings.Contains(typeStr, "double"):
		if len(b) >= 8 {
			return math.Float64frombits(binary.LittleEndian.Uint64(b[:8]))
		}
	case strings.Contains(typeStr, "float"):
		if len(b) >= 4 {
			return math.Float32frombits(binary.LittleEndian.Uint32(b[:4]))
		}
	case typeStr == "bool":
		if len(b) >= 1 {
			return b[0] != 0
		}
	}
	return strings.TrimRight(string(b), "\x00")
}

// asFloat64 converts a coerced scalar value to float64 (parsing numeric strings).
func asFloat64(v any) (float64, bool) {
	switch x := v.(type) {
	case int8:
		return float64(x), true
	case uint8:
		return float64(x), true
	case int16:
		return float64(x), true
	case uint16:
		return float64(x), true
	case int32:
		return float64(x), true
	case uint32:
		return float64(x), true
	case float32:
		return float64(x), true
	case float64:
		return x, true
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(x), 64); err == nil {
			return f, true
		}
	}
	return 0, false
}

// asText renders a coerced scalar value as text, hex-encoding binary blobs.
func asText(v any) string {
	switch x := v.(type) {
	case string:
		s := strings.TrimSpace(x)
		if hasUnprintable(s) {
			return hex.EncodeToString([]byte(s))
		}
		return s
	case float64:
		if x == float64(int64(x)) {
			return strconv.FormatInt(int64(x), 10)
		}
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	return fmt.Sprintf("%v", v)
}

// hasUnprintable reports whether s contains non-printable bytes.
func hasUnprintable(s string) bool {
	if s == "" {
		return false
	}
	for _, b := range []byte(s) {
		if (b < 0x20 && b != '\t' && b != '\n' && b != '\r') || b >= 0x7f {
			return true
		}
	}
	return false
}
