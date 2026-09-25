package parser

import (
	"encoding/binary"
	"math"
)

// On-disk wire constants for the curve and type-body blobs handed to the
// frontend. The magic lets the renderer sanity-check the buffer.
const (
	CurveBinMagic   uint32 = 0x4E554342
	CurveBinVersion uint32 = 1
	CurveBinHeader         = 28
)

// Type-body blob constants.
const (
	TypeBinMagic   uint32 = 0x4E555442
	TypeBinVersion uint32 = 1
	TypeBinHeader         = 32
	TimeColBytes          = 4
)

// CurveData is one numeric series for a (message, field) pair. While a log is
// being parsed it holds growing times/samples slices; after Finalize the data is
// packed into a TypeBody and the slices are released, leaving body+column to
// address rows in the packed buffer.
type CurveData struct {
	Name     string
	Unit     string
	Instance string
	Min      float64
	Max      float64

	body   *TypeBody
	column int

	times   []float64
	samples []float32

	frozen bool
}

// TypeBody is the packed, column-major binary representation of one message
// type's samples, written as a fixed-stride row table prefixed by TypeBinHeader.
type TypeBody struct {
	Fields     []TypeField
	RowCount   int
	Stride     int
	BaseTimeMs float64

	Bin        []byte
	spoolStart int64
	spoolSize  int64
}

// TypeField describes one column within a TypeBody.
type TypeField struct {
	Name   string
	GLType FieldGLType
	Scale  float64
	Offset int
	Min    float64
	Max    float64
	Count  int
}

// TypeSchemaField is the JSON-friendly projection of a TypeField.
type TypeSchemaField struct {
	Name   string  `json:"name"`
	GLType int     `json:"glType"`
	Scale  float64 `json:"scale"`
	Offset int     `json:"offset"`
	Min    float64 `json:"min"`
	Max    float64 `json:"max"`
	Count  int     `json:"count"`
}

// TypeSchemaEntry is the JSON-friendly projection of a TypeBody.
type TypeSchemaEntry struct {
	Fields     []TypeSchemaField `json:"fields"`
	RowCount   int               `json:"rowCount"`
	Stride     int               `json:"stride"`
	BaseTimeMs float64           `json:"baseTimeMs"`
}

// Count reports how many samples the curve holds.
func (cd *CurveData) Count() int {
	if cd.body != nil && cd.column < len(cd.body.Fields) {
		return cd.body.Fields[cd.column].Count
	}
	return len(cd.samples)
}

// Times returns the per-sample timestamps (empty once finalized).
func (cd *CurveData) Times() []float64 { return cd.times }

// Values returns the raw sample slice (empty once finalized).
func (cd *CurveData) Values() []float32 { return cd.samples }

// ReadFieldGL decodes one little-endian numeric value of the given wire type
// from body at offset off.
func ReadFieldGL(body []byte, off int, gl FieldGLType) float64 {
	switch gl {
	case GLInt8:
		return float64(int8(body[off]))
	case GLUint8:
		return float64(body[off])
	case GLInt16:
		return float64(int16(binary.LittleEndian.Uint16(body[off : off+2])))
	case GLUint16:
		return float64(binary.LittleEndian.Uint16(body[off : off+2]))
	case GLInt32:
		return float64(int32(binary.LittleEndian.Uint32(body[off : off+4])))
	case GLUint32:
		return float64(binary.LittleEndian.Uint32(body[off : off+4]))
	case GLFloat32:
		return float64(math.Float32frombits(binary.LittleEndian.Uint32(body[off : off+4])))
	}
	return 0
}
