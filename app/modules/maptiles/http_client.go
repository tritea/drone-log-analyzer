package maptiles

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

// HTTP client / upstream fetch tuning constants.
const (
	// tileByteCeiling caps how many bytes we are willing to read from a single
	// upstream tile response; anything larger is treated as suspicious.
	tileByteCeiling = 1 << 20
	// redirectCap bounds the number of HTTP redirects followed per request.
	redirectCap = 5
	// tileUserAgent identifies the proxy when talking to upstream tile servers.
	tileUserAgent = "DroneLogAnalyzer/1.0 (local tile proxy)"
)

// SharedHTTPClient returns an *http.Client tuned for tile downloads: a bounded
// timeout and a sane redirect cap. Each call yields a fresh client so callers
// may keep or discard it freely.
func SharedHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= redirectCap {
				return fmt.Errorf("stopped after %d redirects", redirectCap)
			}
			return nil
		},
	}
}

// HTTPFetch downloads a single tile from upstream using client, tagging any
// error context with id for diagnosis. It enforces tileByteCeiling on the
// response body and rejects non-200 statuses and empty payloads.
func HTTPFetch(client *http.Client, url, id string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request for tile %s: %w", id, err)
	}
	req.Header.Set("User-Agent", tileUserAgent)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch tile %s: %w", id, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream %s returned %d", id, resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, tileByteCeiling))
	if err != nil {
		return nil, fmt.Errorf("read tile %s: %w", id, err)
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("empty tile from %s", id)
	}
	return data, nil
}
