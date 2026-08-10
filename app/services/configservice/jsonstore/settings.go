package jsonstore

import (
	"context"
	"fmt"
	"strings"
	"time"

	"drone-log-analyzer/app/services/configservice"
)

func (s *service) GetSettings(ctx context.Context) (*configservice.SettingsResponse, error) {
	var settings map[string]any
	if err := loadConfig(settingsFileName, &settings); err != nil {
		return nil, err
	}
	return &configservice.SettingsResponse{Settings: settings, Path: configPath(settingsFileName)}, nil
}

func (s *service) SaveSettings(ctx context.Context, settings map[string]any) error {
	if settings != nil {
		settings["updatedAt"] = time.Now().Format(time.RFC3339)
	}
	return saveConfig(settingsFileName, settings)
}

func (s *service) GetFlightMetrics(ctx context.Context) (*configservice.FlightMetricsResponse, error) {
	format := s.currentFormat()
	var metrics map[string]any
	if err := loadConfigForFormat(format, flightMetricsBase, &metrics); err != nil {
		return nil, err
	}
	return &configservice.FlightMetricsResponse{Metrics: metrics, Path: configPath(configFileName(format, flightMetricsBase))}, nil
}

func (s *service) SaveFlightMetrics(ctx context.Context, metrics map[string]any) error {
	if metrics != nil {
		metrics["updatedAt"] = time.Now().Format(time.RFC3339)
	}
	return saveConfigForFormat(s.currentFormat(), flightMetricsBase, metrics)
}

type curveState struct {
	ActiveCurves []configservice.CurveStateCurve `json:"activeCurves"`
	UpdatedAt    string                          `json:"updatedAt,omitempty"`
}

func (s *service) GetCurveState(ctx context.Context) (*configservice.CurveStateResponse, error) {
	format := s.currentFormat()
	var st curveState
	if err := loadConfigForFormat(format, curveStateBase, &st); err != nil {
		return nil, err
	}
	st.ActiveCurves = cleanCurveStateCurves(st.ActiveCurves)
	return &configservice.CurveStateResponse{
		ActiveCurves: st.ActiveCurves,
		UpdatedAt:    st.UpdatedAt,
		Path:         configPath(configFileName(format, curveStateBase)),
	}, nil
}

func (s *service) SaveCurveState(ctx context.Context, req configservice.CurveStateRequest) error {
	st := curveState{
		ActiveCurves: cleanCurveStateCurves(req.ActiveCurves),
		UpdatedAt:    time.Now().Format(time.RFC3339),
	}
	return saveConfigForFormat(s.currentFormat(), curveStateBase, st)
}

func cleanCurveStateCurves(curves []configservice.CurveStateCurve) []configservice.CurveStateCurve {
	cleaned := make([]configservice.CurveStateCurve, 0, len(curves))
	seen := map[string]bool{}
	for _, c := range curves {
		c.Type = strings.TrimSpace(c.Type)
		c.Field = strings.TrimSpace(c.Field)
		if c.Type == "" || c.Field == "" {
			continue
		}
		key := c.Type + "\x00" + c.Field
		if seen[key] {
			continue
		}
		seen[key] = true
		if c.Scale == 0 && c.ScaleInput == "" {
			c.Scale = 1
		}
		c.ScaleInput = defaultInput(c.ScaleInput, c.Scale)
		c.OffsetInput = defaultInput(c.OffsetInput, c.Offset)
		c.FieldName = strings.TrimSpace(c.FieldName)
		if c.FieldGroupScale == 0 && c.FieldGroupScaleInput == "" {
			c.FieldGroupScale = 1
		}
		c.FieldGroupScaleInput = defaultInput(c.FieldGroupScaleInput, c.FieldGroupScale)
		c.FieldGroupOffsetInput = defaultInput(c.FieldGroupOffsetInput, c.FieldGroupOffset)
		cleaned = append(cleaned, c)
	}
	return cleaned
}

func defaultInput(input string, val float64) string {
	if input != "" {
		return input
	}
	return fmt.Sprintf("%g", val)
}
