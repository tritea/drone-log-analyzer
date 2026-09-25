package tools

import (
	"fmt"
	"strings"
	"testing"

	"drone-log-analyzer/app/modules/knowledge"
)

// TestChainMatches 锁住 topic 路径与日志参数表交叉对比的语义：按链序输出；
// 全量表格式（dataflash/ulog）链上未含=固件无此参数，剔除记名不送；
// tlog（截获不全）保留占位（inLog=false，行组装时以 null 展示）；
// 知识库元信息按机型过滤。
func TestChainMatches(t *testing.T) {
	kb := &knowledge.ParamsKB{Params: map[string]knowledge.ParamMeta{
		"EK3_SRC1_POSZ": {Description: "垂直位置源"},
		"RNGFND1_TYPE":  {Description: "测距仪类型", AppliesTo: []string{"multirotor"}},
	}}
	logValues := map[string]float64{"EK3_SRC1_POSZ": 3, "RNGFND1_TYPE": 1}
	names := []string{"EK3_SRC1_POSZ", "EK3_SRC1_VELZ", "RNGFND1_TYPE"}

	// tlog（paramsComplete=false）：缺失项保留占位。
	got, dropped := chainMatches(kb, knowledge.VehicleClass("fixedwing"), names, logValues, false)
	if len(got) != 3 || len(dropped) != 0 {
		t.Fatalf("tlog: got %d matches / %d dropped, want 3/0", len(got), len(dropped))
	}
	if got[0].name != "EK3_SRC1_POSZ" || !got[0].inLog || got[0].value != 3 || got[0].pm == nil {
		t.Errorf("tlog match[0] = %+v, want inLog EK3_SRC1_POSZ with meta", got[0])
	}
	if got[1].name != "EK3_SRC1_VELZ" || got[1].inLog {
		t.Errorf("tlog match[1] = %+v, want absent-in-log placeholder", got[1])
	}
	// 机型不匹配：不带知识库元信息。
	if got[2].name != "RNGFND1_TYPE" || got[2].pm != nil {
		t.Errorf("tlog match[2] = %+v, want no meta for non-applies class", got[2])
	}

	// dataflash/ulog（paramsComplete=true）：缺失项剔除并记名（固件无此参数）。
	got, dropped = chainMatches(kb, knowledge.VehicleClass("fixedwing"), names, logValues, true)
	if len(got) != 2 || len(dropped) != 1 || dropped[0] != "EK3_SRC1_VELZ" {
		t.Fatalf("full table: got %d matches / dropped %v, want 2 / [EK3_SRC1_VELZ]", len(got), dropped)
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

// TestGroupScan 锁住同族扫描语义：链参数与被剔除参数的族都参与；实例号
// 与代际归同族（RNGFND2 命中 RNGFND1 的族、EK2 命中 EK3 的族）；已入
// rows 的不重复；族外参数排除；按名排序、超上限截断且 total 记全量。
func TestGroupScan(t *testing.T) {
	chain := []string{"EK3_SRC1_POSZ"}
	dropped := []string{"RNGFND1_TYPE"}
	logValues := map[string]float64{
		"EK3_SRC1_POSZ": 3, "EK3_ALT_M_NSE": 0.1, "EK2_SRC1_POSZ": 3,
		"RNGFND2_TYPE": 1, "WPNAV_SPEED": 500,
	}
	rows, total, trunc := groupScan(chain, dropped, logValues, map[string]bool{"EK3_SRC1_POSZ": true})
	if total != 3 || trunc {
		t.Fatalf("total=%d trunc=%v, want 3/false", total, trunc)
	}
	want := []string{"EK2_SRC1_POSZ", "EK3_ALT_M_NSE", "RNGFND2_TYPE"}
	for i, w := range want {
		if rows[i][0] != w {
			t.Errorf("rows[%d] = %v, want %s（排序、族归并、排除族外与已列项）", i, rows[i], w)
		}
	}
	if rows[2][1] != float64(1) {
		t.Errorf("RNGFND2_TYPE value = %v, want 1", rows[2][1])
	}

	// 截断：超上限时 total 记全量、trunc 置位（单族可超 120，上限只防失控）。
	big := map[string]float64{}
	for i := range groupScanMaxEntries + 5 {
		big[fmt.Sprintf("EK3_FAKE_%03d", i)] = float64(i)
	}
	rows, total, trunc = groupScan(chain, nil, big, nil)
	if !trunc || total != groupScanMaxEntries+5 || len(rows) != groupScanMaxEntries {
		t.Errorf("trunc=%v total=%d len=%d, want true/%d/%d",
			trunc, total, len(rows), groupScanMaxEntries+5, groupScanMaxEntries)
	}
}

// TestTopicHint 锁住回退提示语义：全部在日志中=无提示；剔除项/缺失项
// 分别计数说明，且都带暴力搜索（name_search/name_prefix）引导。
func TestTopicHint(t *testing.T) {
	all := []paramMatch{{name: "A", inLog: true, value: 1}, {name: "B", inLog: true, value: 2}}
	if h := topicHint(all, nil); h != "" {
		t.Errorf("all-in-log hint = %q, want empty", h)
	}
	h := topicHint(all, []string{"C", "D"})
	if !strings.Contains(h, "2 项") || !strings.Contains(h, "C、D") || !strings.Contains(h, "name_search") {
		t.Errorf("dropped hint %q 应含计数、名单与暴力搜索引导", h)
	}
	partial := append(all, paramMatch{name: "E"})
	h = topicHint(partial, nil)
	if !strings.Contains(h, "1/3") || !strings.Contains(h, "默认值") {
		t.Errorf("missing hint %q 应含缺失计数与默认值说明", h)
	}
}
