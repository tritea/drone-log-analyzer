package fieldstats

import "math"

// Downsample 把序列降采样到不超过 maxPoints 个点：按时间均分为 bucket，
// 每桶输出（桶起始时刻, 桶内有效样本均值）。非有限值被跳过；maxPoints<=0
// 或样本数本来不多时原样返回。供 raw 操作控制 token 体积。
func Downsample(s Series, maxPoints int) Series {
	n := s.Len()
	if maxPoints <= 0 || n <= maxPoints {
		return Series{Times: s.Times, Values: s.Values}
	}
	tStart, tEnd := s.Times[0], s.Times[n-1]
	span := tEnd - tStart
	if span <= 0 {
		st := Stats(s)
		if st.Ok {
			return Series{
				Times:  []float64{tStart},
				Values: []float64{st.Avg},
			}
		}
		return Series{}
	}
	step := span / float64(maxPoints)
	sums := make([]float64, maxPoints)
	counts := make([]int, maxPoints)
	for i := 0; i < n; i++ {
		v := s.Values[i]
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		idx := int((s.Times[i] - tStart) / step)
		if idx >= maxPoints {
			idx = maxPoints - 1
		}
		if idx < 0 {
			idx = 0
		}
		sums[idx] += v
		counts[idx]++
	}
	out := Series{
		Times:  make([]float64, 0, maxPoints),
		Values: make([]float64, 0, maxPoints),
	}
	for idx := 0; idx < maxPoints; idx++ {
		if counts[idx] == 0 {
			continue
		}
		out.Times = append(out.Times, tStart+float64(idx)*step)
		out.Values = append(out.Values, sums[idx]/float64(counts[idx]))
	}
	return out
}
