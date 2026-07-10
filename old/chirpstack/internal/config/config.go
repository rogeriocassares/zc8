package config

import (
	"os"
	"strconv"
)

// Config holds application configuration for ChirpStack adapter
type Config struct {
	MQTT       MQTTConfig
	Postgres   PostgresConfig
	GrpcIngest GrpcIngestConfig
	Cache      CacheConfig
}

// MQTTConfig holds MQTT broker configuration
type MQTTConfig struct {
	BrokerURL string
	ClientID  string
	Username  string
	Password  string
	QoS       byte
	Topics    []string
	MaxRetry  int
	KeepAlive int
}

// PostgresConfig holds PostgreSQL configuration for device registry
type PostgresConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	Database string
	SSLMode  string
	MaxConns int
}

// GrpcIngestConfig holds ingest service gRPC endpoint configuration
type GrpcIngestConfig struct {
	Host string
	Port int
}

// CacheConfig holds device caching configuration
type CacheConfig struct {
	MaxEntries int
	TTL        int // seconds
}

// Load reads configuration from environment variables
func Load() (*Config, error) {
	cfg := &Config{
		MQTT: MQTTConfig{
			BrokerURL: getEnv("MQTT_BROKER_URL", "mqtt://localhost:1883"),
			ClientID:  getEnv("MQTT_CLIENT_ID", "chirpstack-adapter"),
			Username:  getEnv("MQTT_USERNAME", ""),
			Password:  getEnv("MQTT_PASSWORD", ""),
			QoS:       byte(getEnvInt("MQTT_QOS", 1)),
			MaxRetry:  getEnvInt("MQTT_MAX_RETRY", 3),
			KeepAlive: getEnvInt("MQTT_KEEP_ALIVE", 60),
			Topics: []string{
				"application/+/device/+/event/up",
			},
		},
		Postgres: PostgresConfig{
			Host:     getEnv("POSTGRES_HOST", "localhost"),
			Port:     getEnvInt("POSTGRES_PORT", 5432),
			User:     getEnv("POSTGRES_USER", "postgres"),
			Password: getEnv("POSTGRES_PASSWORD", ""),
			Database: getEnv("POSTGRES_DB", "zc8"),
			SSLMode:  getEnv("POSTGRES_SSLMODE", "disable"),
			MaxConns: getEnvInt("POSTGRES_MAX_CONNS", 25),
		},
		GrpcIngest: GrpcIngestConfig{
			Host: getEnv("GRPC_INGEST_HOST", "localhost"),
			Port: getEnvInt("GRPC_INGEST_PORT", 50054),
		},
		Cache: CacheConfig{
			MaxEntries: getEnvInt("CACHE_MAX_ENTRIES", 10000),
			TTL:        getEnvInt("CACHE_TTL", 3600),
		},
	}

	return cfg, nil
}

// getEnv retrieves an environment variable or returns a default
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvInt retrieves an environment variable as int or returns a default
func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if i, err := strconv.Atoi(value); err == nil {
			return i
		}
	}
	return defaultValue
}
