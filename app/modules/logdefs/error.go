package logdefs

import "strconv"

// subsystemLabels maps ArduPilot ERR.Subsys values to subsystem names.
var subsystemLabels = map[int]string{
	1:  "MAIN",
	2:  "RADIO",
	3:  "COMPASS",
	4:  "OPTFLOW",
	5:  "FAILSAFE_RADIO",
	6:  "FAILSAFE_BATT",
	7:  "FAILSAFE_GPS",
	8:  "FAILSAFE_GCS",
	9:  "FAILSAFE_FENCE",
	10: "FLIGHT_MODE",
	11: "GPS",
	12: "CRASH_CHECK",
	13: "FLIP",
	14: "AUTOTUNE",
	15: "PARACHUTES",
	16: "EKFCHECK",
	17: "FAILSAFE_EKFINAV",
	18: "BARO",
	19: "CPU",
	20: "FAILSAFE_ADSB",
	21: "TERRAIN",
	22: "NAVIGATION",
	23: "FAILSAFE_TERRAIN",
	24: "EKF_PRIMARY",
	25: "THRUST_LOSS_CHECK",
	26: "FAILSAFE_SENSORS",
	27: "FAILSAFE_LEAK",
	28: "PILOT_INPUT",
	29: "FAILSAFE_VIBE",
	30: "INTERNAL_ERROR",
	31: "FAILSAFE_DEADRECKON",
}

// subsystemCodeLabels gives subsystem-specific error-code names, keyed by
// subsystem then code.
var subsystemCodeLabels = map[int]map[int]string{
	1:  {1: "MAIN_INS_DELAY"},
	2:  {2: "RADIO_LATE_FRAME"},
	5:  {0: "FAILSAFE_RESOLVED", 1: "FAILSAFE_OCCURRED"},
	6:  {0: "FAILSAFE_RESOLVED", 1: "FAILSAFE_OCCURRED"},
	7:  {0: "FAILSAFE_RESOLVED", 1: "FAILSAFE_OCCURRED"},
	8:  {0: "FAILSAFE_RESOLVED", 1: "FAILSAFE_OCCURRED"},
	9:  {0: "FAILSAFE_RESOLVED", 1: "FAILSAFE_OCCURRED"},
	11: {2: "GPS_GLITCH"},
	12: {1: "CRASH_CHECK_CRASH", 2: "CRASH_CHECK_LOSS_OF_CONTROL"},
	13: {2: "FLIP_ABANDONED"},
	15: {2: "PARACHUTE_TOO_LOW", 3: "PARACHUTE_LANDED"},
	16: {0: "EKFCHECK_VARIANCE_CLEARED", 2: "EKFCHECK_BAD_VARIANCE"},
	17: {0: "FAILSAFE_RESOLVED", 1: "FAILSAFE_OCCURRED"},
	18: {2: "BARO_GLITCH", 3: "BAD_DEPTH"},
	20: {0: "FAILSAFE_RESOLVED", 1: "FAILSAFE_OCCURRED"},
	21: {2: "MISSING_TERRAIN_DATA"},
	22: {
		2: "FAILED_TO_SET_DESTINATION",
		3: "RESTARTED_RTL",
		4: "FAILED_CIRCLE_INIT",
		5: "DEST_OUTSIDE_FENCE",
		6: "RTL_MISSING_RNGFND",
	},
	23: {0: "FAILSAFE_RESOLVED", 1: "FAILSAFE_OCCURRED"},
	26: {0: "FAILSAFE_RESOLVED", 1: "FAILSAFE_OCCURRED"},
	27: {0: "FAILSAFE_RESOLVED", 1: "FAILSAFE_OCCURRED"},
	29: {0: "FAILSAFE_RESOLVED", 1: "FAILSAFE_OCCURRED"},
	30: {1: "INTERNAL_ERRORS_DETECTED"},
	31: {0: "FAILSAFE_RESOLVED", 1: "FAILSAFE_OCCURRED"},
}

// genericCodeLabels applies when a subsystem has no specific code table.
var genericCodeLabels = map[int]string{
	0: "ERROR_RESOLVED",
	1: "FAILED_TO_INITIALISE",
	4: "UNHEALTHY",
}

// ErrorSubsystemName resolves a subsystem id to its name ("" if unknown).
func ErrorSubsystemName(id int) string { return subsystemLabels[id] }

// ErrorCodeName resolves a (subsystem, code) pair, falling back to the generic
// code table when the subsystem defines nothing specific.
func ErrorCodeName(subsys, code int) string {
	if codes, found := subsystemCodeLabels[subsys]; found {
		if name := codes[code]; name != "" {
			return name
		}
	}
	return genericCodeLabels[code]
}

// FieldValueLabels supplies enum-value label tables for the given message/field
// pair, returning nil when no enum applies.
func FieldValueLabels(msgName, fieldName string) map[string]string {
	switch {
	case msgName == "EV" && fieldName == "Id":
		return stringifyKeys(eventLabels)
	case msgName == "ERR" && fieldName == "Subsys":
		return stringifyKeys(subsystemLabels)
	default:
		return nil
	}
}

// ErrorSubsystemLabels returns the full subsystem table for bulk display.
func ErrorSubsystemLabels() map[int]string { return subsystemLabels }

// ErrorCodeLabels returns the full subsystem→code→name table for bulk display.
func ErrorCodeLabels() map[int]map[int]string { return subsystemCodeLabels }

// GenericErrorCodeLabels returns the fallback code table for bulk display.
func GenericErrorCodeLabels() map[int]string { return genericCodeLabels }

// stringifyKeys converts an int→string map into a string(int)→string map so the
// caller can index by the textual field value it already holds.
func stringifyKeys(values map[int]string) map[string]string {
	out := make(map[string]string, len(values))
	for id, name := range values {
		out[strconv.Itoa(id)] = name
	}
	return out
}
