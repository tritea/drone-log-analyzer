package parser

import (
	"encoding/binary"
	"math"
)

// rowAccum packs incoming rows for one message type into a flat, fixed-stride
// byte buffer so the final TypeBody can be sliced straight out of it.
type rowAccum struct {
	cols   []accumCol
	stride int
	buf    []byte
	times  []float64
}

// accumCol maps one field of a message format onto its slot within a packed row.
type accumCol struct {
	curve  *CurveData
	srcOff int // offset within the raw message payload
	srcLen int // byte width in the raw payload (may differ from the stored width)
	dstOff int // offset within the packed row
	glType FieldGLType
	scale  float64
}

// ingestBinaryRow decodes one binary message instance, appending a packed row to
// the message's accumulator (if it has body fields) and updating per-field stats.
func (lf *LogFile) ingestBinaryRow(msgName string, fd *FormatDef, instance string, msgData []byte, timeMs float64) {
	lf.initCurves(msgName, fd, instance)
	if ac := lf.ensureAccumulator(msgName, fd); ac != nil {
		lf.appendRow(ac, msgData, timeMs)
	}
}

// ensureAccumulator lazily builds the row layout for a message type from its
// format definition, skipping types with no in-body fields.
func (lf *LogFile) ensureAccumulator(msgName string, fd *FormatDef) *rowAccum {
	if lf.accumulators == nil {
		lf.accumulators = make(map[string]*rowAccum)
	}
	if ac, ok := lf.accumulators[msgName]; ok {
		return ac
	}
	fields, ok := lf.Curves[msgName]
	if !ok {
		return nil
	}
	ac := &rowAccum{}
	dstOff := TimeColBytes
	for _, fl := range fd.Layout {
		if !fl.InBody {
			continue
		}
		cd := fields[fl.Name]
		if cd == nil {
			continue
		}
		dstOff = alignOffset(dstOff, fl.GLType.Size())
		ac.cols = append(ac.cols, accumCol{
			curve: cd, srcOff: fl.Offset, srcLen: fl.Size, dstOff: dstOff, glType: fl.GLType, scale: fl.Scale,
		})
		cd.Min = math.Inf(1)
		cd.Max = math.Inf(-1)
		dstOff += fl.GLType.Size()
	}
	if len(ac.cols) == 0 {
		return nil
	}
	ac.stride = alignOffset(dstOff, 4)
	lf.accumulators[msgName] = ac
	return ac
}

// appendRow writes one decoded row into the accumulator buffer and records its
// timestamp, widening fields that are stored wider on disk than in the format.
func (lf *LogFile) appendRow(ac *rowAccum, msgData []byte, timeMs float64) {
	rowBase := len(ac.buf)
	ac.buf = append(ac.buf, make([]byte, ac.stride)...)
	for _, f := range ac.cols {
		if f.srcOff+f.srcLen > len(msgData) {
			continue
		}
		storeN := f.glType.Size()
		dst := ac.buf[rowBase+f.dstOff : rowBase+f.dstOff+storeN]
		var fv float64
		switch {
		case f.srcLen == storeN:
			// Widths match: copy bytes verbatim and decode for stats.
			copy(dst, msgData[f.srcOff:f.srcOff+storeN])
			fv = ReadFieldGL(msgData, f.srcOff, f.glType) * f.scale
		case f.glType == GLInt32:
			// Wide integer field (e.g. scaled lat/lon): round back into int32.
			degE7 := int32(math.Round(readWideFloat(msgData, f.srcOff, f.srcLen) / f.scale))
			binary.LittleEndian.PutUint32(dst, uint32(degE7))
			fv = float64(degE7) * f.scale
		default:
			// Wide float field: store as float32.
			fv = readWideFloat(msgData, f.srcOff, f.srcLen) * f.scale
			binary.LittleEndian.PutUint32(dst, math.Float32bits(float32(fv)))
		}
		if !math.IsNaN(fv) && !math.IsInf(fv, 0) {
			if fv < f.curve.Min {
				f.curve.Min = fv
			}
			if fv > f.curve.Max {
				f.curve.Max = fv
			}
		}
	}
	ac.times = append(ac.times, timeMs)
}

// readWideFloat decodes an 8-byte little-endian float64 from data; 0 otherwise.
func readWideFloat(data []byte, off, size int) float64 {
	if size == 8 && off+8 <= len(data) {
		return math.Float64frombits(binary.LittleEndian.Uint64(data[off : off+8]))
	}
	return 0
}
