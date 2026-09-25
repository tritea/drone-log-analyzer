package maptiles

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// schemaSQL defines the MBTiles-compatible tables and indexes managed by this
// cache. The last_used index drives LRU eviction.
const schemaSQL = `
CREATE TABLE IF NOT EXISTS metadata (name TEXT NOT NULL PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS tiles (
    provider    TEXT    NOT NULL,
    zoom_level  INTEGER NOT NULL,
    tile_column INTEGER NOT NULL,
    tile_row    INTEGER NOT NULL,
    tile_data   BLOB    NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT 0,
    last_used   INTEGER NOT NULL DEFAULT 0,
    use_count   INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (provider, zoom_level, tile_column, tile_row)
);
CREATE INDEX IF NOT EXISTS tiles_last_used_idx ON tiles (last_used);
`

// pragmas tunes SQLite for a single-connection, write-mostly cache workload:
// incremental auto-vacuum, WAL for concurrency, a busy timeout to ride out
// occasional lock contention, and relaxed fsync for throughput.
var pragmas = []string{
	"PRAGMA auto_vacuum=2",
	"PRAGMA journal_mode=WAL",
	"PRAGMA busy_timeout=5000",
	"PRAGMA synchronous=NORMAL",
}

// initDB opens the SQLite database at path, applies pragmas and ensures the
// schema exists. The connection is serialized (MaxOpenConns=1) because the
// cache is single-writer and SQLite serializes anyway.
func initDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open mbtiles %s: %w", path, err)
	}
	db.SetMaxOpenConns(1)

	for _, pragma := range pragmas {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, fmt.Errorf("apply %q: %w", pragma, err)
		}
	}
	if _, err := db.Exec(schemaSQL); err != nil {
		db.Close()
		return nil, fmt.Errorf("init mbtiles schema: %w", err)
	}
	return db, nil
}

// tmsInvertedRow converts a slippy-map y (top-origin) to a TMS row
// (bottom-origin) for the given zoom level, matching the on-disk storage
// convention.
func tmsInvertedRow(z, y int) int64 {
	return (int64(1) << z) - 1 - int64(y)
}
