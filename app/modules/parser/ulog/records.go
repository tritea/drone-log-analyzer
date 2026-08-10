package ulog

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"strings"

	"drone-log-analyzer/app/modules/parser"
)

// onFormat registers a format definition ("name:field specs") from an 'F' record.
func (s *decodeSession) onFormat(payload []byte) error {
	idx := bytes.IndexByte(payload, ':')
	if idx <= 0 {
		return nil
	}
	name := string(payload[:idx])
	spec := string(payload[idx+1:])
	fd := &parser.FormatDef{Name: name}
	assembleLayout(fd, parseTypeSpec(spec))
	s.file.FormatsByName[name] = fd
	return nil
}

// onInfo merges a single info key/value ('I') into the summary metadata.
func (s *decodeSession) onInfo(payload []byte) error {
	desc, valueBytes, ok := splitInfoDesc(payload)
	if !ok {
		return nil
	}
	typeStr, key := splitTypedKey(desc)
	val := coerceScalar(valueBytes, typeStr)
	switch key {
	case "ver_hw", "ver_hw_uuid", "ver_hw_subtype":
		if v := asText(val); v != "" {
			s.file.Summary.HardwareType = v
		}
	case "ver_sw", "ver_vendor_sw":
		if v := asText(val); v != "" {
			s.file.Summary.FirmwareVersion = "PX4 " + v
		}
	case "sys_name", "sys_os_name":
		if v := asText(val); v != "" && s.file.Summary.VehicleType == "" {
			s.file.Summary.VehicleType = v
		}
	}
	return nil
}

// onParam stores a parameter value from a 'P' record.
func (s *decodeSession) onParam(payload []byte) error {
	desc, valueBytes, ok := splitInfoDesc(payload)
	if !ok {
		return nil
	}
	typeStr, key := splitTypedKey(desc)
	if v, ok := asFloat64(coerceScalar(valueBytes, typeStr)); ok {
		s.file.AddParameter(key, v)
	}
	return nil
}

// onInfoMulti buffers multi-part info records; only metadata_events is kept.
func (s *decodeSession) onInfoMulti(payload []byte) error {
	if len(payload) < 2 {
		return nil
	}
	isContinued := payload[0]
	keyLen := int(payload[1])
	if 2+keyLen > len(payload) {
		return nil
	}
	_, name := splitTypedKey(string(payload[2 : 2+keyLen]))
	if name != "metadata_events" {
		return nil
	}
	if isContinued == 0 {
		s.metaEventBuf = s.metaEventBuf[:0]
	}
	s.metaEventBuf = append(s.metaEventBuf, payload[2+keyLen:]...)
	return nil
}

// onSubscribe records a topic subscription ('A') and binds it to its format.
func (s *decodeSession) onSubscribe(payload []byte) error {
	if len(payload) < 3 {
		return nil
	}
	inst := payload[0]
	msgID := binary.LittleEndian.Uint16(payload[1:3])
	name, _ := cutCString(payload[3:])
	s.topicByID[msgID] = name
	s.instByID[msgID] = inst
	if fd, ok := s.file.FormatsByName[name]; ok {
		s.formatByID[msgID] = fd
	}
	return nil
}

// onData ingests a topic sample ('D'): tracks time, stores the row, and emits
// any topic-specific side effects (mode change, mission item, command, event).
func (s *decodeSession) onData(payload []byte) error {
	if len(payload) < 2 {
		return nil
	}
	msgID := binary.LittleEndian.Uint16(payload[0:2])
	fd, ok := s.formatByID[msgID]
	if !ok {
		return nil
	}
	topicData := payload[2:]
	ts := readTopicTime(fd, topicData)
	s.advanceTimeBounds(ts)
	timeMs := float64(ts) / 1000.0

	name := s.topicByID[msgID]
	storeName := name
	if mid := s.instByID[msgID]; mid > 0 {
		storeName = fmt.Sprintf("%s%d", name, mid+1)
	}

	if !s.file.HasTimeBase() && carriesUTC(name) {
		if utcMs, ok := utcMillisFromTopic(fd, topicData); ok && plausibleUTC(utcMs) {
			s.file.SetTimeBase(utcMs - timeMs)
		}
	}
	if s.file.HasTimeBase() {
		timeMs += s.file.TimeBaseMs()
	}

	s.file.AccumStore(storeName, fd, "", topicData, timeMs)
	s.handleTopicExtras(name, fd, topicData, timeMs)
	return nil
}

// handleTopicExtras emits the side effects that depend on the decoded topic.
func (s *decodeSession) handleTopicExtras(name string, fd *parser.FormatDef, topicData []byte, timeMs float64) {
	if name == "vehicle_status" {
		if v, ok := readScalarUint(fd, topicData, "nav_state"); ok {
			nav := int(v)
			if !s.seenNav || nav != s.prevNav {
				s.file.AddModeChange(s.recordNo, parser.ModeChange{
					Mode: px4NavLabel(nav), ModeNum: nav, TimeMs: timeMs,
				})
				s.prevNav = nav
				s.seenNav = true
			}
		}
	}
	switch name {
	case "navigator_mission_item":
		onMissionItem(s, fd, topicData, timeMs)
	case "vehicle_command":
		onVehicleCommand(s, fd, topicData, timeMs)
	case "vehicle_command_ack":
		onCommandAck(s, fd, topicData, timeMs)
	case "event":
		if id, ok := readScalarUint(fd, topicData, "id"); ok {
			s.file.AddEvent(parser.LogEvent{TimeMs: timeMs, Id: int(id), Lineno: s.recordNo})
		}
	}
}

// onString ingests a logged-string record ('L') as a timestamped message.
func (s *decodeSession) onString(payload []byte) error {
	if len(payload) < 10 {
		return nil
	}
	ts := binary.LittleEndian.Uint64(payload[1:9])
	msgMs := float64(ts) / 1000.0
	if s.file.HasTimeBase() {
		msgMs += s.file.TimeBaseMs()
	}
	s.file.AddMessage(s.recordNo, string(payload[9:]), msgMs)
	return nil
}

// splitInfoDesc splits an info/param payload into its "type key" descriptor and
// the raw value bytes that follow it.
func splitInfoDesc(payload []byte) (desc string, value []byte, ok bool) {
	if len(payload) < 2 {
		return "", nil, false
	}
	descLen := int(payload[0])
	if 1+descLen > len(payload) {
		return "", nil, false
	}
	return string(payload[1 : 1+descLen]), payload[1+descLen:], true
}

// splitTypedKey splits a "<ctype> <key>" descriptor into its two parts.
func splitTypedKey(desc string) (typeStr, key string) {
	if sp := strings.IndexByte(desc, ' '); sp >= 0 {
		return desc[:sp], desc[sp+1:]
	}
	return desc, ""
}

// px4NavLabel maps a PX4 navigator state number to its display name.
func px4NavLabel(nav int) string {
	names := map[int]string{
		0: "MANUAL", 1: "ALTCTL", 2: "POSCTL", 3: "AUTO_MISSION", 4: "AUTO_LOITER",
		5: "AUTO_RTL", 6: "POSITION", 7: "ACRO", 8: "OFFBOARD", 9: "STABILIZED",
		10: "RATTITUDE", 11: "AUTO_TAKEOFF", 12: "AUTO_LAND", 13: "AUTO_FOLLOW_TARGET",
		14: "AUTO_PRECLAND", 15: "ORBIT", 16: "AUTO_VTOL_TAKEOFF", 17: "AUTO_VTOL_LAND",
	}
	if n, ok := names[nav]; ok {
		return n
	}
	return fmt.Sprintf("NAV_%d", nav)
}
