package maptiles

import (
	"database/sql"
)

// touchEntry is a staged last_used update for a single tile, batched before
// being flushed by persistTouches.
type touchEntry struct {
	provider string
	z, x, y  int
	ts       int64
}

// loadTileRow fetches a tile blob and its creation timestamp. found is false on
// a miss with a nil error.
func loadTileRow(db *sql.DB, provider string, z, x, y int) (data []byte, createdAt int64, found bool, err error) {
	row := tmsInvertedRow(z, y)
	err = db.QueryRow(
		"SELECT tile_data, created_at FROM tiles WHERE provider=? AND zoom_level=? AND tile_column=? AND tile_row=?",
		provider, z, x, row,
	).Scan(&data, &createdAt)
	if err == sql.ErrNoRows {
		return nil, 0, false, nil
	}
	if err != nil {
		return nil, 0, false, err
	}
	return data, createdAt, true, nil
}

// insertTileRow stores a new tile; inserted is false if a row already existed
// (INSERT OR IGNORE).
func insertTileRow(db *sql.DB, provider string, z, x, y int, data []byte, now int64) (inserted bool, err error) {
	res, err := db.Exec(
		"INSERT OR IGNORE INTO tiles (provider, zoom_level, tile_column, tile_row, tile_data, created_at, last_used, use_count) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
		provider, z, x, tmsInvertedRow(z, y), data, now, now,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// replaceTileRow overwrites a tile's blob/timestamps, returning the previous
// blob length. replaced is false if the row did not exist.
func replaceTileRow(db *sql.DB, provider string, z, x, y int, data []byte, now int64) (oldLen int64, replaced bool, err error) {
	row := tmsInvertedRow(z, y)
	scanErr := db.QueryRow(
		"SELECT length(tile_data) FROM tiles WHERE provider=? AND zoom_level=? AND tile_column=? AND tile_row=?",
		provider, z, x, row,
	).Scan(&oldLen)
	if scanErr == sql.ErrNoRows {
		return 0, false, nil
	}
	if scanErr != nil {
		return 0, false, scanErr
	}
	if _, err := db.Exec(
		"UPDATE tiles SET tile_data=?, created_at=?, last_used=? WHERE provider=? AND zoom_level=? AND tile_column=? AND tile_row=?",
		data, now, now, provider, z, x, row,
	); err != nil {
		return 0, false, err
	}
	return oldLen, true, nil
}

// persistTouches applies a batch of last_used updates inside a single
// transaction for throughput.
func persistTouches(db *sql.DB, entries []touchEntry) error {
	if len(entries) == 0 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	for _, e := range entries {
		if _, err := tx.Exec(
			"UPDATE tiles SET last_used=? WHERE provider=? AND zoom_level=? AND tile_column=? AND tile_row=?",
			e.ts, e.provider, e.z, e.x, tmsInvertedRow(e.z, e.y),
		); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// purgeStaleRows deletes every tile with last_used <= cutoff and reports the
// reclaimed footprint per provider (bytes + deleted tile count). One grouped
// aggregate pass instead of a row-by-row scan.
func purgeStaleRows(db *sql.DB, cutoff int64) (map[string]providerStat, error) {
	freed := map[string]providerStat{}

	rows, err := db.Query(
		"SELECT provider, COUNT(*), SUM(length(tile_data)) FROM tiles WHERE last_used<=? GROUP BY provider",
		cutoff,
	)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var provider string
		var stat providerStat
		if err := rows.Scan(&provider, &stat.tiles, &stat.bytes); err != nil {
			rows.Close()
			return nil, err
		}
		freed[provider] = stat
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	if len(freed) == 0 {
		return freed, nil
	}
	if _, err := db.Exec("DELETE FROM tiles WHERE last_used<=?", cutoff); err != nil {
		return nil, err
	}
	return freed, nil
}

// aggregateStats sums cached bytes and tile counts per provider across all
// tiles. It is the single startup scan that seeds the in-memory counters;
// afterwards every write path updates them incrementally.
func aggregateStats(db *sql.DB) (map[string]providerStat, error) {
	out := map[string]providerStat{}

	rows, err := db.Query("SELECT provider, COUNT(*), SUM(length(tile_data)) FROM tiles GROUP BY provider")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var provider string
		var stat providerStat
		if err := rows.Scan(&provider, &stat.tiles, &stat.bytes); err != nil {
			return nil, err
		}
		out[provider] = stat
	}
	return out, rows.Err()
}

// wipeProvider deletes every tile for a provider and reports its freed
// footprint (bytes and tile count).
func wipeProvider(db *sql.DB, provider string) (providerStat, error) {
	var stat providerStat
	err := db.QueryRow(
		"SELECT COUNT(*), COALESCE(SUM(length(tile_data)), 0) FROM tiles WHERE provider=?", provider,
	).Scan(&stat.tiles, &stat.bytes)
	if err != nil {
		return providerStat{}, err
	}
	if stat.tiles == 0 {
		return stat, nil
	}
	if _, err := db.Exec("DELETE FROM tiles WHERE provider=?", provider); err != nil {
		return providerStat{}, err
	}
	return stat, nil
}

// countProviderTiles returns the number of cached tiles for a provider.
func countProviderTiles(db *sql.DB, provider string) (int64, error) {
	var n int64
	err := db.QueryRow("SELECT COUNT(*) FROM tiles WHERE provider=?", provider).Scan(&n)
	return n, err
}
