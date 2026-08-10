package appcfg

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// SaveImportedModel copies a model file into ModelDir under a non-colliding
// name, dragging along a sibling .mtl sidecar when importing an .obj.
func SaveImportedModel(src string) (string, error) {
	dir := ModelDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create model dir: %w", err)
	}
	name := nonCollidingName(dir, filepath.Base(src))
	dst := filepath.Join(dir, name)
	if err := copyFileContents(src, dst, 0o644); err != nil {
		return "", fmt.Errorf("copy model file: %w", err)
	}
	copyMaterialSidecar(src, dir, name)
	return dst, nil
}

// nonCollidingName appends _1, _2, … until name is free in dir.
func nonCollidingName(dir, name string) string {
	if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
		return name
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s_%d%s", stem, i, ext)
		if _, err := os.Stat(filepath.Join(dir, candidate)); err != nil {
			return candidate
		}
	}
}

// copyMaterialSidecar copies a .obj's sibling .mtl next to the copied model.
func copyMaterialSidecar(srcObj, dir, dstObjName string) {
	if strings.ToLower(filepath.Ext(srcObj)) != ".obj" {
		return
	}
	srcMtl := strings.TrimSuffix(srcObj, filepath.Ext(srcObj)) + ".mtl"
	if _, err := os.Stat(srcMtl); err != nil {
		return
	}
	dstMtl := strings.TrimSuffix(dstObjName, filepath.Ext(dstObjName)) + ".mtl"
	if err := copyFileContents(srcMtl, filepath.Join(dir, dstMtl), 0o644); err != nil {
		log.Printf("appcfg: copy sibling mtl %q failed: %v", srcMtl, err)
	}
}
