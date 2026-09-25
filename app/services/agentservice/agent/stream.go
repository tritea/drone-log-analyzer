package agent

import (
	"encoding/json"
	"io"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/schema"

	"drone-log-analyzer/app/services/agentservice"
)

// run 收集一轮 Chat 的事件流：把 eino AgentEvent 翻译成 agentservice.
// AgentEvent（经 sink 推送前端）并收集完整消息序列（回填会话历史）。
type run struct {
	sink agentservice.EventSink

	msgs []*schema.Message // 本轮收集的 user/assistant/tool 交错序列

	// callUsage 是当前模型调用内最近一次上报的 token 用量（流式通常在
	// 最后一个 chunk），调用收口（assistant）时并入 sums 并清空。
	callUsage *schema.TokenUsage

	// sums 是本轮全部模型调用的累计用量：ReAct 每次迭代都是一次独立调用
	// 且重发全上下文，服务商按次计费，须累加而非只记最后一次。
	sumPrompt     int
	sumCompletion int
	sumTotal      int

	// pending 记录每个 ToolCallID 的开始时刻，工具结果到达时计算耗时。
	pending map[string]time.Time
}

func newRun(sink agentservice.EventSink) *run {
	return &run{sink: sink, pending: map[string]time.Time{}}
}

func (r *run) emit(ev agentservice.AgentEvent) {
	if r.sink != nil {
		r.sink(ev)
	}
}

// handle 处理一条消息变体（流式或完整）。
func (r *run) handle(mv *adk.MessageVariant) error {
	if mv == nil {
		return nil
	}
	if mv.IsStreaming && mv.MessageStream != nil {
		return r.consumeStream(mv.MessageStream)
	}
	if mv.Message == nil {
		return nil
	}
	switch mv.Role {
	case schema.Assistant:
		r.assistant(mv.Message)
	case schema.Tool:
		r.toolResult(mv.Message)
	}
	return nil
}

// assistant 处理一条完整助手消息：带 ToolCalls 的先发 tool_start；
// 纯文本的作为一段增量发出（非流式模型也走这里）。推理模型的思考内容
// （ReasoningContent）单独走 reasoning 事件，前端灰显折叠。
func (r *run) assistant(msg *schema.Message) {
	for _, tc := range msg.ToolCalls {
		r.pending[tc.ID] = time.Now()
		r.emit(agentservice.AgentEvent{
			Type: "tool_start",
			Tool: tc.Function.Name,
			Args: parseArgs(tc.Function.Arguments),
		})
	}
	r.msgs = append(r.msgs, msg)
	if msg.ResponseMeta != nil && msg.ResponseMeta.Usage != nil {
		r.callUsage = msg.ResponseMeta.Usage
	}
	r.commitUsage()
	if len(msg.ToolCalls) == 0 {
		if msg.ReasoningContent != "" {
			r.emit(agentservice.AgentEvent{Type: "reasoning", Text: msg.ReasoningContent})
		}
		if msg.Content != "" {
			r.emit(agentservice.AgentEvent{Type: "delta", Text: msg.Content})
		}
	}
}

// toolResult 处理工具结果消息：计算耗时、发 tool_end、收集进序列。
func (r *run) toolResult(msg *schema.Message) {
	start, ok := r.pending[msg.ToolCallID]
	delete(r.pending, msg.ToolCallID)
	var dur int64
	if ok {
		dur = time.Since(start).Milliseconds()
	}
	r.emit(agentservice.AgentEvent{
		Type:       "tool_end",
		Tool:       msg.ToolName,
		Summary:    summarizeToolContent(msg.Content),
		DurationMs: dur,
	})
	r.msgs = append(r.msgs, msg)
}

// consumeStream 消费流式助手输出：逐帧发 delta，合并成完整消息后按
// assistant 处理（tool call 参数在流式里分片到达，交给 ConcatMessages 合并）。
func (r *run) consumeStream(sr *schema.StreamReader[*schema.Message]) error {
	defer sr.Close()
	var frames []*schema.Message
	for {
		f, err := sr.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			r.commitUsage() // 收口中断的调用，避免已上报的用量丢失
			return err
		}
		if f.ReasoningContent != "" {
			r.emit(agentservice.AgentEvent{Type: "reasoning", Text: f.ReasoningContent})
		}
		if f.Content != "" {
			r.emit(agentservice.AgentEvent{Type: "delta", Text: f.Content})
		}
		if f.ResponseMeta != nil && f.ResponseMeta.Usage != nil {
			r.callUsage = f.ResponseMeta.Usage
		}
		frames = append(frames, f)
	}
	if len(frames) == 0 {
		return nil
	}
	final, err := schema.ConcatMessages(frames)
	if err != nil {
		return err
	}
	r.assistant(final)
	return nil
}

// commitUsage 把当前调用的用量并入轮累计。assistant 是每次模型调用的
// 收口点（流式合并后 / 非流式各调一次），在此提交恰好每调用计一次。
func (r *run) commitUsage() {
	if r.callUsage == nil {
		return
	}
	r.sumPrompt += r.callUsage.PromptTokens
	r.sumCompletion += r.callUsage.CompletionTokens
	// TotalTokens 缺失（0）时按 prompt+completion 归一，保证 Σ 口径一致。
	total := r.callUsage.TotalTokens
	if total == 0 {
		total = r.callUsage.PromptTokens + r.callUsage.CompletionTokens
	}
	r.sumTotal += total
	r.callUsage = nil
}

// addUsage 把另一 run（incidentPatch 的补块调用）的累计并入本 run。
func (r *run) addUsage(o *run) {
	if o == nil {
		return
	}
	r.sumPrompt += o.sumPrompt
	r.sumCompletion += o.sumCompletion
	r.sumTotal += o.sumTotal
}

// finalAnswer 返回最后一条纯文本助手消息（没有则空串）。
func (r *run) finalAnswer() string {
	for i := len(r.msgs) - 1; i >= 0; i-- {
		m := r.msgs[i]
		if m.Role == schema.Assistant && len(m.ToolCalls) == 0 && m.Content != "" {
			return m.Content
		}
	}
	return ""
}

// trace 返回本轮工具调用轨迹（给最终消息附带）。
func (r *run) trace() []agentservice.ToolCallTrace {
	var out []agentservice.ToolCallTrace
	for _, m := range r.msgs {
		if m.Role != schema.Tool {
			continue
		}
		out = append(out, agentservice.ToolCallTrace{
			Tool:    m.ToolName,
			Summary: summarizeToolContent(m.Content),
		})
	}
	return out
}

func parseArgs(arguments string) map[string]any {
	m := map[string]any{}
	if arguments == "" {
		return m
	}
	_ = json.Unmarshal([]byte(arguments), &m)
	return m
}
