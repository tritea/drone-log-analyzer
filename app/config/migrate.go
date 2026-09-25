package appcfg

import (
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sync"
)

var migrateOnce sync.Once

// MigrateConfigDir renames the legacy "APMLogAnalyzer" config directory to the
// current "DroneLogAnalyzer" name exactly once. It is idempotent and must run
// before any service reads config.
func MigrateConfigDir() {
	migrateOnce.Do(func() {
		base, err := os.UserConfigDir()
		if err != nil || base == "" {
			return
		}
		oldDir := filepath.Join(base, legacyConfigDir)
		newDir := filepath.Join(base, configDirName)

		if _, err := os.Stat(newDir); err == nil {
			return // already migrated or fresh install
		}
		if _, err := os.Stat(oldDir); err != nil {
			if !os.IsNotExist(err) {
				log.Printf("appcfg: stat legacy config dir %q failed: %v", oldDir, err)
			}
			return
		}

		if err := copyTree(oldDir, newDir); err != nil {
			log.Printf("appcfg: migrate %q -> %q failed: %v (will use default config)", oldDir, newDir, err)
			return
		}
		log.Printf("appcfg: migrated config %q -> %q", oldDir, newDir)
	})
}

// copyTree recursively copies a directory tree, preserving file modes.
func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)

		if d.IsDir() {
			info, err := d.Info()
			if err != nil {
				return err
			}
			return os.MkdirAll(target, info.Mode().Perm())
		}

		info, err := d.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		return copyFileContents(path, target, info.Mode().Perm())
	})
}

// copyFileContents copies a single regular file, truncating the destination.
func copyFileContents(src, dst string, perm os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, perm)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
