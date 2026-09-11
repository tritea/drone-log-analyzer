// Package tools 把日志数据/知识库/统计能力包装为 eino InvokableTool，
// 供 ChatModelAgent 的 ReAct 循环调用。工具无业务状态：当前日志、格式、
// 机型类在每轮 Chat 时通过 Deps 注入（工具随轮次重建，代价可忽略）。
package tools

import (
	"context"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"

	"drone-log-analyzer/app/modules/knowledge"
	"drone-log-analyzer/app/services/logservice"
)

// Deps 是工具集的依赖快照：绑定当前日志的访问入口与知识库上下文。
type Deps struct {
	Log    logservice.Service
	Format string                 // 当前日志格式（apm/tlog/ulog）
	Class  knowledge.VehicleClass // 当前机型类（知识库过滤）
	Abs    *AbsTime               // 绝对时间基准（nil=日志无 UTC 基准）
}

// Build 构建全部工具。任何单个工具构建失败都直接返回错误（schema 推导
// 依赖编译期类型，失败即编程错误）。
func Build(deps Deps) ([]tool.BaseTool, error) {
	overview, err := overviewTool(deps)
	if err != nil {
		return nil, err
	}
	groups, err := listGroupsTool(deps)
	if err != nil {
		return nil, err
	}
	fields, err := groupFieldsTool(deps)
	if err != nil {
		return nil, err
	}
	signal, err := querySignalTool(deps)
	if err != nil {
		return nil, err
	}
	events, err := flightEventsTool(deps)
	if err != nil {
		return nil, err
	}
	params, err := parametersTool(deps)
	if err != nil {
		return nil, err
	}
	paramGroups, err := paramGroupsTool(deps)
	if err != nil {
		return nil, err
	}
	return []tool.BaseTool{overview, groups, fields, signal, events, params, paramGroups}, nil
}

// infer 是 utils.InferTool 的薄封装，统一 import 与签名。
func infer[T, D any](name, desc string, fn func(ctx context.Context, in T) (D, error)) (tool.InvokableTool, error) {
	return utils.InferTool(name, desc, fn)
}
