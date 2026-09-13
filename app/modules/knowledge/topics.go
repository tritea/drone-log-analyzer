package knowledge

// topics.go — 常用主题 → group 映射：把"按问题域找字段"从两层探索
// （list_groups → get_fields）压成一次直达。主题是高频诊断域的固化
// 路径，未覆盖的场景仍走分组/字段工具；运行时与日志实际存在的 group
// 取交集，日志里没有的不出现。group 顺序即输出顺序（按诊断价值排）。

// formatTopics 按格式维护主题映射。主题 key 用稳定英文词，展示名见
// tools 层工具描述；同主题各格式映射到各自的真实 group 名。
var formatTopics = map[string]map[string][]string{
	"apm": {
		"position":  {"GPS", "POS", "ORGN"},
		"attitude":  {"ATT", "AHR2"},
		"altitude":  {"CTUN", "BARO", "TERR"},
		"power":     {"CTUN", "ESC", "RPM"},
		"battery":   {"BAT", "BCL", "POWR"},
		"vibration": {"VIBE", "IMU"},
		"estimator": {"XKF1", "XKF4", "NKF1"},
		"rc":        {"RCIN", "RCOU"},
	},
	"tlog": {
		"position":  {"GPS_RAW_INT", "GLOBAL_POSITION_INT", "LOCAL_POSITION_NED", "POSITION_TARGET_GLOBAL_INT"},
		"attitude":  {"ATTITUDE", "ATTITUDE_QUATERNION", "AHRS"},
		"altitude":  {"ALTITUDE", "VFR_HUD"},
		"power":     {"ESC_STATUS", "SERVO_OUTPUT_RAW", "RPM"},
		"battery":   {"BATTERY_STATUS", "POWER_STATUS", "SYS_STATUS"},
		"vibration": {"VIBRATION", "RAW_IMU"},
		"estimator": {"EKF_STATUS_REPORT", "ESTIMATOR_STATUS"},
		"rc":        {"RC_CHANNELS", "RC_CHANNELS_SCALED", "MANUAL_CONTROL"},
	},
	"ulog": {
		"position":  {"vehicle_gps_position", "vehicle_local_position", "vehicle_global_position"},
		"attitude":  {"vehicle_attitude", "vehicle_angular_velocity"},
		"altitude":  {"sensor_baro", "vehicle_air_data"},
		"power":     {"actuator_motors", "actuator_outputs"},
		"battery":   {"battery_status"},
		"vibration": {"sensor_combined"},
		"estimator": {"estimator_status", "estimator_innovations"},
		"rc":        {"rc_channels", "manual_control_setpoint"},
	},
}

// TopicChain 是某问题域的排查链：先定位的支配参数与判读步骤。领域知识
// 放这里而非 prompt——prompt 只保留"有配置影响的行为先定位支配参数"的
// 通用原则，具体查什么参数按格式/固件在此维护。
type TopicChain struct {
	Params []string // 应先取的支配参数（get_params 可用名或前缀）
	Guide  string   // 排查链：确认配置 → 沿链路取数 → 检查外部输入
}

// formatChains 按格式维护问题域的排查链。tlog 是 ArduPilot 遥测流，
// 参数体系与 apm 相同；ulog（PX4）估计器源选择机制不同，待充实。
var formatChains = map[string]map[string]TopicChain{
	"apm": {
		"altitude": {
			Params: []string{"EK3_SRC1_POSZ", "EK3_SRC1_VELZ", "RNGFND1_TYPE", "EK3_ALT_M_NSE"},
			Guide:  "先确认高度源（POSZ：0=气压计 1=测距仪 2=GPS 3=GPS+气压融合）与测距仪配置，判断是否用错源/缺校准；再对照实际源的原始数据（BARO/RFND/GPS）与 EKF 估计；最后检查外部输入（RTK 状态降级、气压扰动、MAVLink 命令）",
		},
		"position": {
			Params: []string{"EK3_SRC1_POSXY", "EK3_SRC1_VELXY", "GPS1_TYPE", "GPS_AUTO_CONFIG", "EK3_GPS_CHECK"},
			Guide:  "先确认定位源（POSXY：1=GPS 2=外部导航 3=融合）与 GPS 类型（含 RTK）；再对照该源原始数据与 EKF 估计/新息；最后检查外部输入（RTK 降级、干扰、命令改目标）",
		},
		"estimator": {
			Params: []string{"EK3_ENABLE", "EK3_SRC_OPTIONS", "EK3_GSF_RUN_MASK", "AHRS_EKF_TYPE"},
			Guide:  "先确认实际生效的估计器（AHRS_EKF_TYPE）与源策略；再查估计器状态/新息与源数据的一致性",
		},
	},
	"tlog": {}, // 与 apm 同参数体系，见下方 TopicChainFor 的回退
	"ulog": {}, // PX4 估计器源选择机制不同，待充实（M3 持续项）
}

// TopicChainFor 返回某格式某问题域的排查链；tlog 回退用 apm 的定义。
func TopicChainFor(format, topic string) (TopicChain, bool) {
	if format == "tlog" {
		format = "apm"
	}
	c, ok := formatChains[format][topic]
	return c, ok
}

// TopicGroups 返回某格式下主题映射（key=主题，value=group 清单）。
// 未知格式返回 nil。返回值只读，调用方不得修改。
func TopicGroups(format string) map[string][]string {
	return formatTopics[format]
}

// TopicList 返回某格式的主题 key 清单（稳定顺序）；未知格式返回 nil。
func TopicList(format string) []string {
	m := formatTopics[format]
	if m == nil {
		return nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
