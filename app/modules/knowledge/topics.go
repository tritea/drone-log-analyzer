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
	Params []string // 应先取的支配参数（get_params 传同 topic 直取；日志未记录的按知识库默认值补齐展示）
	Guide  string   // 排查链：确认配置 → 沿链路取数 → 检查外部输入
}

// formatChains 按格式维护问题域的排查链。tlog 是 ArduPilot 遥测流，
// 参数体系与 apm 相同；ulog（PX4）参数体系独立维护（power 域暂无核实
// 过的支配参数，留空回退前缀浏览）。Params 里的名字必须存在于对应格式
// 的参数知识库（topics_test 校验），日志未记录的参数由 get_params 按
// 知识库默认值补齐展示。
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
		"attitude": {
			Params: []string{"ATC_INPUT_TC", "ATC_RAT_RLL_P", "ATC_RAT_PIT_P", "ATC_RAT_YAW_P", "ATC_ANGLE_BOOST"},
			Guide:  "先确认角度/速率控制参数是否被改与输入滤波时间常数；再对照姿态目标与实际角的跟踪误差、输出是否饱和；最后检查输入源（遥控/导航目标）",
		},
		"power": {
			Params: []string{"MOT_THST_EXPO", "MOT_SPIN_ARM", "MOT_SPIN_MAX", "MOT_PWM_TYPE", "ATC_THR_MIX_MAX"},
			Guide:  "先确认油门映射（PWM 协议/推力指数/怠速）与油门混控权重；再对照油门输出与电压电流跌落、动力响应（转速 vs 指令）；最后检查机械（桨/电机）",
		},
		"battery": {
			Params: []string{"BATT_MONITOR", "BATT_LOW_VOLT", "BATT_CRT_VOLT", "BATT_ARM_VOLT", "BATT_CAPACITY", "BATT_CURR_MULT"},
			Guide:  "先确认监视器类型与电压/电流换算（改过则读数失真）；再对照电压电流曲线与告警动作；最后核对起飞前电量与压降速率",
		},
		"vibration": {
			Params: []string{"INS_HNTCH_ENABLE", "INS_HNTCH_FREQ", "INS_HNTCH_REF", "INS_ACCEL_FILTER"},
			Guide:  "先确认陷波与加速度滤波配置（是否启用、频率是否对应电机阶次）；再对照振动水平与频谱特征；最后检查机械（桨/电机/机架松动）",
		},
		"rc": {
			Params: []string{"RC_OPTIONS", "FLTMODE_CH", "FLTMODE1"},
			Guide:  "先确认通道选项与模式开关通道配置；再对照遥控输入曲线与模式切换序列是否一致；最后检查失控保护动作",
		},
	},
	"tlog": {}, // 与 apm 同参数体系，见下方 TopicChainFor 的回退
	"ulog": {
		"position": {
			Params: []string{"EKF2_GPS_CHECK", "EKF2_EV_CTRL", "GPS_UBX_MODE", "SENS_GPS_MASK"},
			Guide:  "先确认 GPS 质量检查门槛与外部视觉融合开关；再对照 GPS 原始数据与 EKF 估计/新息；最后检查外部输入（RTK 降级、干扰、命令改目标）",
		},
		"attitude": {
			Params: []string{"MC_ROLLRATE_P", "MC_PITCHRATE_P", "MC_YAWRATE_P", "MC_ROLLRATE_MAX", "MC_YAWRATE_MAX"},
			Guide:  "先确认姿态速率增益与上限是否被改；再对照姿态角/角速度的跟踪误差与执行器饱和；最后检查输入源",
		},
		"altitude": {
			Params: []string{"EKF2_BARO_CTRL", "EKF2_BARO_NOISE", "LPE_BAR_Z"},
			Guide:  "先确认气压计源策略与噪声参数；再对照气压/高度原始数据与融合估计；最后检查外部扰动（气流、高度源切换）",
		},
		"estimator": {
			Params: []string{"EKF2_MULTI_IMU", "ATT_EN", "EKF2_REQ_EPH", "EKF2_REQ_EPV", "EKF2_BARO_DELAY"},
			Guide:  "先确认融合源开关与 GPS 质量门槛、气压延迟补偿；再查估计器状态/新息与源数据的一致性",
		},
		"battery": {
			Params: []string{"BAT1_SOURCE", "BAT1_N_CELLS", "BAT1_V_EMPTY", "BAT1_V_CHARGED", "BAT_LOW_THR", "BAT_CRIT_THR", "COM_LOW_BAT_ACT"},
			Guide:  "先确认电池源与节数/满空电压标定（错则读数失真）；再对照电压电流曲线与低电动作；最后核对起飞前电量与压降速率",
		},
		"vibration": {
			Params: []string{"IMU_GYRO_CUTOFF", "IMU_ACCEL_CUTOFF", "IMU_DGYRO_CUTOFF"},
			Guide:  "先确认陀螺/加速度滤波截止频率；再对照传感器振动水平（加速度模长波动）；最后检查机械（桨/电机/机架松动）",
		},
		"rc": {
			Params: []string{"RC_MAP_THROTTLE", "RC_MAP_MODE_SW", "COM_RC_LOSS_T", "NAV_RCL_ACT"},
			Guide:  "先确认通道映射与失联判定/动作；再对照遥控输入与模式切换序列；最后检查失联时序与恢复行为",
		},
	},
}

// TopicChainFor 返回某格式某问题域的排查链；tlog 回退用 apm 的定义。
func TopicChainFor(format, topic string) (TopicChain, bool) {
	if format == "tlog" {
		format = "apm"
	}
	c, ok := formatChains[format][topic]
	return c, ok
}

// ChainTopics 返回某格式有排查链（支配参数清单）的主题 key 清单；tlog
// 回退用 apm 的定义。供 get_params 的 topic 过滤报错提示可选值。
func ChainTopics(format string) []string {
	if format == "tlog" {
		format = "apm"
	}
	m := formatChains[format]
	if m == nil {
		return nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
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
