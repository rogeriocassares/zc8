package transport

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"github.com/rogeriocassares/zc8/packages/go-data"
)

// DeviceLookup resolves device identity and ingest routing from v_device_ingest_routing.
type DeviceLookup struct {
	db     *sql.DB
	logger *log.Logger
}

// NewDeviceLookup creates a new device lookup.
func NewDeviceLookup(db *sql.DB, logger *log.Logger) *DeviceLookup {
	if logger == nil {
		logger = log.New(log.Writer(), "[DeviceLookup] ", log.LstdFlags)
	}
	return &DeviceLookup{db: db, logger: logger}
}

// Lookup queries v_device_ingest_routing by dev_eui or device_key within a team.
// Returns device identity AND pre-resolved ingest routing (InfluxDB, Redis, NATS).
func (dl *DeviceLookup) Lookup(ctx context.Context, deviceKey string, teamID int64) (*DeviceConfig, error) {
	query := `
		SELECT
			device_id,
			device_key,
			COALESCE(device_model_code, ''),
			COALESCE(vendor_id, 0),
			team_id,
			COALESCE(influxdb_config_id, 0),
			COALESCE(influxdb_write_enabled, false),
			COALESCE(influxdb_require_ack, false),
			COALESCE(influxdb_host, ''),
			COALESCE(influxdb_port, 0),
			COALESCE(influxdb_token, ''),
			COALESCE(influxdb_bucket, ''),
			COALESCE(influxdb_measurement, 'telemetry'),
			COALESCE(redis_config_id, 0),
			COALESCE(redis_write_enabled, true),
			COALESCE(redis_max_hash_entries, 10),
			COALESCE(redis_host, ''),
			COALESCE(redis_port, 0),
			COALESCE(redis_key_prefix, ''),
			COALESCE(nats_config_id, 0),
			COALESCE(nats_write_enabled, true),
			COALESCE(nats_url, ''),
			COALESCE(nats_subject_prefix, '')
		FROM v_device_ingest_routing
		WHERE (dev_eui = $1 OR device_key = $1)
			AND team_id = $2
			AND is_active = true
		LIMIT 1
	`

	cfg := &DeviceConfig{ParserConfig: make(map[string]interface{})}
	var (
		influxConfigID int64
		writeInflux    bool
		requireAck     bool
		influxHost     string
		influxPort     int
		influxToken    string
		influxBucket   string
		influxMeasure  string
		redisConfigID  int64
		writeRedis     bool
		redisMaxHash   int32
		redisHost      string
		redisPort      int
		redisKeyPrefix string
		natsConfigID   int64
		writeNATS      bool
		natsURL        string
		natsSubjPrefix string
	)

	err := dl.db.QueryRowContext(ctx, query, deviceKey, teamID).Scan(
		&cfg.DeviceUUID,
		&cfg.DeviceKey,
		&cfg.DeviceModelCode,
		&cfg.VendorID,
		&cfg.TeamID,
		&influxConfigID, &writeInflux, &requireAck,
		&influxHost, &influxPort, &influxToken, &influxBucket, &influxMeasure,
		&redisConfigID, &writeRedis, &redisMaxHash,
		&redisHost, &redisPort, &redisKeyPrefix,
		&natsConfigID, &writeNATS, &natsURL, &natsSubjPrefix,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	// Build host:port strings for InfluxDB and Redis
	influxHostPort := influxHost
	if influxPort > 0 {
		influxHostPort = fmt.Sprintf("%s:%d", influxHost, influxPort)
	}
	redisHostPort := redisHost
	if redisPort > 0 {
		redisHostPort = fmt.Sprintf("%s:%d", redisHost, redisPort)
	}

	cfg.Routing = &data.IngestRouting{
		InfluxDBConfigID:    influxConfigID,
		WriteToInfluxDB:     writeInflux,
		RequireInfluxDBAck:  requireAck,
		InfluxDBHost:        influxHostPort,
		InfluxDBToken:       influxToken,
		InfluxDBBucket:      influxBucket,
		InfluxDBMeasurement: influxMeasure,
		RedisConfigID:       redisConfigID,
		WriteToRedis:        writeRedis,
		RedisMaxHashEntries: redisMaxHash,
		RedisHost:           redisHostPort,
		RedisKeyPrefix:      redisKeyPrefix,
		NATSConfigID:        natsConfigID,
		WriteToNATS:         writeNATS,
		NATSURL:             natsURL,
		NATSSubjectPrefix:   natsSubjPrefix,
	}

	return cfg, nil
}
