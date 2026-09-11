package agent

import (
	"sync"

	"github.com/cloudwego/eino/schema"

	"drone-log-analyzer/app/services/agentservice"
)

// session 是单窗口应用的多轮会话：保存 eino 消息序列（user/assistant/tool
// 完整交错，供下一轮作为上下文）与 DTO 投影。重启即清，不持久化。
type session struct {
	mu      sync.Mutex
	msgs    []*schema.Message
}

func newSession() *session { return &session{} }

// snapshot 返回历史消息拷贝（含锁内复制，供本轮输入拼接）。
func (s *session) snapshot() []*schema.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*schema.Message, len(s.msgs))
	copy(out, s.msgs)
	return out
}

// extend 追加一轮的完整消息序列（user + assistant/tool 交错）。
func (s *session) extend(msgs []*schema.Message) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.msgs = append(s.msgs, msgs...)
}

func (s *session) reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.msgs = nil
}

// toDTO 把 eino 消息序列投影为前端消息列表：user 一条一条；assistant 的
// 最终文本（无 ToolCalls 的那条）作为一条助手消息，其前的工具调用序列
// 作为它的 toolTrace。
func (s *session) toDTO() []agentservice.ChatMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]agentservice.ChatMessage, 0, len(s.msgs))
	var trace []agentservice.ToolCallTrace
	for _, m := range s.msgs {
		switch m.Role {
		case schema.User:
			trace = nil
			out = append(out, agentservice.ChatMessage{Role: "user", Content: m.Content})
		case schema.Assistant:
			if len(m.ToolCalls) > 0 {
				continue // 工具调用轮，等结果回填 trace
			}
			if m.Content == "" {
				continue
			}
			out = append(out, agentservice.ChatMessage{
				Role: "assistant", Content: m.Content, ToolTrace: trace,
			})
			trace = nil
		case schema.Tool:
			trace = append(trace, agentservice.ToolCallTrace{
				Tool:    m.ToolName,
				Summary: summarizeToolContent(m.Content),
			})
		}
	}
	return out
}

// summarizeToolContent 取工具结果的前 120 个字符作为折叠条摘要。
func summarizeToolContent(content string) string {
	const max = 120
	runes := []rune(content)
	if len(runes) <= max {
		return content
	}
	return string(runes[:max]) + "…"
}
