package appcfg

import (
	"os"
	"path/filepath"
)

const (
	configDirName   = "DroneLogAnalyzer"
	legacyConfigDir = "APMLogAnalyzer"
)

// UserConfigDir returns the per-user config directory for the app,
// falling back to the current directory when the OS provides none.
func UserConfigDir() string {
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		return "."
	}
	return filepath.Join(base, configDirName)
}

// ConfigPath joins a config file name onto the user config directory.
func ConfigPath(filename string) string {
	return filepath.Join(UserConfigDir(), filename)
}

// CacheDir is the on-disk tile cache location: beside the executable when
// available, otherwise inside the user config directory.
func CacheDir() string {
	if exe, err := os.Executable(); err == nil && exe != "" {
		return filepath.Join(filepath.Dir(exe), "db")
	}
	return filepath.Join(UserConfigDir(), "db")
}

// ModelDir is where imported 3D models live (beside the executable when possible).
func ModelDir() string {
	if exe, err := os.Executable(); err == nil && exe != "" {
		return filepath.Join(filepath.Dir(exe), "models")
	}
	return filepath.Join(UserConfigDir(), "models")
}

// TilesetDir is where copied 3D Tiles datasets live (beside the executable when
// possible). Tilesets are normally referenced in place; this is only used when
// the user opts to copy a dataset into the app on import.
func TilesetDir() string {
	if exe, err := os.Executable(); err == nil && exe != "" {
		return filepath.Join(filepath.Dir(exe), "tilesets")
	}
	return filepath.Join(UserConfigDir(), "tilesets")
}
