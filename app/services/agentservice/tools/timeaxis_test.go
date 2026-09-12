package tools

import (
	"testing"
	"time"
)

func TestAtShort(t *testing.T) {
	base := time.Date(2024, 5, 1, 10, 0, 0, 0, time.Local)
	abs := &AbsTime{StartUnix: base.Unix()}

	cases := []struct {
		name string
		sec  float64
		want string
	}{
		{"起点", 0, "10:00:00"},
		{"同日", 3661, "11:01:01"},
		{"跨天边界", 14 * 3600, "05-02 00:00:00"},
		{"跨天", 14*3600 + 3661, "05-02 01:01:01"},
	}
	for _, c := range cases {
		if got := abs.AtShort(c.sec); got != c.want {
			t.Errorf("%s: AtShort(%v) = %q, want %q", c.name, c.sec, got, c.want)
		}
	}

	var nilAbs *AbsTime
	if got := nilAbs.AtShort(5); got != "" {
		t.Errorf("nil AbsTime: AtShort = %q, want empty", got)
	}
	if got := nilAbs.Start(); got != "" {
		t.Errorf("nil AbsTime: Start = %q, want empty", got)
	}
}
