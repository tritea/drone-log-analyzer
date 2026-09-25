package agent

import (
	"context"
	"net/url"
	"strings"

	openaix "github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/model"

	appmodel "drone-log-analyzer/app/model"
)

// buildChatModel 按配置构建 OpenAI 兼容 ChatModel。一个入口覆盖所有主流
// 提供商（GLM/DeepSeek/Qwen/OpenRouter/Ollama 本地等），只差 BaseURL。
func buildChatModel(ctx context.Context, cfg *appmodel.LlmConfig) (model.BaseChatModel, error) {
	conf := &openaix.ChatModelConfig{
		APIKey:  cfg.APIKey,
		BaseURL: cfg.BaseURL,
		Model:   cfg.Model,
	}
	if cfg.Temperature > 0 {
		t := float32(cfg.Temperature)
		conf.Temperature = &t
	}
	return openaix.NewChatModel(ctx, conf)
}

// validateLlmConfig 校验配置完整性：模型必填；APIKey 必填除非 BaseURL 指向
// 本机（Ollama/lm-server 等本地推理无需密钥）。
func validateLlmConfig(cfg *appmodel.LlmConfig) bool {
	if cfg == nil || strings.TrimSpace(cfg.Model) == "" {
		return false
	}
	if strings.TrimSpace(cfg.APIKey) != "" {
		return true
	}
	return isLocalBaseURL(cfg.BaseURL)
}

func isLocalBaseURL(baseURL string) bool {
	if strings.TrimSpace(baseURL) == "" {
		return false
	}
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || u.Host == "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
}
