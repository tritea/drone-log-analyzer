package agent

import (
	"context"
	"strings"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/schema"

	appmodel "drone-log-analyzer/app/model"
)

const forceSummaryPrompt = "工具调用次数已达本轮上限。不要再试图查询数据：" +
	"基于以上已获取的全部工具结果，立即给出最终分析结论" +
	"（遵守系统提示词的全部回答规则，含末尾 incident 机读块）；数据不足的部分明确说明即可。"

// forceSummary 在迭代超限后强制收尾：用一个无工具的轻量 agent 基于本轮
// 已获取的数据直接作答，避免整轮报废——已花费的调用至少要换来结论。
// Instruction 复用完整系统提示词（报告受众/禁自创机读格式/incident 规范
// 都在里面）——曾因用精简指令导致收尾输出 YAML 报告头这类违规格式。
// 返回内部 run（usage 供调用方并入本轮统计）与结论文本；失败时文本为空。
func (s *service) forceSummary(ctx context.Context, cfg *appmodel.LlmConfig, sysPrompt string, round []*schema.Message) (*run, string) {
	r := newRun(nil) // sink=nil：收尾不推流，文本由调用方并入最终消息
	cm, err := buildChatModel(ctx, cfg)
	if err != nil {
		return r, ""
	}
	ag, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Instruction: sysPrompt + "\n\n补充：你不调用任何工具——对话历史里的工具结果就是全部" +
			"可用数据，直接给出最终诊断结论。",
		Model:         cm,
		MaxIterations: 2, // 无工具一轮即出；2 为异常保险
	})
	if err != nil {
		return r, ""
	}
	input := append(append([]*schema.Message(nil), round...), schema.UserMessage(forceSummaryPrompt))
	iter := ag.Run(ctx, &adk.AgentInput{Messages: input})
	for {
		ev, ok := iter.Next()
		if !ok {
			break
		}
		if ev.Err != nil {
			return r, ""
		}
		if ev.Output == nil || ev.Output.MessageOutput == nil {
			continue
		}
		if err := r.handle(ev.Output.MessageOutput); err != nil {
			return r, ""
		}
	}
	return r, strings.TrimSpace(r.finalAnswer())
}
