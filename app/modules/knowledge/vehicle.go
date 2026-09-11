package knowledge

import "strings"

// VehicleClass 是归一化机型类。三种日志格式的 VehicleType/Frame/Airframe
// 取值各异（"Copter"/"multirotor"/"QUADROTOR"...），知识库统一用它做 appliesTo。
type VehicleClass string

const (
	ClassMultirotor VehicleClass = "multirotor"
	ClassFixedWing  VehicleClass = "fixedwing"
	ClassHelicopter VehicleClass = "helicopter"
	ClassVtol       VehicleClass = "vtol"
	ClassRover      VehicleClass = "rover"
	ClassBoat       VehicleClass = "boat"
	ClassSub        VehicleClass = "sub"
	ClassUnknown    VehicleClass = "unknown"
)

// AllClasses 是知识库 JSON 里 appliesTo 允许的机型类全集。
var AllClasses = []string{
	string(ClassMultirotor), string(ClassFixedWing), string(ClassHelicopter),
	string(ClassVtol), string(ClassRover), string(ClassBoat), string(ClassSub),
}

// Class 把 LogSummary 的机型字段归一化为 VehicleClass。
// 优先级 airframe > frame > vehicleType；匹配不到返回 ClassUnknown
// （查询侧对 unknown 不过滤，全量返回）。
func Class(vehicleType, frame, airframe string) VehicleClass {
	for _, s := range []string{airframe, frame, vehicleType} {
		if c := matchClass(s); c != ClassUnknown {
			return c
		}
	}
	return ClassUnknown
}

func matchClass(s string) VehicleClass {
	if s == "" {
		return ClassUnknown
	}
	t := strings.ToLower(s)
	// 顺序敏感：QuadPlane/DualHeli 等复合 frame 先判 vtol/helicopter。
	switch {
	case strings.Contains(t, "vtol"), strings.Contains(t, "quadplane"), strings.Contains(t, "tilt"):
		return ClassVtol
	case strings.Contains(t, "heli"):
		return ClassHelicopter
	case strings.Contains(t, "plane"), strings.Contains(t, "fixed"), strings.Contains(t, "fw"):
		return ClassFixedWing
	case strings.Contains(t, "rover"), strings.Contains(t, "crawl"):
		return ClassRover
	case strings.Contains(t, "boat"), strings.Contains(t, "sail"), strings.Contains(t, "motorboat"):
		return ClassBoat
	case strings.Contains(t, "sub"), strings.Contains(t, "diving"):
		return ClassSub
	case strings.Contains(t, "multirotor"), strings.Contains(t, "copter"),
		strings.Contains(t, "quad"), strings.Contains(t, "hexa"), strings.Contains(t, "octo"),
		strings.Contains(t, "tri"), strings.Contains(t, "y6"), strings.Contains(t, "x8"):
		return ClassMultirotor
	}
	return ClassUnknown
}

// Applies 判断 appliesTo 列表是否覆盖该机型。空列表或 unknown 机型 = 全部适用。
func Applies(list []string, class VehicleClass) bool {
	if len(list) == 0 || class == ClassUnknown {
		return true
	}
	for _, c := range list {
		if strings.EqualFold(strings.TrimSpace(c), string(class)) {
			return true
		}
	}
	return false
}

// FilterGroup 返回按机型过滤后的 GroupMeta 拷贝（不改动原条目）：
//   - Group 级 appliesTo 不匹配 → nil
//   - 字段级 appliesTo 不匹配 → 从 Fields 剔除
func FilterGroup(gm *GroupMeta, class VehicleClass) *GroupMeta {
	if gm == nil || !Applies(gm.AppliesTo, class) {
		return nil
	}
	out := &GroupMeta{
		Description:  gm.Description,
		Affects:      gm.Affects,
		AppliesTo:    gm.AppliesTo,
		VehicleNotes: gm.VehicleNotes,
	}
	if len(gm.Fields) == 0 {
		return out
	}
	out.Fields = make(map[string]FieldMeta, len(gm.Fields))
	for name, fm := range gm.Fields {
		if Applies(fm.AppliesTo, class) {
			out.Fields[name] = fm
		}
	}
	return out
}
