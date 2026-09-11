package knowledge

import (
	"embed"
	"encoding/json"
	"fmt"
	"maps"
	"strings"
	"sync"

	"drone-log-analyzer/app/modules/parser"
)

//go:embed formats/*.json
var formatFiles embed.FS

var (
	loadOnce sync.Once
	loaded   map[string]*FormatKB
	paramKBs map[string]*ParamsKB
	loadErr  error
)

// ForFormat 返回指定日志格式的字段知识库；无对应文件时返回空库（非 nil），
// 调用方据此降级为"无知识库元信息"。
func ForFormat(format string) *FormatKB {
	loadOnce.Do(loadFormats)
	if loaded == nil {
		return &FormatKB{Format: format, Groups: map[string]*GroupMeta{}}
	}
	if kb, ok := loaded[format]; ok {
		return kb
	}
	return &FormatKB{Format: format, Groups: map[string]*GroupMeta{}}
}

// ForParams 返回指定格式的参数知识库。tlog 的参数命名跟随固件（ArduPilot
// 或 PX4），加载时合并两者（apm 优先，字段缺失由 ulog 补）。
func ForParams(format string) *ParamsKB {
	loadOnce.Do(loadFormats)
	if paramKBs == nil {
		return &ParamsKB{Format: format, Params: map[string]ParamMeta{}}
	}
	if kb, ok := paramKBs[format]; ok {
		return kb
	}
	return &ParamsKB{Format: format, Params: map[string]ParamMeta{}}
}

func loadFormats() {
	loaded = map[string]*FormatKB{}
	paramKBs = map[string]*ParamsKB{}
	entries, err := formatFiles.ReadDir("formats")
	if err != nil {
		loadErr = fmt.Errorf("read embedded knowledge formats: %w", err)
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		data, err := formatFiles.ReadFile("formats/" + e.Name())
		if err != nil {
			loadErr = fmt.Errorf("read %s: %w", e.Name(), err)
			return
		}
		if strings.HasSuffix(e.Name(), "-params.json") {
			var pkb ParamsKB
			if err := json.Unmarshal(data, &pkb); err != nil {
				loadErr = fmt.Errorf("parse %s: %w", e.Name(), err)
				return
			}
			if pkb.Params == nil {
				pkb.Params = map[string]ParamMeta{}
			}
			paramKBs[pkb.Format] = &pkb
			continue
		}
		var kb FormatKB
		if err := json.Unmarshal(data, &kb); err != nil {
			loadErr = fmt.Errorf("parse %s: %w", e.Name(), err)
			return
		}
		if kb.Groups == nil {
			kb.Groups = map[string]*GroupMeta{}
		}
		loaded[kb.Format] = &kb
	}
	mergeTlogParams()
}

// mergeTlogParams 把 apm 与 ulog 的参数库合并为 tlog 版（apm 优先）。
func mergeTlogParams() {
	apm, okA := paramKBs["apm"]
	ulog, okU := paramKBs["ulog"]
	if !okA && !okU {
		return
	}
	merged := &ParamsKB{Format: "tlog", Version: 1, Params: map[string]ParamMeta{}, Groups: map[string]ParamGroupMeta{}}
	for _, src := range []*ParamsKB{ulog, apm} { // apm 后写覆盖优先
		if src == nil {
			continue
		}
		maps.Copy(merged.Params, src.Params)
		for k, v := range src.Groups {
			if _, exists := merged.Groups[k]; !exists {
				merged.Groups[k] = v
			}
		}
	}
	paramKBs["tlog"] = merged
}

// LoadError 返回知识库加载错误（正常为 nil）。文件损坏时让调用方能感知，
// 而不是静默降级成空库。
func LoadError() error {
	loadOnce.Do(loadFormats)
	return loadErr
}

// Group 按 group 名查条目：先精确匹配，未命中则去掉尾部实例数字回退
// （BARO2 → BARO）。返回 nil 表示知识库不认识该 group。
func (kb *FormatKB) Group(name string) *GroupMeta {
	if kb == nil {
		return nil
	}
	if gm, ok := kb.Groups[name]; ok {
		return gm
	}
	if gm, ok := kb.Groups[parser.BaseTypeName(name)]; ok {
		return gm
	}
	return nil
}

// Field 按 group+字段名查元信息。第二返回值 false 表示无条目（字段仍可能
// 存在于日志中，只是知识库没覆盖）。
func (kb *FormatKB) Field(group, field string) (FieldMeta, bool) {
	gm := kb.Group(group)
	if gm == nil {
		return FieldMeta{}, false
	}
	fm, ok := gm.Fields[field]
	return fm, ok
}

// ParamGroup 返回参数名的前缀分组（下划线前首段，如 EK3_SRC1_POSXY → EK3）。
func ParamGroup(name string) string {
	if i := strings.IndexByte(name, '_'); i > 0 {
		return name[:i]
	}
	return name
}

// Lookup 查参数元信息。机型过滤由调用方用 Applies(pm.AppliesTo, class) 做。
func (kb *ParamsKB) Lookup(name string) (ParamMeta, bool) {
	if kb == nil {
		return ParamMeta{}, false
	}
	pm, ok := kb.Params[name]
	return pm, ok
}

// ParamGroupMeta 查前缀分组的作用知识。
func (kb *ParamsKB) ParamGroupMeta(prefix string) (ParamGroupMeta, bool) {
	if kb == nil {
		return ParamGroupMeta{}, false
	}
	gm, ok := kb.Groups[prefix]
	return gm, ok
}
