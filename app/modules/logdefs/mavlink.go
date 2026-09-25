package logdefs

// commandLabels maps MAVLink MAV_CMD ids to their canonical names.
var commandLabels = map[int]string{
	16:  "NAV_WAYPOINT",
	17:  "NAV_LOITER_UNLIM",
	18:  "NAV_LOITER_TURNS",
	19:  "NAV_LOITER_TIME",
	20:  "NAV_RETURN_TO_LAUNCH",
	21:  "NAV_LAND",
	22:  "NAV_TAKEOFF",
	23:  "NAV_LAND_LOCAL",
	24:  "NAV_TAKEOFF_LOCAL",
	25:  "NAV_FOLLOW",
	30:  "NAV_CONTINUE_AND_CHANGE_ALT",
	31:  "NAV_LOITER_TO_ALT",
	80:  "NAV_CONTINUE_AND_CHANGE_ALT",
	81:  "NAV_LOITER_TO_ALT",
	82:  "DO_JUMP",
	83:  "DO_CHANGE_SPEED",
	84:  "DO_SET_HOME",
	85:  "DO_SET_ROI",
	87:  "DO_SET_MODE",
	88:  "DO_JUMP_TAG",
	89:  "DO_START_MAG_CAL",
	90:  "DO_SET_CAM_TRIGG_DIST",
	94:  "DO_LAND_START",
	95:  "DO_SET_ROI_LOCATION",
	96:  "DO_SET_ROI_WPNEXT_OFFSET",
	97:  "DO_SET_ROI_NONE",
	98:  "DO_SET_ROI_SYSID",
	99:  "DO_SET_ROI_CIRCLE",
	101: "DO_SET_FOCUS",
	115: "CONDITION_DELAY",
	116: "CONDITION_CHANGE_ALT",
	117: "CONDITION_DISTANCE",
	118: "CONDITION_YAW",
	119: "CONDITION_LAST",
	120: "DO_SET_SERVO",
	121: "DO_REPEAT_SERVO",
	122: "DO_SET_RELAY",
	123: "DO_REPEAT_RELAY",
	128: "DO_MOUNT_CONTROL",
	129: "DO_SET_CAM_TRIGG_INTERVAL",
	130: "DO_FENCE_ENABLE",
	131: "DO_PARACHUTE",
	132: "DO_GPS_SWITCH",
	133: "DO_INVERTED_FLIGHT",
	134: "DO_DIGICAM_CONTROL",
	135: "DO_SET_CAM_TRIGG_DIST2",
	136: "DO_CONTROL_VIDEO",
	137: "DO_SET_ROI",
	140: "DO_LAST",
	141: "DO_AUX_FUNCTION",
	142: "DO_MOUNT_CONFIGURE",
	143: "DO_MOUNT_CONTROL_QUAT",
	144: "DO_GUIDED_MASTER",
	145: "DO_GUIDED_LIMITS",
	146: "DO_ENGINE_CONTROL",
	147: "DO_SET_MISSION_CURRENT",
	148: "DO_LAST",
	149: "DO_SET_RELAY",
	159: "DO_MOUNT_TRACK",
	176: "DO_SET_ROI",
	177: "DO_GUIDED_LIMITS",
	178: "DO_FENCE_ENABLE",
	179: "DO_PARACHUTE",
	181: "DO_START_MAG_CAL",
	182: "DO_ACCEPT_MAG_CAL",
	183: "DO_SET_CAM_TRIGG_DIST",
	184: "DO_VTOL_TRANSITION",
	185: "DO_MOUNT_CONFIGURE",
	186: "DO_SET_RESUME_REPEAT_DIST",
	189: "DO_LAST",
	192: "DO_DELAY_COMMAND",
	193: "DO_DISTANCE_INIT_COMMAND",
	194: "DO_FIGURE_EIGHT",
	195: "DO_LAND_START2",
	201: "DO_SET_ROI_LOCATION",
	202: "DO_SET_ROI_WPNEXT_OFFSET",
	203: "DO_SET_ROI_NONE",
	204: "DO_SET_ROI_SYSID",
	205: "DO_SET_ROI_CIRCLE",
	206: "DO_SET_ROI",
	210: "DO_SET_CAM_TRIGG_DIST",
	211: "DO_SET_HOME_LOCATION",
	212: "DO_SET_HOME_YAW",
}

// frameLabels maps MAVLink MAV_FRAME ids to their names.
var frameLabels = map[int]string{
	0:  "GLOBAL",
	1:  "LOCAL_NED",
	2:  "MISSION",
	3:  "GLOBAL_RELATIVE_ALT",
	4:  "LOCAL_ENU",
	5:  "GLOBAL_INT",
	6:  "GLOBAL_RELATIVE_ALT_INT",
	7:  "LOCAL_OFFSET_NED",
	8:  "BODY_NED",
	9:  "BODY_OFFSET_NED",
	10: "GLOBAL_TERRAIN_ALT",
	11: "GLOBAL_TERRAIN_ALT_INT",
	12: "LOCAL_FRD",
	13: "GLOBAL_RELATIVE_ALT_MSL_INT",
	14: "LOCAL_FLU",
}

// resultLabels maps MAVLink MAV_RESULT ids to their names.
var resultLabels = map[int]string{
	0: "ACCEPTED",
	1: "TEMPORARILY_REJECTED",
	2: "DENIED",
	3: "UNSUPPORTED",
	4: "FAILED",
	5: "IN_PROGRESS",
	6: "CANCELLED",
	7: "COMMAND_LONG_ONLY",
	8: "COMMAND_INT_ONLY",
	9: "COMMAND_UNSUPPORTED_MAV_FRAME",
}

// CommandName resolves a MAV_CMD id to its name ("" if unknown).
func CommandName(id int) string { return commandLabels[id] }

// FrameName resolves a MAV_FRAME id to its name ("" if unknown).
func FrameName(id int) string { return frameLabels[id] }

// ResultName resolves a MAV_RESULT id to its name ("" if unknown).
func ResultName(id int) string { return resultLabels[id] }

// CommandLabels returns the full MAV_CMD table for bulk display.
func CommandLabels() map[int]string { return commandLabels }

// FrameLabels returns the full MAV_FRAME table for bulk display.
func FrameLabels() map[int]string { return frameLabels }

// ResultLabels returns the full MAV_RESULT table for bulk display.
func ResultLabels() map[int]string { return resultLabels }
