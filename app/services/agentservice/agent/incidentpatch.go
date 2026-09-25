package agent

import (
	"context"
	"strings"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/schema"

	appmodel "drone-log-analyzer/app/model"
)

// incident 机读块补全：模型偶尔漏输出 ```incident 块，或把围栏写成排版
// 文本（分隔线/[INC-xxx] 小节）导致前端 JSON.parse 失败。Chat 结束时检测
// 回答缺块，则用一个无工具的轻量 agent 把已有结论转成纯 JSON 追加到末尾。
// 任何失败都静默放弃——补块是尽力而为，不能影响原回答。

const incidentFence = "```incident"

// looksLikeIncidentJSON 判断文本是否带合法机读块：```incident 围栏后
// （跳过围栏行残文与空白）紧跟 [ 或 {（JSON 数组/对象开头）。
func looksLikeIncidentJSON(text string) bool {
	idx := strings.LastIndex(text, incidentFence)
	if idx < 0 {
		return false
	}
	rest := text[idx+len(incidentFence):]
	if nl := strings.IndexByte(rest, '\n'); nl >= 0 {
		rest = rest[nl+1:]
	}
	rest = strings.TrimLeft(rest, " \t\r\n")
	return strings.HasPrefix(rest, "[") || strings.HasPrefix(rest, "{")
}

const incidentPatchPrompt = "请把上面结论中的问题时段（异常/越限/值得人工复核的时段）整理为机读块输出：" +
	"只输出一个围栏代码块（开始标记=三个反引号紧跟 incident），块内容为纯 JSON 数组（以 [ 开始、] 结束，" +
	"块内不得有任何其它文字），每项形如 {\"startSec\": 数值, \"endSec\": 数值, " +
	"\"severity\": \"low|medium|high|critical\", \"title\": \"简短标题\", \"desc\": \"一句话结论\", " +
	"\"fields\": [\"GRP.Field\"]}。startSec/endSec 为相对日志起点的秒，title/desc 用与用户提问相同的语言。" +
	"严禁 YAML 或任何自创格式，只认 JSON 数组。没有问题时段则只回复两个字：无"

// incidentPatch 跑一轮无工具的格式转换：基于已含本轮结论的会话历史，让
// 模型只做"结论→JSON"的转换（不查数据，token 开销小）。返回补块文本
// （含围栏）与内部 run（其 usage 供调用方并入本轮统计）；无块/失败时文本
// 为空串，run 仍带出已产生的消耗。
func (s *service) incidentPatch(ctx context.Context, cfg *appmodel.LlmConfig, sess *session) (*run, string) {
	r := newRun(nil) // sink=nil：补块不推流，避免与当前轮的 streaming 文本混排
	cm, err := buildChatModel(ctx, cfg)
	if err != nil {
		return r, ""
	}
	ag, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Instruction: "你是格式转换器：把对话里已有的分析结论转换为机读 JSON。" +
			"不调用任何工具，除一个 JSON 代码块外不输出任何内容。",
		Model:         cm,
		MaxIterations: 2, // 无工具，一轮即出；2 为异常保险
	})
	if err != nil {
		return r, ""
	}
	input := append(trimContext(sess.snapshot()), schema.UserMessage(incidentPatchPrompt))
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
	text := strings.TrimSpace(r.finalAnswer())
	if !looksLikeIncidentJSON(text) {
		return r, ""
	}
	return r, text
}
