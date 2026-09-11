package jsonstore

import (
	"context"
	"math"
	"strings"

	appmodel "drone-log-analyzer/app/model"
	"drone-log-analyzer/app/services/configservice"
)

const llmConfigFileName = "llm_config_v1.json"

func (s *service) GetLlmConfig(ctx context.Context) (*configservice.LlmConfigResponse, error) {
	cfg := &appmodel.LlmConfig{}
	if err := loadConfig(llmConfigFileName, cfg); err != nil {
		return nil, err
	}
	return &configservice.LlmConfigResponse{Config: sanitizeLlmConfig(*cfg), Path: configPath(llmConfigFileName)}, nil
}

func (s *service) SaveLlmConfig(ctx context.Context, req appmodel.LlmConfig) (*configservice.LlmConfigResponse, error) {
	cfg := sanitizeLlmConfig(req)
	if err := saveConfig(llmConfigFileName, cfg); err != nil {
		return nil, err
	}
	return &configservice.LlmConfigResponse{Config: cfg, Path: configPath(llmConfigFileName)}, nil
}

// sanitizeLlmConfig 规范化用户输入：去空白、钳制取值范围。APIKey 明文落盘
// 仅存于本机用户配置目录，永不写入日志或事件。
func sanitizeLlmConfig(cfg appmodel.LlmConfig) *appmodel.LlmConfig {
	cfg.Provider = strings.TrimSpace(cfg.Provider)
	cfg.BaseURL = strings.TrimSpace(cfg.BaseURL)
	cfg.Model = strings.TrimSpace(cfg.Model)
	if cfg.Temperature < 0 || math.IsNaN(cfg.Temperature) {
		cfg.Temperature = 0
	}
	if cfg.Temperature > 2 {
		cfg.Temperature = 2
	}
	if cfg.MaxSteps <= 0 {
		cfg.MaxSteps = defaultLlmMaxSteps
	}
	if cfg.MaxSteps > 50 {
		cfg.MaxSteps = 50
	}
	return &cfg
}

const defaultLlmMaxSteps = 15
