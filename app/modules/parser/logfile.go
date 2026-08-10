package parser

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"sync"
)

// LogFile is the in-memory accumulation of one parsed flight log. Public map and
// slice fields are the read-only result consumed by the log service; the
// lowercase fields drive parsing and are not safe to touch concurrently.
type LogFile struct {
	Summary         LogSummary
	Formats         map[uint8]*FormatDef
	FormatsByName   map[string]*FormatDef
	Parameters      map[string]float64
	Messages        map[int]string
	MessageTimes    map[int]float64
	ModeChanges     map[int]ModeChange
	Commands        []MissionCommand
	MAVLinkCommands []MAVLinkCommand
	Errors          []LogError
	Events          []LogEvent
	PX4EventNames   map[int]string
	Curves          map[string]map[string]*CurveData
	TypeBodies      map[string]*TypeBody
	accumulators    map[string]*rowAccum
	spool           *os.File
	SeenTypes       []string

	epochMs     float64
	epochLocked bool
	mu          sync.RWMutex
}

// BaseTypeName strips a trailing numeric instance suffix from a message name
// (e.g. "BARO2" → "BARO") so callers can fall back to the base format.
func BaseTypeName(msgName string) string {
	if msgName == "" {
		return msgName
	}
	i := len(msgName)
	for i > 0 && msgName[i-1] >= '0' && msgName[i-1] <= '9' {
		i--
	}
	if i == 0 || i == len(msgName) {
		return msgName
	}
	return msgName[:i]
}

// GetCurveData resolves a (message, field, instance) triple to its curve, or nil.
func (lf *LogFile) GetCurveData(msgName, fieldName, instance string) *CurveData {
	lf.mu.RLock()
	defer lf.mu.RUnlock()

	fields, ok := lf.Curves[msgName]
	if !ok {
		return nil
	}
	cd, ok := fields[fieldName]
	if !ok {
		return nil
	}
	if instance != "" && cd.Instance != instance {
		// Instance mismatch: look for the indexed key "Msg[inst].Field".
		instKey := fmt.Sprintf("%s[%s].%s", msgName, instance, fieldName)
		for _, f := range lf.Curves {
			if c, ok := f[instKey]; ok {
				return c
			}
		}
		return nil
	}
	return cd
}

// GetFieldNames returns the ordered field names for a message type.
func (lf *LogFile) GetFieldNames(msgName string) []string {
	lf.mu.RLock()
	defer lf.mu.RUnlock()
	fd := lf.lookupFormat(msgName)
	if fd == nil {
		return nil
	}
	return fd.FieldNames
}

// GetFieldType returns the wire-format type byte at fieldIdx, or 0 if absent.
func (lf *LogFile) GetFieldType(msgName string, fieldIdx int) byte {
	fd := lf.lookupFormat(msgName)
	if fd == nil || fieldIdx >= len(fd.FormatStr) {
		return 0
	}
	return fd.FormatStr[fieldIdx]
}

// deriveDuration estimates flight duration by scanning candidate topics for a
// usable time span, preferring accumulator-backed ones.
func (lf *LogFile) deriveDuration(topics []string) {
	for _, name := range topics {
		if ac := lf.accumulators[name]; ac != nil && len(ac.times) > 0 {
			lf.Summary.DurationSecs = (ac.times[len(ac.times)-1] - ac.times[0]) / 1000.0
			return
		}
	}
	for _, name := range topics {
		gpsFields, ok := lf.Curves[name]
		if !ok {
			continue
		}
		var timeField *CurveData
		for _, tn := range []string{"TimeMS", "TimeUS", "Time"} {
			if cd, ok := gpsFields[tn]; ok {
				timeField = cd
				break
			}
		}
		if timeField == nil || len(timeField.samples) == 0 {
			continue
		}
		first := float64(timeField.samples[0])
		last := float64(timeField.samples[len(timeField.samples)-1])
		if _, ok := gpsFields["TimeUS"]; ok {
			first /= 1000.0
			last /= 1000.0
		}
		lf.Summary.DurationSecs = (last - first) / 1000.0
		return
	}
}

// lockEpoch records the UTC epoch (ms) once and rebases every timestamp seen so
// far onto it. Subsequent calls are no-ops.
func (lf *LogFile) lockEpoch(baseMs float64) {
	if baseMs <= 0 || lf.epochLocked {
		return
	}
	lf.epochMs = baseMs
	lf.epochLocked = true
	lf.Summary.StartUnixSecs = int64(baseMs / 1000)
	lf.Summary.HasUTC = true
	lf.rebaseTimes(baseMs)
}

// rebaseTimes shifts all recorded timestamps by deltaMs (used when the UTC epoch
// is discovered after some data has already been accumulated).
func (lf *LogFile) rebaseTimes(deltaMs float64) {
	for _, fields := range lf.Curves {
		for _, cd := range fields {
			if cd.frozen {
				continue
			}
			for i := range cd.times {
				cd.times[i] += deltaMs
			}
		}
	}
	for _, ac := range lf.accumulators {
		for i := range ac.times {
			ac.times[i] += deltaMs
		}
	}
	for lineno, timeMs := range lf.MessageTimes {
		lf.MessageTimes[lineno] = timeMs + deltaMs
	}
	for lineno, mode := range lf.ModeChanges {
		mode.TimeMs += deltaMs
		lf.ModeChanges[lineno] = mode
	}
	for i := range lf.Commands {
		lf.Commands[i].TimeMs += deltaMs
	}
	for i := range lf.MAVLinkCommands {
		lf.MAVLinkCommands[i].TimeMs += deltaMs
	}
}

// ParseFile opens filename, sniffs its format via the registered parsers, and
// returns the fully parsed LogFile.
func ParseFile(filename string) (*LogFile, error) {
	f, err := os.Open(filename)
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	head := make([]byte, 8)
	n, err := f.Read(head)
	f.Close()
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("read header: %w", err)
	}
	for _, p := range Registered() {
		if n > 0 && p.Match(head[:n], filename) {
			return p.Parse(filename)
		}
	}
	return nil, fmt.Errorf("unrecognized log format: %s", filename)
}

// gatherSeenTypes builds the de-duplicated list of message type names that
// actually produced curves.
func (lf *LogFile) gatherSeenTypes() {
	seen := make(map[string]bool)
	for name := range lf.Curves {
		seen[name] = true
	}
	for name := range lf.FormatsByName {
		if seen[name] {
			continue
		}
		if _, hasData := lf.Curves[name]; hasData {
			seen[name] = true
		}
	}
	types := make([]string, 0, len(seen))
	for t := range seen {
		types = append(types, t)
	}
	lf.SeenTypes = types
}

// lookupFormat finds the FormatDef for a message, trying the base name when the
// instance-suffixed name is absent.
func (lf *LogFile) lookupFormat(msgName string) *FormatDef {
	if fd, ok := lf.FormatsByName[msgName]; ok {
		return fd
	}
	if fd, ok := lf.FormatsByName[BaseTypeName(msgName)]; ok {
		return fd
	}
	return nil
}

// TypeBodyBytes returns the packed binary body for a message type (or nil).
func (lf *LogFile) TypeBodyBytes(msgName string) []byte {
	return lf.bodyBytes(lf.TypeBodies[msgName])
}

// CurveBytes serializes a curve into the wire blob the frontend chart consumes.
func (lf *LogFile) CurveBytes(cd *CurveData) []byte {
	if cd.body == nil || cd.column >= len(cd.body.Fields) {
		return nil
	}
	tb := cd.body
	tf := tb.Fields[cd.column]
	body := lf.bodyBytes(tb)
	n := tf.Count
	out := make([]byte, CurveBinHeader+n*8)
	binary.LittleEndian.PutUint32(out[0:4], CurveBinMagic)
	binary.LittleEndian.PutUint32(out[4:8], CurveBinVersion)
	binary.LittleEndian.PutUint32(out[8:12], uint32(n))
	binary.LittleEndian.PutUint64(out[12:20], math.Float64bits(tb.BaseTimeMs))
	binary.LittleEndian.PutUint32(out[20:24], math.Float32bits(float32(tf.Min)))
	binary.LittleEndian.PutUint32(out[24:28], math.Float32bits(float32(tf.Max)))
	if body == nil {
		return out
	}
	for r := 0; r < n; r++ {
		rowBase := TypeBinHeader + r*tb.Stride
		dms := int32(binary.LittleEndian.Uint32(body[rowBase : rowBase+TimeColBytes]))
		val := ReadFieldGL(body, rowBase+tf.Offset, tf.GLType) * tf.Scale
		o := CurveBinHeader + r*8
		binary.LittleEndian.PutUint32(out[o:o+4], math.Float32bits(float32(dms)))
		binary.LittleEndian.PutUint32(out[o+4:o+8], math.Float32bits(float32(val)))
	}
	return out
}

// CurveValues returns the decoded sample values for a curve straight from the
// packed body (or nil if the curve is not body-backed).
func (lf *LogFile) CurveValues(cd *CurveData) []float64 {
	if cd.body == nil || cd.column >= len(cd.body.Fields) {
		return nil
	}
	tb := cd.body
	tf := tb.Fields[cd.column]
	body := lf.bodyBytes(tb)
	n := tf.Count
	out := make([]float64, n)
	if body == nil {
		return out
	}
	for r := 0; r < n; r++ {
		rowBase := TypeBinHeader + r*tb.Stride
		out[r] = ReadFieldGL(body, rowBase+tf.Offset, tf.GLType) * tf.Scale
	}
	return out
}

// TypeSchema projects every TypeBody into its JSON-friendly form.
func (lf *LogFile) TypeSchema() map[string]TypeSchemaEntry {
	out := make(map[string]TypeSchemaEntry, len(lf.TypeBodies))
	for msgName, tb := range lf.TypeBodies {
		fields := make([]TypeSchemaField, 0, len(tb.Fields))
		for _, f := range tb.Fields {
			fields = append(fields, TypeSchemaField{
				Name: f.Name, GLType: int(f.GLType), Scale: f.Scale, Offset: f.Offset,
				Min: f.Min, Max: f.Max, Count: f.Count,
			})
		}
		out[msgName] = TypeSchemaEntry{
			Fields: fields, RowCount: tb.RowCount, Stride: tb.Stride, BaseTimeMs: tb.BaseTimeMs,
		}
	}
	return out
}

// CloseSpool removes the on-disk spool file used to keep large logs off the heap.
func (lf *LogFile) CloseSpool() {
	if lf.spool != nil {
		name := lf.spool.Name()
		lf.spool.Close()
		os.Remove(name)
		lf.spool = nil
	}
}
