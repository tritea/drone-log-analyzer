package logdefs

import "testing"

func TestCommandName(t *testing.T) {
	cases := map[int]string{
		16:    "NAV_WAYPOINT",
		21:    "NAV_LAND",
		184:   "DO_VTOL_TRANSITION",
		99999: "",
	}
	for id, want := range cases {
		if got := CommandName(id); got != want {
			t.Errorf("CommandName(%d)=%q want %q", id, got, want)
		}
	}
}

func TestFrameName(t *testing.T) {
	cases := map[int]string{
		0:   "GLOBAL",
		3:   "GLOBAL_RELATIVE_ALT",
		14:  "LOCAL_FLU",
		999: "",
	}
	for id, want := range cases {
		if got := FrameName(id); got != want {
			t.Errorf("FrameName(%d)=%q want %q", id, got, want)
		}
	}
}

func TestResultName(t *testing.T) {
	cases := map[int]string{
		0:   "ACCEPTED",
		2:   "DENIED",
		4:   "FAILED",
		999: "",
	}
	for id, want := range cases {
		if got := ResultName(id); got != want {
			t.Errorf("ResultName(%d)=%q want %q", id, got, want)
		}
	}
}

func TestMAVLinkLabelTables(t *testing.T) {
	if len(CommandLabels()) == 0 {
		t.Error("CommandLabels() is empty")
	}
	if len(FrameLabels()) == 0 {
		t.Error("FrameLabels() is empty")
	}
	if len(ResultLabels()) == 0 {
		t.Error("ResultLabels() is empty")
	}
	if CommandLabels()[16] != "NAV_WAYPOINT" {
		t.Errorf("CommandLabels()[16]=%q want NAV_WAYPOINT", CommandLabels()[16])
	}
}
