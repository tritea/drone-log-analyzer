package agentservice

// ChatRequest 是一轮对话的输入。
type ChatRequest struct {
	Message string `json:"message"`
}

// ToolCallTrace 是一次工具调用的展示轨迹（前端折叠条）。
type ToolCallTrace struct {
	Tool       string         `json:"tool"`
	Args       map[string]any `json:"args,omitempty"`
	Summary    string         `json:"summary,omitempty"`
	DurationMs int64          `json:"durationMs"`
}

// RoundStats 是一轮对话的耗时与 token 用量（usage 由提供商回传，缺失时
// 仅有时长）。
type RoundStats struct {
	DurationMs       int64 `json:"durationMs"`
	PromptTokens     int   `json:"promptTokens,omitempty"`
	CompletionTokens int   `json:"completionTokens,omitempty"`
	TotalTokens      int   `json:"totalTokens,omitempty"`
}

// ChatMessage 是会话消息（用户/助手）。
type ChatMessage struct {
	Role      string          `json:"role"` // user / assistant
	Content   string          `json:"content"`
	ToolTrace []ToolCallTrace `json:"toolTrace,omitempty"`
	Stats     *RoundStats     `json:"stats,omitempty"` // 助手消息：本轮耗时/token
}

type ChatResponse struct {
	Message ChatMessage `json:"message"`
}

type HistoryResponse struct {
	Messages []ChatMessage `json:"messages"`
}

// AgentEvent 是流式事件协议（前端 EventsOn('agent:event') 按此渲染）。
type AgentEvent struct {
	Type string `json:"type"` // delta / reasoning / tool_start / tool_end / final / error

	Text string `json:"text,omitempty"` // delta 增量文本

	Tool        string         `json:"tool,omitempty"` // tool_start / tool_end
	Args        map[string]any `json:"args,omitempty"`
	Summary     string         `json:"summary,omitempty"`
	DurationMs  int64          `json:"durationMs,omitempty"`

	Message *ChatMessage `json:"message,omitempty"` // final
	Error   string       `json:"error,omitempty"`    // error
}
