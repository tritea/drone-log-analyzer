package configservice

import (
	"context"
	"errors"
)

var (
	ErrFieldEntryNameInvalid = errors.New("field entry name invalid")
	ErrFieldEntryNotFound    = errors.New("field entry not found")

	ErrCustomModelNameInvalid = errors.New("custom model name invalid")
	ErrCustomModelNotFound    = errors.New("custom model not found")

	ErrModelGroupNameInvalid = errors.New("model group name invalid")
	ErrModelGroupNotFound    = errors.New("model group not found")

	ErrTilesetNameInvalid = errors.New("tileset name invalid")
	ErrTilesetNotFound    = errors.New("tileset not found")
)

type Service interface {
	GetSettings(ctx context.Context) (*SettingsResponse, error)
	SaveSettings(ctx context.Context, settings map[string]any) error

	SetCurrentFormat(ctx context.Context, format string) error

	GetFlightMetrics(ctx context.Context) (*FlightMetricsResponse, error)
	SaveFlightMetrics(ctx context.Context, metrics map[string]any) error

	GetCurveState(ctx context.Context) (*CurveStateResponse, error)
	SaveCurveState(ctx context.Context, req CurveStateRequest) error

	ListFieldEntries(ctx context.Context) (*FieldEntriesResponse, error)
	SaveFieldEntry(ctx context.Context, req FieldEntry) (*FieldEntriesResponse, error)
	DeleteFieldEntry(ctx context.Context, req DeleteFieldEntryRequest) (*FieldEntriesResponse, error)

	ListCustomModels(ctx context.Context) (*CustomModelsResponse, error)
	SaveCustomModel(ctx context.Context, req CustomModel) (*CustomModelsResponse, error)
	DeleteCustomModel(ctx context.Context, req DeleteCustomModelRequest) (*CustomModelsResponse, error)

	ListModelGroups(ctx context.Context) (*ModelGroupsResponse, error)
	SaveModelGroup(ctx context.Context, req ModelGroup) (*ModelGroupsResponse, error)
	DeleteModelGroup(ctx context.Context, req DeleteModelGroupRequest) (*ModelGroupsResponse, error)

	ListTilesets(ctx context.Context) (*TilesetsResponse, error)
	SaveTileset(ctx context.Context, req Tileset) (*TilesetsResponse, error)
	DeleteTileset(ctx context.Context, req DeleteTilesetRequest) (*TilesetsResponse, error)

	// ResolveTilesetDir maps a tileset name to its on-disk root directory for
	// serving over HTTP. Returns ok=false when the name is unknown or the
	// tileset is remote-only (no Dir).
	ResolveTilesetDir(ctx context.Context, name string) (string, bool)
}
