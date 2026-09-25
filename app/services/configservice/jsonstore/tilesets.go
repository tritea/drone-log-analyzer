package jsonstore

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"drone-log-analyzer/app/services/configservice"
)

func (s *service) ListTilesets(ctx context.Context) (*configservice.TilesetsResponse, error) {
	var tilesets []configservice.Tileset
	if err := loadConfig(tilesetsFileName, &tilesets); err != nil {
		return nil, err
	}
	for i := range tilesets {
		tilesets[i] = cleanTileset(tilesets[i])
	}
	sortTilesets(tilesets)
	s.rebuildTilesetDirs(tilesets)
	return &configservice.TilesetsResponse{
		Tilesets: tilesets,
		Path:     configPath(tilesetsFileName),
	}, nil
}

func (s *service) SaveTileset(ctx context.Context, req configservice.Tileset) (*configservice.TilesetsResponse, error) {
	req.Name = strings.TrimSpace(req.Name)
	if err := validateTilesetName(req.Name); err != nil {
		return nil, err
	}
	req.Dir = strings.TrimSpace(req.Dir)
	req.Url = strings.TrimSpace(req.Url)
	if req.Dir == "" && req.Url == "" {
		return nil, fmt.Errorf("%w: dir or url is required", configservice.ErrTilesetNameInvalid)
	}
	req = cleanTileset(req)

	var tilesets []configservice.Tileset
	if err := loadConfig(tilesetsFileName, &tilesets); err != nil {
		return nil, err
	}

	now := time.Now().Format(time.RFC3339)
	found := false
	for i := range tilesets {
		if tilesets[i].Name == req.Name {
			req.CreatedAt = tilesets[i].CreatedAt
			req.UpdatedAt = now
			if req.CreatedAt == "" {
				req.CreatedAt = now
			}
			tilesets[i] = req
			found = true
			break
		}
	}
	if !found {
		req.CreatedAt = now
		req.UpdatedAt = now
		tilesets = append(tilesets, req)
	}

	if err := saveConfig(tilesetsFileName, tilesets); err != nil {
		return nil, err
	}
	sortTilesets(tilesets)
	s.rebuildTilesetDirs(tilesets)
	return &configservice.TilesetsResponse{
		Tilesets:     tilesets,
		Path:         configPath(tilesetsFileName),
		SavedTileset: req.Name,
	}, nil
}

func (s *service) DeleteTileset(ctx context.Context, req configservice.DeleteTilesetRequest) (*configservice.TilesetsResponse, error) {
	name := strings.TrimSpace(req.Name)
	if err := validateTilesetName(name); err != nil {
		return nil, err
	}
	var tilesets []configservice.Tileset
	if err := loadConfig(tilesetsFileName, &tilesets); err != nil {
		return nil, err
	}
	next := tilesets[:0]
	found := false
	for _, t := range tilesets {
		if t.Name == name {
			found = true
			continue
		}
		next = append(next, t)
	}
	if !found {
		return nil, fmt.Errorf("%w: %s", configservice.ErrTilesetNotFound, name)
	}
	if err := saveConfig(tilesetsFileName, next); err != nil {
		return nil, err
	}
	s.rebuildTilesetDirs(next)
	return &configservice.TilesetsResponse{
		Tilesets: next,
		Path:     configPath(tilesetsFileName),
	}, nil
}

// ResolveTilesetDir maps a tileset name to its on-disk root directory. The
// name→dir cache is rebuilt from disk on first access and refreshed on every
// List/Save/Delete, so the HTTP hot path never re-reads the JSON file.
func (s *service) ResolveTilesetDir(ctx context.Context, name string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tilesetDirs == nil {
		var tilesets []configservice.Tileset
		if err := loadConfig(tilesetsFileName, &tilesets); err == nil {
			s.tilesetDirs = make(map[string]string, len(tilesets))
			for _, t := range tilesets {
				if t.Dir != "" {
					s.tilesetDirs[t.Name] = t.Dir
				}
			}
		}
	}
	dir, ok := s.tilesetDirs[name]
	return dir, ok && dir != ""
}

// rebuildTilesetDirs refreshes the in-memory name→dir cache. Caller must NOT
// hold s.mu (this method acquires it).
func (s *service) rebuildTilesetDirs(tilesets []configservice.Tileset) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tilesetDirs == nil {
		s.tilesetDirs = make(map[string]string, len(tilesets))
	} else {
		for k := range s.tilesetDirs {
			delete(s.tilesetDirs, k)
		}
	}
	for _, t := range tilesets {
		if t.Dir != "" {
			s.tilesetDirs[t.Name] = t.Dir
		}
	}
}

func cleanTileset(t configservice.Tileset) configservice.Tileset {
	t.Name = strings.TrimSpace(t.Name)
	t.Dir = strings.TrimSpace(t.Dir)
	t.Url = strings.TrimSpace(t.Url)
	if t.Scale == 0 {
		t.Scale = 1
	}
	return t
}

func validateTilesetName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("%w: name is required", configservice.ErrTilesetNameInvalid)
	}
	if len([]rune(name)) > 48 {
		return fmt.Errorf("%w: name must be 48 characters or fewer", configservice.ErrTilesetNameInvalid)
	}
	// Name doubles as the URL :id segment, so it must be path-safe.
	if strings.ContainsAny(name, "\x00\r\n/\\") {
		return fmt.Errorf("%w: name contains invalid characters", configservice.ErrTilesetNameInvalid)
	}
	return nil
}

func sortTilesets(tilesets []configservice.Tileset) {
	sort.Slice(tilesets, func(i, j int) bool {
		return strings.ToLower(tilesets[i].Name) < strings.ToLower(tilesets[j].Name)
	})
}
