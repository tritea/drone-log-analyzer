package logservice

import (
	"encoding/json"
	"math"
	"testing"
)

// TestParameterMarshalJSON 是 BAT1_A_PER_V=NaN 闪退问题的回归测试。
// PX4 会把"不适用/未校准"的参数写成 NaN/±Inf 位模式；Go 的 float64 NaN/±Inf
// 无法被 encoding/json 编码，Wails IPC 会记 FAT 导致前端进程退出。
// MarshalJSON 必须把非有限值转成字符串标签，保证 json.Marshal 不报错。
func TestParameterMarshalJSON(t *testing.T) {
	cases := []struct {
		name  string
		value float64
		want  string // 期望的 JSON value 字面量
	}{
		{"finite", 1.25, "1.25"},
		{"zero", 0, "0"},
		{"nan", math.NaN(), `"NaN"`},
		{"posInf", math.Inf(1), `"Inf"`},
		{"negInf", math.Inf(-1), `"-Inf"`},
	}
	for _, c := range cases {
		b, err := json.Marshal(Parameter{Name: c.name, Value: c.value})
		if err != nil {
			t.Errorf("%s: marshal error: %v", c.name, err)
			continue
		}
		// value 字段必须是期望字面量；NaN/Inf 被序列化为字符串标签，
		// 故无需（也无法）把字符串 unmarshal 回 float64 ——消费者是 JS 前端。
		if got := string(b); !containsValue(got, c.want) {
			t.Errorf("%s: got %s, want value=%s", c.name, got, c.want)
		}
	}
}

// containsValue 粗略检查 JSON 里包含 "value":<want> 片段。
func containsValue(js, want string) bool {
	return indexOf(js, `"value":`+want) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
