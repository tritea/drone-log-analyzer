package fieldstats

import "math"

// BasicStats 是窗口基础统计：最值（含命中时刻）、均值、峰峰值、RMS。
// 无有效样本时 Ok=false，数值字段无意义。
type BasicStats struct {
	Ok     bool    `json:"ok"`
	Count  int     `json:"count"`
	Min    float64 `json:"min"`
	MinAt  float64 `json:"minAt"`
	Max    float64 `json:"max"`
	MaxAt  float64 `json:"maxAt"`
	Avg    float64 `json:"avg"`
	P2P    float64 `json:"p2p"`
	Rms    float64 `json:"rms"` // 均方根：振动/纹波类震荡信号的标准强度度量
	HasAvg bool    `json:"hasAvg"`
}

// Stats 计算窗口基础统计。非有限值样本被跳过。
func Stats(s Series) BasicStats {
	var st BasicStats
	first := true
	var sum, sumSq float64
	var cnt int
	for i := 0; i < s.Len(); i++ {
		v := s.Values[i]
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		t := s.Times[i]
		if first || v < st.Min {
			st.Min, st.MinAt = v, t
		}
		if first || v > st.Max {
			st.Max, st.MaxAt = v, t
		}
		first = false
		sum += v
		sumSq += v * v
		cnt++
	}
	if first {
		return st
	}
	st.Ok = true
	st.Count = cnt
	st.Avg = sum / float64(cnt)
	st.HasAvg = true
	st.P2P = st.Max - st.Min
	st.Rms = math.Sqrt(sumSq / float64(cnt))
	return st
}

// Min 返回窗口最小值与命中时刻（无有效样本时 ok=false）。
func Min(s Series) (value, at float64, ok bool) {
	st := Stats(s)
	return st.Min, st.MinAt, st.Ok
}

// Max 返回窗口最大值与命中时刻（无有效样本时 ok=false）。
func Max(s Series) (value, at float64, ok bool) {
	st := Stats(s)
	return st.Max, st.MaxAt, st.Ok
}

// Avg 返回窗口均值（无有效样本时 ok=false）。
func Avg(s Series) (value float64, ok bool) {
	st := Stats(s)
	return st.Avg, st.Ok
}

// P2P 返回峰峰值 max-min（无有效样本时 ok=false）。
func P2P(s Series) (value float64, ok bool) {
	st := Stats(s)
	return st.P2P, st.Ok
}
