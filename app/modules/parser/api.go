package parser

// NewLogFile constructs an empty LogFile ready for a format backend to populate.
func NewLogFile(filename, format string) *LogFile {
	return &LogFile{
		Summary: LogSummary{
			Filename: filename,
			Format:   format,
		},
		Formats:       make(map[uint8]*FormatDef),
		FormatsByName: make(map[string]*FormatDef),
		Parameters:    make(map[string]float64),
		Messages:      make(map[int]string),
		MessageTimes:  make(map[int]float64),
		ModeChanges:   make(map[int]ModeChange),
		Curves:        make(map[string]map[string]*CurveData),
	}
}

// SetFileSizeKB records the source file size into the summary.
func (lf *LogFile) SetFileSizeKB(kb float64) { lf.Summary.FileSizeKB = kb }

// SetTimeBase locks the UTC epoch for the log (first caller wins).
func (lf *LogFile) SetTimeBase(baseMs float64) { lf.lockEpoch(baseMs) }

// HasTimeBase reports whether a UTC epoch has been locked.
func (lf *LogFile) HasTimeBase() bool { return lf.epochLocked }

// TimeBaseMs returns the locked UTC epoch in milliseconds.
func (lf *LogFile) TimeBaseMs() float64 { return lf.epochMs }

// AccumStore ingests one binary message instance into the curve accumulator.
func (lf *LogFile) AccumStore(msgName string, fd *FormatDef, instance string, msgData []byte, timeMs float64) {
	lf.ingestBinaryRow(msgName, fd, instance, msgData, timeMs)
}

// EnsureCurves makes sure the message type has curve slots allocated.
func (lf *LogFile) EnsureCurves(msgName string, fd *FormatDef, instance string) {
	lf.initCurves(msgName, fd, instance)
}

// StoreTextCurveValues ingests one text-parsed message instance into its curves.
func (lf *LogFile) StoreTextCurveValues(msgName string, fd *FormatDef, values []any, timeMs float64, lineno int, instance string) {
	lf.ingestTextRow(msgName, fd, values, timeMs, lineno, instance)
}

// AddParameter records (or overwrites) a named parameter value.
func (lf *LogFile) AddParameter(name string, v float64) { lf.Parameters[name] = v }

// AddMessage records a text message with its timestamp.
func (lf *LogFile) AddMessage(lineno int, msg string, timeMs float64) {
	if lf.MessageTimes == nil {
		lf.MessageTimes = make(map[int]float64)
	}
	lf.Messages[lineno] = msg
	lf.MessageTimes[lineno] = timeMs
}

// AddError appends an error row.
func (lf *LogFile) AddError(e LogError) { lf.Errors = append(lf.Errors, e) }

// AddEvent appends an event row.
func (lf *LogFile) AddEvent(e LogEvent) { lf.Events = append(lf.Events, e) }

// AddModeChange records a flight-mode transition keyed by source line.
func (lf *LogFile) AddModeChange(lineno int, m ModeChange) { lf.ModeChanges[lineno] = m }

// AppendCommand appends a mission command row.
func (lf *LogFile) AppendCommand(c MissionCommand) { lf.Commands = append(lf.Commands, c) }

// AppendMAVLinkCommand appends a MAVLink command and returns its index so the
// caller can later attach its acknowledgement result.
func (lf *LogFile) AppendMAVLinkCommand(c MAVLinkCommand) int {
	lf.MAVLinkCommands = append(lf.MAVLinkCommands, c)
	return len(lf.MAVLinkCommands) - 1
}

// SetMAVLinkCommandResult stamps the result of a previously appended command.
func (lf *LogFile) SetMAVLinkCommandResult(idx, result int) {
	if idx < 0 || idx >= len(lf.MAVLinkCommands) {
		return
	}
	lf.MAVLinkCommands[idx].Result = result
}

// ComputeDuration derives the flight duration from the given candidate topics.
func (lf *LogFile) ComputeDuration(topics []string) { lf.deriveDuration(topics) }

// Finalize packs all curves into type bodies and gathers seen types. Must be
// called once after the format backend finishes streaming records.
func (lf *LogFile) Finalize() {
	lf.gatherSeenTypes()
	lf.freezeAllCurves()
}
