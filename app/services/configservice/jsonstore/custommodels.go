package jsonstore

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"drone-log-analyzer/app/services/configservice"
)

func (s *service) ListCustomModels(ctx context.Context) (*configservice.CustomModelsResponse, error) {
	var models []configservice.CustomModel
	if err := loadConfig(customModelsFileName, &models); err != nil {
		return nil, err
	}
	for i := range models {
		models[i] = cleanCustomModel(models[i])
	}
	sortCustomModels(models)
	return &configservice.CustomModelsResponse{
		Models: models,
		Path:   configPath(customModelsFileName),
	}, nil
}

func (s *service) SaveCustomModel(ctx context.Context, req configservice.CustomModel) (*configservice.CustomModelsResponse, error) {
	req.Name = strings.TrimSpace(req.Name)
	if err := validateCustomModelName(req.Name); err != nil {
		return nil, err
	}
	req.File = strings.TrimSpace(req.File)
	if req.File == "" {
		return nil, fmt.Errorf("%w: file is required", configservice.ErrCustomModelNameInvalid)
	}
	req = cleanCustomModel(req)

	var models []configservice.CustomModel
	if err := loadConfig(customModelsFileName, &models); err != nil {
		return nil, err
	}

	now := time.Now().Format(time.RFC3339)
	found := false
	for i := range models {
		if models[i].Name == req.Name {
			req.CreatedAt = models[i].CreatedAt
			req.UpdatedAt = now
			if req.CreatedAt == "" {
				req.CreatedAt = now
			}
			models[i] = req
			found = true
			break
		}
	}
	if !found {
		req.CreatedAt = now
		req.UpdatedAt = now
		models = append(models, req)
	}

	if err := saveConfig(customModelsFileName, models); err != nil {
		return nil, err
	}
	return &configservice.CustomModelsResponse{
		Models:     models,
		Path:       configPath(customModelsFileName),
		SavedModel: req.Name,
	}, nil
}

func (s *service) DeleteCustomModel(ctx context.Context, req configservice.DeleteCustomModelRequest) (*configservice.CustomModelsResponse, error) {
	name := strings.TrimSpace(req.Name)
	if err := validateCustomModelName(name); err != nil {
		return nil, err
	}
	var models []configservice.CustomModel
	if err := loadConfig(customModelsFileName, &models); err != nil {
		return nil, err
	}
	next := models[:0]
	found := false
	for _, m := range models {
		if m.Name == name {
			found = true
			continue
		}
		next = append(next, m)
	}
	if !found {
		return nil, fmt.Errorf("%w: %s", configservice.ErrCustomModelNotFound, name)
	}
	if err := saveConfig(customModelsFileName, next); err != nil {
		return nil, err
	}
	return &configservice.CustomModelsResponse{
		Models: next,
		Path:   configPath(customModelsFileName),
	}, nil
}

func cleanCustomModel(m configservice.CustomModel) configservice.CustomModel {
	m.Name = strings.TrimSpace(m.Name)
	m.File = strings.TrimSpace(m.File)
	if m.Scale == 0 {
		m.Scale = 1
	}
	return m
}

func validateCustomModelName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("%w: name is required", configservice.ErrCustomModelNameInvalid)
	}
	if len([]rune(name)) > 48 {
		return fmt.Errorf("%w: name must be 48 characters or fewer", configservice.ErrCustomModelNameInvalid)
	}
	if strings.ContainsAny(name, "\x00\r\n") {
		return fmt.Errorf("%w: name contains invalid characters", configservice.ErrCustomModelNameInvalid)
	}
	return nil
}

func sortCustomModels(models []configservice.CustomModel) {
	sort.Slice(models, func(i, j int) bool {
		return strings.ToLower(models[i].Name) < strings.ToLower(models[j].Name)
	})
}
