package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/cloudwego/eino/schema"

	appcfg "drone-log-analyzer/app/config"
	"drone-log-analyzer/app/services/agentservice"
)

// session 是按日志文件隔离的多轮会话：保存 eino 消息序列（user/assistant/
// tool 完整交错，供下一轮作为上下文）与 DTO 投影，并在每轮结束后落盘
// （%用户配置目录%/agent_session_<key>.json），重开应用后可恢复——避免
// 用户误关应用丢掉已花费的对话。
type session struct {
	mu   sync.Mutex
	msgs []*schema.Message
	path string // 落盘路径；空表示不持久化
}

func newSession(path string) *session { return &session{path: path} }

// loadSession 从磁盘恢复会话；文件不存在或损坏时返回空会话（不报错，
// 聊天历史丢失可容忍，不应阻塞功能）。
func loadSession(path string) *session {
	s := newSession(path)
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return s
	}
	if err := json.Unmarshal(data, &s.msgs); err != nil {
		s.msgs = nil
		return s
	}
	rehydrateStats(s.msgs)
	return s
}

// rehydrateStats 把 JSON 反序列化成 map 的 Extra["stats"] 还原为
// *RoundStats（toDTO 按具体类型断言）。
func rehydrateStats(msgs []*schema.Message) {
	for _, m := range msgs {
		if m == nil || m.Extra == nil {
			continue
		}
		raw, ok := m.Extra["stats"]
		if !ok {
			continue
		}
		if _, ok := raw.(*agentservice.RoundStats); ok {
			continue
		}
		b, err := json.Marshal(raw)
		if err != nil {
			continue
		}
		var st agentservice.RoundStats
		if json.Unmarshal(b, &st) == nil {
			m.Extra["stats"] = &st
		}
	}
}

// save 把会话写盘（每轮结束后调用；失败静默——持久化是尽力而为）。
func (s *session) save() {
	if s.path == "" || len(s.msgs) == 0 {
		return
	}
	s.mu.Lock()
	data, err := json.MarshalIndent(s.msgs, "", "  ")
	s.mu.Unlock()
	if err != nil {
		return
	}
	_ = os.WriteFile(s.path, data, 0o644)
}

// remove 删除落盘文件（清空会话时）。
func (s *session) remove() {
	if s.path != "" {
		_ = os.Remove(s.path)
	}
}

// snapshot 返回历史消息拷贝（供本轮输入拼接）。
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
			msg := agentservice.ChatMessage{
				Role: "assistant", Content: m.Content, ToolTrace: trace,
			}
			if st, ok := m.Extra["stats"].(*agentservice.RoundStats); ok {
				msg.Stats = st
			}
			out = append(out, msg)
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

// sessionKey 由日志文件名派生会话键（空文件名 → default）。
func sessionKey(fileName string) string {
	if fileName == "" {
		return "default"
	}
	return hashKey(fileName)
}

// hashKey 取文件路径的短哈希（FNV-1a，hex），避免文件名里的非法字符进入落盘文件名。
func hashKey(s string) string {
	const (
		fnvOffset uint64 = 14695981039346656037
		fnvPrime  uint64 = 1099511628211
	)
	h := fnvOffset
	for i := 0; i < len(s); i++ {
		h ^= uint64(s[i])
		h *= fnvPrime
	}
	return fmt.Sprintf("%016x", h)
}

// sessionPath 返回会话落盘路径（用户配置目录下）。
func sessionPath(key string) string {
	return appcfg.ConfigPath("agent_session_" + key + ".json")
}
