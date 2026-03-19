package transport

import (
	"log"
	"os"
	"time"
)

// SinkConfig configures the NATS JetStream ingest sink.
type SinkConfig struct {
	// NATSURL is the NATS server address.
	// Default: "nats://localhost:4222" (env: NATS_URL).
	NATSURL string
	// StreamName is the JetStream stream name.
	// Default: "TELEMETRY" (env: NATS_STREAM_NAME).
	StreamName string
	// TransportType identifies this transport (e.g., "mqtt-subscriber").
	TransportType string
	// BatchSize is the number of messages per flush. Default: 256.
	BatchSize int
	// FlushInterval is the max time before flushing a partial batch.
	FlushInterval time.Duration
}

// SinkConfigFromEnv creates a SinkConfig from environment variables.
func SinkConfigFromEnv(transportType string) SinkConfig {
	return SinkConfig{
		NATSURL:       getenvDefault("NATS_URL", "nats://localhost:4222"),
		StreamName:    getenvDefault("NATS_STREAM_NAME", "TELEMETRY"),
		TransportType: transportType,
		BatchSize:     256,
		FlushInterval: 10 * time.Millisecond,
	}
}

func getenvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// NewIngestSink creates a NATS JetStream ingest sink.
func NewIngestSink(cfg SinkConfig, logger *log.Logger) (IngestSink, error) {
	return NewJetStreamSink(JetStreamSinkConfig{
		URL:           cfg.NATSURL,
		StreamName:    cfg.StreamName,
		SubjectPrefix: "telemetry.raw",
		TransportType: cfg.TransportType,
		QueueSize:     16384,
		BatchSize:     cfg.BatchSize,
		FlushInterval: cfg.FlushInterval,
		Replicas:      1,
	}, logger)
}
