package fieldstats

import "math"

// Cond 是越限判定条件。Op 取 lt/le/gt/ge（同知识库阈值定义）。
type Cond struct {
	Op    string  `json:"op"`
	Value float64 `json:"value"`
}

// Match 判断 v 是否满足条件。
func (c Cond) Match(v float64) bool {
	switch c.Op {
	case "lt":
		return v < c.Value
	case "le":
		return v <= c.Value
	case "gt":
		return v > c.Value
	case "ge":
		return v >= c.Value
	}
	return false
}

// ValidOp 判断 op 是否受支持。
func (c Cond) ValidOp() bool {
	switch c.Op {
	case "lt", "le", "gt", "ge":
		return true
	}
	return false
}

// Segment 是一段连续越限区间。Worst 是区间内最恶劣值（lt 类取最小、
// gt 类取最大），Extent 是 Worst 相对阈值的越限幅度。
type Segment struct {
	Start   float64 `json:"start"`
	End     float64 `json:"end"`
	Duration float64 `json:"duration"`
	Worst   float64 `json:"worst"`
	Extent  float64 `json:"extent"`
}

// Abnormal 扫描序列，返回满足 cond 的连续区间（相邻有效样本间断即分段；
// 区间边界取首末命中样本时刻）。返回空切片表示全程无越限。
func Abnormal(s Series, cond Cond) []Segment {
	if !cond.ValidOp() {
		return nil
	}
	var segs []Segment
	inSeg := false
	var seg Segment
	for i := 0; i < s.Len(); i++ {
		v := s.Values[i]
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		hit := cond.Match(v)
		t := s.Times[i]
		switch {
		case hit && !inSeg:
			seg = Segment{Start: t, End: t, Worst: v}
			inSeg = true
		case hit:
			seg.End = t
			if worse(v, seg.Worst, cond) {
				seg.Worst = v
			}
		case !hit && inSeg:
			seg.Duration = seg.End - seg.Start
			seg.Extent = math.Abs(seg.Worst - cond.Value)
			segs = append(segs, seg)
			inSeg = false
		}
	}
	if inSeg {
		seg.Duration = seg.End - seg.Start
		seg.Extent = math.Abs(seg.Worst - cond.Value)
		segs = append(segs, seg)
	}
	return segs
}

// worse 判断 v 是否比 cur 更"接近危险"：lt 类越小越糟，gt 类越大越糟。
func worse(v, cur float64, cond Cond) bool {
	if cond.Op == "lt" || cond.Op == "le" {
		return v < cur
	}
	return v > cur
}
