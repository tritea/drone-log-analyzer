// Package ulog decodes PX4 ULog flight-log files into a parser.LogFile.
//
// A ULog file is an 8-byte header followed by a stream of length-prefixed
// records. This package registers a loader with the parent parser registry;
// the loader is selected when a file's leading bytes match the ULog signature.
package ulog

import (
	"bytes"
	"fmt"
	"log"
	"os"
	"runtime"
	"runtime/debug"

	"drone-log-analyzer/app/modules/parser"
)

// fileSignature is the 7-byte magic that prefixes every well-formed ULog.
var fileSignature = []byte{0x55, 0x4C, 0x6F, 0x67, 0x01, 0x12, 0x35}

// ULog record type tags. The byte sits just after each record's length.
const (
	recFormat    byte = 'F' // format definition
	recInfo      byte = 'I' // single info key/value
	recInfoMulti byte = 'M' // multi-part info (metadata_events)
	recParam     byte = 'P' // parameter value
	recSubscribe byte = 'A' // add-logged subscription
	recData      byte = 'D' // topic data sample
	recString    byte = 'L' // logged string message
)

// ulgLoader is the ULog entry point registered with the parser registry.
type ulgLoader struct{}

// Match reports whether data begins with the ULog signature.
func (ulgLoader) Match(head []byte, _ string) bool {
	return len(head) >= 7 && bytes.Equal(head[:7], fileSignature)
}

// Parse reads filename, decodes its ULog stream, and returns a populated LogFile.
func (ulgLoader) Parse(filename string) (*parser.LogFile, error) {
	data, err := os.ReadFile(filename)
	if err != nil {
		return nil, fmt.Errorf("open ulog: %w", err)
	}
	out := parser.NewLogFile(filename, "ulog")
	if fi, statErr := os.Stat(filename); statErr == nil {
		out.SetFileSizeKB(float64(fi.Size()) / 1024.0)
	}
	sess := newDecodeSession(out)
	if err := sess.decode(data); err != nil {
		return nil, err
	}

	log.Printf("ulog parse %s: formats=%d subscriptions=%d curve-topics=%d params=%d messages=%d duration=%.1fs",
		filename, len(out.FormatsByName), len(sess.topicByID), len(out.Curves), len(out.Parameters), len(out.Messages), out.Summary.DurationSecs)
	out.Finalize()

	runtime.GC()
	runtime.GC()
	debug.FreeOSMemory()
	return out, nil
}

func init() {
	parser.Register(ulgLoader{})
}
