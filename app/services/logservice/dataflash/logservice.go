package dataflash

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sort"
	"strings"
	"sync"

	"drone-log-analyzer/app/modules/logdefs"
	logparser "drone-log-analyzer/app/modules/parser"
	"drone-log-analyzer/app/services/logservice"
)

type service struct {
	mu       sync.RWMutex
	log      *logparser.LogFile
	loaded   bool
	fileName string
}

func New() logservice.Service {
	return &service{}
}

func (s *service) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.log != nil {
		s.log.CloseSpool()
	}
	return nil
}

func (s *service) current() (*logparser.LogFile, error) {
	if !s.loaded || s.log == nil {
		return nil, logservice.ErrNoLogLoaded
	}
	return s.log, nil
}

func (s *service) Load(ctx context.Context, req logservice.LoadRequest) (*logservice.SummaryResponse, error) {
	path := req.Path
	if strings.HasPrefix(path, "~") {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, path[1:])
	}

	log, err := logparser.ParseFile(path)
	if err != nil {
		return nil, fmt.Errorf("parse log: %w", err)
	}

	s.mu.Lock()
	if s.log != nil {
		s.log.CloseSpool()
	}
	s.log = log
	s.loaded = true
	s.fileName = path
	s.mu.Unlock()

	runtime.GC()
	debug.FreeOSMemory()

	resp := summarize(log)
	return &resp, nil
}

func (s *service) Status(ctx context.Context) (logservice.StatusResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return logservice.StatusResponse{Loaded: s.loaded, FileName: s.fileName}, nil
}

func (s *service) Summary(ctx context.Context) (*logservice.SummaryResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}
	resp := summarize(lg)
	return &resp, nil
}

func (s *service) MessageTypes(ctx context.Context) ([]logservice.TypeInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}

	types := make([]logservice.TypeInfo, 0)
	for name, curves := range lg.Curves {
		fd, ok := lg.FormatsByName[name]
		if !ok {
			fd, ok = lg.FormatsByName[logparser.BaseTypeName(name)]
		}
		if !ok {
			continue
		}
		count := 0
		for _, cd := range curves {
			count = cd.Count()
			break
		}

		numericFields := make([]string, 0, len(fd.Layout))
		for _, fl := range fd.Layout {
			if fl.InBody {
				numericFields = append(numericFields, fl.Name)
			}
		}

		if len(numericFields) > 0 {
			types = append(types, logservice.TypeInfo{
				Name:   name,
				Fields: numericFields,
				Count:  count,
			})
		}
	}

	sort.Slice(types, func(i, j int) bool { return types[i].Name < types[j].Name })
	return types, nil
}

func (s *service) Fields(ctx context.Context, req logservice.FieldsRequest) ([]logservice.FieldInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}

	fd, ok := lg.FormatsByName[req.Type]
	if !ok {
		fd, ok = lg.FormatsByName[logparser.BaseTypeName(req.Type)]
	}
	if !ok {
		return nil, logservice.ErrTypeNotFound
	}

	fields := make([]logservice.FieldInfo, 0, len(fd.Layout))
	for _, fl := range fd.Layout {
		fi := logservice.FieldInfo{Name: fl.Name, Type: fl.OrigType, IsNumeric: fl.InBody}
		if curves, ok := lg.Curves[req.Type]; ok {
			if cd, ok := curves[fl.Name]; ok {
				fi.Min = cd.Min
				fi.Max = cd.Max
				fi.Count = cd.Count()
			}
		}
		fields = append(fields, fi)
	}
	return fields, nil
}

func (s *service) TypeSchema(ctx context.Context) (map[string]logparser.TypeSchemaEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}
	return lg.TypeSchema(), nil
}

func (s *service) CurveData(ctx context.Context, req logservice.CurveDataRequest) ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}

	curves, ok := lg.Curves[req.Type]
	if !ok {
		return nil, logservice.ErrTypeNotFound
	}
	cd, ok := curves[req.Field]
	if !ok {
		return nil, fmt.Errorf("%w: %s", logservice.ErrTypeNotFound, req.Field)
	}
	return lg.CurveBytes(cd), nil
}

func (s *service) TypeBody(ctx context.Context, req logservice.TypeBodyRequest) ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}
	body := lg.TypeBodyBytes(req.Type)
	if body == nil {
		return nil, logservice.ErrTypeNotFound
	}
	return body, nil
}

func (s *service) Parameters(ctx context.Context) ([]logservice.Parameter, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}
	params := make([]logservice.Parameter, 0, len(lg.Parameters))
	for k, v := range lg.Parameters {
		params = append(params, logservice.Parameter{Name: k, Value: v})
	}
	sort.Slice(params, func(i, j int) bool { return params[i].Name < params[j].Name })
	return params, nil
}

func (s *service) Commands(ctx context.Context) ([]logservice.CommandEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}
	commands := make([]logservice.CommandEntry, 0, len(lg.Commands))
	for _, mc := range lg.Commands {
		commands = append(commands, logservice.CommandEntry{
			TimeMs:       mc.TimeMs,
			CommandTotal: mc.CommandTotal,
			Sequence:     mc.Sequence,
			Command:      mc.Command,
			CommandName:  logdefs.CommandName(mc.Command),
			Param1:       mc.Param1,
			Param2:       mc.Param2,
			Param3:       mc.Param3,
			Param4:       mc.Param4,
			Latitude:     mc.Latitude,
			Longitude:    mc.Longitude,
			Altitude:     mc.Altitude,
			Frame:        mc.Frame,
			FrameName:    logdefs.FrameName(mc.Frame),
		})
	}

	sort.Slice(commands, func(i, j int) bool {
		if commands[i].TimeMs == commands[j].TimeMs {
			return commands[i].Sequence < commands[j].Sequence
		}
		return commands[i].TimeMs < commands[j].TimeMs
	})
	return commands, nil
}

func (s *service) MAVLinkCommands(ctx context.Context) ([]logservice.MAVLinkCommandEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}
	items := make([]logservice.MAVLinkCommandEntry, 0, len(lg.MAVLinkCommands))
	for _, mc := range lg.MAVLinkCommands {
		items = append(items, logservice.MAVLinkCommandEntry{
			TimeMs:          mc.TimeMs,
			TargetSystem:    mc.TargetSystem,
			TargetComponent: mc.TargetComponent,
			SourceSystem:    mc.SourceSystem,
			SourceComponent: mc.SourceComponent,
			Frame:           mc.Frame,
			FrameName:       logdefs.FrameName(mc.Frame),
			Command:         mc.Command,
			CommandName:     logdefs.CommandName(mc.Command),
			Param1:          mc.Param1,
			Param2:          mc.Param2,
			Param3:          mc.Param3,
			Param4:          mc.Param4,
			Latitude:        mc.Latitude,
			Longitude:       mc.Longitude,
			Altitude:        mc.Altitude,
			Result:          mc.Result,
			ResultName:      logdefs.ResultName(mc.Result),
			WasCommandLong:  mc.WasCommandLong,
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].TimeMs < items[j].TimeMs })
	return items, nil
}

func (s *service) ModeChanges(ctx context.Context) ([]logservice.ModeEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}
	modes := make([]logservice.ModeEntry, 0, len(lg.ModeChanges))
	for lineno, mc := range lg.ModeChanges {
		modes = append(modes, logservice.ModeEntry{Lineno: lineno, TimeMs: mc.TimeMs, Mode: mc.Mode, ModeNum: mc.ModeNum})
	}
	sort.Slice(modes, func(i, j int) bool {
		if modes[i].TimeMs == modes[j].TimeMs {
			return modes[i].Lineno < modes[j].Lineno
		}
		return modes[i].TimeMs < modes[j].TimeMs
	})
	return modes, nil
}

func (s *service) Messages(ctx context.Context) ([]logservice.MessageEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}
	msgs := make([]logservice.MessageEntry, 0, len(lg.Messages))
	for lineno, msg := range lg.Messages {
		msgs = append(msgs, logservice.MessageEntry{Lineno: lineno, TimeMs: lg.MessageTimes[lineno], Message: msg})
	}
	sort.Slice(msgs, func(i, j int) bool {
		if msgs[i].TimeMs == msgs[j].TimeMs {
			return msgs[i].Lineno < msgs[j].Lineno
		}
		return msgs[i].TimeMs < msgs[j].TimeMs
	})
	return msgs, nil
}

func (s *service) Errors(ctx context.Context) ([]logservice.ErrorEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}
	errs := make([]logservice.ErrorEntry, 0, len(lg.Errors))
	for _, e := range lg.Errors {
		subName := logdefs.ErrorSubsystemName(e.Subsys)
		codeName := logdefs.ErrorCodeName(e.Subsys, e.ECode)
		desc := codeName
		if desc == "" {
			desc = fmt.Sprintf("#%d", e.ECode)
		}
		errs = append(errs, logservice.ErrorEntry{
			Lineno:      e.Lineno,
			TimeMs:      e.TimeMs,
			Subsys:      e.Subsys,
			ECode:       e.ECode,
			SubsysName:  subName,
			ErrorCode:   codeName,
			Description: desc,
		})
	}
	sort.Slice(errs, func(i, j int) bool {
		if errs[i].TimeMs == errs[j].TimeMs {
			return errs[i].Lineno < errs[j].Lineno
		}
		return errs[i].TimeMs < errs[j].TimeMs
	})
	return errs, nil
}

func (s *service) Events(ctx context.Context) ([]logservice.EventEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}
	events := make([]logservice.EventEntry, 0, len(lg.Events))
	isULog := lg.Summary.Format == "ulog"
	for _, ev := range lg.Events {
		name := ""
		if isULog {

			name = lg.PX4EventNames[ev.Id&0xFFFFFF]
		} else {

			name = logdefs.EventName(ev.Id)
		}
		events = append(events, logservice.EventEntry{
			Lineno: ev.Lineno,
			TimeMs: ev.TimeMs,
			Id:     ev.Id,
			Name:   name,
		})
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].TimeMs == events[j].TimeMs {
			return events[i].Lineno < events[j].Lineno
		}
		return events[i].TimeMs < events[j].TimeMs
	})
	return events, nil
}

func (s *service) Browse(ctx context.Context, req logservice.BrowseRequest) (*logservice.BrowseResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lg, err := s.current()
	if err != nil {
		return nil, err
	}
	fd, ok := lg.FormatsByName[req.Type]
	if !ok {
		fd, ok = lg.FormatsByName[logparser.BaseTypeName(req.Type)]
	}
	if !ok {
		return nil, logservice.ErrTypeNotFound
	}
	data := make(map[string][]float64)
	if curves, ok := lg.Curves[req.Type]; ok {
		for _, fn := range fd.FieldNames {
			if cd, ok := curves[fn]; ok {
				data[fn] = lg.CurveValues(cd)
			}
		}
	}
	return &logservice.BrowseResponse{Type: req.Type, Fields: fd.FieldNames, Data: data}, nil
}

func (s *service) LogDefs(ctx context.Context) (*logservice.LogDefsResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	format := "apm"
	units := map[string]string{}
	if lg, err := s.current(); err == nil {
		format = lg.Summary.Format
		for msgName, fields := range lg.Curves {
			for fn, cd := range fields {
				if cd.Unit != "" {
					units[msgName+"."+fn] = cd.Unit
				}
			}
		}
	}

	resp := &logservice.LogDefsResponse{Format: format, Units: units}
	switch format {
	case "ulog":
		resp.NavStateNames = px4NavStateNames()
	case "tlog":

	default:
		resp.EventNames = logdefs.EventLabels()
		resp.ErrorSubsystems = logdefs.ErrorSubsystemLabels()
		resp.ErrorCodes = logdefs.ErrorCodeLabels()
		resp.GeneralErrorCodes = logdefs.GenericErrorCodeLabels()
	}
	return resp, nil
}

func summarize(lg *logparser.LogFile) logservice.SummaryResponse {

	frame, airframe := lg.Summary.Frame, lg.Summary.Airframe
	switch lg.Summary.Format {
	case "ulog":
		frame, airframe = classifyPX4FromLog(lg)
	case "apm", "":
		airframe = classifyAirframe(lg)
	}
	return logservice.SummaryResponse{
		Filename:        lg.Summary.Filename,
		FileSizeKB:      lg.Summary.FileSizeKB,
		VehicleType:     lg.Summary.VehicleType,
		FirmwareVersion: lg.Summary.FirmwareVersion,
		FirmwareHash:    lg.Summary.FirmwareHash,
		HardwareType:    lg.Summary.HardwareType,
		FreeRAM:         lg.Summary.FreeRAM,
		DurationSecs:    lg.Summary.DurationSecs,
		TotalLines:      lg.Summary.TotalLines,
		Frame:           frame,
		Airframe:        airframe,
		TypeCount:       len(lg.Curves),
		StartUnixSecs:   lg.Summary.StartUnixSecs,
		HasUTC:          lg.Summary.HasUTC,
		Format:          lg.Summary.Format,
	}
}

func classifyAirframe(lg *logparser.LogFile) string {
	if _, ok := lg.Parameters["Q_ENABLE"]; ok {
		return "vtol"
	}
	return "multirotor"
}

func px4NavStateNames() map[int]string {
	return map[int]string{
		0: "MANUAL", 1: "ALTCTL", 2: "POSCTL", 3: "AUTO_MISSION", 4: "AUTO_LOITER",
		5: "AUTO_RTL", 6: "POSITION", 7: "ACRO", 8: "OFFBOARD", 9: "STABILIZED",
		10: "RATTITUDE", 11: "AUTO_TAKEOFF", 12: "AUTO_LAND", 13: "AUTO_FOLLOW_TARGET",
		14: "AUTO_PRECLAND", 15: "ORBIT", 16: "AUTO_VTOL_TAKEOFF", 17: "AUTO_VTOL_LAND",
	}
}
