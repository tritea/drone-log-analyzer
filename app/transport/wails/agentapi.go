package wails

import (
	"context"

	"drone-log-analyzer/app/services/agentservice"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const agentEventName = "agent:event"

// AgentAPI 暴露 Agent 服务给前端。流式事件经 Wails Events（agent:event）
// 推送，ctx 由 Startup 注入（与 HostAPI 同模式）。
type AgentAPI struct {
	ctx context.Context
	Svc agentservice.Service
}

func (a *AgentAPI) Startup(ctx context.Context) {
	a.ctx = ctx
}

// Emit 是 agentservice 的 EventSink：把流式事件转发给前端。
// Startup 前为空操作（Wails 保证 Startup 先于任何绑定方法调用）。
func (a *AgentAPI) Emit(ev agentservice.AgentEvent) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, agentEventName, ev)
}

func (a *AgentAPI) Chat(req agentservice.ChatRequest) (*agentservice.ChatResponse, error) {
	return a.Svc.Chat(context.Background(), req)
}

func (a *AgentAPI) Stop() error {
	return a.Svc.Stop(context.Background())
}

func (a *AgentAPI) History() (*agentservice.HistoryResponse, error) {
	return a.Svc.History(context.Background())
}

func (a *AgentAPI) Clear() error {
	return a.Svc.Clear(context.Background())
}
