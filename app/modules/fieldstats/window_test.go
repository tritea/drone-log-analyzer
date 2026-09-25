package fieldstats

import (
	"math"
	"testing"
)

func TestSlice(t *testing.T) {
	s := series([]float64{0, 1, 2, 3, 4, 5}, 1) // t = 0..5
	got := Slice(s, 2, 4)
	if got.Len() != 3 {
		t.Fatalf("len = %d, want 3 (t∈[2,4])", got.Len())
	}
	if got.Values[0] != 2 || got.Values[2] != 4 {
		t.Errorf("values = %v, want [2 3 4]", got.Values)
	}
	open := Slice(s, 4, 0)
	if open.Len() != 2 || open.Values[1] != 5 {
		t.Errorf("open window len=%d values=%v, want 2 [4 5]", open.Len(), open.Values)
	}
	swapped := Slice(s, 4, 2)
	if swapped.Len() != 3 {
		t.Errorf("swapped bounds len = %d, want 3", swapped.Len())
	}
	none := Slice(s, 10, 12)
	if none.Len() != 0 {
		t.Errorf("out-of-range len = %d, want 0", none.Len())
	}
}

func TestDownsample(t *testing.T) {
	vals := make([]float64, 1000)
	for i := range vals {
		vals[i] = float64(i)
	}
	s := series(vals, 10)
	got := Downsample(s, 100)
	if got.Len() > 100 {
		t.Fatalf("len = %d, want <= 100", got.Len())
	}
	st := Stats(got)
	if !st.Ok || math.Abs(st.Max-999) > 10 {
		t.Errorf("max = %v, want ≈999", st.Max)
	}
	small := Downsample(series([]float64{1, 2, 3}, 1), 100)
	if small.Len() != 3 {
		t.Errorf("small len = %d, want 3 (passthrough)", small.Len())
	}
}

// TestDownsampleLTTBKeepsSpikeAndShape 锁住 LTTB 抽稀的形状/离群点保真：
// 单样本尖峰造成大三角形面积，天然被选中（桶均值实现会把它稀释掉）。
func TestDownsampleLTTBKeepsSpikeAndShape(t *testing.T) {
	vals := make([]float64, 200)
	for i := range vals {
		vals[i] = 10
	}
	vals[77] = 95 // 单样本尖峰
	s := series(vals, 10)
	got := Downsample(s, 20)
	if got.Len() != 20 {
		t.Fatalf("len = %d, want 20 (LTTB 输出恰为目标点数)", got.Len())
	}
	found := false
	for _, v := range got.Values {
		if v == 95 {
			found = true
		}
	}
	if !found {
		t.Fatalf("spike 95 lost: values=%v", got.Values)
	}
	// 首末点必选，时间保持单调。
	if got.Values[0] != 10 || got.Values[len(got.Values)-1] != 10 {
		t.Errorf("first/last should be endpoints (10), got %v/%v", got.Values[0], got.Values[len(got.Values)-1])
	}
	for i := 1; i < len(got.Times); i++ {
		if got.Times[i] <= got.Times[i-1] {
			t.Fatalf("times not monotonic at %d", i)
		}
	}
}

func TestAbnormal(t *testing.T) {
	// t=0..9，值 [10,10,3,3,10,10,4,10,10,10]：NSats 式低于 5 的两段。
	s := series([]float64{10, 10, 3, 3, 10, 10, 4, 10, 10, 10}, 1)
	segs := Abnormal(s, Cond{Op: "lt", Value: 5})
	if len(segs) != 2 {
		t.Fatalf("segments = %d, want 2: %+v", len(segs), segs)
	}
	if segs[0].Start != 2 || segs[0].End != 3 || segs[0].Duration != 1 {
		t.Errorf("seg0 = %+v", segs[0])
	}
	if segs[0].Worst != 3 || segs[1].Worst != 4 {
		t.Errorf("worst = %v/%v, want 3/4", segs[0].Worst, segs[1].Worst)
	}
	if segs[1].Extent != 1 {
		t.Errorf("extent = %v, want 1", segs[1].Extent)
	}

	above := Abnormal(s, Cond{Op: "gt", Value: 5})
	// 低于阈值的凹点会打断连续段：[0,1] [4,5] [7,9] 共三段。
	if len(above) != 3 || above[0].Start != 0 || above[2].End != 9 {
		t.Errorf("gt segs = %+v", above)
	}

	if got := Abnormal(s, Cond{Op: "xx", Value: 1}); got != nil {
		t.Errorf("invalid op should return nil, got %+v", got)
	}
}
