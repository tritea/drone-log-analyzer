package parser

import (
	"bytes"
	"strings"
)

// FormatParser is the contract each log-format backend implements. A backend
// self-registers via Register in its package init(), so adding a format never
// touches the dispatch code here.
type FormatParser interface {
	Match(head []byte, filename string) bool
	Parse(filename string) (*LogFile, error)
}

// loaders holds every registered backend in registration order. Order matters:
// the dataflash fallback must register last, behind the precise-magic matchers.
var loaders []FormatParser

// Register adds a format backend to the dispatch list (called from init()).
func Register(p FormatParser) {
	loaders = append(loaders, p)
}

// Registered returns every format backend in registration order.
func Registered() []FormatParser { return loaders }

// ulogFileHeader is the 7-byte magic prefix that opens every ULog file.
var ulogFileHeader = []byte{0x55, 0x4C, 0x6F, 0x67, 0x01, 0x12, 0x35}

// IsULog reports whether head begins with the ULog magic.
func IsULog(head []byte) bool {
	return len(head) >= 7 && bytes.Equal(head[:7], ulogFileHeader)
}

// IsMAVLink reports whether the file looks like a MAVLink stream — either a
// .tlog extension or a v1/v2 packet start byte (0xFE / 0xFD).
func IsMAVLink(head []byte, filename string) bool {
	if strings.HasSuffix(strings.ToLower(filename), ".tlog") {
		return true
	}
	return len(head) >= 1 && (head[0] == 0xFD || head[0] == 0xFE)
}
