package dataflash

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"drone-log-analyzer/app/modules/parser"
)

// scanText parses an ASCII DataFlash log streamed from r. The reader itself is
// not consumed; the file is re-opened by name so the line buffer can be drained
// in fixed-size chunks without unbounded reads.
func scanText(lf *parser.LogFile, r io.Reader) error {
	_ = r

	lf.FormatsByName["FMT"] = &parser.FormatDef{
		MsgType:    fmtMsgID,
		Name:       "FMT",
		FormatStr:  "BBnNZ",
		FieldNames: []string{"Type", "Length", "Name", "Format", "Columns"},
	}

	f, err := os.Open(lf.Summary.Filename)
	if err != nil {
		return fmt.Errorf("open text log: %w", err)
	}
	defer f.Close()

	counter := textLineCounter{lf: lf}
	if err := counter.drain(f); err != nil {
		return err
	}
	lf.Summary.TotalLines = counter.lineno
	return nil
}

// textLineCounter buffers chunked reads, splits them into lines, and dispatches
// each complete line. A trailing partial line (no final newline) is flushed at
// EOF.
type textLineCounter struct {
	lf     *parser.LogFile
	buf    []byte
	lineno int
}

func (c *textLineCounter) drain(f *os.File) error {
	chunk := make([]byte, 32*1024)
	for {
		n, err := f.Read(chunk)
		if n > 0 {
			c.buf = append(c.buf, chunk[:n]...)
		}
		if err != nil && err != io.EOF {
			return fmt.Errorf("read text log: %w", err)
		}
		c.flushComplete()
		if err == io.EOF {
			break
		}
	}
	c.flushTrailing()
	return nil
}

// flushComplete emits every full (newline-terminated) line currently buffered.
func (c *textLineCounter) flushComplete() {
	for {
		idx := bytes.IndexByte(c.buf, '\n')
		if idx < 0 {
			return
		}
		c.lineno++
		ingestTextLine(c.lf, string(c.buf[:idx]), c.lineno)
		c.buf = c.buf[idx+1:]
	}
}

// flushTrailing emits any bytes left in the buffer as a final line.
func (c *textLineCounter) flushTrailing() {
	if len(c.buf) == 0 {
		return
	}
	c.lineno++
	ingestTextLine(c.lf, string(c.buf), c.lineno)
	c.buf = c.buf[:0]
}

// ingestTextLine parses and dispatches a single text log line.
func ingestTextLine(lf *parser.LogFile, line string, lineno int) {
	line = strings.TrimRight(line, "\r\n")
	if line == "" || isSkippableBanner(line) {
		return
	}

	tokens := strings.Split(line, ", ")
	if len(tokens) == 1 {
		handleUntypedLine(lf, line)
		return
	}

	msgName := tokens[0]
	if msgName == "FMT" {
		registerTextFormat(lf, tokens)
		return
	}

	fd, ok := lf.FormatsByName[msgName]
	if !ok {
		return
	}

	values := tokenizeValues(tokens[1:])
	timeMs := textLineMillis(lf, fd, values)
	syncTimeBaseFromGPS(lf, msgName, fd, values, timeMs)
	if lf.HasTimeBase() {
		timeMs += lf.TimeBaseMs()
	}

	lf.StoreTextCurveValues(msgName, fd, values, timeMs, lineno, "")
	if inst, ok := textLineInstance(fd, values); ok {
		lf.StoreTextCurveValues(parser.InstanceTypeName(msgName, inst), fd, values, timeMs, lineno, fmt.Sprintf("%d", inst))
	}
	dispatchRecord(lf, msgName, fd, values, timeMs, lineno)
}

// isSkippableBanner reports whether a line is boilerplate that carries no data.
func isSkippableBanner(line string) bool {
	if line == " Ready to drive." || line == " Ready to FLY." {
		return true
	}
	return line == "----------------------------------------"
}

// handleUntypedLine processes lines that have no comma separators: free-RAM,
// hardware banner, or firmware banner.
func handleUntypedLine(lf *parser.LogFile, line string) {
	parts := strings.Split(line, " ")
	if len(parts) == 3 && parts[0] == "Free" && parts[1] == "RAM:" {
		ram, _ := strconv.Atoi(parts[2])
		lf.Summary.FreeRAM = ram
		return
	}
	if parts[0] == "PX4" || parts[0] == "APM" || parts[0] == "MPNG" {
		lf.Summary.HardwareType = line
		return
	}
	detectFirmware(lf, line)
}

func tokenizeValues(tokens []string) []any {
	values := make([]any, len(tokens))
	for i, t := range tokens {
		values[i] = strings.TrimSpace(t)
	}
	return values
}

// registerTextFormat decodes an "FMT, ..." line into a FormatDef and indexes it
// by both type id and name.
func registerTextFormat(lf *parser.LogFile, tokens []string) {
	if len(tokens) < 6 {
		return
	}

	typeID, _ := strconv.Atoi(strings.TrimSpace(tokens[1]))
	msgLen, _ := strconv.Atoi(strings.TrimSpace(tokens[2]))
	name := strings.TrimSpace(tokens[3])
	formatStr := strings.TrimSpace(tokens[4])

	var fieldNames []string
	if len(tokens) > 5 {
		raw := strings.Join(tokens[5:], ",")
		fields := strings.Split(raw, ",")
		fieldNames = make([]string, len(fields))
		for i := range fields {
			fieldNames[i] = strings.TrimSpace(fields[i])
		}
	}

	fd := &parser.FormatDef{
		MsgType:    uint8(typeID),
		MsgLen:     uint8(msgLen),
		Name:       name,
		FormatStr:  formatStr,
		FieldNames: fieldNames,
	}
	assembleLayout(fd)

	lf.Formats[fd.MsgType] = fd
	lf.FormatsByName[name] = fd
}
