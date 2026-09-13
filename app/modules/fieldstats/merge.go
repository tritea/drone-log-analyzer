package fieldstats

// MergeSegments 合并相邻（间隔 ≤ gapSecs）的越限段：信号在阈值附近抖动时
// Abnormal 会切出大量单采样毛刺段（实测一条振动查询切出 1600+ 段），诊断
// 语义上它们同属一场越限风暴。合并段的 Worst/Extent 取更恶劣者（Extent
// 大者更恶劣，与 lt/gt 条件无关），Duration 按首末时刻重算。输入须按时间
// 升序（Abnormal 的输出天然有序）。
func MergeSegments(segs []Segment, gapSecs float64) []Segment {
	if len(segs) == 0 {
		return nil
	}
	out := make([]Segment, 0, len(segs))
	cur := segs[0]
	for _, s := range segs[1:] {
		if s.Start-cur.End <= gapSecs {
			cur.End = s.End
			if s.Extent > cur.Extent {
				cur.Worst, cur.Extent = s.Worst, s.Extent
			}
			continue
		}
		cur.Duration = cur.End - cur.Start
		out = append(out, cur)
		cur = s
	}
	cur.Duration = cur.End - cur.Start
	return append(out, cur)
}
