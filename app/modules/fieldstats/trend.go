package fieldstats

import "math"

// TrendStats 是趋势统计：最小二乘回归斜率（单位/秒）与方向判定。
// Direction 判定：|slope| * 时长（回归总变化）< 值域的 50% 视为 flat——
// 噪声序列的 LSQ 斜率非零但无净趋势，50% 容忍度避免把抖动判为趋势。
type TrendStats struct {
	Ok        bool    `json:"ok"`
	Slope     float64 `json:"slope"`
	Direction string  `json:"direction"` // rising / falling / flat
	First     float64 `json:"first"`
	Last      float64 `json:"last"`
	Change    float64 `json:"change"` // last - first
	Duration  float64 `json:"duration"`
}

// Trend 计算趋势。跳过非有限值；有效样本 <2 时仅给出首末值。
func Trend(s Series) TrendStats {
	var tr TrendStats
	var n int
	var firstT float64
	var sumT, sumV, sumTT, sumTV float64
	for i := 0; i < s.Len(); i++ {
		v, t := s.Values[i], s.Times[i]
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		if n == 0 {
			tr.First = v
			firstT = t
		}
		tr.Last = v
		tr.Duration = t - firstT
		n++
		sumT += t
		sumV += v
		sumTT += t * t
		sumTV += t * v
	}
	if n == 0 {
		return tr
	}
	tr.Ok = true
	tr.Change = tr.Last - tr.First
	if n >= 2 {
		den := float64(n)*sumTT - sumT*sumT
		if den != 0 {
			tr.Slope = (float64(n)*sumTV - sumT*sumV) / den
		}
	}
	st := Stats(s)
	totalChange := math.Abs(tr.Slope) * tr.Duration
	if !st.Ok || totalChange < 0.5*st.P2P {
		tr.Direction = "flat"
	} else if tr.Slope > 0 {
		tr.Direction = "rising"
	} else {
		tr.Direction = "falling"
	}
	return tr
}
