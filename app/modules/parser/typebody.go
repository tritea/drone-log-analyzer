package parser

import (
	"encoding/binary"
	"math"
	"os"
)

// scrubFinite turns NaN/Inf into 0 so a stray bad value can't poison a curve's
// min/max or the serialized binary range.
func scrubFinite(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

// assembleFromCurves builds a TypeBody by packing the per-field sample slices
// for a message type into a flat, stride-aligned row table. Used when the type
// was parsed from text (no accumulator buffer exists).
func (lf *LogFile) assembleFromCurves(msgName string, fields map[string]*CurveData) *TypeBody {
	fd := lf.lookupFormat(msgName)
	if fd == nil {
		return nil
	}

	type columnSpec struct {
		curve *CurveData
		gl    FieldGLType
		scale float64
	}
	specs := make([]columnSpec, 0, len(fd.Layout))
	for _, fl := range fd.Layout {
		if !fl.InBody {
			continue
		}
		cd := fields[fl.Name]
		if cd == nil || len(cd.samples) == 0 {
			continue
		}
		specs = append(specs, columnSpec{curve: cd, gl: GLFloat32, scale: 1})
	}
	if len(specs) == 0 {
		return nil
	}

	rowCount := len(specs[0].curve.samples)
	for _, s := range specs {
		if len(s.curve.samples) > rowCount {
			rowCount = len(s.curve.samples)
		}
	}

	type columnPlan struct {
		curve  *CurveData
		gl     FieldGLType
		scale  float64
		offset int
	}
	plan := make([]columnPlan, len(specs))
	off := TimeColBytes
	for i, s := range specs {
		size := s.gl.Size()
		off = alignOffset(off, size)
		plan[i] = columnPlan{s.curve, s.gl, s.scale, off}
		off += size
	}
	stride := alignOffset(off, 4)

	var base float64
	if len(specs[0].curve.times) > 0 {
		base = specs[0].curve.times[0]
	}

	buf := make([]byte, TypeBinHeader+stride*rowCount)
	binary.LittleEndian.PutUint32(buf[0:4], TypeBinMagic)
	binary.LittleEndian.PutUint32(buf[4:8], TypeBinVersion)
	binary.LittleEndian.PutUint32(buf[8:12], uint32(rowCount))
	binary.LittleEndian.PutUint32(buf[12:16], uint32(len(plan)))
	binary.LittleEndian.PutUint32(buf[16:20], uint32(stride))
	binary.LittleEndian.PutUint32(buf[20:24], 0)
	binary.LittleEndian.PutUint64(buf[24:32], math.Float64bits(base))

	for r := 0; r < rowCount; r++ {
		rowBase := TypeBinHeader + r*stride
		var dms int32
		if r < len(specs[0].curve.times) {
			dms = int32(specs[0].curve.times[r] - base)
		}
		binary.LittleEndian.PutUint32(buf[rowBase:rowBase+TimeColBytes], uint32(dms))
		for _, c := range plan {
			if r >= len(c.curve.samples) {
				continue
			}
			binary.LittleEndian.PutUint32(buf[rowBase+c.offset:rowBase+c.offset+4], math.Float32bits(c.curve.samples[r]))
		}
	}

	tb := &TypeBody{RowCount: rowCount, Stride: stride, BaseTimeMs: base, Bin: buf}
	prefix := len(msgName) + 1
	for i, c := range plan {
		name := c.curve.Name
		if len(name) > prefix {
			name = name[prefix:]
		}
		tb.Fields = append(tb.Fields, TypeField{
			Name: name, GLType: c.gl, Scale: c.scale, Offset: c.offset,
			Min: c.curve.Min, Max: c.curve.Max, Count: len(c.curve.samples),
		})
		c.curve.body = tb
		c.curve.column = i
	}
	return tb
}

// assembleFromAccum stamps relative timestamps onto an accumulator's packed
// buffer and wraps it as a TypeBody. Used for binary-parsed types.
func (lf *LogFile) assembleFromAccum(msgName string, ac *rowAccum) *TypeBody {
	if len(ac.cols) == 0 || len(ac.times) == 0 {
		return nil
	}
	rowCount := len(ac.times)
	base := ac.times[0]
	for r := 0; r < rowCount; r++ {
		rowBase := r * ac.stride
		binary.LittleEndian.PutUint32(ac.buf[rowBase:rowBase+TimeColBytes], uint32(int32(ac.times[r]-base)))
	}
	buf := make([]byte, TypeBinHeader+len(ac.buf))
	binary.LittleEndian.PutUint32(buf[0:4], TypeBinMagic)
	binary.LittleEndian.PutUint32(buf[4:8], TypeBinVersion)
	binary.LittleEndian.PutUint32(buf[8:12], uint32(rowCount))
	binary.LittleEndian.PutUint32(buf[12:16], uint32(len(ac.cols)))
	binary.LittleEndian.PutUint32(buf[16:20], uint32(ac.stride))
	binary.LittleEndian.PutUint32(buf[20:24], 0)
	binary.LittleEndian.PutUint64(buf[24:32], math.Float64bits(base))
	copy(buf[TypeBinHeader:], ac.buf)

	tb := &TypeBody{RowCount: rowCount, Stride: ac.stride, BaseTimeMs: base, Bin: buf}
	prefix := len(msgName) + 1
	for i, f := range ac.cols {
		name := f.curve.Name
		if len(name) > prefix {
			name = name[prefix:]
		}
		tb.Fields = append(tb.Fields, TypeField{
			Name: name, GLType: f.glType, Scale: f.scale, Offset: f.dstOff,
			Min: f.curve.Min, Max: f.curve.Max, Count: rowCount,
		})
		f.curve.body = tb
		f.curve.column = i
	}
	return tb
}

// freezeAllCurves packs every message type into a TypeBody, releases the
// per-curve sample slices, and (for large logs) spills bodies to a temp file so
// peak heap stays bounded.
func (lf *LogFile) freezeAllCurves() {
	lf.TypeBodies = make(map[string]*TypeBody)
	f, err := os.CreateTemp("", "dla-curves-*.bin")
	canSpool := err == nil
	if canSpool {
		lf.spool = f
	}
	var off int64
	for msgName, fields := range lf.Curves {
		for _, cd := range fields {
			cd.Min = scrubFinite(cd.Min)
			cd.Max = scrubFinite(cd.Max)
		}
		var tb *TypeBody
		if ac := lf.accumulators[msgName]; ac != nil {
			tb = lf.assembleFromAccum(msgName, ac)
			ac.buf = nil
			ac.times = nil
		} else {
			tb = lf.assembleFromCurves(msgName, fields)
		}
		for _, cd := range fields {
			cd.times, cd.samples = nil, nil
			cd.frozen = true
		}
		if tb == nil || len(tb.Bin) == 0 {
			continue
		}
		if canSpool {
			if n, werr := f.Write(tb.Bin); werr == nil {
				tb.spoolStart = off
				tb.spoolSize = int64(n)
				off += int64(n)
				tb.Bin = nil
			}
		}
		lf.TypeBodies[msgName] = tb
	}
}

// bodyBytes returns the raw bytes for a TypeBody, reading them back from the
// spool file when they were spilled there during finalize.
func (lf *LogFile) bodyBytes(tb *TypeBody) []byte {
	if tb == nil {
		return nil
	}
	if tb.Bin != nil {
		return tb.Bin
	}
	if lf.spool != nil && tb.spoolSize > 0 {
		buf := make([]byte, tb.spoolSize)
		if _, err := lf.spool.ReadAt(buf, tb.spoolStart); err == nil {
			return buf
		}
	}
	return nil
}
