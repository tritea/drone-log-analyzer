package tlog

import (
	"strings"

	"github.com/bluenviron/gomavlib/v3/pkg/dialects/ardupilotmega"

	"drone-log-analyzer/app/modules/parser"
)

// onHeartbeat records vehicle type and firmware on first contact, and emits a
// mode-change entry whenever a system's custom mode flips. Mode tracking only
// runs once the autopilot family is known.
func (s *parseSession) onHeartbeat(m *ardupilotmega.MessageHeartbeat, sysID byte, timeMs float64) {
	ap := autopilotName(m.Autopilot)
	if ap == "" {
		return
	}
	if !s.vehicleKnown {
		if vehicle, frameName, airframe := decodeVehicle(m.Type); vehicle != "" {
			s.log.Summary.VehicleType = vehicle
			s.log.Summary.Frame = frameName
			s.log.Summary.Airframe = airframe
			s.vehicleName = vehicle
		}
		s.log.Summary.FirmwareVersion = ap
		s.vehicleKnown = true
	}
	cur := uint32(m.CustomMode)
	if prev, seen := s.prevMode[sysID]; seen && prev != cur {
		s.log.AddModeChange(s.lineNo, parser.ModeChange{
			Mode: flightModeLabel(s.vehicleName, cur), ModeNum: int(cur), TimeMs: timeMs,
		})
	}
	s.prevMode[sysID] = cur
}

// onStatusText appends a non-empty STATUSTEXT payload to the message log.
func (s *parseSession) onStatusText(m *ardupilotmega.MessageStatustext, timeMs float64) {
	text := strings.TrimRight(m.Text, "\x00")
	if text == "" {
		return
	}
	s.log.AddMessage(s.lineNo, text, timeMs)
}

// onParamValue records a PARAM_VALUE name/value pair.
func (s *parseSession) onParamValue(m *ardupilotmega.MessageParamValue) {
	name := strings.TrimRight(m.ParamId, "\x00")
	if name == "" {
		return
	}
	s.log.AddParameter(name, float64(m.ParamValue))
}

// onMissionItem appends a MISSION_ITEM as a planned command, deduping by seq.
func (s *parseSession) onMissionItem(m *ardupilotmega.MessageMissionItem, timeMs float64) {
	if s.markSeqSeen(m.Seq) {
		return
	}
	s.log.AppendCommand(parser.MissionCommand{
		TimeMs:    timeMs,
		Sequence:  int(m.Seq),
		Command:   int(m.Command),
		Param1:    float64(m.Param1),
		Param2:    float64(m.Param2),
		Param3:    float64(m.Param3),
		Param4:    float64(m.Param4),
		Latitude:  float64(m.X),
		Longitude: float64(m.Y),
		Altitude:  float64(m.Z),
		Frame:     int(m.Frame),
	})
}

// onMissionItemInt appends a MISSION_ITEM_INT as a planned command, scaling
// lat/lon from 1e-7-degree integer units.
func (s *parseSession) onMissionItemInt(m *ardupilotmega.MessageMissionItemInt, timeMs float64) {
	if s.markSeqSeen(m.Seq) {
		return
	}
	s.log.AppendCommand(parser.MissionCommand{
		TimeMs:    timeMs,
		Sequence:  int(m.Seq),
		Command:   int(m.Command),
		Param1:    float64(m.Param1),
		Param2:    float64(m.Param2),
		Param3:    float64(m.Param3),
		Param4:    float64(m.Param4),
		Latitude:  float64(m.X) * 1e-7,
		Longitude: float64(m.Y) * 1e-7,
		Altitude:  float64(m.Z),
		Frame:     int(m.Frame),
	})
}

// onCommandInt records a COMMAND_INT issued during the flight.
func (s *parseSession) onCommandInt(m *ardupilotmega.MessageCommandInt, sysID, compID byte, timeMs float64) {
	s.log.AppendMAVLinkCommand(parser.MAVLinkCommand{
		TimeMs:          timeMs,
		TargetSystem:    int(m.TargetSystem),
		TargetComponent: int(m.TargetComponent),
		SourceSystem:    int(sysID),
		SourceComponent: int(compID),
		Frame:           int(m.Frame),
		Command:         int(m.Command),
		Param1:          float64(m.Param1),
		Param2:          float64(m.Param2),
		Param3:          float64(m.Param3),
		Param4:          float64(m.Param4),
		Latitude:        float64(m.X) * 1e-7,
		Longitude:       float64(m.Y) * 1e-7,
		Altitude:        float64(m.Z),
		WasCommandLong:  false,
	})
}

// onCommandLong records a COMMAND_LONG issued during the flight.
func (s *parseSession) onCommandLong(m *ardupilotmega.MessageCommandLong, sysID, compID byte, timeMs float64) {
	s.log.AppendMAVLinkCommand(parser.MAVLinkCommand{
		TimeMs:          timeMs,
		TargetSystem:    int(m.TargetSystem),
		TargetComponent: int(m.TargetComponent),
		SourceSystem:    int(sysID),
		SourceComponent: int(compID),
		Frame:           0,
		Command:         int(m.Command),
		Param1:          float64(m.Param1),
		Param2:          float64(m.Param2),
		Param3:          float64(m.Param3),
		Param4:          float64(m.Param4),
		Latitude:        float64(m.Param5),
		Longitude:       float64(m.Param6),
		Altitude:        float64(m.Param7),
		WasCommandLong:  true,
	})
}

// onCommandAck back-fills the Result of the most recent matching open command.
func (s *parseSession) onCommandAck(m *ardupilotmega.MessageCommandAck) {
	cmd := int(m.Command)
	for i := len(s.log.MAVLinkCommands) - 1; i >= 0; i-- {
		c := &s.log.MAVLinkCommands[i]
		if c.Command == cmd && c.Result == 0 {
			c.Result = int(m.Result)
			return
		}
	}
}

// markSeqSeen deduplicates mission items by sequence number, returning true
// when seq was already recorded.
func (s *parseSession) markSeqSeen(seq uint16) bool {
	if s.seenSeqs == nil {
		s.seenSeqs = make(map[uint16]bool)
	}
	if s.seenSeqs[seq] {
		return true
	}
	s.seenSeqs[seq] = true
	return false
}
