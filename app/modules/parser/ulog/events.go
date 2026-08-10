package ulog

import (
	"bytes"
	"encoding/json"
	"io"
	"strconv"

	"github.com/ulikunitz/xz"
)

// xzHeader marks XZ-compressed payloads.
var xzHeader = []byte{0xFD, '7', 'z', 'X', 'Z', 0x00}

// decodeEventMetadata parses the PX4 metadata_events blob (optionally XZ-coded)
// into a map of event id -> human-readable message.
func decodeEventMetadata(data []byte) map[int]string {
	if len(data) >= len(xzHeader) && bytes.Equal(data[:len(xzHeader)], xzHeader) {
		if out, err := inflateXZ(data); err == nil {
			data = out
		}
	}
	var root any
	if err := json.Unmarshal(data, &root); err != nil {
		return nil
	}
	out := make(map[int]string)
	collectEvents(root, 0, false, out)
	if len(out) == 0 {
		return nil
	}
	return out
}

// inflateXZ decompresses an XZ payload.
func inflateXZ(data []byte) ([]byte, error) {
	r, err := xz.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	return io.ReadAll(r)
}

// collectEvents walks the JSON tree, collecting {id, message} pairs into out.
// numKey is the integer object key active on the current path (if any).
func collectEvents(node any, numKey int, hasNumKey bool, out map[int]string) {
	switch v := node.(type) {
	case map[string]any:
		if msg, ok := v["message"].(string); ok && msg != "" {
			if id, ok := resolveEventID(v, numKey, hasNumKey); ok {
				out[id] = msg
			}
		}
		for k, child := range v {
			if n, err := strconv.Atoi(k); err == nil {
				collectEvents(child, n, true, out)
			} else {
				collectEvents(child, numKey, hasNumKey, out)
			}
		}
	case []any:
		for _, child := range v {
			collectEvents(child, numKey, hasNumKey, out)
		}
	}
}

// resolveEventID determines the event id, preferring an explicit "id" field
// and falling back to the active numeric object key.
func resolveEventID(obj map[string]any, numKey int, hasNumKey bool) (int, bool) {
	if raw, ok := obj["id"]; ok {
		if id, ok := coerceJSONInt(raw); ok {
			return id, true
		}
	}
	if hasNumKey {
		return numKey, true
	}
	return 0, false
}

// coerceJSONInt converts a JSON number-or-string into an int.
func coerceJSONInt(v any) (int, bool) {
	switch x := v.(type) {
	case float64:
		return int(x), true
	case string:
		if n, err := strconv.Atoi(x); err == nil {
			return n, true
		}
	}
	return 0, false
}
