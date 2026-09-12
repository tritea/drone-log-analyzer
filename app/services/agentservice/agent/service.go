// Package agent 是 agentservice 的 eino 实现：装配 ChatModelAgent（ReAct
// 循环）+ 日志工具集，把事件流翻译为前端可渲染的 AgentEvent。
package agent

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"

	"drone-log-analyzer/app/modules/knowledge"
	"drone-log-analyzer/app/services/agentservice"
	"drone-log-analyzer/app/services/agentservice/tools"
	"drone-log-analyzer/app/services/logservice"
)

// roundStats 汇总一轮的耗时与 token 用量（usage 缺失时仅时长）。
func roundStats(r *run, started time.Time) *agentservice.RoundStats {
	st := &agentservice.RoundStats{DurationMs: time.Since(started).Milliseconds()}
	if r.usage != nil {
		st.PromptTokens = r.usage.PromptTokens
		st.CompletionTokens = r.usage.CompletionTokens
		st.TotalTokens = r.usage.TotalTokens
	}
	return st
}

var errEmptyMessage = errors.New("empty message")

// Deps 是装配依赖。Llm 由 main 把 configservice 适配进来；Sink 由传输层
// 注入（Wails EventsEmit），可为 nil（无前端时静默）。
type Deps struct {
	Log  logservice.Service
	Llm  agentservice.LlmConfigProvider
	Sink agentservice.EventSink
}

type service struct {
	deps     Deps
	sessions map[string]*session

	mu     sync.Mutex
	busy   bool
	cancel context.CancelFunc
}

// New 构造 agentservice.Service。
func New(deps Deps) agentservice.Service {
	return &service{deps: deps, sessions: map[string]*session{}}
}

// sessionFor 返回当前日志对应的会话（按文件名隔离；首次访问时从磁盘
// 恢复，无日志时用 default 空会话）。
func (s *service) sessionFor(ctx context.Context) *session {
	fileName := ""
	if st, err := s.deps.Log.Status(ctx); err == nil {
		fileName = st.FileName
	}
	key := sessionKey(fileName)
	s.mu.Lock()
	defer s.mu.Unlock()
	if sess, ok := s.sessions[key]; ok {
		return sess
	}
	sess := loadSession(sessionPath(key))
	s.sessions[key] = sess
	return sess
}

func (s *service) Chat(ctx context.Context, req agentservice.ChatRequest) (*agentservice.ChatResponse, error) {
	msg := strings.TrimSpace(req.Message)
	if msg == "" {
		return nil, errEmptyMessage
	}
	if !s.tryBegin() {
		return nil, agentservice.ErrAgentBusy
	}
	defer s.end()

	cfg, err := s.deps.Llm.LlmConfig(ctx)
	if err != nil {
		return nil, err
	}
	if !validateLlmConfig(cfg) {
		return nil, agentservice.ErrLlmNotConfigured
	}
	st, err := s.deps.Log.Status(ctx)
	if err != nil {
		return nil, err
	}
	if !st.Loaded {
		return nil, agentservice.ErrNoLogLoaded
	}
	sum, err := s.deps.Log.Summary(ctx)
	if err != nil {
		return nil, err
	}
	class := knowledge.Class(sum.VehicleType, sum.Frame, sum.Airframe)

	var abs *tools.AbsTime
	if sum.HasUTC {
		abs = &tools.AbsTime{StartUnix: sum.StartUnixSecs}
	}
	built, err := tools.Build(tools.Deps{Log: s.deps.Log, Format: sum.Format, Class: class, Abs: abs})
	if err != nil {
		return nil, err
	}
	cm, err := buildChatModel(ctx, cfg)
	if err != nil {
		return nil, err
	}
	maxIter := cfg.MaxSteps
	if maxIter <= 0 {
		maxIter = 15
	}
	ag, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Instruction:   buildSystemPrompt(sum, class),
		Model:         cm,
		ToolsConfig:   adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: built}},
		MaxIterations: maxIter,
	})
	if err != nil {
		return nil, err
	}

	runCtx, cancel := context.WithCancel(ctx)
	s.setCancel(cancel)
	defer cancel()

	sess := s.sessionFor(ctx)
	// 历史裁剪：控制多轮上下文体积（旧轮工具结果是 token 大头）。
	input := trimContext(sess.snapshot())
	input = append(input, schema.UserMessage(msg))
	r := newRun(s.deps.Sink)

	iter := ag.Run(runCtx, &adk.AgentInput{Messages: input, EnableStreaming: true})
	started := time.Now()
	var runErr error
	for {
		ev, ok := iter.Next()
		if !ok {
			break
		}
		if ev.Err != nil {
			runErr = ev.Err
			break
		}
		if ev.Output == nil || ev.Output.MessageOutput == nil {
			continue
		}
		if err := r.handle(ev.Output.MessageOutput); err != nil {
			runErr = err
			break
		}
	}

	answer := r.finalAnswer()
	switch {
	case runErr == nil:
	case errors.Is(runErr, context.Canceled):
		if answer == "" {
			s.emitError("已停止")
			return nil, runErr
		}
		answer += "\n\n（本轮被手动停止，以上为已生成的部分）"
	default:
		s.emitError(runErr.Error())
		return nil, runErr
	}
	if answer == "" {
		answer = "（模型没有给出回答，可重试或换模型）"
	}

	final := agentservice.ChatMessage{
		Role:      "assistant",
		Content:   answer,
		ToolTrace: r.trace(),
		Stats:     roundStats(r, started),
	}
	// stats 挂进历史消息（Extra），History() 可带出。
	for i := len(r.msgs) - 1; i >= 0; i-- {
		m := r.msgs[i]
		if m.Role == schema.Assistant && len(m.ToolCalls) == 0 {
			if m.Extra == nil {
				m.Extra = map[string]any{}
			}
			m.Extra["stats"] = final.Stats
			break
		}
	}
	// 历史回填：user + 本轮完整交错序列（assistant/tool 保留 ToolCalls 供
	// 下一轮上下文）。被停止的半轮也保留已生成部分。随后落盘（重开可恢复）。
	round := make([]*schema.Message, 0, len(r.msgs)+1)
	round = append(round, schema.UserMessage(msg))
	round = append(round, r.msgs...)
	sess.extend(round)

	// 缺合法 incident 机读块时静默补一轮（模型偶尔漏输出或写成排版文本）：
	// 用无工具的轻量 agent 把已有结论转成纯 JSON，拼到回答末尾并同步历史。
	if len(answer) > 200 && !looksLikeIncidentJSON(answer) {
		if patch := s.incidentPatch(runCtx, cfg, sess); patch != "" {
			answer += "\n\n" + patch
			final.Content = answer
			for i := len(round) - 1; i >= 0; i-- {
				if m := round[i]; m.Role == schema.Assistant && len(m.ToolCalls) == 0 {
					m.Content = answer
					break
				}
			}
		}
	}
	sess.save()
	s.emitFinal(final)
	return &agentservice.ChatResponse{Message: final}, nil
}

func (s *service) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
	return nil
}

func (s *service) History(ctx context.Context) (*agentservice.HistoryResponse, error) {
	return &agentservice.HistoryResponse{Messages: s.sessionFor(ctx).toDTO()}, nil
}

func (s *service) Clear(ctx context.Context) error {
	sess := s.sessionFor(ctx)
	sess.reset()
	sess.remove()
	return nil
}

func (s *service) tryBegin() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.busy {
		return false
	}
	s.busy = true
	return true
}

func (s *service) end() {
	s.mu.Lock()
	s.busy = false
	s.cancel = nil
	s.mu.Unlock()
}

func (s *service) setCancel(cancel context.CancelFunc) {
	s.mu.Lock()
	s.cancel = cancel
	s.mu.Unlock()
}

func (s *service) emitError(text string) {
	if s.deps.Sink != nil {
		s.deps.Sink(agentservice.AgentEvent{Type: "error", Error: text})
	}
}

func (s *service) emitFinal(msg agentservice.ChatMessage) {
	if s.deps.Sink != nil {
		s.deps.Sink(agentservice.AgentEvent{Type: "final", Message: &msg})
	}
}
