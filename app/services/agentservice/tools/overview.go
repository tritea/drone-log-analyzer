package tools

import (
	"context"

	"github.com/cloudwego/eino/components/tool"
)

// overviewInput 无参数：概览始终针对当前加载的日志。
type overviewInput struct{}

type overviewOutput struct {
	Format          string  `json:"format"`           // apm / tlog / ulog
	VehicleType     string  `json:"vehicleType"`      // 固件报的机型（如 Copter）
	VehicleClass    string  `json:"vehicleClass"`     // 归一化机型类（multirotor 等）
	Frame           string  `json:"frame,omitempty"`
	Airframe        string  `json:"airframe,omitempty"`
	FirmwareVersion string  `json:"firmwareVersion,omitempty"`
	HardwareType    string  `json:"hardwareType,omitempty"`
	Filename        string  `json:"filename,omitempty"`
	DurationSecs    float64 `json:"durationSecs,omitempty"`
	GroupCount      int     `json:"groupCount"` // 日志内的数据 group 数
	ParameterCount  int     `json:"parameterCount"`
	ErrorCount      int     `json:"errorCount"`
	EventCount      int     `json:"eventCount"`
	ModeChangeCount int     `json:"modeChangeCount"`
}

func overviewTool(deps Deps) (tool.InvokableTool, error) {
	return infer("get_overview",
		"获取当前日志的整体概况：格式、机型、固件、时长、参数量与错误/事件/模式切换计数。"+
			"分析任何问题前先调用它。",
		func(ctx context.Context, _ overviewInput) (overviewOutput, error) {
			var out overviewOutput
			sum, err := deps.Log.Summary(ctx)
			if err != nil {
				return out, err
			}
			out.Format = sum.Format
			out.VehicleType = sum.VehicleType
			out.VehicleClass = string(deps.Class)
			out.Frame = sum.Frame
			out.Airframe = sum.Airframe
			out.FirmwareVersion = sum.FirmwareVersion
			out.HardwareType = sum.HardwareType
			out.Filename = sum.Filename
			out.DurationSecs = sum.DurationSecs

			if types, err := deps.Log.MessageTypes(ctx); err == nil {
				out.GroupCount = len(types)
			}
			if params, err := deps.Log.Parameters(ctx); err == nil {
				out.ParameterCount = len(params)
			}
			if errs, err := deps.Log.Errors(ctx); err == nil {
				out.ErrorCount = len(errs)
			}
			if events, err := deps.Log.Events(ctx); err == nil {
				out.EventCount = len(events)
			}
			if modes, err := deps.Log.ModeChanges(ctx); err == nil {
				out.ModeChangeCount = len(modes)
			}
			return out, nil
		})
}
