// context.go — 多轮上下文裁剪：约束发往模型的历史体积，控制 token 开支。
package agent

import (
	"fmt"

	"github.com/cloudwego/eino/schema"
)

const (
	// historyBudgetChars 是历史消息的字符预算（中文≈1字符=1token，混合
	// 内容约 3 字符=1token，60k 字符 ≈ 1.5~2 万 token）。超预算的旧轮
	// 整轮丢弃，为系统提示词与本轮工具结果留出空间。
	historyBudgetChars = 60000
	// keptToolChars 是保留轮内单条工具结果的字符上限。旧轮的原始数据
	// 详文（如 raw 序列）对后续问答价值低，却是 token 大头。
	keptToolChars = 4000
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
		out[i] = truncateToolMsg(m)
	}
	return out
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
