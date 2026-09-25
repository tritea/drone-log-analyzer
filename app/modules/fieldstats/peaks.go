package fieldstats

import "math"

// PeakStats 是峰值（局部极大/极小）检测结果。Prominence 为判定阈值：
// 默认取窗口峰峰值的 5%（峰峰值小于 1e-12 时用 1e-12，避免恒值序列误报）。
type PeakStats struct {
	Ok        bool    `json:"ok"`
	Count     int     `json:"count"`
	MaxPeak   float64 `json:"maxPeak"`
	MaxPeakAt float64 `json:"maxPeakAt"`
	Prominence float64 `json:"prominence"`
}

// Peaks 检测局部极值（极大与极小都计入 Count）。一个"峰"定义为相对相邻
// 平台沿的突出幅度 >= prominence 的局部极值；MaxPeak 取最大峰值（极大值）。
func Peaks(s Series, prominence float64) PeakStats {
	var ps PeakStats
	st := Stats(s)
	if !st.Ok {
		return ps
	}
	ps.Ok = true
	if prominence <= 0 {
		prominence = 0.05 * st.P2P
		if prominence < 1e-12 {
			prominence = 1e-12
		}
	}
	ps.Prominence = prominence

	// 先收集有限样本的索引，再在去噪序列上找局部极值。
	idx := make([]int, 0, s.Len())
	for i := 0; i < s.Len(); i++ {
		if v := s.Values[i]; !math.IsNaN(v) && !math.IsInf(v, 0) {
			idx = append(idx, i)
		}
	}
	for k := 1; k < len(idx)-1; k++ {
		i, ip, in := idx[k], idx[k-1], idx[k+1]
		v, vp, vn := s.Values[i], s.Values[ip], s.Values[in]
		isMax := v > vp && v >= vn
		isMin := v < vp && v <= vn
		if !isMax && !isMin {
			continue
		}
		if math.Abs(v-vp) >= prominence {
			ps.Count++
			if isMax && v > ps.MaxPeak {
				ps.MaxPeak, ps.MaxPeakAt = v, s.Times[i]
			}
		}
	}
	if ps.MaxPeak == 0 && st.Max != 0 {
		// 没有判定为峰的样本时退化为窗口最大值。
		ps.MaxPeak, ps.MaxPeakAt = st.Max, st.MaxAt
	}
	return ps
}
