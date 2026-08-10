package parser

import "math"

// initCurves ensures every field of a message type has a CurveData slot,
// creating the message bucket on first sight.
func (lf *LogFile) initCurves(msgName string, fd *FormatDef, instance string) {
	if _, ok := lf.Curves[msgName]; ok {
		return
	}
	lf.Curves[msgName] = make(map[string]*CurveData)
	for _, fn := range fd.FieldNames {
		lf.Curves[msgName][fn] = &CurveData{
			Name:     msgName + "." + fn,
			Instance: instance,
		}
	}
}

// ingestTextRow appends one text-parsed message instance to its curves, growing
// the times/samples slices and tracking per-field min/max. Non-finite values are
// dropped so they never poison the chart range.
func (lf *LogFile) ingestTextRow(msgName string, fd *FormatDef, values []any, timeMs float64, _ int, instance string) {
	lf.initCurves(msgName, fd, instance)
	for i, fn := range fd.FieldNames {
		if i >= len(values) {
			break
		}
		cd, ok := lf.Curves[msgName][fn]
		if !ok {
			continue
		}
		fval := ToFloat64(values[i])
		if math.IsNaN(fval) || math.IsInf(fval, 0) {
			continue
		}
		cd.times = append(cd.times, timeMs)
		cd.samples = append(cd.samples, float32(fval))
		if len(cd.times) == 1 {
			cd.Min = fval
			cd.Max = fval
		} else {
			if fval < cd.Min {
				cd.Min = fval
			}
			if fval > cd.Max {
				cd.Max = fval
			}
		}
	}
}
