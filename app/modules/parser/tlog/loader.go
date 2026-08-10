package tlog

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"drone-log-analyzer/app/modules/parser"
)

// Byte markers and strings used during format detection and label synthesis.
const (
	extTlog      = ".tlog"
	mavV1Start   = 0xFE
	mavV2Start   = 0xFD
	modeFallback = "MODE_%d"
)

// tlogBackend parses MAVLink telemetry logs (.tlog) produced by ArduPilot /
// PX4 ground stations. It self-registers via init.
type tlogBackend struct{}

// Match reports whether the input looks like a tlog stream. The decision is
// identical for any given input:
//   - a .tlog extension on the filename (case-insensitive) wins, otherwise
//   - the first byte must be a MAVLink v1 (0xFE) or v2 (0xFD) start marker.
func (tlogBackend) Match(head []byte, filename string) bool {
	if strings.EqualFold(filepath.Ext(filename), extTlog) {
		return true
	}
	if len(head) == 0 {
		return false
	}
	return head[0] == mavV2Start || head[0] == mavV1Start
}

// Parse opens filename, walks every MAVLink frame, and accumulates curves,
// parameters, status messages, mission commands, and mode changes into a
// parser.LogFile before finalizing it.
func (tlogBackend) Parse(filename string) (*parser.LogFile, error) {
	f, err := os.Open(filename)
	if err != nil {
		return nil, fmt.Errorf("tlog: open file: %w", err)
	}
	defer f.Close()

	lf := parser.NewLogFile(filename, "tlog")
	if fi, statErr := f.Stat(); statErr == nil {
		lf.SetFileSizeKB(float64(fi.Size()) / 1024.0)
	}

	sess := newSession(lf)
	if err := sess.run(f); err != nil {
		return nil, err
	}
	sess.writeSummary()

	lf.Finalize()
	runtime.GC()
	runtime.GC()
	return lf, nil
}

func init() { parser.Register(tlogBackend{}) }
