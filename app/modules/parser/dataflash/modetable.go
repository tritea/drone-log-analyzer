package dataflash

import (
	"fmt"
	"strings"

	"drone-log-analyzer/app/modules/parser"
)

// detectFirmware parses a "ArduCopter V3.6 (hash)" style banner line and fills
// in the firmware version, hash, and vehicle type on the log summary.
func detectFirmware(lf *parser.LogFile, line string) {
	parts := strings.Split(line, " ")
	if len(parts) < 2 || parts[1] == "" || parts[1][0] != 'V' {
		return
	}
	lf.Summary.FirmwareVersion = parts[1]
	switch parts[0] {
	case "ArduCopter", "APM:Copter":
		lf.Summary.VehicleType = "Copter"
	case "ArduPlane":
		lf.Summary.VehicleType = "Plane"
	case "ArduRover":
		lf.Summary.VehicleType = "Rover"
	case "ArduSub":
		lf.Summary.VehicleType = "Sub"
	}
	if len(parts) >= 3 {
		lf.Summary.FirmwareHash = strings.Trim(parts[2], "()")
	}
}

// vehicleModeLabel maps a numeric flight mode to its label for the current
// vehicle type (Plane vs. Copter).
func vehicleModeLabel(lf *parser.LogFile, mode int) string {
	if lf.Summary.VehicleType == "Plane" {
		return planeModeLabel(mode)
	}
	return copterModeLabel(mode)
}

func planeModeLabel(mode int) string {
	modes := map[int]string{
		0: "MANUAL", 1: "CIRCLE", 2: "STABILIZE", 3: "TRAINING",
		4: "ACRO", 5: "FBWA", 6: "FBWB", 7: "CRUISE",
		8: "AUTOTUNE", 10: "AUTO", 11: "RTL", 12: "LOITER",
		13: "TAKEOFF", 14: "AVOID_ADSB", 15: "GUIDED", 16: "INITIALISING",
		17: "QSTABILIZE", 18: "QHOVER", 19: "QLOITER", 20: "QLAND",
		21: "QRTL", 22: "QAUTOTUNE", 23: "QACRO", 24: "THERMAL",
	}
	if name, ok := modes[mode]; ok {
		return name
	}
	return fmt.Sprintf("MODE_%d", mode)
}

func copterModeLabel(mode int) string {
	modes := map[int]string{
		0: "STABILIZE", 1: "ACRO", 2: "ALT_HOLD", 3: "AUTO",
		4: "GUIDED", 5: "LOITER", 6: "RTL", 7: "CIRCLE",
		9: "LAND", 10: "OF_LOITER", 11: "DRIFT", 13: "SPORT",
		14: "FLIP", 15: "AUTOTUNE", 16: "HYBRID", 17: "POSHOLD",
		18: "BRAKE", 19: "THROW", 20: "AVOID_ADSB", 21: "GUIDED_NOGPS",
		22: "SMART_RTL", 23: "FLOWHOLD", 24: "FOLLOW",
	}
	if name, ok := modes[mode]; ok {
		return name
	}
	return fmt.Sprintf("MODE_%d", mode)
}
