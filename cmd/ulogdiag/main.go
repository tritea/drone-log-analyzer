package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/ulikunitz/xz"
)

type evInfo struct {
	parentKey  string
	hasIDField bool
	idRaw      any
	obj        map[string]any
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: ulogdiag <file.ulg>")
		os.Exit(2)
	}
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		die("read file: %v", err)
	}
	if len(data) < 16 {
		die("file too short")
	}

	off := 16
	var metaBuf []byte
	formats := map[string]string{}
	names := map[uint16]string{}
	var eventIDs []uint64
	metaChunks := 0
	for off+3 <= len(data) {
		msgSize := int(binary.LittleEndian.Uint16(data[off : off+2]))
		msgType := data[off+2]
		pEnd := off + 3 + msgSize
		if pEnd > len(data) {
			break
		}
		payload := data[off+3 : pEnd]
		off = pEnd

		switch msgType {
		case 'F':
			if i := bytes.IndexByte(payload, ':'); i > 0 {
				formats[string(payload[:i])] = string(payload[i+1:])
			}
		case 'A':
			if len(payload) >= 3 {
				mid := binary.LittleEndian.Uint16(payload[1:3])
				if n, rest := readCString(payload[3:]); n != "" {
					names[mid] = n
					_ = rest
				}
			}
		case 'M':
			if len(payload) >= 2 {
				keyLen := int(payload[1])
				if 2+keyLen <= len(payload) {
					desc := string(payload[2 : 2+keyLen])
					if keyName(desc) == "metadata_events" {
						metaChunks++
						metaBuf = append(metaBuf, payload[2+keyLen:]...)
					}
				}
			}
		case 'D':
			if len(payload) >= 2 {
				mid := binary.LittleEndian.Uint16(payload[0:2])
				if names[mid] == "event" {
					if id, ok := extractEventID(formats["event"], payload[2:]); ok {
						eventIDs = append(eventIDs, id)
					}
				}
			}
		}
	}

	fmt.Printf("metadata_events 分片: %d，拼接 %d 字节\n", metaChunks, len(metaBuf))
	fmt.Printf("event topic 格式串: %q\n", formats["event"])
	seen := map[uint64]bool{}
	var uniqIDs []uint64
	for _, id := range eventIDs {
		if !seen[id] {
			seen[id] = true
			uniqIDs = append(uniqIDs, id)
		}
	}
	fmt.Printf("event topic 去重 id 数: %d，样例: %v\n", len(uniqIDs), firstN(uniqIDs, 10))

	if len(metaBuf) == 0 {
		fmt.Println("\n=> 此日志【没有】metadata_events。需要打包兜底。")
		return
	}

	jsonData := metaBuf
	if bytes.HasPrefix(metaBuf, []byte{0xFD, '7', 'z', 'X', 'Z', 0x00}) {
		r, err := xz.NewReader(bytes.NewReader(metaBuf))
		if err != nil {
			die("xz.NewReader: %v", err)
		}
		jsonData, err = io.ReadAll(r)
		if err != nil {
			die("xz 解压: %v", err)
		}
		fmt.Printf("xz 解压：%d -> %d 字节\n", len(metaBuf), len(jsonData))
	}

	var root any
	if err := json.Unmarshal(jsonData, &root); err != nil {
		fmt.Printf("JSON 解析失败: %v\n", err)
		fmt.Printf("预览: %q\n", preview(jsonData, 300))
		return
	}

	var events []evInfo
	collectEvents(root, "", &events)
	fmt.Printf("\nmetadata 中含 message 的事件对象: %d\n", len(events))

	withID, keyedNum, neither := 0, 0, 0
	var ids []int
	for _, e := range events {
		hasField := false
		if e.hasIDField {
			if n, ok := toInt(e.idRaw); ok {
				ids = append(ids, n)
				hasField = true
			}
		}
		if hasField {
			withID++
		} else if _, err := strconv.Atoi(e.parentKey); err == nil {
			keyedNum++
			ids = append(ids, atoiSafe(e.parentKey))
		} else {
			neither++
		}
	}
	fmt.Printf("  - 有数字 id 字段: %d\n", withID)
	fmt.Printf("  - 按数字父键键控: %d\n", keyedNum)
	fmt.Printf("  - 两者都没有(按名字键控): %d\n", neither)
	if len(ids) > 0 {
		mn, mx := ids[0], ids[0]
		for _, v := range ids {
			if v < mn {
				mn = v
			}
			if v > mx {
				mx = v
			}
		}
		fmt.Printf("  - metadata id 范围: %d ~ %d，样例: %v\n", mn, mx, firstNInts(ids, 10))
	}

	fmt.Println("\n---- 事件样例（父键 + 对象）----")
	for i := 0; i < 3 && i < len(events); i++ {
		b, _ := json.Marshal(events[i].obj)
		fmt.Printf("[%d] parentKey=%q\n    %s\n", i, events[i].parentKey, string(b))
	}

	if len(ids) > 0 {
		idset := map[int]bool{}
		for _, v := range ids {
			idset[v] = true
		}
		transforms := []struct {
			name string
			f    func(uint64) int
		}{
			{"raw", func(x uint64) int { return int(x) }},
			{"& 0xFFFFFF（剥高 8 位 log level）", func(x uint64) int { return int(x & 0xFFFFFF) }},
			{">> 8", func(x uint64) int { return int(x >> 8) }},
			{">> 16", func(x uint64) int { return int(x >> 16) }},
		}
		fmt.Println("\n运行时 id 变换命中率：")
		for _, t := range transforms {
			hit := 0
			for _, rid := range uniqIDs {
				if idset[t.f(rid)] {
					hit++
				}
			}
			fmt.Printf("  %-32s %d/%d\n", t.name, hit, len(uniqIDs))
		}
	}
}

func collectEvents(node any, parentKey string, out *[]evInfo) {
	switch v := node.(type) {
	case map[string]any:
		if _, ok := v["message"]; ok {
			e := evInfo{parentKey: parentKey, obj: v}
			if raw, has := v["id"]; has {
				e.hasIDField = true
				e.idRaw = raw
			}
			*out = append(*out, e)
		}
		for k, c := range v {
			collectEvents(c, k, out)
		}
	case []any:
		for _, c := range v {
			collectEvents(c, parentKey, out)
		}
	}
}

func extractEventID(formatStr string, data []byte) (uint64, bool) {
	off := 0
	for _, f := range splitFields(formatStr) {
		size, isArr := ctypeSize(f)
		if isArr {
			off += size
			continue
		}
		name := fieldName(f)
		if name == "id" {
			switch size {
			case 1:
				if off+1 <= len(data) {
					return uint64(data[off]), true
				}
			case 2:
				if off+2 <= len(data) {
					return uint64(binary.LittleEndian.Uint16(data[off : off+2])), true
				}
			case 4:
				if off+4 <= len(data) {
					return uint64(binary.LittleEndian.Uint32(data[off : off+4])), true
				}
			}
			return 0, false
		}
		off += size
	}
	return 0, false
}

func splitFields(s string) []string {
	parts := strings.Split(s, ";")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func ctypeSize(f string) (size int, isArr bool) {
	if i := strings.IndexByte(f, '['); i >= 0 {

		base := scalarSize(f[:i])
		nStr := f[i+1:]
		if j := strings.IndexByte(nStr, ']'); j >= 0 {
			if n, err := strconv.Atoi(nStr[:j]); err == nil {
				return base * n, true
			}
		}
		return base, true
	}
	return scalarSize(f), false
}

func scalarSize(t string) int {
	t = strings.TrimSpace(t)
	switch {
	case strings.Contains(t, "char") || strings.Contains(t, "bool") || strings.Contains(t, "uint8") || strings.Contains(t, "int8"):
		return 1
	case strings.Contains(t, "int16") || strings.Contains(t, "uint16"):
		return 2
	case strings.Contains(t, "int32") || strings.Contains(t, "uint32") || strings.Contains(t, "float"):
		return 4
	case strings.Contains(t, "int64") || strings.Contains(t, "uint64") || strings.Contains(t, "double"):
		return 8
	}
	return 0
}

func fieldName(f string) string {

	f = strings.TrimSpace(f)
	parts := strings.Fields(f)
	if len(parts) == 0 {
		return ""
	}
	return parts[len(parts)-1]
}

func toInt(v any) (int, bool) {
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
func atoiSafe(s string) int { n, _ := strconv.Atoi(s); return n }
func readCString(b []byte) (string, []byte) {
	if i := bytes.IndexByte(b, 0); i >= 0 {
		return string(b[:i]), b[i+1:]
	}
	return string(b), nil
}
func keyName(desc string) string {
	if i := strings.IndexByte(desc, ' '); i >= 0 {
		return desc[i+1:]
	}
	return desc
}
func preview(b []byte, n int) string {
	if len(b) > n {
		return string(b[:n]) + "..."
	}
	return string(b)
}
func firstN(v []uint64, n int) []uint64 {
	if len(v) > n {
		return v[:n]
	}
	return v
}
func firstNInts(v []int, n int) []int {
	if len(v) > n {
		return v[:n]
	}
	return v
}
func die(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
