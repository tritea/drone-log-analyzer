package tools

import (
	"testing"
	"time"
)

func TestAtShort(t *testing.T) {
	base := time.Date(2024, 5, 1, 10, 0, 0, 0, time.UTC)
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

// TestRelSec 锁住时间域归一化：tlog/ulog 的记录时间戳是绝对纪元毫秒
// （≈1.79e12），不减 OriginMs 会被 AtShort 二次加基准，渲染出几十年后
// 的幻影日期（曾表现为事件 t 列 "05-16 21:xx"，实为 2083 年）。
func TestRelSec(t *testing.T) {
	const tlogStartMs = 1788912000000 // 2026-09-08 06:40:00 UTC
	cases := []struct {
		name     string
		originMs float64
		timeMs   float64
		want     float64
	}{
		{"tlog 绝对毫秒", tlogStartMs, tlogStartMs + 445216, 445.216},
		{"dataflash 启动毫秒", 4, 4 + 445220, 445.22},
		{"原点自身", tlogStartMs, tlogStartMs, 0},
	}
	for _, c := range cases {
		if got := relSec(c.originMs, c.timeMs); got != c.want {
			t.Errorf("%s: relSec = %v, want %v", c.name, got, c.want)
		}
	}

	// 端到端：tlog 域的相对秒渲染回正确当天时刻，而非跨天幻影日期。
	// 基准用 UTC 构造（渲染口径即 UTC，与界面显示一致，且不依赖机器时区）。
	base := time.Date(2026, 9, 8, 14, 40, 0, 0, time.UTC)
	abs := &AbsTime{StartUnix: base.Unix()}
	if got := abs.AtShort(relSec(float64(base.UnixMilli()), float64(base.UnixMilli())+445216)); got != "14:47:25" {
		t.Errorf("AtShort(relSec) = %q, want 14:47:25（14:40:00+445.216s）", got)
	}
}
