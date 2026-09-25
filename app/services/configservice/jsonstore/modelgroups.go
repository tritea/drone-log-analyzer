package jsonstore

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"drone-log-analyzer/app/services/configservice"
)

func (s *service) ListModelGroups(ctx context.Context) (*configservice.ModelGroupsResponse, error) {
	var groups []configservice.ModelGroup
	if err := loadConfig(modelGroupsFileName, &groups); err != nil {
		return nil, err
	}
	for i := range groups {
		groups[i] = cleanModelGroup(groups[i])
	}
	sortModelGroups(groups)
	return &configservice.ModelGroupsResponse{
		Groups: groups,
		Path:   configPath(modelGroupsFileName),
	}, nil
}

func (s *service) SaveModelGroup(ctx context.Context, req configservice.ModelGroup) (*configservice.ModelGroupsResponse, error) {
	req.Name = strings.TrimSpace(req.Name)
	if err := validateModelGroupName(req.Name); err != nil {
		return nil, err
	}
	req = cleanModelGroup(req)

	var groups []configservice.ModelGroup
	if err := loadConfig(modelGroupsFileName, &groups); err != nil {
		return nil, err
	}

	now := time.Now().Format(time.RFC3339)
	found := false
	for i := range groups {
		if groups[i].Name == req.Name {
			req.CreatedAt = groups[i].CreatedAt
			req.UpdatedAt = now
			if req.CreatedAt == "" {
				req.CreatedAt = now
			}
			groups[i] = req
			found = true
			break
		}
	}
	if !found {
		req.CreatedAt = now
		req.UpdatedAt = now
		groups = append(groups, req)
	}

	if err := saveConfig(modelGroupsFileName, groups); err != nil {
		return nil, err
	}
	return &configservice.ModelGroupsResponse{
		Groups:     groups,
		Path:       configPath(modelGroupsFileName),
		SavedGroup: req.Name,
	}, nil
}

func (s *service) DeleteModelGroup(ctx context.Context, req configservice.DeleteModelGroupRequest) (*configservice.ModelGroupsResponse, error) {
	name := strings.TrimSpace(req.Name)
	if err := validateModelGroupName(name); err != nil {
		return nil, err
	}
	var groups []configservice.ModelGroup
	if err := loadConfig(modelGroupsFileName, &groups); err != nil {
		return nil, err
	}
	next := groups[:0]
	found := false
	for _, g := range groups {
		if g.Name == name {
			found = true
			continue
		}
		next = append(next, g)
	}
	if !found {
		return nil, fmt.Errorf("%w: %s", configservice.ErrModelGroupNotFound, name)
	}
	if err := saveConfig(modelGroupsFileName, next); err != nil {
		return nil, err
	}
	return &configservice.ModelGroupsResponse{
		Groups: next,
		Path:   configPath(modelGroupsFileName),
	}, nil
}

func cleanModelGroup(g configservice.ModelGroup) configservice.ModelGroup {
	g.Name = strings.TrimSpace(g.Name)
	if g.Rows < 1 {
		g.Rows = 1
	}
	if g.Cols < 1 {
		g.Cols = 1
	}
	if g.Spacing <= 0 {
		g.Spacing = 10
	}
	if g.Scale == 0 {
		g.Scale = 1
	}
	cleaned := make([]configservice.ModelGroupTile, 0, len(g.Tiles))
	seen := make(map[[2]int]bool)
	for _, t := range g.Tiles {
		t.File = strings.TrimSpace(t.File)
		if t.Row < 0 || t.Row >= g.Rows || t.Col < 0 || t.Col >= g.Cols {
			continue
		}
		if t.File == "" {
			continue
		}
		key := [2]int{t.Row, t.Col}
		if seen[key] {
			continue
		}
		seen[key] = true
		cleaned = append(cleaned, t)
	}
	g.Tiles = cleaned
	return g
}

func validateModelGroupName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("%w: name is required", configservice.ErrModelGroupNameInvalid)
	}
	if len([]rune(name)) > 48 {
		return fmt.Errorf("%w: name must be 48 characters or fewer", configservice.ErrModelGroupNameInvalid)
	}
	if strings.ContainsAny(name, "\x00\r\n#") {
		return fmt.Errorf("%w: name contains invalid characters", configservice.ErrModelGroupNameInvalid)
	}
	if strings.HasPrefix(name, "__grp_") {
		return fmt.Errorf("%w: name must not start with '__grp_'", configservice.ErrModelGroupNameInvalid)
	}
	return nil
}

func sortModelGroups(groups []configservice.ModelGroup) {
	sort.Slice(groups, func(i, j int) bool {
		return strings.ToLower(groups[i].Name) < strings.ToLower(groups[j].Name)
	})
}
