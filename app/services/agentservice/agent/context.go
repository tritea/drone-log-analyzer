// context.go — 多轮上下文裁剪：约束发往模型的历史体积，控制 token 开支。
package agent

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/cloudwego/eino/schema"
)

const (
	// historyBudgetChars 是历史消息的字符预算（中文≈1字符=1token，混合
	// 内容约 3 字符=1token，60k 字符 ≈ 1.5~2 万 token）。超预算的旧轮
	// 整轮丢弃，为系统提示词与本轮工具结果留出空间。
	historyBudgetChars = 60000
	// keptToolChars 是保留轮内单条工具结果的字符上限。紧凑编码后一条
	// 完整响应普遍 5~8k（records 200 条 ≈ 8k、raw 300 点 ≈ 4.8k），
	// 上限须容得下单条完整结果：追问时旧数据可用优于残缺+重查。超出
	// 预算时旧轮整轮丢弃，总历史成本仍被 historyBudgetChars 封顶。
	keptToolChars = 8000
)

// trimContext 裁剪多轮历史：
//   - 一"轮" = 一条 user 消息到下一条 user 消息之前的完整序列。assistant
//     的 ToolCalls 与 tool 结果在轮内成对出现，整轮保留/丢弃不会破坏
//     调用配对（OpenAI 兼容接口要求 tool 消息必须能回溯 tool_call_id）。
//   - 从最新一轮往回整轮保留，直到超出预算；至少保留最近一轮。
//   - 保留轮内超长的 tool 结果截断到 keptToolChars，并标注原始长度。
//
// 输入消息不会被修改；截断产生新副本（不可变原则）。
func trimContext(msgs []*schema.Message) []*schema.Message {
	if len(msgs) == 0 {
		return msgs
	}
	// 轮边界：每条 user 消息开启一轮；首条消息之前的内容并入第一轮。
	starts := make([]int, 0, 8)
	starts = append(starts, 0)
	for i, m := range msgs {
		if i > 0 && m != nil && m.Role == schema.User {
			starts = append(starts, i)
		}
	}

	total := 0
	keepFrom := len(msgs) // 空保留区间
	for r := len(starts) - 1; r >= 0; r-- {
		cost := 0
		for i := starts[r]; i < len(msgs) && (r+1 == len(starts) || i < starts[r+1]); i++ {
			cost += msgCost(msgs[i])
		}
		if total+cost > historyBudgetChars && keepFrom <= len(msgs)-1 {
			break // 已有至少一轮，预算用尽
		}
		total += cost
		keepFrom = starts[r]
	}

	kept := msgs[keepFrom:]
	out := make([]*schema.Message, len(kept))
	for i, m := range kept {
		out[i] = stripIncidentFence(truncateToolMsg(m))
	}
	return out
}

// incidentFenceRe 匹配 ```incident 围栏块（非贪婪到闭合围栏）。
var incidentFenceRe = regexp.MustCompile("(?s)```incident.*?```")

// stripIncidentFence 把历史助手消息里的 incident 机读块压成一行占位：机读
// 块是给前端解析的，与正文时间线内容重复，模型在后续轮次重读这份长 JSON
// 是纯上下文浪费。输入不修改，替换产生新副本（不可变原则）。
func stripIncidentFence(m *schema.Message) *schema.Message {
	if m == nil || m.Role != schema.Assistant || !strings.Contains(m.Content, incidentFence) {
		return m
	}
	cp := *m
	cp.Content = incidentFenceRe.ReplaceAllString(cp.Content, "（历史回答的 incident 机读块已省略）")
	return &cp
}

// msgCost 估算一条消息的上下文成本（字符）：正文 + 工具调用的名字与参数。
func msgCost(m *schema.Message) int {
	if m == nil {
		return 0
	}
	c := len([]rune(m.Content))
	for _, tc := range m.ToolCalls {
		c += len(tc.Function.Name) + len([]rune(tc.Function.Arguments)) + 16
	}
	return c
}

// repairTail 修复被中断消息序列的尾部：截掉结果未到齐的 tool_calls
// 段（assistant 带 tool_calls 但部分/全部结果缺失——OpenAI 兼容接口
// 要求 tool 消息必须能回溯 tool_call_id，孤儿配对会让下一轮请求被拒）。
// 序列完整时原样返回；输入不修改，截断产生新切片（不可变原则）。
func repairTail(msgs []*schema.Message) []*schema.Message {
	pending := map[string]bool{}
	lastComplete := -1 // 最后一条完整消息的下标（截断点=它+1）
	for i, m := range msgs {
		switch m.Role {
		case schema.Assistant:
			for _, tc := range m.ToolCalls {
				pending[tc.ID] = true
			}
			if len(m.ToolCalls) == 0 && len(pending) == 0 {
				lastComplete = i
			}
		case schema.Tool:
			delete(pending, m.ToolCallID)
			if len(pending) == 0 {
				lastComplete = i
			}
		}
	}
	if len(pending) == 0 {
		return msgs
	}
	return msgs[:lastComplete+1]
}

// truncateToolMsg 截断超长的 tool 结果消息，返回新副本；其余消息原样返回。
func truncateToolMsg(m *schema.Message) *schema.Message {
	if m == nil || m.Role != schema.Tool {
		return m
	}
	runes := []rune(m.Content)
	if len(runes) <= keptToolChars {
		return m
	}
	cp := *m
	cp.Content = string(runes[:keptToolChars]) +
		fmt.Sprintf("\n…（历史工具结果已截断，原 %d 字符；如需数据请重新调用工具）", len(runes))
	return &cp
}
