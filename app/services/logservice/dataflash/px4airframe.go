package dataflash

import (
	logparser "drone-log-analyzer/app/modules/parser"
)

const (
	px4DefaultFrame    = "QUADROTOR"
	px4DefaultAirframe = "multirotor"
	px4SysAutostartKey = "SYS_AUTOSTART"
)

func classifyPX4Airframe(id int) (frame, airframe string) {
	switch {
	case id >= 13000 && id <= 13999:
		return "", "vtol"
	case (id >= 2100 && id <= 2199) || (id >= 3000 && id <= 3099):
		return "", "vtol"
	case id >= 4000 && id <= 5999:
		return "QUADROTOR", "multirotor"
	case (id >= 6000 && id <= 7999) || (id >= 11000 && id <= 11999):
		return "HEXAROTOR", "multirotor"
	case (id >= 8000 && id <= 9999) || (id >= 12000 && id <= 12999):
		return "OCTOROTOR", "multirotor"
	default:
		return px4DefaultFrame, px4DefaultAirframe
	}
}

func classifyPX4FromLog(lg *logparser.LogFile) (frame, airframe string) {
	v, ok := lg.Parameters[px4SysAutostartKey]
	if !ok {
		return px4DefaultFrame, px4DefaultAirframe
	}
	return classifyPX4Airframe(int(v))
}
