// pacing.go — 调用预算提示：模型对"还能查几步"没有感知，会把迭代上限
// 当目标用满，最后一步撞上限触发强制收尾（结论质量打折 + 多一次全量
// 重发）。本钩子在每次模型调用前把当前进度写进系统提示词尾部：临近
// 用尽时提示收敛，最后一次调用给出"必须作答"的强指令——让模型在预算
// 内自主收尾。弱模型不遵守也没关系：上限与 forceSummary 仍是硬兜底，
// pacing 只是让常规轮次不必走到那一步。
package agent

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/schema"
)

// pacingMark 预算提示的定位标记（剥除旧提示用；系统提示词正文不含此串）。
const pacingMark = "【调用预算】"

// pacingMiddleware 每次模型调用前更新系统提示词尾部的预算提示。计数器
// 随 agent 实例走（一轮 Chat 新建一个 agent，即每轮从 1 起算）；adk 的
// MaxIterations=M 恰好允许 M 次模型调用，第 M 次必须产出最终回答。
type pacingMiddleware struct {
	*adk.BaseChatModelAgentMiddleware
	calls atomic.Int64
	max   int
}

// newPacingMiddleware 构造预算提示钩子（maxIter = 本轮迭代上限）。
func newPacingMiddleware(maxIter int) adk.ChatModelAgentMiddleware {
	return &pacingMiddleware{BaseChatModelAgentMiddleware: &adk.BaseChatModelAgentMiddleware{}, max: maxIter}
}

func (p *pacingMiddleware) BeforeModelRewriteState(ctx context.Context,
	st *adk.ChatModelAgentState, mc *adk.ModelContext) (context.Context, *adk.ChatModelAgentState, error) {
	if st == nil || len(st.Messages) == 0 || st.Messages[0].Role != schema.System {
		return ctx, st, nil
	}
	n := int(p.calls.Add(1))
	cp := *st.Messages[0]
	cp.Content = strings.TrimRight(stripPacing(cp.Content), "\n \t") + pacingNote(n, p.max)
	st.Messages[0] = &cp
	return ctx, st, nil
}

// stripPacing 剥掉上一次注入的预算提示（内容是本包拼的，按标记精确可剥，
// 上下文里始终只有一条当前进度）。
func stripPacing(s string) string {
	if i := strings.LastIndex(s, pacingMark); i >= 0 {
		return s[:i]
	}
	return s
}

// pacingNote 生成第 n/max 次调用的预算提示。n==max 是关键一步：明确
// 告知不得再调工具、立即作答——这是避免撞上限触发强制收尾的信号；
// n<max 只报进度并提示按需收敛。
func pacingNote(n, max int) string {
	if n > max {
		return ""
	}
	if n == max {
		return "\n\n" + pacingMark + fmt.Sprintf("这是第 %d/%d 次也是最后一次模型调用："+
			"工具调用预算已用尽，不得再调用任何工具，立即基于已获取的全部数据给出最终回答"+
			"（遵守上述全部回答规则，含末尾 incident 机读块）。", n, max)
	}
	return "\n\n" + pacingMark + fmt.Sprintf("工具调用进度 %d/%d，剩余 %d 次；"+
		"请按需收敛，临近用尽时直接作答（每次调用都重发全部上下文，尽早收尾更省 token）。", n, max, max-n)
}
