package parser

import (
	"fmt"
	"math"
	"strconv"
)

func ToFloat64(v any) float64 {
	switch val := v.(type) {
	case int8:
		return float64(val)
	case uint8:
		return float64(val)
	case int16:
		return float64(val)
	case uint16:
		return float64(val)
	case int32:
		return float64(val)
	case uint32:
		return float64(val)
	case int64:
		return float64(val)
	case uint64:
		return float64(val)
	case float32:
		return float64(val)
	case float64:
		return val
	case string:
		f, err := strconv.ParseFloat(val, 64)
		if err != nil {
			return math.NaN()
		}
		return f
	default:
		return math.NaN()
	}
}

func InstanceTypeName(msgName string, instance int) string {
	return fmt.Sprintf("%s%d", msgName, instance+1)
}
