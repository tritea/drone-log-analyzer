package agent

import (
	"strings"
	"testing"

	"drone-log-analyzer/app/modules/knowledge"
	"drone-log-analyzer/app/services/logservice"
)

// TestFirmwareEcosystem 锁住格式→飞控生态映射：ArduPilot 与 PX4 的枚举/
// 参数语义互不通用，生态锚点写错会系统性误导模型。
func TestFirmwareEcosystem(t *testing.T) {
	if e := firmwareEcosystem("apm"); !strings.Contains(e, "ArduPilot") || strings.Contains(e, "PX4") {
		t.Errorf("apm = %q, want ArduPilot 生态", e)
	}
	if e := firmwareEcosystem("ulog"); !strings.Contains(e, "PX4") || strings.Contains(e, "ArduPilot") {
		t.Errorf("ulog = %q, want PX4 生态", e)
	}
	if e := firmwareEcosystem("tlog"); !strings.Contains(e, "ArduPilot") || !strings.Contains(e, "PX4") {
		t.Errorf("tlog = %q, want ArduPilot/PX4 皆可能", e)
	}
	if e := firmwareEcosystem("nope"); e != "未知格式" {
		t.Errorf("unknown = %q, want 未知格式", e)
	}
}

// TestSystemPromptCarriesEcosystem 系统提示词带生态锚点（格式黑话不注明
// 生态，模型可能拿别家固件的知识解释字段）。
func TestSystemPromptCarriesEcosystem(t *testing.T) {
	sum := &logservice.SummaryResponse{Format: "ulog", VehicleType: "Quadcopter"}
	prompt := buildSystemPrompt(sum, knowledge.Class("Quadcopter", "", ""), "fast")
	if !strings.Contains(prompt, "PX4") {
		t.Errorf("ulog system prompt 缺 PX4 生态锚点")
	}
}
