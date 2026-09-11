package tools

import (
	"context"
	"sort"
	"strings"

	"github.com/cloudwego/eino/components/tool"

	"drone-log-analyzer/app/modules/knowledge"
)

type flightEventsInput struct {
	Kind string `json:"kind" jsonschema:"required,description=errors|events|modes"`
}

type recordEntry struct {
	TimeSec float64 `json:"timeSec"`
	Time    string  `json:"time,omitempty"` // 绝对时刻（本地时区；空=无 UTC 基准）
	Text    string  `json:"text"`
}

type flightEventsOutput struct {
	Kind      string        `json:"kind"`
	Count     int           `json:"count"` // 命中总数（entries 可能被截断）
	Truncated bool          `json:"truncated,omitempty"`
	Entries   []recordEntry `json:"entries"`
}

// flightEventsTool 返回错误/事件/模式切换记录（时间 + 文案），诊断时
// 的高价值线索。
func flightEventsTool(deps Deps) (tool.InvokableTool, error) {
	return infer("get_records",
		"获取飞行过程记录：kind=errors（错误）、events（事件，如解锁/上锁）、"+
			"modes（模式切换序列）。时间单位秒、相对日志起点。",
		func(ctx context.Context, in flightEventsInput) (flightEventsOutput, error) {
			out := flightEventsOutput{Kind: strings.ToLower(strings.TrimSpace(in.Kind))}
			switch out.Kind {
			case "errors":
				errs, err := deps.Log.Errors(ctx)
				if err != nil {
					return out, err
				}
				for _, e := range errs {
					desc := e.Description
					if e.SubsysName != "" {
						desc = e.SubsysName + ": " + desc
					}
					out.Entries = append(out.Entries, recordEntry{TimeSec: e.TimeMs / 1000, Text: desc})
				}
			case "events":
				events, err := deps.Log.Events(ctx)
				if err != nil {
					return out, err
				}
				for _, ev := range events {
					name := ev.Name
					if name == "" {
						name = "EV#" + formatFloat(float64(ev.Id))
					}
					out.Entries = append(out.Entries, recordEntry{TimeSec: ev.TimeMs / 1000, Text: name})
				}
			case "modes":
				modes, err := deps.Log.ModeChanges(ctx)
				if err != nil {
					return out, err
				}
				for _, m := range modes {
					text := m.Mode
					if text == "" {
						text = "MODE#" + formatFloat(float64(m.ModeNum))
					}
					out.Entries = append(out.Entries, recordEntry{TimeSec: m.TimeMs / 1000, Text: text})
				}
			default:
				return out, errBadKind
			}
			out.Count = len(out.Entries)
			if len(out.Entries) > maxRecordEntries {
				out.Entries = out.Entries[:maxRecordEntries]
				out.Truncated = true
			}
			for i := range out.Entries {
				out.Entries[i].Time = deps.Abs.At(out.Entries[i].TimeSec)
			}
			return out, nil
		})
}

type parametersInput struct {
	NamePrefix string `json:"name_prefix,omitempty" jsonschema_description:"参数名前缀过滤（区分大小写），缺省返回全部"`
}

type parameterEntry struct {
	Name        string   `json:"name"`
	Value       float64  `json:"value"`
	Description string   `json:"description,omitempty"`
	Long        string   `json:"long,omitempty"`
	Unit        string   `json:"unit,omitempty"`
	RangeMin    *float64 `json:"rangeMin,omitempty"`
	RangeMax    *float64 `json:"rangeMax,omitempty"`
	Default     *float64 `json:"default,omitempty"` // 官方默认值；与当前值不同=用户改过
	Values      []string `json:"values,omitempty"`  // 枚举/位段说明
	Group       string   `json:"group,omitempty"`
	Known       bool     `json:"known"` // 是否附有参考说明
}

type parametersOutput struct {
	Count     int              `json:"count"` // 命中总数（entries 可能被截断）
	Truncated bool             `json:"truncated,omitempty"`
	Entries   []parameterEntry `json:"entries"`
}

// parametersTool 返回飞控参数（可前缀过滤），并融合参数知识库：含义/单位/
// 范围/默认值/枚举。当前值 vs 默认值 是排查配置问题的关键线索。
func parametersTool(deps Deps) (tool.InvokableTool, error) {
	return infer("get_params",
		"获取参数表（名称→值），可用 name_prefix 前缀过滤（如 ATC_、MOT_、EK3_）。"+
			"每条附带含义/单位/范围/默认值（当前值≠默认值说明被改过）。"+
			"建议先用参数分组工具浏览，再按前缀取值。",
		func(ctx context.Context, in parametersInput) (parametersOutput, error) {
			params, err := deps.Log.Parameters(ctx)
			if err != nil {
				return parametersOutput{}, err
			}
			prefix := in.NamePrefix
			kb := knowledge.ForParams(deps.Format)
			out := parametersOutput{Entries: make([]parameterEntry, 0, len(params))}
			for _, p := range params {
				if prefix != "" && !strings.HasPrefix(p.Name, prefix) {
					continue
				}
				entry := parameterEntry{Name: p.Name, Value: p.Value, Group: knowledge.ParamGroup(p.Name)}
				if pm, ok := kb.Lookup(p.Name); ok && knowledge.Applies(pm.AppliesTo, deps.Class) {
					entry.Known = true
					entry.Description = pm.Description
					entry.Long = pm.Long
					entry.Unit = pm.Unit
					entry.RangeMin = pm.RangeMin
					entry.RangeMax = pm.RangeMax
					entry.Default = pm.Default
					entry.Values = pm.Values
				}
				out.Entries = append(out.Entries, entry)
			}
			out.Count = len(out.Entries)
			// 截断 + 精简：条目多时去掉 Long 长述（token 大头），提示分批取。
			if len(out.Entries) > maxParamEntries {
				out.Entries = out.Entries[:maxParamEntries]
				out.Truncated = true
			}
			if len(out.Entries) > 40 {
				for i := range out.Entries {
					out.Entries[i].Long = ""
				}
			}
			return out, nil
		})
}

type paramGroupsInput struct{}

type paramGroupBrief struct {
	Prefix      string   `json:"prefix"`
	Description string   `json:"description,omitempty"`
	Affects     []string `json:"affects,omitempty"`
	Count       int      `json:"count"` // 当前日志里该组参数个数（按机型过滤后）
}

type paramGroupsOutput struct {
	Groups []paramGroupBrief `json:"groups"`
}

// paramGroupsTool 按前缀分组浏览参数域（ATC/MOT/EK3…），避免全量拉参数
// 浪费上下文；组带作用与影响说明。
func paramGroupsTool(deps Deps) (tool.InvokableTool, error) {
	return infer("list_param_groups",
		"按前缀分组列出当前日志的参数域（如 ATC_=姿态控制、MOT_=动力、EK3_=估计器），"+
			"含每组作用说明与参数个数。先浏览分组，再用前缀过滤取参数值。",
		func(ctx context.Context, in paramGroupsInput) (paramGroupsOutput, error) {
			params, err := deps.Log.Parameters(ctx)
			if err != nil {
				return paramGroupsOutput{}, err
			}
			kb := knowledge.ForParams(deps.Format)
			counts := map[string]int{}
			for _, p := range params {
				if pm, ok := kb.Lookup(p.Name); ok && !knowledge.Applies(pm.AppliesTo, deps.Class) {
					continue
				}
				counts[knowledge.ParamGroup(p.Name)]++
			}
			groups := make([]paramGroupBrief, 0, len(counts))
			for prefix, count := range counts {
				brief := paramGroupBrief{Prefix: prefix, Count: count}
				if gm, ok := kb.ParamGroupMeta(prefix); ok {
					brief.Description = gm.Description
					brief.Affects = gm.Affects
				}
				groups = append(groups, brief)
			}
			sort.Slice(groups, func(i, j int) bool { return groups[i].Prefix < groups[j].Prefix })
			return paramGroupsOutput{Groups: groups}, nil
		})
}

var errBadKind = &badKindError{}

type badKindError struct{}

func (*badKindError) Error() string {
	return "kind 必须是 errors / events / modes 之一"
}
