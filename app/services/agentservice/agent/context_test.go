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

// TestStripIncidentFence 锁住历史机读块剥离：正文时间线保留、incident 长
// JSON 压成占位（模型重读纯浪费），原消息不被修改（会话落盘仍完整）。
func TestStripIncidentFence(t *testing.T) {
	src := "结论文字A\n\n```incident\n[{\"startSec\":1},{\"startSec\":2},{\"startSec\":3}]\n```\n\n结尾文字"
	m := &schema.Message{Role: schema.Assistant, Content: src}

	got := stripIncidentFence(m)
	if got == m {
		t.Fatal("应返回新副本")
	}
	if strings.Contains(got.Content, "startSec") {
		t.Errorf("机读块应被剥离: %q", got.Content)
	}
	if !strings.Contains(got.Content, "结论文字A") || !strings.Contains(got.Content, "结尾文字") {
		t.Errorf("正文不应受影响: %q", got.Content)
	}
	if strings.Contains(m.Content, "已省略") || !strings.Contains(m.Content, "startSec") {
		t.Error("原消息不得被修改（落盘需完整）")
	}

	// 无围栏的助手消息与工具消息原样返回。
	plain := &schema.Message{Role: schema.Assistant, Content: "普通回答"}
	if stripIncidentFence(plain) != plain {
		t.Error("无围栏消息应原样返回")
	}
}

// TestRepairTail 锁住中断轮的尾部修复：tool_calls 与结果必须成对保留，
// 孤儿配对会让下一轮请求被 API 拒绝；完整序列原样返回。
func TestRepairTail(t *testing.T) {
	tc := func(id string) []schema.ToolCall {
		return []schema.ToolCall{{ID: id, Type: "function", Function: schema.FunctionCall{Name: "query_data"}}}
	}
	toolMsg := func(id string) *schema.Message {
		return &schema.Message{Role: schema.Tool, ToolCallID: id, ToolName: "query_data", Content: "{}"}
	}
	cases := []struct {
		name string
		in   []*schema.Message
		want int // 期望保留的消息数
	}{
		{"完整序列原样", []*schema.Message{
			{Role: schema.Assistant, ToolCalls: tc("c1")}, toolMsg("c1"),
			{Role: schema.Assistant, Content: "结论"},
		}, 3},
		{"尾部孤儿tool_calls截掉", []*schema.Message{
			{Role: schema.Assistant, ToolCalls: tc("c1")}, toolMsg("c1"),
			{Role: schema.Assistant, ToolCalls: tc("c2")},
		}, 2},
		{"结果只到一半截到上一对", []*schema.Message{
			{Role: schema.Assistant, ToolCalls: tc("c1")}, toolMsg("c1"),
			{Role: schema.Assistant, ToolCalls: append(tc("c2"), tc("c3")...)}, toolMsg("c2"),
		}, 2},
		{"只有孤儿返回空", []*schema.Message{
			{Role: schema.Assistant, ToolCalls: tc("c1")},
		}, 0},
		{"多段截到中断点", []*schema.Message{
			{Role: schema.Assistant, ToolCalls: tc("c1")}, toolMsg("c1"),
			{Role: schema.Assistant, Content: "中间结论"},
			{Role: schema.Assistant, ToolCalls: tc("c2")},
		}, 3},
	}
	for _, c := range cases {
		got := repairTail(c.in)
		if len(got) != c.want {
			t.Errorf("%s: kept %d msgs, want %d", c.name, len(got), c.want)
		}
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
