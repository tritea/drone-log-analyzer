package dataflash

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"drone-log-analyzer/app/modules/parser"
)

// dispatchRecord routes the recognized record types (PARM, MSG, ERR, EV, CMD,
// MAVC, MODE) to their dedicated handlers. Other types are ignored.
func dispatchRecord(lf *parser.LogFile, msgName string, fd *parser.FormatDef, values []any, timeMs float64, lineno int) {
	switch msgName {
	case "PARM":
		handleParameter(lf, fd, values)
	case "MSG", "Message":
		handleMessage(lf, fd, values, timeMs, lineno)
	case "ERR":
		handleError(lf, fd, values, timeMs, lineno)
	case "EV":
		handleEvent(lf, fd, values, timeMs, lineno)
	case "CMD":
		lf.AppendCommand(buildMissionCommand(fd, values, timeMs))
	case "MAVC":
		lf.AppendMAVLinkCommand(buildMAVLinkCommand(fd, values, timeMs))
	case "MODE":
		recordModeChange(lf, fd, values, timeMs, lineno)
	}
}

func handleParameter(lf *parser.LogFile, fd *parser.FormatDef, values []any) {
	nameIdx := indexOfFieldByAliases(fd, "name")
	valueIdx := indexOfFieldByAliases(fd, "value")
	if nameIdx < 0 && len(values) >= 2 {
		nameIdx = 0
	}
	if nameIdx < 0 || nameIdx >= len(values) || valueIdx < 0 || valueIdx >= len(values) {
		return
	}

	name := fmt.Sprintf("%v", values[nameIdx])
	if name == "" || strings.EqualFold(name, "Name") {
		return
	}
	if f, err := strconv.ParseFloat(fmt.Sprintf("%v", values[valueIdx]), 64); err == nil {
		lf.AddParameter(name, f)
	}
}

func handleMessage(lf *parser.LogFile, fd *parser.FormatDef, values []any, timeMs float64, lineno int) {
	if len(values) < 1 {
		return
	}
	msg := extractMessageText(fd, values)
	if msg == "" {
		return
	}

	if strings.HasPrefix(msg, "Frame: ") || strings.HasPrefix(msg, "Frame ") {
		lf.Summary.Frame = strings.TrimPrefix(msg, "Frame: ")
		lf.Summary.Frame = strings.TrimPrefix(lf.Summary.Frame, "Frame ")
	}

	detectFirmware(lf, msg)
	lf.AddMessage(lineno, msg, timeMs)
}

func handleError(lf *parser.LogFile, fd *parser.FormatDef, values []any, timeMs float64, lineno int) {
	subsys, ecode := -1, -1
	forEachNamedField(fd, values, func(field string, val float64) {
		switch field {
		case "subsys", "subsystem", "sub_system", "sub":
			subsys = int(val)
		case "ecode", "errorcode", "error_code", "code", "err":
			ecode = int(val)
		}
	})
	if subsys >= 0 || ecode >= 0 {
		lf.AddError(parser.LogError{TimeMs: timeMs, Subsys: subsys, ECode: ecode, Lineno: lineno})
	}
}

func handleEvent(lf *parser.LogFile, fd *parser.FormatDef, values []any, timeMs float64, lineno int) {
	for i, fn := range fd.FieldNames {
		if i >= len(values) {
			break
		}
		if strings.EqualFold(strings.TrimSpace(fn), "id") {
			lf.AddEvent(parser.LogEvent{TimeMs: timeMs, Id: int(parser.ToFloat64(values[i])), Lineno: lineno})
			break
		}
	}
}

// buildMissionCommand assembles a MissionCommand from a CMD record.
func buildMissionCommand(fd *parser.FormatDef, values []any, timeMs float64) parser.MissionCommand {
	cmd := parser.MissionCommand{TimeMs: timeMs}
	forEachNamedField(fd, values, func(field string, val float64) {
		switch field {
		case "ctot", "command_total", "commandtotal", "total":
			cmd.CommandTotal = int(val)
		case "cnum", "seq", "sequence":
			cmd.Sequence = int(val)
		case "cid", "cmd", "command", "commandid":
			cmd.Command = int(val)
		case "prm1", "p1", "param1":
			cmd.Param1 = val
		case "prm2", "p2", "param2":
			cmd.Param2 = val
		case "prm3", "p3", "param3":
			cmd.Param3 = val
		case "prm4", "p4", "param4":
			cmd.Param4 = val
		case "lat", "latitude":
			cmd.Latitude = sanitizeCoord(val)
		case "lng", "lon", "longitude":
			cmd.Longitude = sanitizeCoord(val)
		case "alt", "altitude":
			cmd.Altitude = val
		case "frm", "frame":
			cmd.Frame = int(val)
		}
	})
	return cmd
}

// buildMAVLinkCommand assembles a MAVLinkCommand from a MAVC record.
func buildMAVLinkCommand(fd *parser.FormatDef, values []any, timeMs float64) parser.MAVLinkCommand {
	cmd := parser.MAVLinkCommand{TimeMs: timeMs}
	forEachNamedField(fd, values, func(field string, val float64) {
		switch field {
		case "ts", "target_system", "targetsystem", "targetsys":
			cmd.TargetSystem = int(val)
		case "tc", "target_component", "targetcomponent":
			cmd.TargetComponent = int(val)
		case "ss", "source_system", "sourcesystem", "sourcesys":
			cmd.SourceSystem = int(val)
		case "sc", "source_component", "sourcecomponent":
			cmd.SourceComponent = int(val)
		case "fr", "frame":
			cmd.Frame = int(val)
		case "cmd", "command", "commandid", "cid":
			cmd.Command = int(val)
		case "p1", "prm1", "param1":
			cmd.Param1 = val
		case "p2", "prm2", "param2":
			cmd.Param2 = val
		case "p3", "prm3", "param3":
			cmd.Param3 = val
		case "p4", "prm4", "param4":
			cmd.Param4 = val
		case "x", "lat", "latitude":
			cmd.Latitude = sanitizeCoord(val)
		case "y", "lng", "lon", "longitude":
			cmd.Longitude = sanitizeCoord(val)
		case "z", "alt", "altitude":
			cmd.Altitude = val
		case "res", "result":
			cmd.Result = int(val)
		case "wl", "was_command_long", "wascommandlong":
			cmd.WasCommandLong = val != 0
		}
	})
	return cmd
}

// sanitizeCoord normalizes a raw lat/lon integer to degrees, treating NaN/Inf
// as zero.
func sanitizeCoord(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	if math.Abs(v) > 360.0 {
		return v / 1e7
	}
	return v
}

// extractMessageText pulls the human-readable text out of a MSG/Message
// record, skipping time fields.
func extractMessageText(fd *parser.FormatDef, values []any) string {
	for i, fn := range fd.FieldNames {
		if i >= len(values) {
			break
		}
		switch strings.ToLower(strings.TrimSpace(fn)) {
		case "msg", "message", "text":
			return fmt.Sprintf("%v", values[i])
		}
	}
	for i, v := range values {
		if i < len(fd.FieldNames) {
			fn := strings.ToLower(strings.TrimSpace(fd.FieldNames[i]))
			if fn == "timems" || fn == "timeus" || fn == "time" {
				continue
			}
		}
		if _, ok := v.(string); ok {
			return fmt.Sprintf("%v", v)
		}
	}
	return ""
}

func recordModeChange(lf *parser.LogFile, fd *parser.FormatDef, values []any, timeMs float64, lineno int) {
	var modeStr string
	var modeNum int

	for i, fn := range fd.FieldNames {
		if i >= len(values) {
			break
		}
		switch fn {
		case "Mode":
			modeStr = fmt.Sprintf("%v", values[i])
		case "ModeNum":
			if n, err := strconv.Atoi(fmt.Sprintf("%v", values[i])); err == nil {
				modeNum = n
			}
		}
	}

	if modeStr == "" {
		return
	}
	if n, err := strconv.Atoi(modeStr); err == nil {
		modeStr = vehicleModeLabel(lf, n)
	}
	lf.AddModeChange(lineno, parser.ModeChange{Mode: modeStr, ModeNum: modeNum, TimeMs: timeMs})
}

// indexOfFieldByAliases returns the index of the first field whose name matches
// any alias (case-insensitive, trimmed).
func indexOfFieldByAliases(fd *parser.FormatDef, aliases ...string) int {
	for i, fn := range fd.FieldNames {
		field := strings.ToLower(strings.TrimSpace(fn))
		for _, a := range aliases {
			if field == a {
				return i
			}
		}
	}
	return -1
}

// forEachNamedField iterates every typed field in values, invoking fn with the
// lower-cased trimmed field name and its float value. Iteration stops when
// values is exhausted.
func forEachNamedField(fd *parser.FormatDef, values []any, fn func(field string, val float64)) {
	for i, fname := range fd.FieldNames {
		if i >= len(values) {
			return
		}
		field := strings.ToLower(strings.TrimSpace(fname))
		fn(field, parser.ToFloat64(values[i]))
	}
}
