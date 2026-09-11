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

	// usage 是模型最近一次上报的 token 用量（流式通常在最后一个 chunk）。
	usage *schema.TokenUsage

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
		r.usage = msg.ResponseMeta.Usage
	}
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
			return err
		}
		if f.ReasoningContent != "" {
			r.emit(agentservice.AgentEvent{Type: "reasoning", Text: f.ReasoningContent})
		}
		if f.Content != "" {
			r.emit(agentservice.AgentEvent{Type: "delta", Text: f.Content})
		}
		if f.ResponseMeta != nil && f.ResponseMeta.Usage != nil {
			r.usage = f.ResponseMeta.Usage
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
