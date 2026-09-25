// Package knowledge 是日志字段知识库（纯模块，不 import 任何 service）。
// 每种日志格式一个 JSON 文件（formats/<format>.json，//go:embed 内嵌），
// 描述该格式的 group/字段：用途、单位、分级阈值、影响域、组合分析启发式、
// 机型适用范围。查询侧按当前机型过滤，AI 拿到的字段列表始终与机型匹配。
package knowledge

// Threshold 是一条分级阈值。op 取 lt/le/gt/ge：例如 NSats 低于 8 为 warning
// （op=lt），振动高于 15 为 warning（op=gt）。
type Threshold struct {
	Level string  `json:"level"` // warning / critical / ...
	Op    string  `json:"op"`    // lt / le / gt / ge
	Value float64 `json:"value"`
}

// AnalysisNote 是"组合条件 → 含义"的启发式知识，供 AI 做诊断推理参考。
type AnalysisNote struct {
	Condition string `json:"condition"`
	Meaning   string `json:"meaning"`
}

// FieldMeta 描述 group 内单个字段。除 Description 外全部可选，按字段实况裁剪。
type FieldMeta struct {
	Description string         `json:"description,omitempty"`
	Unit        string         `json:"unit,omitempty"`
	Values      []string       `json:"values,omitempty"` // 枚举/位段取值（"4=DGPS" 格式）：不同日志体系刻度不同，必须随字段下发防误读
	Thresholds  []Threshold    `json:"thresholds,omitempty"`
	Affects     []string       `json:"affects,omitempty"`
	Analysis    []AnalysisNote `json:"analysis,omitempty"`
	AppliesTo   []string       `json:"appliesTo,omitempty"` // 机型类；缺省=全部
	Related     []string       `json:"related,omitempty"`   // 关联字段，如 "GPS.HDop"
}

// GroupMeta 描述一个日志大类（group，如 GPS/BAT）。
type GroupMeta struct {
	Description  string               `json:"description,omitempty"`
	Affects      []string             `json:"affects,omitempty"`
	AppliesTo    []string             `json:"appliesTo,omitempty"`
	VehicleNotes map[string]string    `json:"vehicleNotes,omitempty"` // 机型特殊说明
	Fields       map[string]FieldMeta `json:"fields,omitempty"`
}

// FormatKB 是一种日志格式的完整知识库（formats/<format>.json 的内存形态）。
type FormatKB struct {
	Format  string                `json:"format"` // 与 parser 注册的格式名一致：apm/tlog/ulog
	Version int                   `json:"version"`
	Groups  map[string]*GroupMeta `json:"groups"`
}

// ParamMeta 描述一个飞控参数（由 tools/gen-params.mjs 从官方文档生成，
// formats/<format>-params.json）。字段名用单字母缩键控制体积。
type ParamMeta struct {
	Description string   `json:"d,omitempty"` // 短述（官方标题）
	Long        string   `json:"D,omitempty"` // 长述（截断）
	Unit        string   `json:"u,omitempty"`
	RangeMin    *float64 `json:"rmin,omitempty"`
	RangeMax    *float64 `json:"rmax,omitempty"`
	Default     *float64 `json:"def,omitempty"` // 官方默认值（仅 PX4 文档提供）
	Values      []string `json:"v,omitempty"`   // 枚举值/位段："0: 含义"
	AppliesTo   []string `json:"ap,omitempty"`  // 机型类；缺省=全部
}

// ParamGroupMeta 是参数前缀分组（如 ATC/MOT/EK3）的作用与影响域。
type ParamGroupMeta struct {
	Description string   `json:"description,omitempty"`
	Affects     []string `json:"affects,omitempty"`
}

// ParamsKB 是一种格式的参数知识库。参数本身按名索引；分组按前缀（下划线
// 前的首段，如 EK3_SRC1_POSXY → EK3）。
type ParamsKB struct {
	Format  string                    `json:"format"`
	Version int                       `json:"version"`
	Groups  map[string]ParamGroupMeta `json:"groups,omitempty"`
	Params  map[string]ParamMeta      `json:"params"`
}
