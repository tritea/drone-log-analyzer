package logservice

import (
	"encoding/json"
	"math"
)

type LoadRequest struct {
	Path string `json:"path"`
}

type StatusResponse struct {
	Loaded   bool   `json:"loaded"`
	FileName string `json:"fileName"`
}

type SummaryResponse struct {
	Filename        string  `json:"filename"`
	FileSizeKB      float64 `json:"fileSizeKB"`
	VehicleType     string  `json:"vehicleType"`
	FirmwareVersion string  `json:"firmwareVersion"`
	FirmwareHash    string  `json:"firmwareHash"`
	HardwareType    string  `json:"hardwareType"`
	FreeRAM         int     `json:"freeRAM"`
	DurationSecs    float64 `json:"durationSecs"`
	TotalLines      int     `json:"totalLines"`
	Frame           string  `json:"frame"`
	Airframe        string  `json:"airframe"`
	TypeCount       int     `json:"typeCount"`
	StartUnixSecs   int64   `json:"startUnixSecs"`
	HasUTC          bool    `json:"hasUTC"`
	Format          string  `json:"format"`
}

type TypeInfo struct {
	Name    string   `json:"name"`
	Fields  []string `json:"fields"`
	Count   int      `json:"count"`
	HasData bool     `json:"hasData"`
}

type FieldsRequest struct {
	Type string `json:"type"`
}

type FieldInfo struct {
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	Min       float64 `json:"min"`
	Max       float64 `json:"max"`
	Count     int     `json:"count"`
	IsNumeric bool    `json:"isNumeric"`
}

type CurveDataRequest struct {
	Type  string `json:"type"`
	Field string `json:"field"`
}

type TypeBodyRequest struct {
	Type string `json:"type"`
}

type Parameter struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
}

// finiteJSON 把 float64 渲染为 JSON 安全值。PX4 等固件会把"不适用/未校准"的参数、
// 未用 param 槽位或坐标写成 NaN/±Inf 位模式；Go 的 float64 NaN/±Inf 无法被
// encoding/json 编码（JSON 标准无此概念），Wails IPC 会记 FAT 并导致前端进程退出
// （即"打开某些日志闪退"）。故在 service DTO 边界把非有限值序列化为字符串标签，前端
// 按字符串渲染即可——formatParameterValue / formatCoord 均先 Number.isFinite 守卫。
func finiteJSON(v float64) any {
	switch {
	case math.IsNaN(v):
		return "NaN"
	case math.IsInf(v, 1):
		return "Inf"
	case math.IsInf(v, -1):
		return "-Inf"
	}
	return v
}

// MarshalJSON 保证 Parameter 的 JSON 安全（NaN/±Inf → 字符串标签）。
func (p Parameter) MarshalJSON() ([]byte, error) {
	type paramOut struct {
		Name  string `json:"name"`
		Value any    `json:"value"`
	}
	return json.Marshal(paramOut{Name: p.Name, Value: finiteJSON(p.Value)})
}

type CommandEntry struct {
	TimeMs       float64 `json:"timeMs"`
	CommandTotal int     `json:"commandTotal"`
	Sequence     int     `json:"sequence"`
	Command      int     `json:"command"`
	CommandName  string  `json:"commandName"`
	Param1       float64 `json:"param1"`
	Param2       float64 `json:"param2"`
	Param3       float64 `json:"param3"`
	Param4       float64 `json:"param4"`
	Latitude     float64 `json:"latitude"`
	Longitude    float64 `json:"longitude"`
	Altitude     float64 `json:"altitude"`
	Frame        int     `json:"frame"`
	FrameName    string  `json:"frameName"`
}

// MarshalJSON 保证 CommandEntry 的 JSON 安全（航点命令的 param/坐标同样可能 NaN/±Inf）。
func (c CommandEntry) MarshalJSON() ([]byte, error) {
	type out struct {
		TimeMs       any    `json:"timeMs"`
		CommandTotal int    `json:"commandTotal"`
		Sequence     int    `json:"sequence"`
		Command      int    `json:"command"`
		CommandName  string `json:"commandName"`
		Param1       any    `json:"param1"`
		Param2       any    `json:"param2"`
		Param3       any    `json:"param3"`
		Param4       any    `json:"param4"`
		Latitude     any    `json:"latitude"`
		Longitude    any    `json:"longitude"`
		Altitude     any    `json:"altitude"`
		Frame        int    `json:"frame"`
		FrameName    string `json:"frameName"`
	}
	return json.Marshal(out{
		TimeMs:       finiteJSON(c.TimeMs),
		CommandTotal: c.CommandTotal,
		Sequence:     c.Sequence,
		Command:      c.Command,
		CommandName:  c.CommandName,
		Param1:       finiteJSON(c.Param1),
		Param2:       finiteJSON(c.Param2),
		Param3:       finiteJSON(c.Param3),
		Param4:       finiteJSON(c.Param4),
		Latitude:     finiteJSON(c.Latitude),
		Longitude:    finiteJSON(c.Longitude),
		Altitude:     finiteJSON(c.Altitude),
		Frame:        c.Frame,
		FrameName:    c.FrameName,
	})
}

type MAVLinkCommandEntry struct {
	TimeMs          float64 `json:"timeMs"`
	TargetSystem    int     `json:"targetSystem"`
	TargetComponent int     `json:"targetComponent"`
	SourceSystem    int     `json:"sourceSystem"`
	SourceComponent int     `json:"sourceComponent"`
	Frame           int     `json:"frame"`
	FrameName       string  `json:"frameName"`
	Command         int     `json:"command"`
	CommandName     string  `json:"commandName"`
	Param1          float64 `json:"param1"`
	Param2          float64 `json:"param2"`
	Param3          float64 `json:"param3"`
	Param4          float64 `json:"param4"`
	Latitude        float64 `json:"latitude"`
	Longitude       float64 `json:"longitude"`
	Altitude        float64 `json:"altitude"`
	Result          int     `json:"result"`
	ResultName      string  `json:"resultName"`
	WasCommandLong  bool    `json:"wasCommandLong"`
}

// MarshalJSON 保证 MAVLinkCommandEntry 的 JSON 安全。MAVLink 的未用 param 槽位与
// 不适用坐标常以 NaN/±Inf 位模式出现，必须在此边界 sanitize，否则 Wails IPC 编码失败、
// 前端进程退出（即"MAVLink 列表打开某些日志闪退"）。
func (m MAVLinkCommandEntry) MarshalJSON() ([]byte, error) {
	type out struct {
		TimeMs          any    `json:"timeMs"`
		TargetSystem    int    `json:"targetSystem"`
		TargetComponent int    `json:"targetComponent"`
		SourceSystem    int    `json:"sourceSystem"`
		SourceComponent int    `json:"sourceComponent"`
		Frame           int    `json:"frame"`
		FrameName       string `json:"frameName"`
		Command         int    `json:"command"`
		CommandName     string `json:"commandName"`
		Param1          any    `json:"param1"`
		Param2          any    `json:"param2"`
		Param3          any    `json:"param3"`
		Param4          any    `json:"param4"`
		Latitude        any    `json:"latitude"`
		Longitude       any    `json:"longitude"`
		Altitude        any    `json:"altitude"`
		Result          int    `json:"result"`
		ResultName      string `json:"resultName"`
		WasCommandLong  bool   `json:"wasCommandLong"`
	}
	return json.Marshal(out{
		TimeMs:          finiteJSON(m.TimeMs),
		TargetSystem:    m.TargetSystem,
		TargetComponent: m.TargetComponent,
		SourceSystem:    m.SourceSystem,
		SourceComponent: m.SourceComponent,
		Frame:           m.Frame,
		FrameName:       m.FrameName,
		Command:         m.Command,
		CommandName:     m.CommandName,
		Param1:          finiteJSON(m.Param1),
		Param2:          finiteJSON(m.Param2),
		Param3:          finiteJSON(m.Param3),
		Param4:          finiteJSON(m.Param4),
		Latitude:        finiteJSON(m.Latitude),
		Longitude:       finiteJSON(m.Longitude),
		Altitude:        finiteJSON(m.Altitude),
		Result:          m.Result,
		ResultName:      m.ResultName,
		WasCommandLong:  m.WasCommandLong,
	})
}

type ModeEntry struct {
	Lineno  int     `json:"lineno"`
	TimeMs  float64 `json:"timeMs"`
	Mode    string  `json:"mode"`
	ModeNum int     `json:"modeNum"`
}

type MessageEntry struct {
	Lineno  int     `json:"lineno"`
	TimeMs  float64 `json:"timeMs"`
	Message string  `json:"message"`
}

type ErrorEntry struct {
	Lineno      int     `json:"lineno"`
	TimeMs      float64 `json:"timeMs"`
	Subsys      int     `json:"subsys"`
	ECode       int     `json:"eCode"`
	SubsysName  string  `json:"subsysName"`
	ErrorCode   string  `json:"errorCode"`
	Description string  `json:"description"`
}

type EventEntry struct {
	Lineno int     `json:"lineno"`
	TimeMs float64 `json:"timeMs"`
	Id     int     `json:"id"`
	Name   string  `json:"name"`
}

type BrowseRequest struct {
	Type string `json:"type"`
}

type BrowseResponse struct {
	Type   string               `json:"type"`
	Fields []string             `json:"fields"`
	Data   map[string][]float64 `json:"data"`
}

type LogDefsResponse struct {
	Format            string                 `json:"format"`
	EventNames        map[int]string         `json:"eventNames,omitempty"`
	ErrorSubsystems   map[int]string         `json:"errorSubsystems,omitempty"`
	ErrorCodes        map[int]map[int]string `json:"errorCodes,omitempty"`
	GeneralErrorCodes map[int]string         `json:"generalErrorCodes,omitempty"`
	NavStateNames     map[int]string         `json:"navStateNames,omitempty"`
	Units             map[string]string      `json:"units"`
}
