package agent

import (
	"testing"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/schema"
)

// msgWithUsage 造一条带 usage 的完整助手消息（total<=0 表示服务商未上报 TotalTokens）。
func msgWithUsage(prompt, completion, total int) *schema.Message {
	return &schema.Message{
		Role:         schema.Assistant,
		Content:      "ok",
		ResponseMeta: &schema.ResponseMeta{Usage: &schema.TokenUsage{PromptTokens: prompt, CompletionTokens: completion, TotalTokens: total}},
	}
}

// streamOf 把若干帧包装成 StreamReader（模拟流式输出，usage 通常只在最后一帧）。
func streamOf(frames ...*schema.Message) *schema.StreamReader[*schema.Message] {
	sr, sw := schema.Pipe[*schema.Message](len(frames))
	for _, f := range frames {
		_ = sw.Send(f, nil)
	}
	sw.Close()
	return sr
}

// 一轮内多次模型调用（流式 + 非流式）的 usage 应逐次累加，而非只记最后一次。
func TestRunUsageAccumulatesPerCall(t *testing.T) {
	r := newRun(nil)
	err := r.handle(&adk.MessageVariant{
		IsStreaming: true,
		MessageStream: streamOf(
			&schema.Message{Role: schema.Assistant, Content: "分析"},
			msgWithUsage(100_000, 5_000, 105_000),
		),
	})
	if err != nil {
		t.Fatalf("handle stream: %v", err)
	}
	err = r.handle(&adk.MessageVariant{Role: schema.Assistant, Message: msgWithUsage(120_000, 2_000, 122_000)})
	if err != nil {
		t.Fatalf("handle message: %v", err)
	}

	st := roundStats(r, time.Now().Add(-3*time.Second))
	if st.PromptTokens != 220_000 || st.CompletionTokens != 7_000 || st.TotalTokens != 227_000 {
		t.Fatalf("stats = %+v, want prompt=220000 completion=7000 total=227000", st)
	}
	if st.DurationMs < 3_000 {
		t.Fatalf("durationMs = %d, want >= 3000", st.DurationMs)
	}
}

// 补块调用的消耗并入主轮；TotalTokens 缺失按 prompt+completion 兜底；nil 安全。
func TestRoundStatsMergesPatchRun(t *testing.T) {
	r := newRun(nil)
	if err := r.handle(&adk.MessageVariant{Role: schema.Assistant, Message: msgWithUsage(50, 5, 0)}); err != nil {
		t.Fatalf("handle: %v", err)
	}
	pr := newRun(nil)
	if err := pr.handle(&adk.MessageVariant{Role: schema.Assistant, Message: msgWithUsage(30, 3, 33)}); err != nil {
		t.Fatalf("handle patch: %v", err)
	}
	r.addUsage(pr)
	r.addUsage(nil) // 不应 panic

	st := roundStats(r, time.Now())
	if st.PromptTokens != 80 || st.CompletionTokens != 8 || st.TotalTokens != 88 {
		t.Fatalf("stats = %+v, want prompt=80 completion=8 total=88", st)
	}
}
