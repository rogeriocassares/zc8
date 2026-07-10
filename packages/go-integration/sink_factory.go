package integration

import (
	"log"
	"os"
	"strconv"
	"time"
)

// SinkConfig configures the NATS JetStream ingest sink.
type SinkConfig struct {
	// NATSURL is the NATS server address.
	NATSURL string
	// StreamName is the JetStream stream name.
	StreamName string
	// IntegrationType identifies this integration (e.g., "mqtt-subscriber").
	IntegrationType string
	// BatchSize is the number of messages per flush. Default: 256.
	BatchSize int
	// FlushInterval is the max time before flushing a partial batch.
	FlushInterval time.Duration
	// MaxMsgsPerSubject limits stored messages per unique device subject.
	// Default 100 enables JetStream replay (last 100 per device) in the browser.
	MaxMsgsPerSubject int64
}

// SinkConfigFromEnv creates a SinkConfig from environment variables.
func SinkConfigFromEnv(integrationType string) SinkConfig {
	maxMsgs := int64(100)
	if v := os.Getenv("NATS_MAX_MSGS_PER_SUBJECT"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n >= 0 {
			maxMsgs = n
		}
	}
	return SinkConfig{
		NATSURL:           getenvDefault("NATS_URL", "nats://localhost:4222"),
		StreamName:        getenvDefault("NATS_STREAM_NAME", "DATA"),
		IntegrationType:   integrationType,
		BatchSize:         256,
		FlushInterval:     10 * time.Millisecond,
		MaxMsgsPerSubject: maxMsgs,
	}
}

func getenvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// NewIngestSink creates a NATS JetStream ingest sink for the DATA stream.
func NewIngestSink(cfg SinkConfig, logger *log.Logger) (IngestSink, error) {
	return NewJetStreamSink(JetStreamSinkConfig{
		URL:               cfg.NATSURL,
		StreamName:        getenvDefault("NATS_DATA_STREAM", "DATA"),
		SubjectPrefix:     "data",
		IntegrationType:   cfg.IntegrationType,
		QueueSize:         16384,
		BatchSize:         cfg.BatchSize,
		FlushInterval:     cfg.FlushInterval,
		MaxMsgsPerSubject: cfg.MaxMsgsPerSubject,
		Replicas:          1,
	}, logger)
}
