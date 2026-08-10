package providers

import (
	"testing"
)

func TestProviderIDsUnique(t *testing.T) {
	svc, err := NewDefaultTileService(t.TempDir())
	if err != nil {
		t.Fatalf("NewDefaultTileService: %v", err)
	}
	defer svc.Close()
	seen := map[string]bool{}
	for _, p := range svc.ListProviders(nil) {
		if seen[p.ID] {
			t.Fatalf("duplicate provider id: %s", p.ID)
		}
		seen[p.ID] = true
	}
}
