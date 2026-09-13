package agent

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/cloudwego/eino/schema"
)

// mkToolMsg 构造工具结果消息。
func mkToolMsg(content string) *schema.Message {
	return &schema.Message{Role: schema.Tool, Content: content, ToolCallID: "tc1"}
}

// mkQueryJSON 构造一条类 query_data 的大结果：stats 定长载荷 + 超长 pts。
func mkQueryJSON(pts int) string {
	ptsArr := make([][2]float64, pts)
	for i := range ptsArr {
		ptsArr[i] = [2]float64{1000 + float64(i), float64(i % 7)}
	}
	b, _ := json.Marshal(map[string]any{
		"timeBase": "2026-09-08 14:37:51",
		"results": []any{map[string]any{
			"name": "CTUN.Alt", "op": "raw", "n": pts,
			"stats": []any{true, pts, -0.5, 1005.1, 9.7, 1217.4, 2.3, 10.2, 1.1, "14:54:36", "15:01:57"},
			"pts":   ptsArr,
		}},
	})
	return string(b)
}

// TestDietAgedToolMsgs 锁住轮内压缩的边界与保真：最新批次的工具结果
// 原样；旧批次裁超长数组保标量（stats/名称/样本数）；小结果不动；消息
// 数量与角色不变（tool_call 配对完整）。
func TestDietAgedToolMsgs(t *testing.T) {
	big := mkQueryJSON(300)
	msgs := []*schema.Message{
		schema.UserMessage("问题"),
		{Role: schema.Assistant, ToolCalls: []schema.ToolCall{{ID: "tc1"}}},
		mkToolMsg(big),
		mkToolMsg(`{"count":2,"rows":[["A",1],["B",2]]}`), // 小结果：不动
		{Role: schema.Assistant, ToolCalls: []schema.ToolCall{{ID: "tc2"}}},
		mkToolMsg(mkQueryJSON(300)), // 最新批次：原样
	}
	got := dietAgedToolMsgs(msgs)
	if len(got) != len(msgs) {
		t.Fatalf("message count changed: %d -> %d", len(msgs), len(got))
	}
	for i := range got {
		if got[i].Role != msgs[i].Role {
			t.Errorf("role[%d] changed", i)
		}
	}
	dieted := got[2].Content
	if len(dieted) >= len(big) {
		t.Errorf("aged big result not dieted: %d chars", len(dieted))
	}
	var v map[string]any
	if err := json.Unmarshal([]byte(dieted), &v); err != nil {
		t.Fatalf("dieted content is not JSON: %v", err)
	}
	res := v["results"].([]any)[0].(map[string]any)
	// 标量与定长载荷保留。
	if res["name"] != "CTUN.Alt" || res["op"] != "raw" {
		t.Errorf("scalars lost: %v", res["name"])
	}
	if got := len(res["stats"].([]any)); got != 11 {
		t.Errorf("stats array capped: len=%d, want 11（定长载荷不动）", got)
	}
	// pts 裁到 cap：39 项点 + 1 条省略标记。
	pts := res["pts"].([]any)
	if len(pts) != dietArrayCap {
		t.Fatalf("pts len=%d, want %d", len(pts), dietArrayCap)
	}
	if _, ok := pts[len(pts)-1].(string); !ok {
		t.Errorf("last pts element should be omission marker, got %T", pts[len(pts)-1])
	}
	// 小结果与最新批次不动。
	if got[3].Content != msgs[3].Content {
		t.Errorf("small result should stay untouched")
	}
	if got[5].Content != msgs[5].Content {
		t.Errorf("fresh batch should stay untouched")
	}
	// 原输入不被修改（请求级变换）。
	if msgs[2].Content != big {
		t.Errorf("input mutated")
	}
}

// TestDietIdempotent 锁住幂等：同一消息压两遍结果一致（每次调用都从头
// 压，不能越压越少）。
func TestDietIdempotent(t *testing.T) {
	msgs := []*schema.Message{
		{Role: schema.Assistant, ToolCalls: []schema.ToolCall{{ID: "tc1"}}},
		mkToolMsg(mkQueryJSON(300)),
		{Role: schema.Assistant, ToolCalls: []schema.ToolCall{{ID: "tc2"}}},
		mkToolMsg("{}"),
	}
	once := dietAgedToolMsgs(msgs)
	twice := dietAgedToolMsgs(once)
	if once[1].Content != twice[1].Content {
		t.Errorf("dieting is not idempotent:\n%s\n%s", once[1].Content, twice[1].Content)
	}
}

// TestDietNonJSON 非 JSON 内容按字符截头并标注。
func TestDietNonJSON(t *testing.T) {
	long := strings.Repeat("x", dietFallbackChars+500)
	msgs := []*schema.Message{
		{Role: schema.Assistant, ToolCalls: []schema.ToolCall{{ID: "tc1"}}},
		mkToolMsg(long),
		{Role: schema.Assistant, ToolCalls: []schema.ToolCall{{ID: "tc2"}}},
		mkToolMsg("{}"),
	}
	got := dietAgedToolMsgs(msgs)[1].Content
	if len(got) >= len(long) || !strings.Contains(got, "已压缩") {
		t.Errorf("non-JSON fallback failed: %d chars", len(got))
	}
}
