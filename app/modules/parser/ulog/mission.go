package ulog

import (
	"drone-log-analyzer/app/modules/parser"
)

// pendingAck tracks an unacknowledged MAVLink command awaiting a result.
type pendingAck struct {
	idx       int
	command   uint32
	targetSys uint8
}

// firstUintOf returns the value of the first names field present in fd, else 0.
func firstUintOf(fd *parser.FormatDef, data []byte, names ...string) uint64 {
	for _, n := range names {
		if v, ok := readScalarUint(fd, data, n); ok {
			return v
		}
	}
	return 0
}

// firstFloatOf returns the value of the first names field present in fd, else 0.
func firstFloatOf(fd *parser.FormatDef, data []byte, names ...string) float64 {
	for _, n := range names {
		if v, ok := readScalarFloat(fd, data, n); ok {
			return v
		}
	}
	return 0
}

// onMissionItem records a navigator mission item, skipping a repeat of the
// most recent sequence number (but keeping items that jump backwards, which
// indicate a mission retransmission).
func onMissionItem(s *decodeSession, fd *parser.FormatDef, data []byte, timeMs float64) {
	seq := int(firstUintOf(fd, data, "sequence_current", "seq", "sequence"))
	if s.seenMission && seq == s.prevMissionSeq {
		return
	}
	s.prevMissionSeq = seq
	s.seenMission = true
	s.file.AppendCommand(parser.MissionCommand{
		TimeMs:    timeMs,
		Sequence:  seq,
		Command:   int(firstUintOf(fd, data, "nav_cmd", "command", "cmd")),
		Latitude:  firstFloatOf(fd, data, "latitude", "lat"),
		Longitude: firstFloatOf(fd, data, "longitude", "lon", "lng"),
		Altitude:  firstFloatOf(fd, data, "altitude", "alt"),
		Frame:     int(firstUintOf(fd, data, "frame", "frm")),
	})
}

// onVehicleCommand records a MAVLink command and queues it for ack matching.
func onVehicleCommand(s *decodeSession, fd *parser.FormatDef, data []byte, timeMs float64) {
	cmd := parser.MAVLinkCommand{
		TimeMs:          timeMs,
		Command:         int(firstUintOf(fd, data, "command", "cmd")),
		Param1:          firstFloatOf(fd, data, "param1", "p1"),
		Param2:          firstFloatOf(fd, data, "param2", "p2"),
		Param3:          firstFloatOf(fd, data, "param3", "p3"),
		Param4:          firstFloatOf(fd, data, "param4", "p4"),
		Latitude:        firstFloatOf(fd, data, "param5", "x", "lat"),
		Longitude:       firstFloatOf(fd, data, "param6", "y", "lon", "lng"),
		Altitude:        firstFloatOf(fd, data, "param7", "z", "alt"),
		TargetSystem:    int(firstUintOf(fd, data, "target_system")),
		TargetComponent: int(firstUintOf(fd, data, "target_component")),
		SourceSystem:    int(firstUintOf(fd, data, "source_system")),
		SourceComponent: int(firstUintOf(fd, data, "source_component")),
	}
	idx := s.file.AppendMAVLinkCommand(cmd)
	s.pendingAcks = append(s.pendingAcks, pendingAck{
		idx:       idx,
		command:   uint32(cmd.Command),
		targetSys: uint8(cmd.TargetSystem),
	})
}

// onCommandAck matches an ack to the most recent pending command with the same
// command id and target system, applies the result, and drops the match.
func onCommandAck(s *decodeSession, fd *parser.FormatDef, data []byte, timeMs float64) {
	_ = timeMs
	cmdID := uint32(firstUintOf(fd, data, "command", "cmd"))
	result := int(firstUintOf(fd, data, "result", "res"))
	targetSys := uint8(firstUintOf(fd, data, "target_system"))
	for i := len(s.pendingAcks) - 1; i >= 0; i-- {
		p := s.pendingAcks[i]
		if p.command == cmdID && p.targetSys == targetSys {
			s.file.SetMAVLinkCommandResult(p.idx, result)
			s.pendingAcks = append(s.pendingAcks[:i], s.pendingAcks[i+1:]...)
			return
		}
	}
}
