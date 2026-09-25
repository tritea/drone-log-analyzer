package tlog

import (
	"fmt"

	"github.com/bluenviron/gomavlib/v3/pkg/dialects/common"
)

// decodeVehicle maps a MAV_TYPE to the ArduPilot vehicle family, frame label,
// and airframe hint used in the Summary. Unknown types return empty strings.
func decodeVehicle(t common.MAV_TYPE) (vehicle, frame, airframe string) {
	switch t {
	case common.MAV_TYPE_QUADROTOR:
		return "Copter", "QUADROTOR", "multirotor"
	case common.MAV_TYPE_HEXAROTOR:
		return "Copter", "HEXAROTOR", "multirotor"
	case common.MAV_TYPE_OCTOROTOR:
		return "Copter", "OCTOROTOR", "multirotor"
	case common.MAV_TYPE_TRICOPTER:
		return "Copter", "TRICOPTER", "multirotor"
	case common.MAV_TYPE_DODECAROTOR:
		return "Copter", "DODECAROTOR", "multirotor"
	case common.MAV_TYPE_DECAROTOR:
		return "Copter", "DECAROTOR", "multirotor"
	case common.MAV_TYPE_HELICOPTER:
		return "Copter", "HELICOPTER", "multirotor"
	case common.MAV_TYPE_COAXIAL:
		return "Copter", "COAXIAL", "multirotor"
	case common.MAV_TYPE_FIXED_WING:
		return "Plane", "FIXED_WING", ""
	case common.MAV_TYPE_GROUND_ROVER:
		return "Rover", "ROVER", ""
	case common.MAV_TYPE_SURFACE_BOAT:
		return "Boat", "BOAT", ""
	case common.MAV_TYPE_SUBMARINE:
		return "Sub", "SUBMARINE", ""
	case common.MAV_TYPE_VTOL_TAILSITTER_DUOROTOR, common.MAV_TYPE_VTOL_TAILSITTER_QUADROTOR,
		common.MAV_TYPE_VTOL_TILTROTOR, common.MAV_TYPE_VTOL_FIXEDROTOR,
		common.MAV_TYPE_VTOL_TAILSITTER, common.MAV_TYPE_VTOL_TILTWING, common.MAV_TYPE_VTOL_GYRODYNE:
		return "Plane", "VTOL", "vtol"
	}
	return "", "", ""
}

// autopilotName maps a MAV_AUTOPILOT to its display label.
func autopilotName(a common.MAV_AUTOPILOT) string {
	switch a {
	case common.MAV_AUTOPILOT_ARDUPILOTMEGA:
		return "ArduPilot"
	case common.MAV_AUTOPILOT_PX4:
		return "PX4"
	}
	return ""
}

// flightModeLabel resolves a custom mode number to its ArduPilot flight-mode
// name, dispatching by vehicle family and defaulting to the Copter table.
func flightModeLabel(vehicle string, customMode uint32) string {
	switch vehicle {
	case "Plane":
		return planeMode(int(customMode))
	case "Rover":
		return roverMode(int(customMode))
	case "Sub":
		return subMode(int(customMode))
	}
	return copterMode(int(customMode))
}

// ArduPilot flight-mode tables, keyed by custom-mode number. Hoisted to
// package scope so they are allocated once rather than per lookup.
var (
	planeModes = map[int]string{
		0: "MANUAL", 1: "CIRCLE", 2: "STABILIZE", 3: "TRAINING",
		4: "ACRO", 5: "FBWA", 6: "FBWB", 7: "CRUISE",
		8: "AUTOTUNE", 10: "AUTO", 11: "RTL", 12: "LOITER",
		13: "TAKEOFF", 14: "AVOID_ADSB", 15: "GUIDED", 16: "INITIALISING",
		17: "QSTABILIZE", 18: "QHOVER", 19: "QLOITER", 20: "QLAND",
		21: "QRTL", 22: "QAUTOTUNE", 23: "QACRO", 24: "THERMAL",
	}
	copterModes = map[int]string{
		0: "STABILIZE", 1: "ACRO", 2: "ALT_HOLD", 3: "AUTO",
		4: "GUIDED", 5: "LOITER", 6: "RTL", 7: "CIRCLE",
		8: "POSITION", 9: "LAND", 10: "OF_LOITER", 11: "DRIFT",
		13: "SPORT", 14: "FLIP", 15: "AUTOTUNE", 16: "POSHOLD",
		17: "BRAKE", 18: "THROW", 19: "AVOID_ADSB", 20: "GUIDED_NOGPS",
		21: "SMART_RTL", 22: "FLOWHOLD", 23: "FOLLOW", 24: "ZIGZAG",
		25: "SYSTEMID", 26: "AUTOROTATE", 27: "AUTO_RTL",
	}
	roverModes = map[int]string{
		0: "MANUAL", 1: "ACRO", 3: "STEERING", 4: "HOLD",
		5: "LOITER", 6: "FOLLOW", 7: "SIMPLE", 10: "AUTO",
		11: "RTL", 12: "SMART_RTL", 15: "GUIDED", 16: "INITIALISING",
	}
	subModes = map[int]string{
		0: "STABILIZE", 1: "ACRO", 2: "ALT_HOLD", 3: "AUTO",
		4: "GUIDED", 7: "CIRCLE", 9: "SURFACE", 10: "OF_LOITER",
		11: "DRIFT", 16: "POSHOLD", 19: "MANUAL",
	}
)

func planeMode(mode int) string {
	if name, ok := planeModes[mode]; ok {
		return name
	}
	return fmt.Sprintf(modeFallback, mode)
}

func copterMode(mode int) string {
	if name, ok := copterModes[mode]; ok {
		return name
	}
	return fmt.Sprintf(modeFallback, mode)
}

func roverMode(mode int) string {
	if name, ok := roverModes[mode]; ok {
		return name
	}
	return fmt.Sprintf(modeFallback, mode)
}

func subMode(mode int) string {
	if name, ok := subModes[mode]; ok {
		return name
	}
	return fmt.Sprintf(modeFallback, mode)
}
