package wails

import (
	"context"

	"drone-log-analyzer/app/services/mapservice"
)

type MapAPI struct {
	Svc mapservice.Service
}

func (a *MapAPI) Available() bool {
	return a.Svc.Available(context.Background())
}

func (a *MapAPI) Providers() (*mapservice.ProvidersResponse, error) {
	return a.Svc.Providers(context.Background())
}

func (a *MapAPI) CacheStats() (*mapservice.CacheStatsResponse, error) {
	return a.Svc.CacheStats(context.Background())
}

func (a *MapAPI) ClearCache() error {
	return a.Svc.ClearCache(context.Background())
}

func (a *MapAPI) ClearCacheProvider(req mapservice.ClearCacheProviderRequest) error {
	return a.Svc.ClearCacheProvider(context.Background(), req)
}
