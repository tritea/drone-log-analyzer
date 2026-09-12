package tools

import (
	"context"

	"github.com/cloudwego/eino/components/tool"

	"drone-log-analyzer/app/modules/knowledge"
	"drone-log-analyzer/app/services/logservice"
)

type listGroupsInput struct{}

// groupCols：desc/affects 来自知识库（空=未覆盖）。
var groupCols = []string{"name", "samples", "fields", "desc", "affects"}

type listGroupsOutput struct {
	Cols []string `json:"cols"`
	Rows [][]any  `json:"rows"`
}

// listGroupsTool 列出当前日志实际存在的 group，左连接知识库描述。
// 日志里真实有的才出现；知识库没覆盖的 group 也列出（描述留空），
// 这样 AI 不会漏掉可用数据。
func listGroupsTool(deps Deps) (tool.InvokableTool, error) {
	return infer("list_groups",
		"列出当前日志里实际存在的数据分组（如 GPS/BAT/CTUN），行数组（cols 标列序）："+
			"名称、样本数、字段数，及知识库的分组用途与影响说明（空=未覆盖）。",
		func(ctx context.Context, _ listGroupsInput) (listGroupsOutput, error) {
			types, err := deps.Log.MessageTypes(ctx)
			if err != nil {
				return listGroupsOutput{}, err
			}
			kb := knowledge.ForFormat(deps.Format)
			out := listGroupsOutput{Cols: groupCols, Rows: make([][]any, 0, len(types))}
			for _, ti := range types {
				desc, affects := "", any(nil)
				if gm := knowledge.FilterGroup(kb.Group(ti.Name), deps.Class); gm != nil {
					desc = gm.Description
					affects = strsOrNil(gm.Affects)
				}
				out.Rows = append(out.Rows, trimRow([]any{ti.Name, ti.Count, len(ti.Fields), desc, affects}))
			}
			return out, nil
		})
}

type groupFieldsInput struct {
	Group string `json:"group" jsonschema:"required" jsonschema_description:"分组名，如 GPS、BAT、CTUN"`
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
		"获取某个分组内的字段清单，行数组（cols 标列序，行尾空列省略）："+
			"name/min/max/n=实测统计；知识库覆盖时附 desc/unit/thr=[级别,op,阈值]行/"+
			"affects/analysis=[条件,含义]行/related（无附加列=知识库未覆盖）。"+
			"按 分组.字段 取数（如 GPS.NSats）前先调它确认字段名。",
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
			for _, fi := range fields {
				if !fi.IsNumeric {
					continue
				}
				row := []any{fi.Name, fi.Min, fi.Max, fi.Count}
				if fm, ok := kb.Field(in.Group, fi.Name); ok && knowledge.Applies(fm.AppliesTo, deps.Class) {
					row = append(row, fm.Description, fm.Unit,
						thrRows(fm.Thresholds), strsOrNil(fm.Affects),
						anaRows(fm.Analysis), strsOrNil(fm.Related))
				}
				out.Rows = append(out.Rows, trimRow(row))
			}
			return out, nil
		})
}
