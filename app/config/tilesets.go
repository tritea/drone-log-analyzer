package appcfg

import (
	"fmt"
	"os"
	"path/filepath"
)

// SaveImportedTileset copies a 3D Tiles directory tree into TilesetDir under a
// non-colliding subdirectory name. The whole tree is copied verbatim so the
// relative-path references inside tileset.json remain valid.
func SaveImportedTileset(srcDir string) (string, error) {
	srcDir = filepath.Clean(srcDir)
	base := TilesetDir()
	if err := os.MkdirAll(base, 0o755); err != nil {
		return "", fmt.Errorf("create tileset dir: %w", err)
	}
	name := nonCollidingName(base, filepath.Base(srcDir))
	dst := filepath.Join(base, name)
	if err := copyTree(srcDir, dst); err != nil {
		return "", fmt.Errorf("copy tileset tree: %w", err)
	}
	return dst, nil
}
