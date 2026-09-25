package tools

import (
	"context"
	"sort"
	"strings"

	"github.com/cloudwego/eino/components/tool"

	"drone-log-analyzer/app/modules/knowledge"
	"drone-log-analyzer/app/services/logservice"
)

// topicTool 把"按问题域找字段"从两层探索（list_groups → get_fields）
// 压成一次直达：常用主题映射到该格式相关的 group 集合，运行时与日志
// 实际存在的 group 取交集后合并输出二级描述。name 列即 query_data 的
// "分组.字段" 取数名。未覆盖的主题返回错误并列出可选项，模型回退
// 分组/字段工具。
func topicTool(deps Deps) (tool.InvokableTool, error) {
	return infer("get_topic_fields",
		"按主题一次拿到该域字段清单（含义/单位/阈值/实测统计，name 列可直接用于"+
			" query_data）与排查链（params=应先定位的支配参数，get_params 传同 topic"+
			"即可直取；guide=确认配置→沿链路取数→检查外部输入的步骤）。诊断优先用"+
			"它，未覆盖领域再用分组/字段工具。",
		func(ctx context.Context, in topicInput) (topicOutput, error) {
			topic := strings.ToLower(strings.TrimSpace(in.Topic))
			groups, ok := knowledge.TopicGroups(deps.Format)[topic]
			if !ok {
				return topicOutput{}, &badTopicError{topics: knowledge.TopicList(deps.Format)}
			}
			kb := knowledge.ForFormat(deps.Format)
			out := topicOutput{Topic: topic, Cols: fieldCols, Rows: make([][]any, 0, 32)}
			if chain, ok := knowledge.TopicChainFor(deps.Format, topic); ok {
				out.Params, out.Guide = chain.Params, chain.Guide
			}
			for _, g := range groups {
				fields, err := deps.Log.Fields(ctx, logservice.FieldsRequest{Type: g})
				if err != nil {
					continue // 日志里没有该 group（交集过滤）
				}
				out.Groups = append(out.Groups, g)
				for _, row := range fieldRows(deps, kb, g, fields, g+".") {
					if len(out.Rows) >= maxTopicFields {
						out.Truncated = true
						break
					}
					out.Rows = append(out.Rows, row)
				}
				if out.Truncated {
					break
				}
			}
			out.Count = len(out.Rows)
			return out, nil
		})
}

type topicInput struct {
	Topic string `json:"topic" jsonschema:"required" jsonschema_description:"position/attitude/altitude/power/battery/vibration/estimator/rc"`
}

type topicOutput struct {
	Topic     string   `json:"topic"`
	Groups    []string `json:"groups"`           // 实际命中的 group（日志里存在的）
	Params    []string `json:"params,omitempty"` // 排查链：应先定位的支配参数（先查它们再查数据）
	Guide     string   `json:"guide,omitempty"`  // 排查链步骤：确认配置 → 沿链路取数 → 检查外部输入
	Count     int      `json:"count"`            // 字段数（截断后=len(rows)）
	Truncated bool     `json:"truncated,omitempty"`
	Cols      []string `json:"cols"`
	Rows      [][]any  `json:"rows"` // 同 get_fields 列序，name 列为 分组.字段
}

// badTopicError 列出可选主题，提示模型回退分组/字段工具。
type badTopicError struct{ topics []string }

func (e *badTopicError) Error() string {
	sort.Strings(e.topics)
	return "topic 必须是 " + strings.Join(e.topics, "/") + " 之一；其他领域用 list_groups + get_fields"
}
