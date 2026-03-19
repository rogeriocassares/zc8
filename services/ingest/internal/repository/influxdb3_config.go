package repository

import (
	"context"
	"fmt"

	infrapostgres "github.com/rogeriocassares/zc8/packages/go-infra/postgres"
	infrainflux "github.com/rogeriocassares/zc8/services/ingest/internal/infra/influx"
)

// InfluxDB3ConfigRepo implements infrainflux.InfluxDB3ConfigRepository.
// It queries ingest_influxdb_config from PostgreSQL.
type InfluxDB3ConfigRepo struct {
	pg *infrapostgres.Client
}

// NewInfluxDB3ConfigRepo creates a new config repository.
func NewInfluxDB3ConfigRepo(pg *infrapostgres.Client) *InfluxDB3ConfigRepo {
	return &InfluxDB3ConfigRepo{pg: pg}
}

// ListActive returns all is_active=true rows ordered by id.
// Implements infrainflux.InfluxDB3ConfigRepository.
func (r *InfluxDB3ConfigRepo) ListActive(ctx context.Context) ([]infrainflux.InfluxDB3ConfigEntry, error) {
	const q = `
		SELECT
			id,
			COALESCE(organization_id, 0),
			COALESCE(team_id, 0),
			host,
			port,
			token,
			influxdb_org,
			bucket,
			COALESCE(measurement, 'telemetry'),
			COALESCE(use_tls, false),
			workers,
			batch_size,
			flush_interval_ms
		FROM ingest_influxdb_config
		WHERE is_active = true
		ORDER BY id
	`
	rows, err := r.pg.Pool().Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("list active influxdb3 configs: %w", err)
	}
	defer rows.Close()

	var entries []infrainflux.InfluxDB3ConfigEntry
	for rows.Next() {
		var e infrainflux.InfluxDB3ConfigEntry
		if err := rows.Scan(
			&e.ID,
			&e.OrganizationID,
			&e.TeamID,
			&e.Host,
			&e.Port,
			&e.Token,
			&e.InfluxDBOrg,
			&e.Bucket,
			&e.Measurement,
			&e.UseTLS,
			&e.Workers,
			&e.BatchSize,
			&e.FlushIntervalMs,
		); err != nil {
			return nil, fmt.Errorf("scan influxdb3 config row: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}
