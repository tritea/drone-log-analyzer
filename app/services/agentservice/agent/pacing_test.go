package agent

import (
	"context"
	"strings"
	"testing"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/schema"
)

// TestPacingNote 锁住提示文案语义：进度条/最后一次的强指令/超界为空。
func TestPacingNote(t *testing.T) {
	progress := pacingNote(1, 3)
	if !strings.Contains(progress, "1/3") || !strings.Contains(progress, "剩余 2") {
		t.Errorf("progress note = %q, want 进度与剩余次数", progress)
	}
	final := pacingNote(3, 3)
	if !strings.Contains(final, "最后一次") || !strings.Contains(final, "不得再调用") {
		t.Errorf("final note = %q, want 必须作答强指令", final)
	}
	if pacingNote(4, 3) != "" {
		t.Errorf("out-of-budget note should be empty")
	}
	// max=1：仅有的那次调用就是最后一次，直接要求作答。
	if !strings.Contains(pacingNote(1, 1), "不得再调用") {
		t.Errorf("max=1 should force answer on the only call")
	}
}

// TestPacingMiddleware 锁住注入行为：只改系统消息；每次调用进度前移且
// 旧提示被剥掉（上下文始终只有一条）；其余消息不动；超界后不再注入。
func TestPacingMiddleware(t *testing.T) {
	p := newPacingMiddleware(2).(*pacingMiddleware)
	st := &adk.ChatModelAgentState{Messages: []*schema.Message{
		schema.SystemMessage("你是飞控日志分析助手。"),
		schema.UserMessage("问题"),
	}}
	ctx := context.Background()
	sysOf := func() string { return st.Messages[0].Content }

	// 第 1 次调用：进度提示。
	_, got, err := p.BeforeModelRewriteState(ctx, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	st = got
	if !strings.Contains(sysOf(), "1/2") || !strings.HasPrefix(sysOf(), "你是飞控日志分析助手。") {
		t.Errorf("call 1 system = %q, want progress note on intact instruction", sysOf())
	}
	// 第 2 次调用（最后一次）：强指令替换进度，仍只有一条。
	_, st, err = p.BeforeModelRewriteState(ctx, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	if c := strings.Count(sysOf(), pacingMark); c != 1 {
		t.Errorf("call 2 pacing marks = %d, want 1（旧的应被剥掉）", c)
	}
	if !strings.Contains(sysOf(), "2/2") || !strings.Contains(sysOf(), "不得再调用") {
		t.Errorf("call 2 system = %q, want final-answer directive", sysOf())
	}
	if st.Messages[1].Content != "问题" {
		t.Errorf("non-system message mutated")
	}
	// 第 3 次（超界，实际不会发生）：提示清空，系统提示词还原。
	_, st, err = p.BeforeModelRewriteState(ctx, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sysOf(), pacingMark) {
		t.Errorf("out-of-budget note should be stripped: %q", sysOf())
	}
	if sysOf() != "你是飞控日志分析助手。" {
		t.Errorf("instruction should round-trip cleanly, got %q", sysOf())
	}
}
