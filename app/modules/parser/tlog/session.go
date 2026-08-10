package tlog

import (
	"fmt"
	"io"
	"os"
	"reflect"
	"time"

	"github.com/bluenviron/gomavlib/v3/pkg/dialect"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/ardupilotmega"
	"github.com/bluenviron/gomavlib/v3/pkg/frame"
	"github.com/bluenviron/gomavlib/v3/pkg/message"
	gomavtlog "github.com/bluenviron/gomavlib/v3/pkg/tlog"

	"drone-log-analyzer/app/modules/parser"
)

// parseSession carries the in-progress state of a single tlog parse: the
// growing LogFile, the cached message layouts, dedup sets, and the time-range
// and UTC-epoch bookkeeping later folded into Summary.
type parseSession struct {
	log     *parser.LogFile
	layouts map[reflect.Type]*messageLayout
	workBuf []byte
	lineNo  int

	vehicleKnown bool
	vehicleName  string
	prevMode     map[byte]uint32

	seenSeqs map[uint16]bool

	firstTimeMs float64
	lastTimeMs  float64
	startEpoch  int64
	gotEpoch    bool
	gotFrames   bool
}

func newSession(log *parser.LogFile) *parseSession {
	return &parseSession{
		log:      log,
		layouts:  make(map[reflect.Type]*messageLayout),
		prevMode: make(map[byte]uint32),
	}
}

// layoutFor returns the cached messageLayout for rt, building and registering
// it on first sight so identical message types are decoded once.
func (s *parseSession) layoutFor(rt reflect.Type) *messageLayout {
	if ml, ok := s.layouts[rt]; ok {
		return ml
	}
	ml := buildMessageLayout(rt)
	s.layouts[rt] = ml
	if _, exists := s.log.FormatsByName[ml.formatName]; !exists {
		s.log.FormatsByName[ml.formatName] = ml.def
	}
	return ml
}

// borrowBuf returns a reusable scratch slice of length n, growing the backing
// array only when the previous capacity is too small.
func (s *parseSession) borrowBuf(n int) []byte {
	if cap(s.workBuf) < n {
		s.workBuf = make([]byte, n)
	}
	return s.workBuf[:n]
}

// run reads every MAVLink entry from f, dispatching each frame until EOF or a
// fatal read error. An error on the very first read is reported; later EOF is
// the expected stop condition.
func (s *parseSession) run(f *os.File) error {
	drw := &dialect.ReadWriter{Dialect: ardupilotmega.Dialect}
	if err := drw.Initialize(); err != nil {
		return fmt.Errorf("tlog: init dialect: %w", err)
	}
	rd := &gomavtlog.Reader{ByteReader: f, DialectRW: drw}
	if err := rd.Initialize(); err != nil {
		return fmt.Errorf("tlog: init reader: %w", err)
	}
	for {
		entry, err := rd.Read()
		if err != nil {
			if s.lineNo == 0 && err != io.EOF && err != io.ErrUnexpectedEOF {
				return fmt.Errorf("tlog: read frame: %w", err)
			}
			return nil
		}
		s.lineNo++
		s.dispatch(entry.Frame, entry.Time)
	}
}

// trackTime records first/last sample timestamps and captures the UTC epoch
// of the first frame. It returns the frame time in milliseconds.
func (s *parseSession) trackTime(t time.Time) float64 {
	timeMs := float64(t.UnixMilli())
	if !s.gotFrames {
		s.firstTimeMs = timeMs
		s.gotFrames = true
	}
	s.lastTimeMs = timeMs
	if !s.gotEpoch {
		s.startEpoch = t.Unix()
		s.gotEpoch = true
	}
	return timeMs
}

// dispatch applies timestamp tracking then forwards the frame's message to a
// type-specific handler.
func (s *parseSession) dispatch(fr frame.Frame, t time.Time) {
	timeMs := s.trackTime(t)
	msg := fr.GetMessage()
	if msg == nil {
		return
	}
	sysID, compID := fr.GetSystemID(), fr.GetComponentID()
	s.routeMessage(msg, sysID, compID, timeMs)
}

// routeMessage sends a decoded MAVLink message to its handler. Raw frames and
// unrecognized struct types are handled by storePayload's default branch.
func (s *parseSession) routeMessage(msg message.Message, sysID, compID byte, timeMs float64) {
	switch m := msg.(type) {
	case *ardupilotmega.MessageHeartbeat:
		s.onHeartbeat(m, sysID, timeMs)
	case *ardupilotmega.MessageStatustext:
		s.onStatusText(m, timeMs)
	case *ardupilotmega.MessageParamValue:
		s.onParamValue(m)
	case *ardupilotmega.MessageMissionItem:
		s.onMissionItem(m, timeMs)
	case *ardupilotmega.MessageMissionItemInt:
		s.onMissionItemInt(m, timeMs)
	case *ardupilotmega.MessageCommandInt:
		s.onCommandInt(m, sysID, compID, timeMs)
	case *ardupilotmega.MessageCommandLong:
		s.onCommandLong(m, sysID, compID, timeMs)
	case *ardupilotmega.MessageCommandAck:
		s.onCommandAck(m)
	case *message.MessageRaw:
		// raw frames carry no decoded payload; nothing to accumulate
	default:
		s.storePayload(m, timeMs)
	}
}

// storePayload packs a generic message into its binary body layout and feeds
// it to the curve accumulator. Raw messages and non-struct pointers are
// ignored so unrecognized traffic cannot corrupt curves.
func (s *parseSession) storePayload(msg message.Message, timeMs float64) {
	if _, raw := msg.(*message.MessageRaw); raw {
		return
	}
	rt := reflect.TypeOf(msg)
	if rt == nil || rt.Kind() != reflect.Pointer || rt.Elem().Kind() != reflect.Struct {
		return
	}
	ml := s.layoutFor(rt.Elem())
	if ml.bodyLen == 0 {
		return
	}
	buf := s.borrowBuf(ml.bodyLen)
	rv := reflect.ValueOf(msg).Elem()
	for _, pack := range ml.packers {
		pack(rv, buf)
	}
	s.log.AccumStore(ml.formatName, ml.def, "", buf, timeMs)
}

// writeSummary folds the captured time-range and UTC bookkeeping into the
// LogFile's Summary fields.
func (s *parseSession) writeSummary() {
	if s.gotEpoch {
		s.log.Summary.StartUnixSecs = s.startEpoch
		s.log.Summary.HasUTC = true
	}
	if s.gotFrames {
		s.log.Summary.DurationSecs = (s.lastTimeMs - s.firstTimeMs) / 1000.0
	}
	s.log.Summary.TotalLines = s.lineNo
}
