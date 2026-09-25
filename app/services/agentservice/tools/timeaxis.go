package tools

import "time"

// AbsTime 是日志的绝对时间基准（起飞/日志起点的 UTC 纪元秒）。工具输出里
// 的相对秒通过它渲染为 UTC 时刻——与界面曲线/时间轴显示同一口径，用户
// 照着界面给的时刻与工具输出天然一致。nil 表示日志没有可信的 UTC 基准。
type AbsTime struct {
	StartUnix int64
}

// At 把相对秒渲染为 UTC 时间串（"2006-01-02 15:04:05"）。
func (a *AbsTime) At(sec float64) string {
	if a == nil {
		return ""
	}
	return time.Unix(a.StartUnix, 0).Add(time.Duration(sec * float64(time.Second))).UTC().Format("2006-01-02 15:04:05")
}

// Start 把日志起点渲染为 UTC 时间串，并带时区后缀（"2026-09-08 06:37:51
// +00:00"）：时刻列全部是 UTC 口径，显式注明防止模型按本地时区二次换算
// 或怀疑与 GPS 时间戳"对不上"。
func (a *AbsTime) Start() string {
	if a == nil {
		return ""
	}
	return time.Unix(a.StartUnix, 0).UTC().Format("2006-01-02 15:04:05 +00:00")
}

// AtShort 把相对秒渲染为短时刻（"15:04:05"）：日期与基准日相同时省略
// 日期（完整日期只在 timeBase 出现一次，消除逐条重复）；跨天条目带
// "01-02 " 前缀自明。nil 返回空。
func (a *AbsTime) AtShort(sec float64) string {
	if a == nil {
		return ""
	}
	base := time.Unix(a.StartUnix, 0).UTC()
	t := base.Add(time.Duration(sec * float64(time.Second)))
	if y, m, d := t.Date(); y == base.Year() && m == base.Month() && d == base.Day() {
		return t.Format("15:04:05")
	}
	return t.Format("01-02 15:04:05")
}

// relSec 把记录时间戳换算为相对日志起点的秒：logservice 的记录类时间戳
// （事件/错误/模式/航线/命令）随格式而异——tlog/ulog 是绝对纪元毫秒、
// dataflash 是启动毫秒——统一减 OriginMs（= summary.StartTimeMs，与
// Series/曲线轴同原点）后除 1000。不归一化的话 tlog/ulog 的事件时刻
// 会被 AtShort 二次加基准，得到几十年后的幻影日期。
func relSec(originMs, timeMs float64) float64 {
	return (timeMs - originMs) / 1000
}

// 结果条目上限：工具输出直接进 LLM 上下文，超出即截断并标记 truncated，
// 提示模型用更精确的过滤条件（时间窗/前缀）分批取。
const (
	maxRecordEntries  = 200 // get_records 条目上限
	maxParamEntries   = 120 // get_params 条目上限
	maxMavlinkEntries = 200 // get_mavlink_commands 条目上限
	maxMissionVersion = 12  // get_mission 版本上限
	maxMissionPoints  = 80  // get_mission 每版航点上限
	maxTopicFields    = 60  // get_topic_fields 字段数上限
	maxAbnSegments    = 50  // abnormal 每级段行上限（超出的丢弃，总越限秒仍按全量计）
	abnMergeGapSecs   = 1.0 // abnormal 相邻段合并间隔（秒）：阈值附近抖动的毛刺段并成一场

	// groupScanMaxEntries 是 topic 路径同族扫描（groupRows）的条目上限，
	// 比 maxParamEntries 高：仅名称+值（无描述列）行成本 ~1/5，而单族就可能
	// 超过 120（EK3_* 新固件 ~130 个），按字母序截断会恰好切掉 EK3_SRC* 这类
	// 排后的关键参数——宁多勿缺，上限只防真正的失控。
	groupScanMaxEntries = 250

	// maxRawRowsPerRound 是一轮（一次 Chat）内全部 raw 查询共享的原始点
	// 总预算：迭代重发乘法下无上限的原始序列会把上下文放大到百万 token。
	MaxRawRowsPerRound = 2400
)
