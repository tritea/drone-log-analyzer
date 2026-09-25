package fieldstats

import "math"

// DerivativeStats 是变化率统计（差分数据）。速率为每秒变化量（单位/秒）：
// MaxRate 为相邻样本差分的最大绝对速率；AvgRate 为窗口端点斜率
// (last-first)/(tN-t0)，反映净变化趋势。
type DerivativeStats struct {
	Ok        bool    `json:"ok"`
	MaxRate   float64 `json:"maxRate"`
	MaxRateAt float64 `json:"maxRateAt"`
	AvgRate   float64 `json:"avgRate"`
	HasAvg    bool    `json:"hasAvg"`
	Samples   int     `json:"samples"`
}

// Derivative 计算变化率。跳过非有限值与时间重复/倒退的相邻对（dt<=0）。
func Derivative(s Series) DerivativeStats {
	var d DerivativeStats
	var prevV, prevT float64
	hasPrev := false
	var firstV, firstT, lastV, lastT float64
	hasFirst := false
	for i := 0; i < s.Len(); i++ {
		v, t := s.Values[i], s.Times[i]
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		if !hasFirst {
			firstV, firstT = v, t
			hasFirst = true
		}
		lastV, lastT = v, t
		if hasPrev {
			dt := t - prevT
			if dt > 0 {
				rate := math.Abs(v-prevV) / dt
				if !d.Ok || rate > d.MaxRate {
					d.MaxRate, d.MaxRateAt = rate, t
				}
				d.Ok = true
				d.Samples++
			}
		}
		prevV, prevT, hasPrev = v, t, true
	}
	if hasFirst && lastT > firstT {
		d.AvgRate = (lastV - firstV) / (lastT - firstT)
		d.HasAvg = true
	}
	return d
}
