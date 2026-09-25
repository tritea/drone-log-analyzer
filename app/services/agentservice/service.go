// Package agentservice 定义日志分析 Agent 的服务接口与 DTO；
// eino 实现在子包 agent/（装配）与 tools/（工具集）。
package agentservice

import (
	"context"
	"errors"

	appmodel "drone-log-analyzer/app/model"
)

var (
	ErrNoLogLoaded      = errors.New("no log loaded")
	ErrLlmNotConfigured = errors.New("llm not configured")
	ErrAgentBusy        = errors.New("agent busy")
)

// EventSink 接收流式事件（delta/tool_start/tool_end/final/error）。
// 传输层把它接到 Wails EventsEmit；service 不 import transport。
type EventSink func(ev AgentEvent)

// LlmConfigProvider 提供 LLM 接入配置。由 main 装配时把 configservice
// 适配进来（跨服务 DTO 用 app/model.LlmConfig，避免 service 互相 import）。
type LlmConfigProvider interface {
	LlmConfig(ctx context.Context) (*appmodel.LlmConfig, error)
}

type Service interface {
	// Chat 发起一轮对话。流式事件经构造时注入的 EventSink 推送，
	// 返回值为该轮的最终消息（含工具调用轨迹）。
	Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error)
	// Stop 取消进行中的一轮（若有）。
	Stop(ctx context.Context) error
	// History 返回会话消息（用户+助手）。
	History(ctx context.Context) (*HistoryResponse, error)
	// Clear 清空会话历史。
	Clear(ctx context.Context) error
}
