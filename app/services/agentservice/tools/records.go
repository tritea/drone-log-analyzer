package tools

import (
	"context"
	"fmt"
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
		"获取飞行过程记录：kind=errors（错误）/events（事件，如解锁/上锁）/"+
			"modes（模式切换序列）。行：t=绝对时刻、tSec=相对秒、text=文案；"+
			"汇总时间线以绝对时刻为准。",
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
	Topic      string `json:"topic,omitempty" jsonschema_description:"按问题域取支配参数（position/attitude/altitude/power/battery/vibration/estimator/rc；个别域无清单会报错并列出可选项），与 name_prefix 二选一"`
	NamePrefix string `json:"name_prefix,omitempty" jsonschema_description:"参数名前缀过滤（区分大小写），缺省返回全部"`
	NameSearch string `json:"name_search,omitempty" jsonschema_description:"按名字子串全局搜索（忽略大小写，如 RNGFND、BARO），可与 name_prefix 叠加——索引查不到时的暴力搜索兜底"`
}

// paramCols：name/value 必有（value=null=日志未记录该参数，通常=默认值，
// 参考 def 列）；知识库覆盖时附 desc/unit/min/max（参考范围）/def（官方
// 默认值）/values（枚举）/long（长述，条目多时省略）。分组可由名字前缀
// （下划线前首段）推导，不单独占列。
var paramCols = []string{"name", "value", "desc", "unit", "min", "max", "def", "values", "long"}

// paramMatch 是一条命中参数：名称、当前值与可选的知识库元信息。inLog=false
// 表示日志参数表未记录该参数（topic 路径保留链上缺失项，按知识库默认值参考：
// 支配配置"没改过"本身就是诊断信息；tlog 截获不全时也可能是漏记录）。
type paramMatch struct {
	name  string
	value float64
	inLog bool
	pm    *knowledge.ParamMeta
}

type parametersOutput struct {
	Count     int      `json:"count"` // 命中总数（rows 可能被截断）
	Truncated bool     `json:"truncated,omitempty"`
	Hint      string   `json:"hint,omitempty"` // topic 路径链上参数缺失时的回退提示
	Cols      []string `json:"cols"`
	Rows      [][]any  `json:"rows"`
}

// chainMatches 按排查链组装命中参数（topic 路径）：按链序输出；日志未记录
// 的也保留（inLog=false）。纯函数便于单测。
func chainMatches(kb *knowledge.ParamsKB, class knowledge.VehicleClass, names []string, logValues map[string]float64) []paramMatch {
	out := make([]paramMatch, 0, len(names))
	for _, name := range names {
		m := paramMatch{name: name}
		if v, ok := logValues[name]; ok {
			m.value, m.inLog = v, true
		}
		if pm, ok := kb.Lookup(name); ok && knowledge.Applies(pm.AppliesTo, class) {
			m.pm = &pm
		}
		out = append(out, m)
	}
	return out
}

// paramTopicError 列出该格式有支配参数清单的主题，提示回退前缀过滤。
type paramTopicError struct{ topics []string }

func (e *paramTopicError) Error() string {
	sort.Strings(e.topics)
	return "此格式该主题暂无支配参数清单（有清单的主题：" + strings.Join(e.topics, "/") +
		"）；请改用 name_prefix 前缀过滤"
}

// topicHint 在 topic 路径链上参数部分缺失时给出回退提示：个别缺失通常=
// 保持默认；大量缺失往往是固件参数体系不同（EK2/EK3、参数改名），应改用
// 前缀过滤拉原始参数自行分析——映射表是快路径，不允许它卡住探索。
func topicHint(matches []paramMatch) string {
	missing := 0
	for _, m := range matches {
		if !m.inLog {
			missing++
		}
	}
	if missing == 0 {
		return ""
	}
	return fmt.Sprintf("链上 %d/%d 项日志未记录：通常=保持默认值；若该固件参数体系不同"+
		"（参数改名/演进），改用 name_search/name_prefix 拉原始参数自行分析", missing, len(matches))
}

// parametersTool 返回飞控参数（topic 按问题域取支配参数 / 前缀过滤），
// 并融合参数知识库：含义/单位/范围/默认值/枚举。当前值 vs 默认值 是排查
// 配置问题的关键线索。
func parametersTool(deps Deps) (tool.InvokableTool, error) {
	return infer("get_params",
		"获取参数表（name→value）。优先用 topic 按问题域取支配参数（少量关键项，"+
			"配合主题工具的排查链使用；结果大量 null=固件参数体系可能不同，改用"+
			" name_search/name_prefix 拉原始参数自行分析）；name_prefix 前缀过滤"+
			"（如 EK3_）、name_search 名字子串全局搜索（如 RNGFND），可叠加。知识库"+
			"覆盖时附 desc/unit/min/max（参考范围）/def（官方默认值，≠当前值=被改过）；"+
			"value=null=日志未记录（通常=默认值，参考 def）。",
		func(ctx context.Context, in parametersInput) (parametersOutput, error) {
			params, err := deps.Log.Parameters(ctx)
			if err != nil {
				return parametersOutput{}, err
			}
			kb := knowledge.ForParams(deps.Format)
			var matched []paramMatch
			if topic := strings.ToLower(strings.TrimSpace(in.Topic)); topic != "" {
				chain, ok := knowledge.TopicChainFor(deps.Format, topic)
				if !ok {
					return parametersOutput{}, &paramTopicError{topics: knowledge.ChainTopics(deps.Format)}
				}
				logValues := make(map[string]float64, len(params))
				for _, p := range params {
					logValues[p.Name] = p.Value
				}
				matched = chainMatches(kb, deps.Class, chain.Params, logValues)
			} else {
				prefix := in.NamePrefix
				search := strings.ToLower(strings.TrimSpace(in.NameSearch))
				matched = make([]paramMatch, 0, len(params))
				for _, p := range params {
					if prefix != "" && !strings.HasPrefix(p.Name, prefix) {
						continue
					}
					if search != "" && !strings.Contains(strings.ToLower(p.Name), search) {
						continue
					}
					entry := paramMatch{name: p.Name, value: p.Value, inLog: true}
					if pm, ok := kb.Lookup(p.Name); ok && knowledge.Applies(pm.AppliesTo, deps.Class) {
						entry.pm = &pm
					}
					matched = append(matched, entry)
				}
			}
			// 精简：条目多时省略 long 长述（token 大头），提示分批取。
			includeLong := len(matched) <= 40
			out := parametersOutput{Cols: paramCols, Rows: make([][]any, 0, len(matched))}
			for _, m := range matched {
				var val any
				if m.inLog {
					val = m.value
				}
				row := []any{m.name, val}
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
			out.Hint = topicHint(matched)
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
		"按前缀列出参数域（如 ATC_=姿态控制、MOT_=动力）：前缀、参数个数（按机型"+
			"过滤后）与作用/影响说明。先浏览分组，再按前缀取值。",
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
