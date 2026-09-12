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

// recordCols 行式编码：t=绝对时刻短格式（HH:MM:SS，日期基准见 timeBase，
// 跨天带 MM-DD 前缀）、tSec=相对秒、text=文案。
var recordCols = []string{"t", "tSec", "text"}

type flightEventsOutput struct {
	Kind      string   `json:"kind"`
	TimeBase  string   `json:"timeBase,omitempty"` // tSec=0 对应的绝对时刻（完整日期，本地时区）
	Count     int      `json:"count"`              // 命中总数（rows 可能被截断）
	Truncated bool     `json:"truncated,omitempty"`
	Cols      []string `json:"cols"`
	Rows      [][]any  `json:"rows"`
}

// flightEventsTool 返回错误/事件/模式切换记录（时刻 + 文案），诊断时
// 的高价值线索。
func flightEventsTool(deps Deps) (tool.InvokableTool, error) {
	return infer("get_records",
		"获取飞行过程记录：kind=errors（错误）、events（事件，如解锁/上锁）、"+
			"modes（模式切换序列）。结果为行数组（cols 标列序）：t=绝对时刻"+
			"（HH:MM:SS，日期基准见 timeBase，跨天带 MM-DD 前缀）、tSec=相对秒、"+
			"text=文案；汇总时间线时以绝对时刻为准。",
		func(ctx context.Context, in flightEventsInput) (flightEventsOutput, error) {
			out := flightEventsOutput{Kind: strings.ToLower(strings.TrimSpace(in.Kind)), TimeBase: deps.Abs.Start(), Cols: recordCols}
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
					sec := relSec(deps.OriginMs, e.TimeMs)
					out.Rows = append(out.Rows, []any{deps.Abs.AtShort(sec), sec, desc})
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
					sec := relSec(deps.OriginMs, ev.TimeMs)
					out.Rows = append(out.Rows, []any{deps.Abs.AtShort(sec), sec, name})
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
					sec := relSec(deps.OriginMs, m.TimeMs)
					out.Rows = append(out.Rows, []any{deps.Abs.AtShort(sec), sec, text})
				}
			default:
				return out, errBadKind
			}
			out.Count = len(out.Rows)
			if len(out.Rows) > maxRecordEntries {
				out.Rows = out.Rows[:maxRecordEntries]
				out.Truncated = true
			}
			return out, nil
		})
}

type parametersInput struct {
	NamePrefix string `json:"name_prefix,omitempty" jsonschema_description:"参数名前缀过滤（区分大小写），缺省返回全部"`
}

// paramCols：name/value 必有；知识库覆盖时附 desc/unit/min/max（参考范围）/
// def（官方默认值）/values（枚举）/long（长述，条目多时省略）。分组可由
// 名字前缀（下划线前首段）推导，不单独占列。
var paramCols = []string{"name", "value", "desc", "unit", "min", "max", "def", "values", "long"}

// paramMatch 是一条命中参数：名称、当前值与可选的知识库元信息。
type paramMatch struct {
	name  string
	value float64
	pm    *knowledge.ParamMeta
}

type parametersOutput struct {
	Count     int      `json:"count"` // 命中总数（rows 可能被截断）
	Truncated bool     `json:"truncated,omitempty"`
	Cols      []string `json:"cols"`
	Rows      [][]any  `json:"rows"`
}

// parametersTool 返回飞控参数（可前缀过滤），并融合参数知识库：含义/单位/
// 范围/默认值/枚举。当前值 vs 默认值 是排查配置问题的关键线索。
func parametersTool(deps Deps) (tool.InvokableTool, error) {
	return infer("get_params",
		"获取参数表（名称→值），可用 name_prefix 前缀过滤（如 ATC_、MOT_、EK3_）。"+
			"结果为行数组（cols 标列序，行尾空列省略）：name/value 必有；知识库覆盖时附"+
			" desc/unit/min/max（参考范围）/def（官方默认值，≠当前值说明被改过）。"+
			"建议先用参数分组工具浏览，再按前缀取值。",
		func(ctx context.Context, in parametersInput) (parametersOutput, error) {
			params, err := deps.Log.Parameters(ctx)
			if err != nil {
				return parametersOutput{}, err
			}
			prefix := in.NamePrefix
			kb := knowledge.ForParams(deps.Format)
			matched := make([]paramMatch, 0, len(params))
			for _, p := range params {
				if prefix != "" && !strings.HasPrefix(p.Name, prefix) {
					continue
				}
				entry := paramMatch{name: p.Name, value: p.Value}
				if pm, ok := kb.Lookup(p.Name); ok && knowledge.Applies(pm.AppliesTo, deps.Class) {
					entry.pm = &pm
				}
				matched = append(matched, entry)
			}
			// 精简：条目多时省略 long 长述（token 大头），提示分批取。
			includeLong := len(matched) <= 40
			out := parametersOutput{Cols: paramCols, Rows: make([][]any, 0, len(matched))}
			for _, m := range matched {
				row := []any{m.name, m.value}
				if m.pm != nil {
					row = append(row, m.pm.Description, m.pm.Unit,
						ptrVal(m.pm.RangeMin), ptrVal(m.pm.RangeMax), ptrVal(m.pm.Default),
						strsOrNil(m.pm.Values), strOrNil(m.pm.Long))
					if !includeLong {
						row[len(row)-1] = nil
					}
				}
				out.Rows = append(out.Rows, trimRow(row))
			}
			out.Count = len(out.Rows)
			// 截断：条目多时去掉尾部，提示用更精确的前缀分批取。
			if len(out.Rows) > maxParamEntries {
				out.Rows = out.Rows[:maxParamEntries]
				out.Truncated = true
			}
			return out, nil
		})
}

type paramGroupsInput struct{}

var paramGroupCols = []string{"prefix", "count", "desc", "affects"}

type paramGroupsOutput struct {
	Cols []string `json:"cols"`
	Rows [][]any  `json:"rows"`
}

// paramGroupsTool 按前缀分组浏览参数域（ATC/MOT/EK3…），避免全量拉参数
// 浪费上下文；组带作用与影响说明。
func paramGroupsTool(deps Deps) (tool.InvokableTool, error) {
	return infer("list_param_groups",
		"按前缀分组列出当前日志的参数域（如 ATC_=姿态控制、MOT_=动力、EK3_=估计器），"+
			"行数组（cols 标列序）：前缀、参数个数（按机型过滤后）与该组作用/影响说明。"+
			"先浏览分组，再用前缀过滤取参数值。",
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
			out := paramGroupsOutput{Cols: paramGroupCols, Rows: make([][]any, 0, len(counts))}
			prefixes := make([]string, 0, len(counts))
			for prefix := range counts {
				prefixes = append(prefixes, prefix)
			}
			sort.Strings(prefixes)
			for _, prefix := range prefixes {
				desc, affects := "", any(nil)
				if gm, ok := kb.ParamGroupMeta(prefix); ok {
					desc = gm.Description
					affects = strsOrNil(gm.Affects)
				}
				out.Rows = append(out.Rows, trimRow([]any{prefix, counts[prefix], desc, affects}))
			}
			return out, nil
		})
}

var errBadKind = &badKindError{}

type badKindError struct{}

func (*badKindError) Error() string {
	return "kind 必须是 errors / events / modes 之一"
}
