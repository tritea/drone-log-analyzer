package tools

import (
	"context"
	"math"
	"sort"
	"strings"

	"github.com/cloudwego/eino/components/tool"

	"drone-log-analyzer/app/services/logservice"
)

// finitePtr 把坐标/参数渲染为可省略的 JSON 字段：非有限值（NaN/±Inf，MAVLink
// 未用槽位的常见位模式）返回 nil → omitempty 省略，避免污染 LLM 上下文。
func finitePtr(v float64) *float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	return &v
}

// ---- 任务航线（get_mission） ----

type missionInput struct{}

// waypointCols：cmd 缺名时为 "#<命令号>"；p1~p4 为命令参数（行尾空列省略）。
var waypointCols = []string{"seq", "cmd", "lat", "lon", "alt", "frame", "p1", "p2", "p3", "p4"}

type missionVersion struct {
	TSec      float64 `json:"tSec"`        // 版本首条命令的相对秒
	T         string  `json:"t,omitempty"` // 对应绝对时刻（短格式；cols 见外层）
	Count     int     `json:"count"`       // 该版航点总数（wp 截断时>len）
	Truncated bool    `json:"truncated,omitempty"`
	Waypoints [][]any `json:"wp"`
}

type missionOutput struct {
	TimeBase  string           `json:"timeBase,omitempty"` // tSec=0 对应的绝对时刻（完整日期）
	Cols      []string         `json:"cols"`
	Versions  int              `json:"versions"` // 航线版本数（飞行中重新上传即新版本）
	Count     int              `json:"count"`    // 航点命令总数
	Truncated bool             `json:"truncated,omitempty"`
	Items     []missionVersion `json:"items"`
}

// missionTool 返回任务航线（航点序列）。飞控日志里的航线上传记录按时间排序后
// sequence 回退即一次完整上传（新版本）——飞行中地面站改航线会产生多版本，
// 版本切换时刻本身常是事故线索。
func missionTool(deps Deps) (tool.InvokableTool, error) {
	return infer("get_mission",
		"获取任务航线（航点序列）：每版含上传时刻与航点行数组（cols 标列序，行尾空列省略；"+
			"seq/cmd/坐标/高度/参数），cmd 缺名时为 #<命令号>，高度参考 frame（相对/绝对）。"+
			"飞行中航线被重新上传会产生多个版本，版本切换时刻值得重点关注。"+
			"无航线记录时 versions=0。",
		func(ctx context.Context, in missionInput) (missionOutput, error) {
			cmds, err := deps.Log.Commands(ctx)
			if err != nil {
				return missionOutput{}, err
			}
			out := missionOutput{TimeBase: deps.Abs.Start(), Cols: waypointCols, Count: len(cmds)}
			sorted := make([]logservice.CommandEntry, len(cmds))
			copy(sorted, cmds)
			sort.SliceStable(sorted, func(i, j int) bool {
				if sorted[i].TimeMs != sorted[j].TimeMs {
					return sorted[i].TimeMs < sorted[j].TimeMs
				}
				return sorted[i].Sequence < sorted[j].Sequence
			})

			// 版本切分与前端 rebuildThreeMissionVersions 同规则：seq 回退即新版本。
			var cur *missionVersion
			prevSeq := -1
			for _, c := range sorted {
				if cur == nil || c.Sequence <= prevSeq {
					out.Items = append(out.Items, missionVersion{
						TSec:      c.TimeMs / 1000,
						Waypoints: make([][]any, 0, 16),
					})
					cur = &out.Items[len(out.Items)-1]
				}
				cur.Count++
				if len(cur.Waypoints) < maxMissionPoints {
					cur.Waypoints = append(cur.Waypoints, trimRow([]any{
						c.Sequence, nameOrID(c.CommandName, c.Command),
						ptrVal(finitePtr(c.Latitude)), ptrVal(finitePtr(c.Longitude)), ptrVal(finitePtr(c.Altitude)),
						c.FrameName,
						ptrVal(finitePtr(c.Param1)), ptrVal(finitePtr(c.Param2)),
						ptrVal(finitePtr(c.Param3)), ptrVal(finitePtr(c.Param4)),
					}))
				} else {
					cur.Truncated = true
					out.Truncated = true
				}
				prevSeq = c.Sequence
			}
			out.Versions = len(out.Items)
			if len(out.Items) > maxMissionVersion {
				out.Items = out.Items[:maxMissionVersion]
				out.Truncated = true
			}
			for i := range out.Items {
				out.Items[i].T = deps.Abs.AtShort(out.Items[i].TSec)
			}
			return out, nil
		})
}

// ---- 飞行中收到的 MAVLink 命令（get_mavlink_commands） ----

type mavlinkCommandsInput struct {
	Command string `json:"command,omitempty" jsonschema_description:"按命令名过滤（包含匹配、忽略大小写），如 LAND、RETURN、MISSION、JUMP；缺省返回全部"`
}

// mavlinkCols：t=绝对时刻短格式（日期基准见 timeBase）；cmd/result 缺名时为
// "#<编号>"；via=LONG/INT；from/to=sys.comp（255.190=典型地面站）。
var mavlinkCols = []string{"t", "tSec", "cmd", "via", "from", "to", "result", "lat", "lon", "alt", "p1", "p2", "p3", "p4"}

type mavlinkCommandsOutput struct {
	TimeBase  string   `json:"timeBase,omitempty"` // tSec=0 对应的绝对时刻（完整日期）
	Cols      []string `json:"cols"`
	Count     int      `json:"count"` // 命中总数（rows 可能被截断）
	Truncated bool     `json:"truncated,omitempty"`
	Rows      [][]any  `json:"rows"`
}

// mavlinkCommandsTool 返回飞行中收到的 MAVLink 命令流（COMMAND_LONG/COMMAND_INT
// 及其 ACK）。地面站在飞行中下发降落/返航/改航点/改参数等命令是常见事故诱因，
// 命令时刻与执行结果（result）是关键证据。
func mavlinkCommandsTool(deps Deps) (tool.InvokableTool, error) {
	return infer("get_mavlink_commands",
		"获取飞行中收到的 MAVLink 命令流，结果为行数组（cols 标列序，行尾空列省略）："+
			"t/cmd=时刻与命令名，result=执行结果（ACCEPTED/DENIED/TIMEOUT…），"+
			"from=255.190 通常为地面站。可用 command 按命令名过滤（如 LAND、RETURN、MISSION）。"+
			"判断\"是否地面站突然下发命令\"就查这个工具；无记录时 count=0。",
		func(ctx context.Context, in mavlinkCommandsInput) (mavlinkCommandsOutput, error) {
			cmds, err := deps.Log.MAVLinkCommands(ctx)
			if err != nil {
				return mavlinkCommandsOutput{}, err
			}
			filter := strings.ToUpper(strings.TrimSpace(in.Command))
			out := mavlinkCommandsOutput{TimeBase: deps.Abs.Start(), Cols: mavlinkCols}
			for _, c := range cmds {
				// 过滤匹配显示名（缺名时为 "#<命令号>"），行里看到什么就能按什么筛。
				if filter != "" && !strings.Contains(strings.ToUpper(nameOrID(c.CommandName, c.Command)), filter) {
					continue
				}
				out.Count++
				if len(out.Rows) >= maxMavlinkEntries {
					out.Truncated = true
					continue
				}
				sec := c.TimeMs / 1000
				out.Rows = append(out.Rows, trimRow([]any{
					deps.Abs.AtShort(sec), sec, nameOrID(c.CommandName, c.Command),
					mavlinkVia(c.WasCommandLong), endpoint(c.SourceSystem, c.SourceComponent), endpoint(c.TargetSystem, c.TargetComponent),
					nameOrID(c.ResultName, c.Result),
					ptrVal(finitePtr(c.Latitude)), ptrVal(finitePtr(c.Longitude)), ptrVal(finitePtr(c.Altitude)),
					ptrVal(finitePtr(c.Param1)), ptrVal(finitePtr(c.Param2)),
					ptrVal(finitePtr(c.Param3)), ptrVal(finitePtr(c.Param4)),
				}))
			}
			return out, nil
		})
}

func mavlinkVia(wasLong bool) string {
	if wasLong {
		return "LONG"
	}
	return "INT"
}

// endpoint 渲染 sys.comp 端点；全零（广播/未指定）返回空。
func endpoint(sys, comp int) string {
	if sys == 0 && comp == 0 {
		return ""
	}
	return formatFloat(float64(sys)) + "." + formatFloat(float64(comp))
}
