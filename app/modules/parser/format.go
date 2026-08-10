package parser

// FieldGLType is the compact numeric type tag used for curve samples in the
// binary body layout. It mirrors the WebGL attribute types the frontend reads.
type FieldGLType uint8

// Wire types supported in the packed type-body format.
const (
	GLInt8    FieldGLType = 0
	GLUint8   FieldGLType = 1
	GLInt16   FieldGLType = 2
	GLUint16  FieldGLType = 3
	GLInt32   FieldGLType = 4
	GLUint32  FieldGLType = 5
	GLFloat32 FieldGLType = 6
)

// Size reports the byte width of a single value of this type.
func (t FieldGLType) Size() int {
	switch t {
	case GLInt8, GLUint8:
		return 1
	case GLInt16, GLUint16:
		return 2
	default:
		return 4
	}
}

// alignOffset rounds off up to the next multiple of a (a must be a power of two)
// so each column in the row buffer starts on a naturally aligned boundary.
func alignOffset(off, a int) int { return (off + a - 1) &^ (a - 1) }

// FieldLayout describes one parsed column of a message format: its decoded
// numeric shape plus the metadata needed to map raw bytes into a curve.
type FieldLayout struct {
	Name     string
	GLType   FieldGLType
	Size     int
	Scale    float64
	Offset   int
	InBody   bool
	OrigType string
}

// FormatDef is the decoded FMT record for a message type: how to split its
// payload into named, typed fields.
type FormatDef struct {
	MsgType    uint8
	MsgLen     uint8
	Name       string
	FormatStr  string
	FieldNames []string
	Layout     []FieldLayout
}
