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
	cfg.MaxStepsMinimal = clampLlmSteps(cfg.MaxStepsMinimal, defaultLlmStepsMinimal)
	cfg.MaxStepsFast = clampLlmSteps(cfg.MaxStepsFast, defaultLlmStepsFast)
	cfg.MaxStepsStandard = clampLlmSteps(cfg.MaxStepsStandard, defaultLlmStepsStandard)
	cfg.MaxStepsPro = clampLlmSteps(cfg.MaxStepsPro, defaultLlmStepsPro)
	cfg.MaxStepsDeep = clampLlmSteps(cfg.MaxStepsDeep, defaultLlmStepsDeep)
	return &cfg
}

// clampLlmSteps 钳制迭代上限到 1~50；<=0 用档位默认。
func clampLlmSteps(v, def int) int {
	if v <= 0 {
		return def
	}
	if v > 50 {
		return 50
	}
	return v
}

const (
	defaultLlmStepsMinimal  = 2  // 极简：快速扫描，找明显异常
	defaultLlmStepsFast     = 5  // 快速：定位主要问题，简单交叉验证
	defaultLlmStepsStandard = 10 // 标准：常规完整分析
	defaultLlmStepsPro      = 13 // 增强：多数据源关联分析
	defaultLlmStepsDeep     = 25 // 深度：假设验证、反复推理
)
