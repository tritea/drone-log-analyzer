package ulog

import (
	"drone-log-analyzer/app/modules/parser"
)

// carriesUTC reports whether a topic is known to carry a wall-clock UTC field.
func carriesUTC(name string) bool {
	switch name {
	case "system_time", "sensor_gps", "vehicle_gps_position":
		return true
	}
	return false
}

// utcMillisFromTopic reads the time_utc_usec field and converts it to millis.
func utcMillisFromTopic(fd *parser.FormatDef, data []byte) (float64, bool) {
	utcUsec, ok := readScalarUint64(fd, data, "time_utc_usec")
	if !ok || utcUsec <= 0 {
		return 0, false
	}
	return float64(utcUsec) / 1000.0, true
}

// plausibleUTC bounds-checks a UTC millis value to reject garbage epochs.
func plausibleUTC(utcMs float64) bool {
	const (
		minReasonableUTCMs = 946684800000.0  // 2000-01-01
		maxReasonableUTCMs = 2524608000000.0 // 2050-01-01
	)
	return utcMs >= minReasonableUTCMs && utcMs < maxReasonableUTCMs
}
