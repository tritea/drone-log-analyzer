package ulog

import (
	"bytes"
	"encoding/binary"
	"fmt"

	"drone-log-analyzer/app/modules/parser"
)

// decodeSession holds the mutable state accumulated while parsing one ULog:
// the output LogFile, the subscription table, and bookkeeping for the
// stream's time bounds, mode transitions, mission items and pending acks.
type decodeSession struct {
	file       *parser.LogFile
	formatByID map[uint16]*parser.FormatDef
	topicByID  map[uint16]string
	instByID   map[uint16]uint8
	firstStamp uint64
	lastStamp  uint64
	seenStamp  bool
	recordNo   int
	prevNav    int
	seenNav    bool

	prevMissionSeq int
	seenMission    bool
	pendingAcks    []pendingAck
	metaEventBuf   []byte
}

// newDecodeSession builds an empty session writing into out.
func newDecodeSession(out *parser.LogFile) *decodeSession {
	return &decodeSession{
		file:       out,
		formatByID: make(map[uint16]*parser.FormatDef),
		topicByID:  make(map[uint16]string),
		instByID:   make(map[uint16]uint8),
	}
}

// decode walks the record stream of data, populating the session's LogFile.
// The leading 16-byte ULog header is validated and skipped.
func (s *decodeSession) decode(data []byte) error {
	if len(data) < 16 {
		return fmt.Errorf("ulog: file too short")
	}
	if !bytes.Equal(data[:7], fileSignature) {
		return fmt.Errorf("ulog: bad magic")
	}

	off := 16
	for off+3 <= len(data) {
		recLen := int(binary.LittleEndian.Uint16(data[off : off+2]))
		recType := data[off+2]
		pStart := off + 3
		pEnd := pStart + recLen
		if pEnd > len(data) {
			break
		}
		s.recordNo++
		_ = s.dispatchRecord(recType, data[pStart:pEnd])
		off = pEnd
	}
	if len(s.metaEventBuf) > 0 {
		s.file.PX4EventNames = decodeEventMetadata(s.metaEventBuf)
	}
	if s.seenStamp {
		s.file.Summary.DurationSecs = float64(s.lastStamp-s.firstStamp) / 1e6
	}
	return nil
}

// dispatchRecord routes a single record to its typed handler.
func (s *decodeSession) dispatchRecord(recType byte, payload []byte) error {
	switch recType {
	case recFormat:
		return s.onFormat(payload)
	case recInfo:
		return s.onInfo(payload)
	case recInfoMulti:
		return s.onInfoMulti(payload)
	case recParam:
		return s.onParam(payload)
	case recSubscribe:
		return s.onSubscribe(payload)
	case recData:
		return s.onData(payload)
	case recString:
		return s.onString(payload)
	}
	return nil
}

// advanceTimeBounds folds ts into the stream's first/last timestamp window.
func (s *decodeSession) advanceTimeBounds(ts uint64) {
	if ts == 0 {
		return
	}
	if !s.seenStamp || ts < s.firstStamp {
		s.firstStamp = ts
	}
	if !s.seenStamp || ts > s.lastStamp {
		s.lastStamp = ts
	}
	s.seenStamp = true
}
