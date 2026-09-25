package dataflash

import (
	"math"
	"strings"

	"drone-log-analyzer/app/modules/parser"
)

// textLineMillis reads the timestamp field of a text log line as milliseconds.
func textLineMillis(lf *parser.LogFile, fd *parser.FormatDef, values []any) float64 {
	_ = lf
	for i, fn := range fd.FieldNames {
		if i >= len(values) {
			break
		}
		if isTimestampField(fn) {
			return normalizeTimeMicros(fn, parser.ToFloat64(values[i]))
		}
	}
	return 0
}

// syncTimeBaseFromGPS establishes the UTC time base from the first GPS record
// seen on a text stream, when no base has been set yet.
func syncTimeBaseFromGPS(lf *parser.LogFile, msgName string, fd *parser.FormatDef, values []any, timeMs float64) {
	if lf.HasTimeBase() || msgName != "GPS" {
		return
	}
	utcMs, ok := gpsFieldUnixMillis(fd, values)
	if !ok || utcMs <= 0 {
		return
	}
	lf.SetTimeBase(utcMs - timeMs)
}

// isPlausibleUTCMs reports whether a millisecond Unix timestamp falls in the
// accepted 2000..2050 window.
func isPlausibleUTCMs(utcMs float64) bool {
	const (
		minReasonableUTCMs = 946684800000.0
		maxReasonableUTCMs = 2524608000000.0
	)
	return utcMs >= minReasonableUTCMs && utcMs < maxReasonableUTCMs
}

// isPlausibleUTCSec reports whether a second-precision Unix timestamp falls in
// the accepted 2000..2050 window.
func isPlausibleUTCSec(utcSecs uint32) bool {
	const (
		minReasonableUTC = 946684800
		maxReasonableUTC = 2524608000
	)
	return utcSecs >= minReasonableUTC && utcSecs < maxReasonableUTC
}

// weekMSToUnixMillis converts a GPS week + GPS milliseconds value to Unix
// milliseconds, applying the GPS-UTC leap offset and a plausibility window.
func weekMSToUnixMillis(week, gms float64) (float64, bool) {
	if week <= 0 || gms < 0 {
		return 0, false
	}
	const (
		gpsEpochUnixMs = 315964800000.0
		weekMs         = 7 * 24 * 60 * 60 * 1000.0
		gpsUTCLeapMs   = 18 * 1000.0
	)
	utcMs := gpsEpochUnixMs + week*weekMs + gms - gpsUTCLeapMs
	if !isPlausibleUTCMs(utcMs) {
		return 0, false
	}
	return utcMs, true
}

// lookupNamedNumber finds the first numeric field matching any candidate name
// and returns its finite value.
func lookupNamedNumber(fd *parser.FormatDef, values []any, names ...string) (float64, bool) {
	for i, fn := range fd.FieldNames {
		if i >= len(values) {
			break
		}
		for _, name := range names {
			if strings.EqualFold(strings.TrimSpace(fn), name) {
				v := parser.ToFloat64(values[i])
				return v, !math.IsNaN(v) && !math.IsInf(v, 0)
			}
		}
	}
	return 0, false
}

// gpsFieldUnixMillis decodes GPS week/GMS fields from text-line values into
// Unix milliseconds.
func gpsFieldUnixMillis(fd *parser.FormatDef, values []any) (float64, bool) {
	week, okWeek := lookupNamedNumber(fd, values, "GWk", "GPSWeek", "Week", "Wk")
	gms, okGMS := lookupNamedNumber(fd, values, "GMS", "GTimeMS", "GPSTimeMS", "TOW", "Tow", "TowMS", "TimeOfWeekMS", "MS")
	if !okWeek || !okGMS {
		return 0, false
	}
	return weekMSToUnixMillis(week, gms)
}

// textLineInstance extracts the instance id of a text log line.
func textLineInstance(fd *parser.FormatDef, values []any) (int, bool) {
	for i, fn := range fd.FieldNames {
		if i >= len(values) {
			break
		}
		if isInstanceField(fn) {
			return toInstanceId(parser.ToFloat64(values[i]))
		}
	}
	return 0, false
}
