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

type missionWaypoint struct {
	Sequence    int      `json:"sequence"`
	Command     int      `json:"command"`
	CommandName string   `json:"commandName,omitempty"`
	Latitude    *float64 `json:"latitude,omitempty"`
	Longitude   *float64 `json:"longitude,omitempty"`
	Altitude    *float64 `json:"altitude,omitempty"`
	FrameName   string   `json:"frameName,omitempty"`
	Param1      *float64 `json:"param1,omitempty"`
	Param2      *float64 `json:"param2,omitempty"`
	Param3      *float64 `json:"param3,omitempty"`
	Param4      *float64 `json:"param4,omitempty"`
}

type missionVersion struct {
	TimeSec   float64           `json:"timeSec"`        // 版本首条命令的相对秒
	Time      string            `json:"time,omitempty"` // 对应绝对时刻（本地时区）
	Count     int               `json:"count"`          // 该版航点总数（waypoints 截断时>len）
	Truncated bool              `json:"truncated,omitempty"`
	Waypoints []missionWaypoint `json:"waypoints"`
}

type missionOutput struct {
	TimeBase  string           `json:"timeBase,omitempty"`
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
		"获取任务航线（航点序列）：每版含上传时刻与航点列表（序号/命令/坐标/高度/参数），"+
			"高度参考 frameName（相对/绝对）。飞行中航线被重新上传会产生多个版本，"+
			"版本切换时刻值得重点关注。无航线记录时 versions=0。",
		func(ctx context.Context, in missionInput) (missionOutput, error) {
			cmds, err := deps.Log.Commands(ctx)
			if err != nil {
				return missionOutput{}, err
			}
			out := missionOutput{TimeBase: deps.Abs.Start(), Count: len(cmds)}
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
						TimeSec:   c.TimeMs / 1000,
						Waypoints: make([]missionWaypoint, 0, 16),
					})
					cur = &out.Items[len(out.Items)-1]
				}
				cur.Count++
				if len(cur.Waypoints) < maxMissionPoints {
					cur.Waypoints = append(cur.Waypoints, missionWaypoint{
						Sequence:    c.Sequence,
						Command:     c.Command,
						CommandName: c.CommandName,
						Latitude:    finitePtr(c.Latitude),
						Longitude:   finitePtr(c.Longitude),
						Altitude:    finitePtr(c.Altitude),
						FrameName:   c.FrameName,
						Param1:      finitePtr(c.Param1),
						Param2:      finitePtr(c.Param2),
						Param3:      finitePtr(c.Param3),
						Param4:      finitePtr(c.Param4),
					})
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
				out.Items[i].Time = deps.Abs.At(out.Items[i].TimeSec)
			}
			return out, nil
		})
}

// ---- 飞行中收到的 MAVLink 命令（get_mavlink_commands） ----

type mavlinkCommandsInput struct {
	Command string `json:"command,omitempty" jsonschema_description:"按命令名过滤（包含匹配、忽略大小写），如 LAND、RETURN、MISSION、JUMP；缺省返回全部"`
}

type mavlinkCommandEntry struct {
	TimeSec     float64  `json:"timeSec"`
	Time        string   `json:"time,omitempty"`
	Command     int      `json:"command"`
	CommandName string   `json:"commandName,omitempty"`
	Via         string   `json:"via,omitempty"`  // COMMAND_LONG / COMMAND_INT
	From        string   `json:"from,omitempty"` // 来源 sys.comp（255.190=典型地面站）
	To          string   `json:"to,omitempty"`   // 目标 sys.comp
	Result      int      `json:"result"`
	ResultName  string   `json:"resultName,omitempty"` // ACK 结果（ACCEPTED/DENIED/TIMEOUT…）
	Latitude    *float64 `json:"latitude,omitempty"`
	Longitude   *float64 `json:"longitude,omitempty"`
	Altitude    *float64 `json:"altitude,omitempty"`
	Param1      *float64 `json:"param1,omitempty"`
	Param2      *float64 `json:"param2,omitempty"`
	Param3      *float64 `json:"param3,omitempty"`
	Param4      *float64 `json:"param4,omitempty"`
}

type mavlinkCommandsOutput struct {
	TimeBase  string                `json:"timeBase,omitempty"`
	Count     int                   `json:"count"` // 命中总数（entries 可能被截断）
	Truncated bool                  `json:"truncated,omitempty"`
	Entries   []mavlinkCommandEntry `json:"entries"`
}

// mavlinkCommandsTool 返回飞行中收到的 MAVLink 命令流（COMMAND_LONG/COMMAND_INT
// 及其 ACK）。地面站在飞行中下发降落/返航/改航点/改参数等命令是常见事故诱因，
// 命令时刻与执行结果（result）是关键证据。
func mavlinkCommandsTool(deps Deps) (tool.InvokableTool, error) {
	return infer("get_mavlink_commands",
		"获取飞行中收到的 MAVLink 命令流（含 COMMAND_LONG/INT 与执行结果 result/"+
			"resultName，来源 from=255.190 通常为地面站）。可用 command 按命令名过滤"+
			"（如 LAND、RETURN、MISSION）。判断\"是否地面站突然下发命令\"就查这个工具；"+
			"无记录时 count=0。",
		func(ctx context.Context, in mavlinkCommandsInput) (mavlinkCommandsOutput, error) {
			cmds, err := deps.Log.MAVLinkCommands(ctx)
			if err != nil {
				return mavlinkCommandsOutput{}, err
			}
			filter := strings.ToUpper(strings.TrimSpace(in.Command))
			out := mavlinkCommandsOutput{TimeBase: deps.Abs.Start()}
			for _, c := range cmds {
				if filter != "" && !strings.Contains(strings.ToUpper(c.CommandName), filter) {
					continue
				}
				out.Count++
				if len(out.Entries) >= maxMavlinkEntries {
					out.Truncated = true
					continue
				}
				out.Entries = append(out.Entries, mavlinkCommandEntry{
					TimeSec:     c.TimeMs / 1000,
					Command:     c.Command,
					CommandName: c.CommandName,
					Via:         mavlinkVia(c.WasCommandLong),
					From:        endpoint(c.SourceSystem, c.SourceComponent),
					To:          endpoint(c.TargetSystem, c.TargetComponent),
					Result:      c.Result,
					ResultName:  c.ResultName,
					Latitude:    finitePtr(c.Latitude),
					Longitude:   finitePtr(c.Longitude),
					Altitude:    finitePtr(c.Altitude),
					Param1:      finitePtr(c.Param1),
					Param2:      finitePtr(c.Param2),
					Param3:      finitePtr(c.Param3),
					Param4:      finitePtr(c.Param4),
				})
			}
			for i := range out.Entries {
				out.Entries[i].Time = deps.Abs.At(out.Entries[i].TimeSec)
			}
			return out, nil
		})
}

func mavlinkVia(wasLong bool) string {
	if wasLong {
		return "COMMAND_LONG"
	}
	return "COMMAND_INT"
}

// endpoint 渲染 sys.comp 端点；全零（广播/未指定）返回空。
func endpoint(sys, comp int) string {
	if sys == 0 && comp == 0 {
		return ""
	}
	return formatFloat(float64(sys)) + "." + formatFloat(float64(comp))
}
