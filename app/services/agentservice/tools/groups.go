package tools

import (
	"context"

	"github.com/cloudwego/eino/components/tool"

	"drone-log-analyzer/app/modules/knowledge"
	"drone-log-analyzer/app/services/logservice"
)

type listGroupsInput struct{}

type listGroupsOutput struct {
	Groups []string `json:"groups"` // 有数据的数据分组名（无样本的类型不列）
}

// listGroupsTool 列出当前日志实际存在数据的分组名——纯名单，不带描述/
// 统计：分组含义模型训练知识已覆盖（GPS/ATT/BARO/CTUN 等），字段级
// 详情由 get_fields 按名查看。tlog 单日志可有数百消息类型，行式编码+
// 描述列会把浏览变成上下文大头（实测 12.7k 字符），名单压到 ~4k。
func listGroupsTool(deps Deps) (tool.InvokableTool, error) {
	return infer("list_groups",
		"列出日志里实际存在数据的数据分组名（纯名单，无样本的类型不列）。"+
			"分组的字段清单用 get_fields 按名查看。",
		func(ctx context.Context, _ listGroupsInput) (listGroupsOutput, error) {
			types, err := deps.Log.MessageTypes(ctx)
			if err != nil {
				return listGroupsOutput{}, err
			}
			out := listGroupsOutput{}
			for _, ti := range types {
				if ti.Count > 0 {
					out.Groups = append(out.Groups, ti.Name)
				}
			}
			return out, nil
		})
}

type groupFieldsInput struct {
	Group string `json:"group" jsonschema:"required" jsonschema_description:"分组名，如 GPS"`
}

// fieldCols：name/min/max/n=实测统计；知识库覆盖时附 desc（一句话用途
// 提示）/unit/values（枚举/位段取值——各日志体系刻度不同，是客观基准
// 必须下发）/thr=[级别,op,阈值]行/affects（相关域，如
// ["attitude","vibration"]）/related（行尾空列省略）。字段含义与分析
// 方法模型训练知识已覆盖，知识库只留客观基准与最简提示。
var fieldCols = []string{"name", "min", "max", "n", "desc", "unit", "values", "thr", "affects", "related"}

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
		"获取分组内字段清单：name/min/max/n=实测统计；知识库覆盖时附 desc"+
			"（一句话用途）/unit/values（枚举或位段取值，如 4=DGPS——按此解释，"+
			"勿套其他日志体系）/thr=[级别,op,阈值]行/affects（相关域数组）"+
			"/related。取数前先调它确认字段名。",
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
			row = append(row, fm.Description, fm.Unit, strsOrNil(fm.Values),
				thrRows(fm.Thresholds), strsOrNil(fm.Affects), strsOrNil(fm.Related))
		}
		rows = append(rows, trimRow(row))
	}
	return rows
}
