package ingest

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
)

// Repository loads typed ingest configurations from PostgreSQL.
// Uses an in-memory cache keyed by ingest_registry.id for hot-path access.
type Repository struct {
	db    *sql.DB
	mu    sync.RWMutex
	cache map[int64]*IngestRegistryEntry // ingest_registry_id → entry
}

// NewRepository creates a new ingest config repository.
func NewRepository(db *sql.DB) *Repository {
	return &Repository{
		db:    db,
		cache: make(map[int64]*IngestRegistryEntry),
	}
}

// LoadAllByOrg loads all active ingest_registry entries for an organization.
// Returns entries grouped by type (influxdb, redis, nats) sorted by priority DESC.
func (r *Repository) LoadAllByOrg(ctx context.Context, orgID int64) ([]*IngestRegistryEntry, error) {
	query := `
		SELECT
			ir.id, ir.name, ir.organization_id, ir.team_id,
			it.code AS ingest_type_code,
			ir.is_active, ir.is_global, ir.write_confirmation, ir.priority,
			ic.config_type,
			ic.influxdb_config_id, ic.redis_config_id, ic.nats_config_id
		FROM ingest_registry ir
		JOIN ingest_type it ON ir.ingest_type_id = it.id
		JOIN ingest_config ic ON ir.ingest_config_id = ic.id
		WHERE ir.organization_id = $1 AND ir.is_active = true
		ORDER BY ir.priority DESC, ir.id ASC
	`

	rows, err := r.db.QueryContext(ctx, query, orgID)
	if err != nil {
		return nil, fmt.Errorf("query ingest_registry failed: %w", err)
	}
	defer rows.Close()

	var entries []*IngestRegistryEntry
	for rows.Next() {
		entry := &IngestRegistryEntry{}
		var teamID sql.NullInt64
		var influxCfgID, redisCfgID, natsCfgID sql.NullInt64

		if err := rows.Scan(
			&entry.ID, &entry.Name, &entry.OrganizationID, &teamID,
			&entry.IngestTypeCode,
			&entry.IsActive, &entry.IsGlobal, &entry.WriteConfirmation, &entry.Priority,
			// from ingest_config
			&entry.IngestTypeCode, // config_type overlaps ingest_type_code here
			&influxCfgID, &redisCfgID, &natsCfgID,
		); err != nil {
			return nil, fmt.Errorf("scan ingest_registry row: %w", err)
		}

		if teamID.Valid {
			t := teamID.Int64
			entry.TeamID = &t
		}

		// Load the typed config
		switch {
		case influxCfgID.Valid:
			cfg, err := r.loadInfluxDBConfig(ctx, influxCfgID.Int64)
			if err != nil {
				return nil, fmt.Errorf("load influxdb config %d: %w", influxCfgID.Int64, err)
			}
			entry.Config.InfluxDB = cfg
		case redisCfgID.Valid:
			cfg, err := r.loadRedisConfig(ctx, redisCfgID.Int64)
			if err != nil {
				return nil, fmt.Errorf("load redis config %d: %w", redisCfgID.Int64, err)
			}
			entry.Config.Redis = cfg
		case natsCfgID.Valid:
			cfg, err := r.loadNATSConfig(ctx, natsCfgID.Int64)
			if err != nil {
				return nil, fmt.Errorf("load nats config %d: %w", natsCfgID.Int64, err)
			}
			entry.Config.NATS = cfg
		}

		// Cache the entry
		r.mu.Lock()
		r.cache[entry.ID] = entry
		r.mu.Unlock()

		entries = append(entries, entry)
	}

	return entries, rows.Err()
}

// GetCached returns a cached entry by ingest_registry ID. Returns nil if not found.
func (r *Repository) GetCached(id int64) *IngestRegistryEntry {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.cache[id]
}

// InvalidateCache clears all cached entries.
func (r *Repository) InvalidateCache() {
	r.mu.Lock()
	r.cache = make(map[int64]*IngestRegistryEntry)
	r.mu.Unlock()
}

func (r *Repository) loadInfluxDBConfig(ctx context.Context, id int64) (*InfluxDBConfig, error) {
	cfg := &InfluxDBConfig{}
	err := r.db.QueryRowContext(ctx, `
		SELECT id, host, port, token, influxdb_org, bucket, measurement,
		       use_tls, write_precision, batch_size, flush_interval_ms,
		       max_retries, retry_delay_ms, workers
		FROM ingest_influxdb_config WHERE id = $1
	`, id).Scan(
		&cfg.ID, &cfg.Host, &cfg.Port, &cfg.Token, &cfg.InfluxDBOrg,
		&cfg.Bucket, &cfg.Measurement,
		&cfg.UseTLS, &cfg.WritePrecision, &cfg.BatchSize, &cfg.FlushIntervalMs,
		&cfg.MaxRetries, &cfg.RetryDelayMs, &cfg.Workers,
	)
	if err != nil {
		return nil, err
	}
	return cfg, nil
}

func (r *Repository) loadRedisConfig(ctx context.Context, id int64) (*RedisConfig, error) {
	cfg := &RedisConfig{}
	var password sql.NullString
	err := r.db.QueryRowContext(ctx, `
		SELECT id, host, port, password, db, max_hash_entries,
		       key_prefix, key_ttl_seconds, pool_size
		FROM ingest_redis_config WHERE id = $1
	`, id).Scan(
		&cfg.ID, &cfg.Host, &cfg.Port, &password, &cfg.DB,
		&cfg.MaxHashEntries, &cfg.KeyPrefix, &cfg.KeyTTLSeconds, &cfg.PoolSize,
	)
	if err != nil {
		return nil, err
	}
	if password.Valid {
		cfg.Password = password.String
	}
	return cfg, nil
}

func (r *Repository) loadNATSConfig(ctx context.Context, id int64) (*NATSConfig, error) {
	cfg := &NATSConfig{}
	var username, password sql.NullString
	err := r.db.QueryRowContext(ctx, `
		SELECT id, url, subject_prefix, max_payload_bytes, username, password, use_tls
		FROM ingest_nats_config WHERE id = $1
	`, id).Scan(
		&cfg.ID, &cfg.URL, &cfg.SubjectPrefix, &cfg.MaxPayloadBytes,
		&username, &password, &cfg.UseTLS,
	)
	if err != nil {
		return nil, err
	}
	if username.Valid {
		cfg.Username = username.String
	}
	if password.Valid {
		cfg.Password = password.String
	}
	return cfg, nil
}
