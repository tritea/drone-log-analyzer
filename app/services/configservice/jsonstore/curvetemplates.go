package jsonstore

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"drone-log-analyzer/app/services/configservice"
)

func (s *service) ListFieldEntries(ctx context.Context) (*configservice.FieldEntriesResponse, error) {
	format := s.currentFormat()
	var templates []configservice.FieldEntry
	if err := loadConfigForFormat(format, fieldEntriesBase, &templates); err != nil {
		return nil, err
	}
	for i := range templates {
		templates[i] = cleanFieldEntry(templates[i])
	}
	sortFieldEntries(templates)
	return &configservice.FieldEntriesResponse{
		Entries: templates,
		Path:    configPath(configFileName(format, fieldEntriesBase)),
	}, nil
}

func (s *service) SaveFieldEntry(ctx context.Context, req configservice.FieldEntry) (*configservice.FieldEntriesResponse, error) {
	req.Name = strings.TrimSpace(req.Name)
	if err := validateFieldEntryName(req.Name); err != nil {
		return nil, err
	}
	req = cleanFieldEntry(req)
	if len(req.Curves) == 0 {
		return nil, fmt.Errorf("field entry must contain at least one curve")
	}

	var templates []configservice.FieldEntry
	if err := loadConfigForFormat(s.currentFormat(), fieldEntriesBase, &templates); err != nil {
		return nil, err
	}

	now := time.Now().Format(time.RFC3339)
	found := false
	for i := range templates {
		if templates[i].Name == req.Name {
			req.CreatedAt = templates[i].CreatedAt
			req.UpdatedAt = now
			if req.CreatedAt == "" {
				req.CreatedAt = now
			}
			templates[i] = req
			found = true
			break
		}
	}
	if !found {
		req.CreatedAt = now
		req.UpdatedAt = now
		templates = append(templates, req)
	}

	if err := saveConfigForFormat(s.currentFormat(), fieldEntriesBase, templates); err != nil {
		return nil, err
	}
	return &configservice.FieldEntriesResponse{
		Entries:    templates,
		Path:       configPath(configFileName(s.currentFormat(), fieldEntriesBase)),
		SavedEntry: req.Name,
	}, nil
}

func (s *service) DeleteFieldEntry(ctx context.Context, req configservice.DeleteFieldEntryRequest) (*configservice.FieldEntriesResponse, error) {
	name := strings.TrimSpace(req.Name)
	if err := validateFieldEntryName(name); err != nil {
		return nil, err
	}
	var templates []configservice.FieldEntry
	if err := loadConfigForFormat(s.currentFormat(), fieldEntriesBase, &templates); err != nil {
		return nil, err
	}
	next := templates[:0]
	found := false
	for _, tmpl := range templates {
		if tmpl.Name == name {
			found = true
			continue
		}
		next = append(next, tmpl)
	}
	if !found {
		return nil, fmt.Errorf("%w: %s", configservice.ErrFieldEntryNotFound, name)
	}
	if err := saveConfigForFormat(s.currentFormat(), fieldEntriesBase, next); err != nil {
		return nil, err
	}
	return &configservice.FieldEntriesResponse{
		Entries: next,
		Path:    configPath(configFileName(s.currentFormat(), fieldEntriesBase)),
	}, nil
}

func cleanFieldCurves(curves []configservice.FieldCurve) []configservice.FieldCurve {
	cleaned := make([]configservice.FieldCurve, 0, len(curves))
	seen := map[string]bool{}
	for _, c := range curves {
		c.Type = strings.TrimSpace(c.Type)
		c.Field = strings.TrimSpace(c.Field)
		if c.Type == "" || c.Field == "" {
			continue
		}
		key := c.Type + "\x00" + c.Field
		if seen[key] {
			continue
		}
		seen[key] = true
		if c.Scale == 0 && c.ScaleInput == "" {
			c.Scale = 1
		}
		c.ScaleInput = defaultInput(c.ScaleInput, c.Scale)
		c.OffsetInput = defaultInput(c.OffsetInput, c.Offset)
		cleaned = append(cleaned, c)
	}
	return cleaned
}

func cleanFieldEntry(tmpl configservice.FieldEntry) configservice.FieldEntry {
	tmpl.Curves = cleanFieldCurves(tmpl.Curves)
	if tmpl.Scale == 0 && tmpl.ScaleInput == "" {
		tmpl.Scale = 1
	}
	tmpl.ScaleInput = defaultInput(tmpl.ScaleInput, tmpl.Scale)
	tmpl.OffsetInput = defaultInput(tmpl.OffsetInput, tmpl.Offset)
	return tmpl
}

func validateFieldEntryName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("%w: name is required", configservice.ErrFieldEntryNameInvalid)
	}
	if len([]rune(name)) > 48 {
		return fmt.Errorf("%w: name must be 48 characters or fewer", configservice.ErrFieldEntryNameInvalid)
	}
	if strings.ContainsAny(name, "\x00\r\n") {
		return fmt.Errorf("%w: name contains invalid characters", configservice.ErrFieldEntryNameInvalid)
	}
	return nil
}

func sortFieldEntries(templates []configservice.FieldEntry) {
	sort.Slice(templates, func(i, j int) bool {
		return strings.ToLower(templates[i].Name) < strings.ToLower(templates[j].Name)
	})
}
