package dataflash

import (
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"runtime"
	"runtime/debug"

	"drone-log-analyzer/app/modules/parser"
)

// DataFlash magic prefix: every binary record begins with 0xA3 0x95.
const (
	magicHi  byte = 0xA3
	magicLo  byte = 0x95
	fmtMsgID byte = 0x80
)

// dataflashLoader is the ArduPilot DataFlash fallback loader. It claims any
// stream that is neither a ULog nor a MAVLink capture.
type dataflashLoader struct{}

func (dataflashLoader) Match(head []byte, filename string) bool {
	return !parser.IsULog(head) && !parser.IsMAVLink(head, filename)
}

func (l dataflashLoader) Parse(filename string) (*parser.LogFile, error) {
	f, err := os.Open(filename)
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("stat file: %w", err)
	}

	hdr := make([]byte, 8)
	n, err := f.Read(hdr)
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("read header: %w", err)
	}
	f.Seek(0, io.SeekStart)

	lf := parser.NewLogFile(filename, "apm")
	lf.SetFileSizeKB(float64(fi.Size()) / 1024.0)

	if err := l.run(lf, f, hdr[:n]); err != nil {
		return nil, err
	}

	lf.ComputeDuration([]string{"GPS", "GPS1"})
	lf.Finalize()

	releaseMemory()
	return lf, nil
}

// run selects between the binary and text decoders using the stream header.
func (l dataflashLoader) run(lf *parser.LogFile, r io.ReadSeeker, hdr []byte) error {
	switch {
	case len(hdr) >= 2 && hdr[0] == magicHi && hdr[1] == magicLo:
		return scanBinary(lf, r, 0, 0)
	case len(hdr) >= 6 && hdr[4] == magicHi && hdr[5] == magicLo:
		offset := uint32(0)
		if len(hdr) >= 4 {
			offset = binary.LittleEndian.Uint32(hdr[:4])
		}
		return scanBinary(lf, r, 4, offset)
	default:
		return scanText(lf, r)
	}
}

func init() {
	parser.Register(dataflashLoader{})
}

func releaseMemory() {
	runtime.GC()
	runtime.GC()
	debug.FreeOSMemory()
}
