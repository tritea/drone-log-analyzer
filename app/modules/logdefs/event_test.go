package logdefs

import "testing"

func TestEventName(t *testing.T) {
	cases := map[int]string{
		10:  "ARMED",
		11:  "DISARMED",
		90:  "AIRSPEED_PRIMARY_CHANGED",
		166: "NOT_BOTTOMED",
		255: "",
	}
	for id, want := range cases {
		t.Run("id", func(t *testing.T) {
			if got := EventName(id); got != want {
				t.Fatalf("EventName(%d) = %q, want %q", id, got, want)
			}
		})
	}
}
