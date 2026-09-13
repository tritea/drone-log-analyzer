package tools

import (
	"context"
	"sort"

	"github.com/cloudwego/eino/components/tool"

	"drone-log-analyzer/app/modules/knowledge"
	"drone-log-analyzer/app/services/logservice"
)

type listGroupsInput struct {
	MinSamples int `json:"min_samples,omitempty" jsonschema_description:"只列样本数≥该值的分组（tlog 消息类型极多，用它滤掉低频类型），缺省=全部"`
}

// groupCols：desc/affects 来自知识库（空=未覆盖）。
var groupCols = []string{"name", "samples", "fields", "desc", "affects"}

type listGroupsOutput struct {
	Count     int      `json:"count"` // 命中总数（rows 可能被截断）
	Truncated bool     `json:"truncated,omitempty"`
	Cols      []string `json:"cols"`
	Rows      [][]any  `json:"rows"`
}

// rankGroups 过滤并排序分组行：丢弃无样本的类型（没有可查数据，纯噪声），
// minSamples 过滤低频类型，按样本数降序（高采样率分组通常诊断价值更高，
// 同数时保序稳定），超上限截断——tlog 单日志可有 400+ 活跃消息类型，
// 全量倒给模型是上下文浪费（实测 523 行 / 12.7k 字符）。纯函数便于单测。
func rankGroups(rows [][]any, minSamples int) ([][]any, int, bool) {
	filtered := make([][]any, 0, len(rows))
	for _, r := range rows {
		n, _ := r[1].(int)
		if n <= 0 || (minSamples > 0 && n < minSamples) {
			continue
		}
		filtered = append(filtered, r)
	}
	sort.SliceStable(filtered, func(i, j int) bool {
		return filtered[i][1].(int) > filtered[j][1].(int)
	})
	total := len(filtered)
	trunc := total > maxRecordEntries
	if trunc {
		filtered = filtered[:maxRecordEntries]
	}
	return filtered, total, trunc
}

// listGroupsTool 列出当前日志实际存在的 group，左连接知识库描述。
// 无样本的类型不列；按样本数降序、超上限截断（count 记全量）。
func listGroupsTool(deps Deps) (tool.InvokableTool, error) {
	return infer("list_groups",
		"列出日志里实际存在的数据分组：名称、样本数、字段数与用途/影响说明"+
			"（按样本数降序，超 200 截断；min_samples 可过滤低频类型）。知识库"+
			"未覆盖的分组描述留空。",
		func(ctx context.Context, in listGroupsInput) (listGroupsOutput, error) {
			types, err := deps.Log.MessageTypes(ctx)
			if err != nil {
				return listGroupsOutput{}, err
			}
			kb := knowledge.ForFormat(deps.Format)
			rows := make([][]any, 0, len(types))
			for _, ti := range types {
				desc, affects := "", any(nil)
				if gm := knowledge.FilterGroup(kb.Group(ti.Name), deps.Class); gm != nil {
					desc = gm.Description
					affects = strsOrNil(gm.Affects)
				}
				rows = append(rows, trimRow([]any{ti.Name, ti.Count, len(ti.Fields), desc, affects}))
			}
			kept, total, trunc := rankGroups(rows, in.MinSamples)
			return listGroupsOutput{Count: total, Truncated: trunc, Cols: groupCols, Rows: kept}, nil
		})
}

type groupFieldsInput struct {
	Group string `json:"group" jsonschema:"required" jsonschema_description:"分组名，如 GPS"`
}

// fieldCols：name/min/max/n=实测统计；知识库覆盖时附 desc/unit/
// thr=[级别,op,阈值]行/affects/analysis=[条件,含义]行/related（行尾空列省略）。
var fieldCols = []string{"name", "min", "max", "n", "desc", "unit", "thr", "affects", "analysis", "related"}

type groupFieldsOutput struct {
	Group       string   `json:"group"`
	Description string   `json:"description,omitempty"`
	VehicleNote string   `json:"vehicleNote,omitempty"`
	Cols        []string `json:"cols"`
	Rows        [][]any  `json:"rows"`
}

// groupFieldsTool 返回一个 group 的字段清单：知识库元信息（描述/单位/阈值/
// 影响域/分析启发式）与实测统计（min/max/count）融合。
func groupFieldsTool(deps Deps) (tool.InvokableTool, error) {
	return infer("get_fields",
		"获取分组内字段清单：name/min/max/n=实测统计；知识库覆盖时附 desc/unit/"+
			"thr=[级别,op,阈值]行/affects/analysis=[条件,含义]行/related。"+
			"取数前先调它确认字段名。",
		func(ctx context.Context, in groupFieldsInput) (groupFieldsOutput, error) {
			fields, err := deps.Log.Fields(ctx, logservice.FieldsRequest{Type: in.Group})
			if err != nil {
				return groupFieldsOutput{}, err
			}
			kb := knowledge.ForFormat(deps.Format)
			gm := knowledge.FilterGroup(kb.Group(in.Group), deps.Class)
			out := groupFieldsOutput{Group: in.Group, Cols: fieldCols, Rows: make([][]any, 0, len(fields))}
			if gm != nil {
				out.Description = gm.Description
				if note, ok := gm.VehicleNotes[string(deps.Class)]; ok {
					out.VehicleNote = note
				}
			}
			out.Rows = append(out.Rows, fieldRows(deps, kb, in.Group, fields, "")...)
			return out, nil
		})
}

// fieldRows 构建一组字段的二级描述行（fieldCols 列序）：实测统计 +
// 知识库元信息。prefix 控制名字列形态：get_fields 用空（裸字段名），
// 主题工具用 "GROUP."（拼成与 query_data 取数名一致的 分组.字段）。
func fieldRows(deps Deps, kb *knowledge.FormatKB, group string, fields []logservice.FieldInfo, prefix string) [][]any {
	var rows [][]any
	for _, fi := range fields {
		if !fi.IsNumeric {
			continue
		}
		row := []any{prefix + fi.Name, fi.Min, fi.Max, fi.Count}
		if fm, ok := kb.Field(group, fi.Name); ok && knowledge.Applies(fm.AppliesTo, deps.Class) {
			row = append(row, fm.Description, fm.Unit,
				thrRows(fm.Thresholds), strsOrNil(fm.Affects),
				anaRows(fm.Analysis), strsOrNil(fm.Related))
		}
		rows = append(rows, trimRow(row))
	}
	return rows
}
