package logdefs

import "testing"

func TestErrorSubsystemName(t *testing.T) {
	cases := map[int]string{
		1:   "MAIN",
		11:  "GPS",
		30:  "INTERNAL_ERROR",
		255: "",
	}
	for id, want := range cases {
		if got := ErrorSubsystemName(id); got != want {
			t.Fatalf("ErrorSubsystemName(%d) = %q, want %q", id, got, want)
		}
	}
}

func TestErrorCodeName(t *testing.T) {
	cases := []struct {
		subsys, code int
		want         string
	}{
		{11, 2, "GPS_GLITCH"},
		{12, 1, "CRASH_CHECK_CRASH"},
		{12, 2, "CRASH_CHECK_LOSS_OF_CONTROL"},
		{22, 6, "RTL_MISSING_RNGFND"},
		{2, 4, "UNHEALTHY"}, // generic fallback
		{255, 255, ""},
	}
	for _, c := range cases {
		if got := ErrorCodeName(c.subsys, c.code); got != c.want {
			t.Fatalf("ErrorCodeName(%d, %d) = %q, want %q", c.subsys, c.code, got, c.want)
		}
	}
}

func TestErrorLabelTables(t *testing.T) {
	if len(ErrorSubsystemLabels()) == 0 {
		t.Error("ErrorSubsystemLabels() is empty")
	}
	if len(ErrorCodeLabels()) == 0 {
		t.Error("ErrorCodeLabels() is empty")
	}
	if len(GenericErrorCodeLabels()) == 0 {
		t.Error("GenericErrorCodeLabels() is empty")
	}
	if ErrorSubsystemLabels()[11] != "GPS" {
		t.Errorf("ErrorSubsystemLabels()[11]=%q want GPS", ErrorSubsystemLabels()[11])
	}
}
