package fieldstats

import "sort"

// Slice 返回 [t0, t1] 时间窗内的子序列（闭区间；t0>t1 时交换，t1<=0 表示
// 开放到序列末尾）。返回新切片，不改动原序列。要求 Times 单调不减。
func Slice(s Series, t0, t1 float64) Series {
	n := s.Len()
	if n == 0 {
		return Series{}
	}
	if t1 > 0 && t0 > t1 {
		t0, t1 = t1, t0
	}
	lo := sort.SearchFloat64s(s.Times[:n], t0)
	hi := n
	if t1 > 0 {
		hi = sort.SearchFloat64s(s.Times[:n], t1+1e-9)
	}
	if lo > hi {
		lo = hi
	}
	return Series{Times: s.Times[lo:hi], Values: s.Values[lo:hi]}
}

// Full 返回原序列（语义占位：无窗口约束时的查询窗口）。
func Full(s Series) Series { return s }
