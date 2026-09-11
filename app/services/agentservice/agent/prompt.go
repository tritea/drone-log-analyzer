package agent

import (
	"fmt"
	"strings"

	"drone-log-analyzer/app/modules/knowledge"
	"drone-log-analyzer/app/services/logservice"
)

// buildSystemPrompt 组装系统提示词：注入"系统层级"的日志上下文（格式/机型/
// 固件/时长）与工具使用套路。每轮 Chat 按当前日志重建（切换日志后立即生效）。
func buildSystemPrompt(sum *logservice.SummaryResponse, class knowledge.VehicleClass) string {
	var b strings.Builder
	b.WriteString("你是飞控日志分析助手，通过工具读取当前加载的飞行日志并诊断问题。\n\n")
	b.WriteString("当前日志：\n")
	fmt.Fprintf(&b, "- 日志格式：%s\n", sum.Format)
	fmt.Fprintf(&b, "- 机型：%s（归类：%s）", orNA(sum.VehicleType), string(class))
	if sum.Frame != "" {
		fmt.Fprintf(&b, "，机架 %s", sum.Frame)
	}
	b.WriteByte('\n')
	if sum.FirmwareVersion != "" {
		fmt.Fprintf(&b, "- 固件：%s\n", sum.FirmwareVersion)
	}
	if sum.DurationSecs > 0 {
		fmt.Fprintf(&b, "- 飞行时长：约 %.0f 秒\n", sum.DurationSecs)
	}

	b.WriteString(`
分析流程：
1. 先了解整体概况（含错误/事件计数）。
2. 再列出数据分组并查看字段的含义、单位与参考阈值。
3. 需要数据时按 "分组.字段" 查询时间窗统计（如 GPS.NSats），时间单位秒、相对日志起点。
4. 需要时补充过程记录（错误/事件/模式）与参数背景。

回答规则：
- 用中文回答。
- 引用数据时注明字段名与时间范围（如 "GPS.NSats 在 120~145s 低于 5"）。
- 阈值判定优先依据字段附带的参考阈值；没有阈值依据时明确说明是推断。
- 结论按置信度排序，给出可执行的检查建议；不确定就直说，不要编造数据。
`)
	return b.String()
}

func orNA(s string) string {
	if s == "" {
		return "未知"
	}
	return s
}
