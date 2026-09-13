// compact.go — 轮内压缩：ReAct 每次迭代都重发全上下文，模型已前进后，
// 早期批次的工具结果是纯传输成本。BeforeModelRewriteState 钩子在每次
// 模型调用前把"旧批次"（最后一批 tool 调用之前）的工具结果压成保结构
// 摘录：工具输出是紧凑 JSON，只裁超长数组（pts/rows 等批量数据，保留
// 头部并加省略标记），全部标量与元数据（统计/阈值/名称——最终报告引用
// 的正是这些）原样保留；非 JSON 文本按字符预算截头。
//
// 变换只作用于发往模型的请求视图：会话落盘、下一轮输入与工具轨迹均
// 保留完整原文（跨轮裁剪仍由 trimContext 负责）。
package agent

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/schema"
)

const (
	// dietArrayCap 旧批次 JSON 数组保留的元素数：保留 cap-1 项 + 1 条
	// 省略标记共 cap 项，恰好不再超限——重复压缩幂等（每次调用都从头
	// 压一遍，不会越压越少）。
	dietArrayCap = 40
	// dietMinChars 小于该字符数的工具结果不动（无收益，白加标记噪声）。
	dietMinChars = 1500
	// dietFallbackChars 裁完数组仍超长（或非 JSON）时的字符兜底上限。
	dietFallbackChars = 6000
)

// dietAgedToolMsgs 返回旧批次工具结果被压缩的消息序列。最新一批 tool
// 调用（最后一条带 ToolCalls 的 assistant 消息之后）保持原样——那是
// 模型正在处理的数据。输入不修改；消息数量与角色不变，tool_call 配对
// 完整（OpenAI 兼容接口要求 tool 消息可回溯 tool_call_id，只裁内容）。
func dietAgedToolMsgs(msgs []*schema.Message) []*schema.Message {
	freshFrom := len(msgs)
	for i := len(msgs) - 1; i >= 0; i-- {
		if m := msgs[i]; m != nil && m.Role == schema.Assistant && len(m.ToolCalls) > 0 {
			freshFrom = i + 1
			break
		}
	}
	out := make([]*schema.Message, len(msgs))
	copy(out, msgs)
	for i := 0; i < freshFrom && i < len(out); i++ {
		if m := out[i]; m != nil && m.Role == schema.Tool && len([]rune(m.Content)) >= dietMinChars {
			cp := *m
			cp.Content = dietJSONContent(m.Content)
			out[i] = &cp
		}
	}
	return out
}

// dietJSONContent 压缩一条工具结果：JSON 则只裁超长数组，否则按字符
// 截头。压不动（结果反而变大，罕见）时保留原文。重新序列化后键按字典
// 序排列——内容等价、仅字段顺序变化，对模型阅读无影响。
func dietJSONContent(s string) string {
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return truncateHead(s, dietFallbackChars)
	}
	b, err := json.Marshal(dietValue(v))
	if err != nil || len(b) >= len(s) {
		return s
	}
	if len(b) > dietFallbackChars {
		return truncateHead(string(b), dietFallbackChars)
	}
	return string(b)
}

// dietValue 递归裁剪超长数组；标量与短数组（stats 等定长载荷）原样保留。
func dietValue(v any) any {
	switch t := v.(type) {
	case map[string]any:
		for k, val := range t {
			t[k] = dietValue(val)
		}
		return t
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = dietValue(val)
		}
		if len(t) > dietArrayCap {
			kept := out[: dietArrayCap-1 : dietArrayCap-1]
			return append(kept, any(fmt.Sprintf("…另有 %d 项已省略（需细节请缩窗/加过滤重查）",
				len(t)-dietArrayCap+1)))
		}
		return out
	default:
		return v
	}
}

// truncateHead 按字符截头并标注原始长度。
func truncateHead(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) +
		fmt.Sprintf("\n…（历史工具结果已压缩，原 %d 字符；需细节请重新调用工具）", len(runes))
}

// dietMiddleware 在每次模型调用前压缩旧批次工具结果（轮内压缩开关
// 开启时装配）。嵌入 Base 提供其余钩子的默认空实现。
type dietMiddleware struct {
	*adk.BaseChatModelAgentMiddleware
}

// newDietMiddleware 构造轮内压缩钩子。
func newDietMiddleware() adk.ChatModelAgentMiddleware {
	return dietMiddleware{&adk.BaseChatModelAgentMiddleware{}}
}

// BeforeModelRewriteState 改写发往模型的消息视图（state 会被持久化为
// 后续迭代的基础，压缩幂等，重复改写无副作用）。
func (dietMiddleware) BeforeModelRewriteState(ctx context.Context,
	st *adk.ChatModelAgentState, mc *adk.ModelContext) (context.Context, *adk.ChatModelAgentState, error) {
	if st != nil {
		st.Messages = dietAgedToolMsgs(st.Messages)
	}
	return ctx, st, nil
}
