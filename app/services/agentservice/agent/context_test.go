package agent

import (
	"strings"
	"testing"

	"github.com/cloudwego/eino/schema"
)

// round 构造一轮：user 提问 + assistant 工具调用 + tool 结果 + assistant 回答。
func round(q, toolResult, answer string, callID string) []*schema.Message {
	return []*schema.Message{
		schema.UserMessage(q),
		{
			Role: schema.Assistant,
			ToolCalls: []schema.ToolCall{{
				ID: callID, Type: "function",
				Function: schema.FunctionCall{Name: "query_data", Arguments: `{"queries":[]}`},
			}},
		},
		{Role: schema.Tool, ToolCallID: callID, ToolName: "query_data", Content: toolResult},
		{Role: schema.Assistant, Content: answer},
	}
}

func TestTrimContextKeepsRecentRounds(t *testing.T) {
	var msgs []*schema.Message
	for range 5 {
		msgs = append(msgs, round("问"+strings.Repeat("x", 100),
			"结果"+strings.Repeat("y", 20000), "答"+strings.Repeat("z", 100), "c1")...)
	}
	got := trimContext(msgs)
	if len(got) == 0 || len(got) >= len(msgs) {
		t.Fatalf("expected trimmed history, got %d of %d", len(got), len(msgs))
	}
	// 保留的第一条必须是 user（轮边界对齐，ToolCalls/tool 配对完整）。
	if got[0].Role != schema.User {
		t.Fatalf("kept history should start at a user message, got %v", got[0].Role)
	}
	// 最末一条（最后一轮的回答）必须在。
	if got[len(got)-1].Content != msgs[len(msgs)-1].Content {
		t.Fatal("latest round answer should be kept verbatim")
	}
}

func TestTrimContextDropsOldRoundsOverBudget(t *testing.T) {
	big := strings.Repeat("d", historyBudgetChars) // 单轮即超预算
	var msgs []*schema.Message
	msgs = append(msgs, round("旧问题", big, "旧回答", "c1")...)
	msgs = append(msgs, round("新问题", "小结果", "新回答", "c2")...)

	got := trimContext(msgs)
	if len(got) != 4 {
		t.Fatalf("over-budget old round should be dropped entirely, got %d msgs", len(got))
	}
	if got[0].Content != "新问题" {
		t.Fatalf("should keep only the latest round, first kept = %q", got[0].Content)
	}
}

func TestTrimContextAtLeastOneRound(t *testing.T) {
	big := strings.Repeat("d", historyBudgetChars*3)
	msgs := round("唯一的问题", big, "回答", "c1")
	got := trimContext(msgs)
	if len(got) != 4 {
		t.Fatalf("latest round must always be kept, got %d msgs", len(got))
	}
}

func TestTrimContextTruncatesOldToolResults(t *testing.T) {
	long := strings.Repeat("r", keptToolChars+500)
	var msgs []*schema.Message
	msgs = append(msgs, round("上一轮", long, "上答", "c1")...)
	msgs = append(msgs, round("这一轮", "ok", "答", "c2")...)

	got := trimContext(msgs)
	// 第一轮的 tool 结果应被截断，且原消息不被修改（不可变）。
	var toolMsg *schema.Message
	for _, m := range got {
		if m.Role == schema.Tool && m.ToolCallID == "c1" {
			toolMsg = m
		}
	}
	if toolMsg == nil {
		t.Fatal("first round tool message missing")
	}
	if n := len([]rune(toolMsg.Content)); n > keptToolChars+100 {
		t.Fatalf("old tool result should be truncated, got %d runes", n)
	}
	if !strings.Contains(toolMsg.Content, "已截断") {
		t.Error("truncated tool result should carry a marker")
	}
	if len([]rune(long)) != keptToolChars+500 {
		t.Fatal("original message must not be mutated")
	}
}

func TestTrimContextEmpty(t *testing.T) {
	if got := trimContext(nil); got != nil {
		t.Fatalf("nil in nil out, got %v", got)
	}
}
