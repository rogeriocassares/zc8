package nats

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

// JetStreamConfig configures a JetStream-enabled NATS client.
type JetStreamConfig struct {
	URL string
	// StreamName is the JetStream stream name (e.g., "TELEMETRY").
	StreamName string
	// Subjects are the subjects captured by this stream (e.g., "telemetry.raw.>").
	Subjects []string
	// MaxBytes limits total stream size (0 = unlimited).
	MaxBytes int64
	// MaxAge limits message retention (0 = unlimited).
	MaxAge time.Duration
	// MaxMsgsPerSubject limits stored messages per unique subject (0 = unlimited).
	// Set to e.g. 100 for per-device JetStream replay (last 100 messages per device).
	MaxMsgsPerSubject int64
	// Replicas for HA (1 for dev/edge, 3 for prod).
	Replicas int
}

// JetStreamClient wraps a NATS connection with JetStream capabilities.
type JetStreamClient struct {
	conn   *nats.Conn
	js     jetstream.JetStream
	stream jetstream.Stream
	logger *log.Logger
}

// NewJetStream creates a NATS connection and initializes JetStream.
// It ensures the configured stream exists (creates or updates it).
func NewJetStream(ctx context.Context, cfg JetStreamConfig, logger *log.Logger) (*JetStreamClient, error) {
	if logger == nil {
		logger = log.New(log.Writer(), "[nats-js] ", log.LstdFlags)
	}

	opts := []nats.Option{
		nats.MaxReconnects(-1),
		nats.ReconnectWait(1 * time.Second),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			if err != nil {
				logger.Printf("NATS disconnected: %v", err)
			}
		}),
		nats.ReconnectHandler(func(_ *nats.Conn) {
			logger.Println("NATS reconnected")
		}),
	}

	conn, err := nats.Connect(cfg.URL, opts...)
	if err != nil {
		return nil, fmt.Errorf("nats connect: %w", err)
	}

	js, err := jetstream.New(conn)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("jetstream init: %w", err)
	}

	// Ensure the stream exists with the desired configuration.
	replicas := cfg.Replicas
	if replicas < 1 {
		replicas = 1
	}

	streamCfg := jetstream.StreamConfig{
		Name:              cfg.StreamName,
		Subjects:          cfg.Subjects,
		Retention:         jetstream.LimitsPolicy,
		MaxBytes:          cfg.MaxBytes,
		MaxAge:            cfg.MaxAge,
		MaxMsgsPerSubject: cfg.MaxMsgsPerSubject,
		Replicas:          replicas,
		Storage:           jetstream.FileStorage,
		Discard:           jetstream.DiscardOld,
	}

	stream, err := js.CreateOrUpdateStream(ctx, streamCfg)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("create/update stream %q: %w", cfg.StreamName, err)
	}

	logger.Printf("JetStream stream %q ready (subjects=%v, replicas=%d)",
		cfg.StreamName, cfg.Subjects, replicas)

	return &JetStreamClient{
		conn:   conn,
		js:     js,
		stream: stream,
		logger: logger,
	}, nil
}

// Publish publishes a message to a JetStream subject.
// Returns the publish ack from the server (confirms persistence).
func (c *JetStreamClient) Publish(ctx context.Context, subject string, data []byte) (*jetstream.PubAck, error) {
	return c.js.Publish(ctx, subject, data)
}

// PublishAsync publishes a message asynchronously for higher throughput.
// The returned PubAckFuture can be used to confirm delivery.
func (c *JetStreamClient) PublishAsync(subject string, data []byte) (jetstream.PubAckFuture, error) {
	return c.js.PublishAsync(subject, data)
}

// ConsumerConfig configures a JetStream pull consumer.
type ConsumerConfig struct {
	// Durable is the consumer name (survives restarts).
	Durable string
	// FilterSubjects filters which subjects this consumer receives.
	FilterSubjects []string
	// MaxAckPending limits unacknowledged messages (backpressure).
	MaxAckPending int
	// AckWait is how long the server waits for ACK before redelivery.
	AckWait time.Duration
}

// CreateConsumer creates or updates a durable pull consumer on the stream.
func (c *JetStreamClient) CreateConsumer(ctx context.Context, cfg ConsumerConfig) (jetstream.Consumer, error) {
	if cfg.MaxAckPending <= 0 {
		cfg.MaxAckPending = 1024
	}
	if cfg.AckWait <= 0 {
		cfg.AckWait = 30 * time.Second
	}

	cons, err := c.js.CreateOrUpdateConsumer(ctx, c.stream.CachedInfo().Config.Name, jetstream.ConsumerConfig{
		Durable:        cfg.Durable,
		FilterSubjects: cfg.FilterSubjects,
		AckPolicy:      jetstream.AckExplicitPolicy,
		MaxAckPending:  cfg.MaxAckPending,
		AckWait:        cfg.AckWait,
		DeliverPolicy:  jetstream.DeliverAllPolicy,
	})
	if err != nil {
		return nil, fmt.Errorf("create consumer %q: %w", cfg.Durable, err)
	}

	c.logger.Printf("JetStream consumer %q ready (max_ack_pending=%d, ack_wait=%v)",
		cfg.Durable, cfg.MaxAckPending, cfg.AckWait)

	return cons, nil
}

// JS returns the underlying jetstream.JetStream for advanced usage.
func (c *JetStreamClient) JS() jetstream.JetStream {
	return c.js
}

// Conn returns the underlying nats.Conn (for NATS Core pub/sub).
func (c *JetStreamClient) Conn() *nats.Conn {
	return c.conn
}

// Health checks the NATS connection.
func (c *JetStreamClient) Health() error {
	if c.conn.IsClosed() {
		return fmt.Errorf("nats connection closed")
	}
	return nil
}

// Close drains the connection and closes it.
func (c *JetStreamClient) Close() error {
	return c.conn.Drain()
}
