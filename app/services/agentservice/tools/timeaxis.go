package tools

import "time"

// AbsTime 是日志的绝对时间基准（起飞/日志起点的 UTC 纪元秒）。工具输出里
// 的相对秒通过它换算为本地时区的墙上时间，让 AI 的回答与导出报告能引用
// 真实时刻而非只有相对秒。nil 表示日志没有可信的 UTC 基准。
type AbsTime struct {
	StartUnix int64
}

// At 把相对秒渲染为本地时区时间串（"2006-01-02 15:04:05"）。
// 桌面单机应用，本地时区即用户时区。
func (a *AbsTime) At(sec float64) string {
	if a == nil {
		return ""
	}
	return time.Unix(a.StartUnix, 0).Add(time.Duration(sec * float64(time.Second))).Format("2006-01-02 15:04:05")
}

// Start 把日志起点渲染为本地时区时间串。
func (a *AbsTime) Start() string {
	if a == nil {
		return ""
	}
	return time.Unix(a.StartUnix, 0).Format("2006-01-02 15:04:05")
}

// AtShort 把相对秒渲染为短时刻（"15:04:05"）：日期与基准日相同时省略
// 日期（完整日期只在 timeBase 出现一次，消除逐条重复）；跨天条目带
// "01-02 " 前缀自明。nil 返回空。
func (a *AbsTime) AtShort(sec float64) string {
	if a == nil {
		return ""
	}
	base := time.Unix(a.StartUnix, 0)
	t := base.Add(time.Duration(sec * float64(time.Second)))
	if y, m, d := t.Date(); y == base.Year() && m == base.Month() && d == base.Day() {
		return t.Format("15:04:05")
	}
	return t.Format("01-02 15:04:05")
}

// 结果条目上限：工具输出直接进 LLM 上下文，超出即截断并标记 truncated，
// 提示模型用更精确的过滤条件（时间窗/前缀）分批取。
const (
	maxRecordEntries  = 200 // get_records 条目上限
	maxParamEntries   = 120 // get_params 条目上限
	maxMavlinkEntries = 200 // get_mavlink_commands 条目上限
	maxMissionVersion = 12  // get_mission 版本上限
	maxMissionPoints  = 80  // get_mission 每版航点上限
)
