package parser

// LogSummary holds the high-level metadata extracted from a parsed log: vehicle,
// firmware, timing, and size. It is the public face of a LogFile.
type LogSummary struct {
	Filename        string
	FileSizeKB      float64
	VehicleType     string
	FirmwareVersion string
	FirmwareHash    string
	HardwareType    string
	FreeRAM         int
	DurationSecs    float64
	TotalLines      int
	Frame           string
	StartUnixSecs   int64
	HasUTC          bool
	Format          string
	Airframe        string
}

// ModeChange is a single flight-mode transition at a given time.
type ModeChange struct {
	Mode    string
	ModeNum int
	TimeMs  float64
}

// MissionCommand is one row of the mission command list (CMD messages).
type MissionCommand struct {
	TimeMs       float64
	CommandTotal int
	Sequence     int
	Command      int
	Param1       float64
	Param2       float64
	Param3       float64
	Param4       float64
	Latitude     float64
	Longitude    float64
	Altitude     float64
	Frame        int
}

// MAVLinkCommand is one observed MAVLink command with its acknowledgement.
type MAVLinkCommand struct {
	TimeMs          float64
	TargetSystem    int
	TargetComponent int
	SourceSystem    int
	SourceComponent int
	Frame           int
	Command         int
	Param1          float64
	Param2          float64
	Param3          float64
	Param4          float64
	Latitude        float64
	Longitude       float64
	Altitude        float64
	Result          int
	WasCommandLong  bool
}

// LogError is one ERR row: which subsystem flagged which code, and when.
type LogError struct {
	TimeMs float64
	Subsys int
	ECode  int
	Lineno int
}

// LogEvent is one EV row: an event id fired at a given time.
type LogEvent struct {
	TimeMs float64
	Id     int
	Lineno int
}
