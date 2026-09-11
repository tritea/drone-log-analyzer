package logservice

import (
	"context"
	"errors"

	"drone-log-analyzer/app/modules/parser"
)

var (
	ErrNoLogLoaded  = errors.New("no log loaded")
	ErrTypeNotFound = errors.New("type not found")
)

type Service interface {
	Load(ctx context.Context, req LoadRequest) (*SummaryResponse, error)
	Status(ctx context.Context) (StatusResponse, error)
	Summary(ctx context.Context) (*SummaryResponse, error)
	MessageTypes(ctx context.Context) ([]TypeInfo, error)
	Fields(ctx context.Context, req FieldsRequest) ([]FieldInfo, error)
	TypeSchema(ctx context.Context) (map[string]parser.TypeSchemaEntry, error)
	CurveData(ctx context.Context, req CurveDataRequest) ([]byte, error)
	TypeBody(ctx context.Context, req TypeBodyRequest) ([]byte, error)
	Parameters(ctx context.Context) ([]Parameter, error)
	Commands(ctx context.Context) ([]CommandEntry, error)
	MAVLinkCommands(ctx context.Context) ([]MAVLinkCommandEntry, error)
	ModeChanges(ctx context.Context) ([]ModeEntry, error)
	Messages(ctx context.Context) ([]MessageEntry, error)
	Errors(ctx context.Context) ([]ErrorEntry, error)
	Events(ctx context.Context) ([]EventEntry, error)
	Browse(ctx context.Context, req BrowseRequest) (*BrowseResponse, error)
	LogDefs(ctx context.Context) (*LogDefsResponse, error)
	Series(ctx context.Context, req SeriesRequest) (*SeriesResponse, error)
	Close() error
}
