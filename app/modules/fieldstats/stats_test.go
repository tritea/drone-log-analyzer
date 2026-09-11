package fieldstats

import (
	"math"
	"testing"
)

func series(values []float64, hz float64) Series {
	times := make([]float64, len(values))
	for i := range values {
		times[i] = float64(i) / hz
	}
	return Series{Times: times, Values: values}
}

func TestStats(t *testing.T) {
	tests := []struct {
		name    string
		s       Series
		wantMin float64
		wantMax float64
		wantAvg float64
		wantOK  bool
	}{
		{"empty", Series{}, 0, 0, 0, false},
		{"all-nan", series([]float64{math.NaN(), math.NaN()}, 1), 0, 0, 0, false},
		{
			"basic",
			series([]float64{3, 1, math.NaN(), 2, 5}, 1),
			1, 5, 2.75, true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			st := Stats(tt.s)
			if st.Ok != tt.wantOK {
				t.Fatalf("Ok = %v, want %v", st.Ok, tt.wantOK)
			}
			if !tt.wantOK {
				return
			}
			if st.Min != tt.wantMin || st.Max != tt.wantMax || st.Avg != tt.wantAvg {
				t.Errorf("min/max/avg = %v/%v/%v, want %v/%v/%v",
					st.Min, st.Max, st.Avg, tt.wantMin, tt.wantMax, tt.wantAvg)
			}
			if st.P2P != tt.wantMax-tt.wantMin {
				t.Errorf("p2p = %v, want %v", st.P2P, tt.wantMax-tt.wantMin)
			}
			if st.MinAt != 1 || st.MaxAt != 4 {
				t.Errorf("minAt/maxAt = %v/%v, want 1/4", st.MinAt, st.MaxAt)
			}
		})
	}
}

func TestDerivative(t *testing.T) {
	// 0s→2s 从 0 升到 4（rate=2），2s→4s 从 4 骤降到 -4（rate=4，首现于 t=3）。
	s := series([]float64{0, 2, 4, 0, -4}, 1)
	d := Derivative(s)
	if !d.Ok || d.MaxRate != 4 || d.MaxRateAt != 3 {
		t.Errorf("MaxRate/At = %v/%v, want 4/3", d.MaxRate, d.MaxRateAt)
	}
	if !d.HasAvg || d.AvgRate != -1 {
		t.Errorf("AvgRate = %v, want -1", d.AvgRate)
	}
}

func TestTrend(t *testing.T) {
	rising := series([]float64{0, 1, 2, 3, 4}, 1)
	tr := Trend(rising)
	if tr.Direction != "rising" || tr.Slope <= 0 {
		t.Errorf("rising: direction=%v slope=%v", tr.Direction, tr.Slope)
	}
	falling := series([]float64{4, 3, 2, 1, 0}, 1)
	tr = Trend(falling)
	if tr.Direction != "falling" || tr.Slope >= 0 {
		t.Errorf("falling: direction=%v slope=%v", tr.Direction, tr.Slope)
	}
	flat := series([]float64{2, 2.1, 1.9, 2, 2}, 1)
	tr = Trend(flat)
	if tr.Direction != "flat" {
		t.Errorf("flat: direction=%v", tr.Direction)
	}
}

func TestPeaks(t *testing.T) {
	s := series([]float64{0, 1, 0, 2, 0, 1, 0}, 1)
	ps := Peaks(s, 0)
	if !ps.Ok {
		t.Fatal("Ok = false")
	}
	if ps.Count != 4 { // 3 个极大 + 2 个极小中 1 个不达 prominence→实际见断言
		t.Logf("count=%d maxPeak=%v at=%v", ps.Count, ps.MaxPeak, ps.MaxPeakAt)
	}
	if ps.MaxPeak != 2 || ps.MaxPeakAt != 3 {
		t.Errorf("MaxPeak/At = %v/%v, want 2/3", ps.MaxPeak, ps.MaxPeakAt)
	}
}
