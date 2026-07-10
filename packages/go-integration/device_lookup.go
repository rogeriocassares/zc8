package integration

import (
	"context"
	"database/sql"
	"log"
)

// DeviceLookup resolves device identity from v_device_ingest_routing.
type DeviceLookup struct {
	db     *sql.DB
	logger *log.Logger
}

func NewDeviceLookup(db *sql.DB, logger *log.Logger) *DeviceLookup {
	if logger == nil {
		logger = log.New(log.Writer(), "[DeviceLookup] ", log.LstdFlags)
	}
	return &DeviceLookup{db: db, logger: logger}
}

// Lookup queries v_device_ingest_routing by dev_eui or device_key within a team.
// Returns device identity fields; routing is handled by NATS subject scope.
func (dl *DeviceLookup) Lookup(ctx context.Context, deviceKey string, teamID int64) (*DeviceConfig, error) {
	const query = `
		SELECT
			device_id,
			device_key,
			COALESCE(device_model_code, ''),
			COALESCE(vendor_id, 0),
			team_id
		FROM v_device_ingest_routing
		WHERE (dev_eui = $1 OR device_key = $1)
			AND team_id = $2
			AND is_active = true
		LIMIT 1
	`

	cfg := &DeviceConfig{ParserConfig: make(map[string]interface{})}
	err := dl.db.QueryRowContext(ctx, query, deviceKey, teamID).Scan(
		&cfg.DeviceUUID,
		&cfg.DeviceKey,
		&cfg.DeviceModelCode,
		&cfg.VendorID,
		&cfg.TeamID,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	return cfg, nil
}
