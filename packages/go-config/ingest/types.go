package ingest

import "fmt"

// InfluxDBConfig represents a validated ingest_influxdb_config row.
type InfluxDBConfig struct {
	ID              int64
	Host            string
	Port            int
	Token           string
	InfluxDBOrg     string
	Bucket          string
	Measurement     string
	UseTLS          bool
	WritePrecision  string
	BatchSize       int
	FlushIntervalMs int
	MaxRetries      int
	RetryDelayMs    int
	Workers         int
}

// Address returns host:port suitable for client connection.
func (c *InfluxDBConfig) Address() string {
	scheme := "http"
	if c.UseTLS {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s:%d", scheme, c.Host, c.Port)
}

// RedisConfig represents a validated ingest_redis_config row.
type RedisConfig struct {
	ID             int64
	Host           string
	Port           int
	Password       string
	DB             int
	MaxHashEntries int
	KeyPrefix      string
	KeyTTLSeconds  int
	PoolSize       int
}

// Address returns host:port.
func (c *RedisConfig) Address() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

// NATSConfig represents a validated ingest_nats_config row.
type NATSConfig struct {
	ID              int64
	URL             string
	SubjectPrefix   string
	MaxPayloadBytes int
	Username        string
	Password        string
	UseTLS          bool
}

// IngestConfig is the discriminated union, exactly one config is non-nil.
type IngestConfig struct {
	InfluxDB *InfluxDBConfig
	Redis    *RedisConfig
	NATS     *NATSConfig
}

// IngestConfigRegistry maps to the ingest_config polymorphic FK table.
type IngestConfigRegistry struct {
	ID            int64
	IngestTypeID  int
	ConfigType    string // "influxdb", "redis", "nats"
	InfluxDBCfgID *int64
	RedisCfgID    *int64
	NATSCfgID     *int64
}

// IngestRegistryEntry maps to an ingest_registry row with resolved config.
type IngestRegistryEntry struct {
	ID                int64
	Name              string
	OrganizationID    int64
	TeamID            *int64
	IngestTypeCode    string // "influxdb3", "redis", "nats"
	IsActive          bool
	IsGlobal          bool
	WriteConfirmation bool
	Priority          int
	Config            IngestConfig
}
