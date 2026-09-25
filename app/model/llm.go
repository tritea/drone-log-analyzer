// Package model 存放跨服务共享的 DTO（见 AGENTS.md：跨服务 DTO 放 app/model/）。
package model

// LlmConfig 是 Agent 服务的 LLM 接入配置（OpenAI 兼容端点）。
// 由 configservice 持久化（llm_config_v1.json），agentservice 消费。
type LlmConfig struct {
	Provider    string  `json:"provider"`    // 展示用：GLM / DeepSeek / Qwen / Ollama / 自定义
	BaseURL     string  `json:"baseUrl"`     // OpenAI 兼容端点；Ollama 本地填 http://127.0.0.1:11434/v1
	APIKey      string  `json:"apiKey"`      // 本地明文存储（桌面应用、用户目录），不写入日志
	Model       string  `json:"model"`       // 模型 ID，如 glm-4.7 / deepseek-chat / qwen-plus
	Temperature float64 `json:"temperature"` // 0~2；0 表示未设置，用模型默认

	// ReAct 迭代上限按分析档位分别配置；<=0 用默认
	// （极简 2 / 快速 4 / 标准 10 / 增强 13 / 深度 25）。
	MaxStepsMinimal  int `json:"maxStepsMinimal"`
	MaxStepsFast     int `json:"maxStepsFast"`
	MaxStepsStandard int `json:"maxStepsStandard"`
	MaxStepsPro      int `json:"maxStepsPro"`
	MaxStepsDeep     int `json:"maxStepsDeep"`
}
