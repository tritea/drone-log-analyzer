package wails

import (
	"context"

	appmodel "drone-log-analyzer/app/model"
	"drone-log-analyzer/app/services/configservice"
)

type ConfigAPI struct {
	Svc configservice.Service
}

func (a *ConfigAPI) GetSettings() (*configservice.SettingsResponse, error) {
	return a.Svc.GetSettings(context.Background())
}

func (a *ConfigAPI) SaveSettings(settings map[string]any) error {
	return a.Svc.SaveSettings(context.Background(), settings)
}

func (a *ConfigAPI) GetLlmConfig() (*configservice.LlmConfigResponse, error) {
	return a.Svc.GetLlmConfig(context.Background())
}

func (a *ConfigAPI) SaveLlmConfig(req appmodel.LlmConfig) (*configservice.LlmConfigResponse, error) {
	return a.Svc.SaveLlmConfig(context.Background(), req)
}

func (a *ConfigAPI) SetCurrentFormat(format string) error {
	return a.Svc.SetCurrentFormat(context.Background(), format)
}

func (a *ConfigAPI) GetFlightMetrics() (*configservice.FlightMetricsResponse, error) {
	return a.Svc.GetFlightMetrics(context.Background())
}

func (a *ConfigAPI) SaveFlightMetrics(metrics map[string]any) error {
	return a.Svc.SaveFlightMetrics(context.Background(), metrics)
}

func (a *ConfigAPI) GetCurveState() (*configservice.CurveStateResponse, error) {
	return a.Svc.GetCurveState(context.Background())
}

func (a *ConfigAPI) SaveCurveState(req configservice.CurveStateRequest) error {
	return a.Svc.SaveCurveState(context.Background(), req)
}

func (a *ConfigAPI) ListFieldEntries() (*configservice.FieldEntriesResponse, error) {
	return a.Svc.ListFieldEntries(context.Background())
}

func (a *ConfigAPI) SaveFieldEntry(req configservice.FieldEntry) (*configservice.FieldEntriesResponse, error) {
	return a.Svc.SaveFieldEntry(context.Background(), req)
}

func (a *ConfigAPI) DeleteFieldEntry(req configservice.DeleteFieldEntryRequest) (*configservice.FieldEntriesResponse, error) {
	return a.Svc.DeleteFieldEntry(context.Background(), req)
}

func (a *ConfigAPI) ListCustomModels() (*configservice.CustomModelsResponse, error) {
	return a.Svc.ListCustomModels(context.Background())
}

func (a *ConfigAPI) SaveCustomModel(req configservice.CustomModel) (*configservice.CustomModelsResponse, error) {
	return a.Svc.SaveCustomModel(context.Background(), req)
}

func (a *ConfigAPI) DeleteCustomModel(req configservice.DeleteCustomModelRequest) (*configservice.CustomModelsResponse, error) {
	return a.Svc.DeleteCustomModel(context.Background(), req)
}

func (a *ConfigAPI) ListModelGroups() (*configservice.ModelGroupsResponse, error) {
	return a.Svc.ListModelGroups(context.Background())
}

func (a *ConfigAPI) SaveModelGroup(req configservice.ModelGroup) (*configservice.ModelGroupsResponse, error) {
	return a.Svc.SaveModelGroup(context.Background(), req)
}

func (a *ConfigAPI) DeleteModelGroup(req configservice.DeleteModelGroupRequest) (*configservice.ModelGroupsResponse, error) {
	return a.Svc.DeleteModelGroup(context.Background(), req)
}

func (a *ConfigAPI) ListTilesets() (*configservice.TilesetsResponse, error) {
	return a.Svc.ListTilesets(context.Background())
}

func (a *ConfigAPI) SaveTileset(req configservice.Tileset) (*configservice.TilesetsResponse, error) {
	return a.Svc.SaveTileset(context.Background(), req)
}

func (a *ConfigAPI) DeleteTileset(req configservice.DeleteTilesetRequest) (*configservice.TilesetsResponse, error) {
	return a.Svc.DeleteTileset(context.Background(), req)
}
