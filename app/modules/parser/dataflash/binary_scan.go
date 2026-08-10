package dataflash

import (
	"fmt"
	"io"
	"strings"

	"drone-log-analyzer/app/modules/parser"
)

// scanBinary walks a DataFlash binary stream, decoding FMT definitions and
// dispatching every subsequent record. startOffset is the byte offset of the
// first record (non-zero when the file begins with a 4-byte UTC timestamp);
// utcSecs, when plausible, seeds the time base.
func scanBinary(lf *parser.LogFile, r io.ReadSeeker, startOffset int, utcSecs uint32) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("read binary: %w", err)
	}
	if isPlausibleUTCSec(utcSecs) {
		lf.SetTimeBase(float64(utcSecs) * 1000)
	}

	formatsByID := make(map[uint8]*parser.FormatDef)
	state := &binScanState{data: data, offset: startOffset}

	for state.advanceToMagic() {
		consumed := state.tryRecord(lf, formatsByID)
		if !consumed {
			state.offset++
		}
	}

	lf.Summary.TotalLines = state.lineno
	return nil
}

// binScanState tracks the cursor position while walking the binary stream.
type binScanState struct {
	data   []byte
	offset int
	lineno int
}

// advanceToMagic moves the cursor forward until it lands on a magic prefix or
// reaches the end-of-stream sentinel (0xFF 0xFF 0xFF). It returns false when no
// further records can be read.
func (s *binScanState) advanceToMagic() bool {
	for s.offset+3 <= len(s.data) {
		if s.atEndSentinel() {
			return false
		}
		if s.data[s.offset] == magicHi && s.data[s.offset+1] == magicLo {
			return true
		}
		s.offset++
	}
	return false
}

func (s *binScanState) atEndSentinel() bool {
	return s.data[s.offset] == 0xFF &&
		s.data[s.offset+1] == 0xFF &&
		s.offset+2 < len(s.data) &&
		s.data[s.offset+2] == 0xFF
}

// tryRecord attempts to decode the record at the cursor. It returns true if a
// record was consumed (cursor advanced past it) and false when the cursor
// should only step a single byte (unknown message id).
func (s *binScanState) tryRecord(lf *parser.LogFile, formatsByID map[uint8]*parser.FormatDef) bool {
	msgID := s.data[s.offset+2]
	if msgID == fmtMsgID {
		return s.consumeFMT(lf, formatsByID)
	}
	fd, ok := formatsByID[msgID]
	if !ok {
		return false
	}
	if s.offset+int(fd.MsgLen) > len(s.data) {
		s.offset = len(s.data)
		return true
	}
	payload := s.data[s.offset+3 : s.offset+int(fd.MsgLen)]
	ingestBinaryRecord(lf, fd, payload, s.lineno)
	s.offset += int(fd.MsgLen)
	s.lineno++
	return true
}

func (s *binScanState) consumeFMT(lf *parser.LogFile, formatsByID map[uint8]*parser.FormatDef) bool {
	if s.offset+89 > len(s.data) {
		s.offset = len(s.data)
		return true
	}
	if fd := decodeFmtRecord(s.data[s.offset+3 : s.offset+89]); fd != nil {
		formatsByID[fd.MsgType] = fd
		lf.Formats[fd.MsgType] = fd
		lf.FormatsByName[fd.Name] = fd
	}
	s.offset += 89
	s.lineno++
	return true
}

// decodeFmtRecord parses an 86-byte FMT record payload into a FormatDef.
func decodeFmtRecord(data []byte) *parser.FormatDef {
	if len(data) < 86 {
		return nil
	}
	fd := &parser.FormatDef{
		MsgType:   data[0],
		MsgLen:    data[1],
		Name:      strings.TrimRight(string(data[2:6]), "\x00"),
		FormatStr: strings.TrimRight(string(data[6:22]), "\x00"),
	}
	if labels := strings.TrimRight(string(data[22:86]), "\x00"); labels != "" {
		fd.FieldNames = strings.Split(labels, ",")
	}
	assembleLayout(fd)
	return fd
}

// ingestBinaryRecord decodes one binary record into curves/records, optionally
// syncing the UTC time base from the first GPS sample.
func ingestBinaryRecord(lf *parser.LogFile, fd *parser.FormatDef, data []byte, lineno int) {
	if len(fd.Layout) == 0 {
		assembleLayout(fd)
	}
	msgName := fd.Name

	timeMs := readTimeMillis(fd, data)
	if !lf.HasTimeBase() && msgName == "GPS" {
		if utcMs, ok := gpsBytesUnixMillis(fd, data); ok {
			lf.SetTimeBase(utcMs - timeMs)
		}
	}
	if lf.HasTimeBase() {
		timeMs += lf.TimeBaseMs()
	}

	lf.AccumStore(msgName, fd, "", data, timeMs)
	if inst, ok := readInstanceId(fd, data); ok {
		lf.AccumStore(parser.InstanceTypeName(msgName, inst), fd, fmt.Sprintf("%d", inst), data, timeMs)
	}

	if isDispatchMessage(msgName) {
		dispatchRecord(lf, msgName, fd, readAllFields(fd, data), timeMs, lineno)
	}
}

// isDispatchMessage reports whether a message name has a dedicated record
// handler (PARM/MSG/ERR/EV/CMD/MAVC/MODE).
func isDispatchMessage(msgName string) bool {
	switch msgName {
	case "PARM", "MSG", "Message", "ERR", "EV", "CMD", "MAVC", "MODE":
		return true
	}
	return false
}
