package fieldstats

import "math"

// Downsample 用 LTTB（Largest-Triangle-Three-Buckets）把序列降到不超过
// maxPoints 个点：中间样本均分入桶，每桶选出与「上一个入选点、下一桶
// 均值点」构成三角形面积最大的**真实样本**。保形状（折线走向与原始
// 曲线最贴合）也保离群点（尖峰造成大三角形，天然被选中），输出是
// 原始样本本身而非合成值（桶均值会稀释峰值、min/max 对会锯齿化）。
// 非有限样本先过滤；maxPoints<3 视为 3（首点+1 桶+末点）；样本数不多
// 时原样返回。供 raw 操作控制 token 体积。
func Downsample(s Series, maxPoints int) Series {
	n := s.Len()
	if maxPoints <= 0 || n <= maxPoints {
		return Series{Times: s.Times, Values: s.Values}
	}
	// 过滤非有限值（保持时间戳配对）。
	ts := make([]float64, 0, n)
	vs := make([]float64, 0, n)
	for i := 0; i < n; i++ {
		if v := s.Values[i]; !math.IsNaN(v) && !math.IsInf(v, 0) {
			ts, vs = append(ts, s.Times[i]), append(vs, v)
		}
	}
	m := len(vs)
	maxPoints = max(maxPoints, 3)
	if m <= maxPoints {
		return Series{Times: ts, Values: vs}
	}

	out := Series{
		Times:  make([]float64, 0, maxPoints),
		Values: make([]float64, 0, maxPoints),
	}
	// 首末点必选；中间 m-2 个样本均分到 maxPoints-2 个桶。
	out.Times, out.Values = append(out.Times, ts[0]), append(out.Values, vs[0])
	buckets := maxPoints - 2
	perBucket := float64(m-2) / float64(buckets)
	prevX, prevY := ts[0], vs[0]
	for b := 0; b < buckets; b++ {
		start := 1 + int(math.Round(float64(b)*perBucket))
		end := 1 + int(math.Round(float64(b+1)*perBucket))
		end = min(end, m-1)
		if start >= end {
			continue
		}
		// 下一桶均值锚点（LTTB 标准做法：与下一桶而非本桶比面积）。
		nStart := end
		nEnd := min(1+int(math.Round(float64(b+2)*perBucket)), m)
		if nEnd <= nStart {
			nEnd = nStart + 1
		}
		avgX, avgY := 0.0, 0.0
		for i := nStart; i < nEnd; i++ {
			avgX += ts[i]
			avgY += vs[i]
		}
		avgX /= float64(nEnd - nStart)
		avgY /= float64(nEnd - nStart)

		best, bestArea := start, -1.0
		for i := start; i < end; i++ {
			area := math.Abs((avgX-prevX)*(vs[i]-prevY) - (avgY-prevY)*(ts[i]-prevX))
			if area > bestArea {
				best, bestArea = i, area
			}
		}
		out.Times, out.Values = append(out.Times, ts[best]), append(out.Values, vs[best])
		prevX, prevY = ts[best], vs[best]
	}
	out.Times, out.Values = append(out.Times, ts[m-1]), append(out.Values, vs[m-1])
	return out
}
