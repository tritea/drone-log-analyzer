package tools

import "testing"

// TestRankGroups 锁住分组行的过滤/排序/截断语义：无样本的类型丢弃；
// min_samples 过滤低频类型；按样本数降序（同数保序）；超上限截断且
// total 记全量。
func TestRankGroups(t *testing.T) {
	rows := [][]any{
		{"AUXF", 3, 4, ""},
		{"ATT", 12960, 7, "姿态"},
		{"ANG", 0, 7, ""}, // 无样本：剔除
		{"GPS", 12960, 20, "定位"},
		{"CMD", 42, 8, ""},
	}
	kept, total, trunc := rankGroups(rows, 0)
	if total != 4 || trunc || len(kept) != 4 {
		t.Fatalf("total=%d trunc=%v len=%d, want 4/false/4", total, trunc, len(kept))
	}
	// 样本数降序；同为 12960 的 ATT/GPS 保持原相对顺序（稳定排序）。
	if kept[0][0] != "ATT" || kept[1][0] != "GPS" || kept[2][0] != "CMD" || kept[3][0] != "AUXF" {
		t.Errorf("order = %v, want ATT,GPS,CMD,AUXF", kept)
	}

	// min_samples 过滤低频类型。
	kept, total, _ = rankGroups(rows, 100)
	if total != 2 || kept[0][0] != "ATT" || kept[1][0] != "GPS" {
		t.Errorf("min_samples=100: total=%d first=%v, want 2 with ATT/GPS", total, kept)
	}

	// 截断：超上限时 total 记全量、行数封顶。
	big := make([][]any, maxRecordEntries+5)
	for i := range big {
		big[i] = []any{"G", i + 1, 1, ""} // 样本数从 1 起（0 会被当无样本剔除）
	}
	kept, total, trunc = rankGroups(big, 0)
	if !trunc || total != maxRecordEntries+5 || len(kept) != maxRecordEntries {
		t.Errorf("trunc=%v total=%d len=%d, want true/%d/%d", trunc, total, len(kept), maxRecordEntries+5, maxRecordEntries)
	}
	if kept[0][1] != maxRecordEntries+5 { // 样本数最大者居首
		t.Errorf("first row samples = %v, want %d", kept[0][1], maxRecordEntries+5)
	}
}
