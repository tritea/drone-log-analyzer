package wails

import (
	"context"

	"drone-log-analyzer/app/modules/parser"
	"drone-log-analyzer/app/services/logservice"
)

type LogAPI struct {
	Svc logservice.Service
}

func (a *LogAPI) Load(req logservice.LoadRequest) (*logservice.SummaryResponse, error) {
	return a.Svc.Load(context.Background(), req)
}

func (a *LogAPI) Status() (logservice.StatusResponse, error) {
	return a.Svc.Status(context.Background())
}

func (a *LogAPI) Summary() (*logservice.SummaryResponse, error) {
	return a.Svc.Summary(context.Background())
}

func (a *LogAPI) MessageTypes() ([]logservice.TypeInfo, error) {
	return a.Svc.MessageTypes(context.Background())
}

func (a *LogAPI) Fields(req logservice.FieldsRequest) ([]logservice.FieldInfo, error) {
	return a.Svc.Fields(context.Background(), req)
}

func (a *LogAPI) TypeSchema() (map[string]parser.TypeSchemaEntry, error) {
	return a.Svc.TypeSchema(context.Background())
}

func (a *LogAPI) CurveData(req logservice.CurveDataRequest) ([]byte, error) {
	return a.Svc.CurveData(context.Background(), req)
}

func (a *LogAPI) TypeBody(req logservice.TypeBodyRequest) ([]byte, error) {
	return a.Svc.TypeBody(context.Background(), req)
}

func (a *LogAPI) Parameters() ([]logservice.Parameter, error) {
	return a.Svc.Parameters(context.Background())
}

func (a *LogAPI) Commands() ([]logservice.CommandEntry, error) {
	return a.Svc.Commands(context.Background())
}

func (a *LogAPI) MAVLinkCommands() ([]logservice.MAVLinkCommandEntry, error) {
	return a.Svc.MAVLinkCommands(context.Background())
}

func (a *LogAPI) ModeChanges() ([]logservice.ModeEntry, error) {
	return a.Svc.ModeChanges(context.Background())
}

func (a *LogAPI) Messages() ([]logservice.MessageEntry, error) {
	return a.Svc.Messages(context.Background())
}

func (a *LogAPI) Errors() ([]logservice.ErrorEntry, error) {
	return a.Svc.Errors(context.Background())
}

func (a *LogAPI) Events() ([]logservice.EventEntry, error) {
	return a.Svc.Events(context.Background())
}

func (a *LogAPI) Browse(req logservice.BrowseRequest) (*logservice.BrowseResponse, error) {
	return a.Svc.Browse(context.Background(), req)
}

func (a *LogAPI) LogDefs() (*logservice.LogDefsResponse, error) {
	return a.Svc.LogDefs(context.Background())
}
