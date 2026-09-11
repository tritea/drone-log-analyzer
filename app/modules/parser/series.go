package parser

import "encoding/binary"

// CurveSeries decodes a curve into parallel (timeMs, value) slices, where timeMs
// is the absolute per-row timestamp in milliseconds (TypeBody.BaseTimeMs plus the
// per-row relative millisecond column). It is the time-aware counterpart of
// CurveValues and backs range/statistics queries.
func (lf *LogFile) CurveSeries(cd *CurveData) (times []float64, values []float64) {
	if cd.body == nil || cd.column >= len(cd.body.Fields) {
		return nil, nil
	}
	tb := cd.body
	tf := tb.Fields[cd.column]
	body := lf.bodyBytes(tb)
	n := tf.Count
	times = make([]float64, n)
	values = make([]float64, n)
	if body == nil {
		return times, values
	}
	for r := 0; r < n; r++ {
		rowBase := TypeBinHeader + r*tb.Stride
		dms := int32(binary.LittleEndian.Uint32(body[rowBase : rowBase+TimeColBytes]))
		times[r] = tb.BaseTimeMs + float64(dms)
		values[r] = ReadFieldGL(body, rowBase+tf.Offset, tf.GLType) * tf.Scale
	}
	return times, values
}

// EarliestBodyTimeMs returns the smallest first-sample timestamp across all
// packed type bodies (or 0 when none). Callers use it to rebase per-group
// absolute timestamps onto one log-wide origin.
func (lf *LogFile) EarliestBodyTimeMs() float64 {
	earliest := 0.0
	first := true
	for _, tb := range lf.TypeBodies {
		if tb == nil || tb.RowCount == 0 {
			continue
		}
		if first || tb.BaseTimeMs < earliest {
			earliest = tb.BaseTimeMs
			first = false
		}
	}
	return earliest
}
