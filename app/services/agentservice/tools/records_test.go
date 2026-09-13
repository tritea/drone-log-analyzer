package tools

import (
	"strings"
	"testing"

	"drone-log-analyzer/app/modules/knowledge"
)

// TestChainMatches 锁住 topic 路径的命中语义：按链序输出；日志未记录的参数
// 保留（inLog=false，供行组装时以 null 展示）；知识库元信息按机型过滤。
func TestChainMatches(t *testing.T) {
	kb := &knowledge.ParamsKB{Params: map[string]knowledge.ParamMeta{
		"EK3_SRC1_POSZ": {Description: "垂直位置源"},
		"RNGFND1_TYPE":  {Description: "测距仪类型", AppliesTo: []string{"multirotor"}},
	}}
	logValues := map[string]float64{"EK3_SRC1_POSZ": 3}
	got := chainMatches(kb, knowledge.VehicleClass("fixedwing"),
		[]string{"EK3_SRC1_POSZ", "EK3_SRC1_VELZ", "RNGFND1_TYPE"}, logValues)
	if len(got) != 3 {
		t.Fatalf("got %d matches, want 3", len(got))
	}
	// 链序保留：第一项是日志里有的源参数，带值与元信息。
	if got[0].name != "EK3_SRC1_POSZ" || !got[0].inLog || got[0].value != 3 || got[0].pm == nil {
		t.Errorf("match[0] = %+v, want inLog EK3_SRC1_POSZ with meta", got[0])
	}
	// 日志未记录：保留占位，inLog=false（value 无意义）。
	if got[1].name != "EK3_SRC1_VELZ" || got[1].inLog {
		t.Errorf("match[1] = %+v, want absent-in-log placeholder", got[1])
	}
	// 机型不匹配：不带知识库元信息。
	if got[2].name != "RNGFND1_TYPE" || got[2].pm != nil {
		t.Errorf("match[2] = %+v, want no meta for non-applies class", got[2])
	}
}

// TestParamTopicError 锁住 topic 无清单时的报错文案（列出可选项并引导
// 前缀过滤）。
func TestParamTopicError(t *testing.T) {
	msg := (&paramTopicError{topics: knowledge.ChainTopics("apm")}).Error()
	if !strings.Contains(msg, "name_prefix") {
		t.Errorf("error message %q 应包含回退提示", msg)
	}
}
