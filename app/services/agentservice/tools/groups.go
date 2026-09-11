package tools

import (
	"context"

	"github.com/cloudwego/eino/components/tool"

	"drone-log-analyzer/app/modules/knowledge"
	"drone-log-analyzer/app/services/logservice"
)

type listGroupsInput struct{}

type groupBrief struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"` // 知识库描述；空=知识库未覆盖
	Affects     []string `json:"affects,omitempty"`
	SampleCount int      `json:"sampleCount"`
	FieldCount  int      `json:"fieldCount"`
}

type listGroupsOutput struct {
	Groups []groupBrief `json:"groups"`
}

// listGroupsTool 列出当前日志实际存在的 group，左连接知识库描述。
// 日志里真实有的才出现；知识库没覆盖的 group 也列出（描述留空），
// 这样 AI 不会漏掉可用数据。
func listGroupsTool(deps Deps) (tool.InvokableTool, error) {
	return infer("list_groups",
		"列出当前日志里实际存在的数据分组（如 GPS/BAT/CTUN），"+
			"含每个分组的用途说明、样本数与字段数。",
		func(ctx context.Context, _ listGroupsInput) (listGroupsOutput, error) {
			types, err := deps.Log.MessageTypes(ctx)
			if err != nil {
				return listGroupsOutput{}, err
			}
			kb := knowledge.ForFormat(deps.Format)
			groups := make([]groupBrief, 0, len(types))
			for _, ti := range types {
				brief := groupBrief{
					Name:        ti.Name,
					SampleCount: ti.Count,
					FieldCount:  len(ti.Fields),
				}
				if gm := knowledge.FilterGroup(kb.Group(ti.Name), deps.Class); gm != nil {
					brief.Description = gm.Description
					brief.Affects = gm.Affects
				}
				groups = append(groups, brief)
			}
			return listGroupsOutput{Groups: groups}, nil
		})
}

type groupFieldsInput struct {
	Group string `json:"group" jsonschema:"required" jsonschema_description:"分组名，如 GPS、BAT、CTUN"`
}

type fieldBrief struct {
	Name        string                  `json:"name"`
	Description string                  `json:"description,omitempty"`
	Unit        string                  `json:"unit,omitempty"`
	Thresholds  []knowledge.Threshold   `json:"thresholds,omitempty"`
	Affects     []string                `json:"affects,omitempty"`
	Analysis    []knowledge.AnalysisNote `json:"analysis,omitempty"`
	Related     []string                `json:"related,omitempty"`
	Min         float64                 `json:"min,omitempty"`
	Max         float64                 `json:"max,omitempty"`
	Count       int                     `json:"count,omitempty"`
	Known       bool                    `json:"known"` // 知识库是否覆盖该字段
}

type groupFieldsOutput struct {
	Group       string       `json:"group"`
	Description string       `json:"description,omitempty"`
	VehicleNote string       `json:"vehicleNote,omitempty"`
	Fields      []fieldBrief `json:"fields"`
}

// groupFieldsTool 返回一个 group 的字段清单：知识库元信息（描述/单位/阈值/
// 影响域/分析启发式）与实测统计（min/max/count）融合。
func groupFieldsTool(deps Deps) (tool.InvokableTool, error) {
	return infer("get_fields",
		"获取某个分组内的字段清单：每个字段的含义、单位、参考阈值、影响范围、"+
			"分析提示，以及实测最小/最大值与样本数（known 表示是否附有参考说明）。"+
			"按 分组.字段 取数（如 GPS.NSats）前先调它确认字段名。",
		func(ctx context.Context, in groupFieldsInput) (groupFieldsOutput, error) {
			fields, err := deps.Log.Fields(ctx, logservice.FieldsRequest{Type: in.Group})
			if err != nil {
				return groupFieldsOutput{}, err
			}
			kb := knowledge.ForFormat(deps.Format)
			gm := knowledge.FilterGroup(kb.Group(in.Group), deps.Class)
			out := groupFieldsOutput{Group: in.Group, Fields: make([]fieldBrief, 0, len(fields))}
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
				brief := fieldBrief{
					Name:  fi.Name,
					Min:   fi.Min,
					Max:   fi.Max,
					Count: fi.Count,
				}
				if fm, ok := kb.Field(in.Group, fi.Name); ok && knowledge.Applies(fm.AppliesTo, deps.Class) {
					brief.Known = true
					brief.Description = fm.Description
					brief.Unit = fm.Unit
					brief.Thresholds = fm.Thresholds
					brief.Affects = fm.Affects
					brief.Analysis = fm.Analysis
					brief.Related = fm.Related
				}
				out.Fields = append(out.Fields, brief)
			}
			return out, nil
		})
}
