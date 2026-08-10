package mapservice

import (
	"context"
	"errors"
)

var ErrMapUnavailable = errors.New("map tile service unavailable")

type Service interface {
	Available(ctx context.Context) bool

	Providers(ctx context.Context) (*ProvidersResponse, error)

	CacheStats(ctx context.Context) (*CacheStatsResponse, error)

	ClearCache(ctx context.Context) error

	ClearCacheProvider(ctx context.Context, req ClearCacheProviderRequest) error

	GetTile(ctx context.Context, req TileRequest) (*TileResponse, error)
	Close() error
}
