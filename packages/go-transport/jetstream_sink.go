package transport

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// JetStreamSinkConfig configures the NATS JetStream ingest sink.
type JetStreamSinkConfig struct {
	// NATS connection URL (e.g., "nats://localhost:4222").
	URL string
	// StreamName for the telemetry stream (e.g., "TELEMETRY").
	StreamName string
	// SubjectPrefix for published messages (e.g., "telemetry.raw").
	// Final subject: {prefix}.{transport_type}
	SubjectPrefix string
	// TransportType identifies this transport (e.g., "mqtt-subscriber").
	TransportType string
	// QueueSize is the internal buffer before publishing (backpressure boundary).
	QueueSize int
	// BatchSize is the number of messages to publish before flushing.
	BatchSize int
	// FlushInterval is the max time before flushing a partial batch.
	FlushInterval time.Duration
	// MaxBytes for the JetStream stream (0 = unlimited).
	MaxBytes int64
	// MaxAge for message retention (0 = unlimited).
	MaxAge time.Duration
	// Replicas for HA (1 = dev/edge, 3 = prod).
	Replicas int
}

// JetStreamSink publishes proto-serialized IngestRequests to NATS JetStream.
// Messages are batched internally and published asynchronously for throughput.
type JetStreamSink struct {
	client  *infranats.JetStreamClient
	subject string
	queue   chan *pb.IngestRequest
	stopCh  chan struct{}
	wg      sync.WaitGroup
	logger  *log.Logger
}

// NewJetStreamSink creates a sink that publishes to NATS JetStream.
func NewJetStreamSink(cfg JetStreamSinkConfig, logger *log.Logger) (*JetStreamSink, error) {
	if logger == nil {
		logger = log.New(log.Writer(), "[js-sink] ", log.LstdFlags)
	}
	if cfg.QueueSize <= 0 {
		cfg.QueueSize = 16384
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 256
	}
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = 10 * time.Millisecond
	}
	if cfg.StreamName == "" {
		cfg.StreamName = "TELEMETRY"
	}
	if cfg.SubjectPrefix == "" {
		cfg.SubjectPrefix = "telemetry.raw"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := infranats.NewJetStream(ctx, infranats.JetStreamConfig{
		URL:        cfg.URL,
		StreamName: cfg.StreamName,
		Subjects:   []string{cfg.SubjectPrefix + ".>"},
		MaxBytes:   cfg.MaxBytes,
		MaxAge:     cfg.MaxAge,
		Replicas:   cfg.Replicas,
	}, logger)
	if err != nil {
		return nil, fmt.Errorf("jetstream sink init: %w", err)
	}

	subject := cfg.SubjectPrefix + "." + cfg.TransportType

	sink := &JetStreamSink{
		client:  client,
		subject: subject,
		queue:   make(chan *pb.IngestRequest, cfg.QueueSize),
		stopCh:  make(chan struct{}),
		logger:  logger,
	}

	sink.wg.Add(1)
	go sink.publishLoop(cfg.BatchSize, cfg.FlushInterval)

	logger.Printf("JetStream sink ready: subject=%s, batch=%d, flush=%v",
		subject, cfg.BatchSize, cfg.FlushInterval)

	return sink, nil
}

// Submit enqueues an IngestRequest for batched JetStream publication.
// Non-blocking: returns false if the queue is full.
func (s *JetStreamSink) Submit(req *pb.IngestRequest) bool {
	select {
	case s.queue <- req:
		return true
	default:
		return false
	}
}

// Close drains the queue and shuts down the JetStream connection.
func (s *JetStreamSink) Close() error {
	close(s.stopCh)
	s.wg.Wait()
	return s.client.Close()
}

// publishLoop serializes and publishes batches of IngestRequests.
func (s *JetStreamSink) publishLoop(batchSize int, flushInterval time.Duration) {
	defer s.wg.Done()

	batch := make([]*pb.IngestRequest, 0, batchSize)
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()

	flush := func() {
		if len(batch) == 0 {
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		published := 0
		for _, req := range batch {
			data, err := pb.MarshalIngestRequest(req)
			if err != nil {
				s.logger.Printf("proto marshal error: %v", err)
				continue
			}

			_, err = s.client.Publish(ctx, s.subject, data)
			if err != nil {
				s.logger.Printf("jetstream publish error (%d/%d published): %v",
					published, len(batch), err)
				break
			}
			published++
		}

		batch = batch[:0]
	}

	for {
		select {
		case req := <-s.queue:
			batch = append(batch, req)
			if len(batch) >= batchSize {
				flush()
			}

		case <-ticker.C:
			flush()

		case <-s.stopCh:
			// Drain remaining
			for {
				select {
				case req := <-s.queue:
					batch = append(batch, req)
				default:
					flush()
					return
				}
			}
		}
	}
}

// Client returns the underlying JetStreamClient for advanced usage
// (e.g., creating consumers on the ingest side).
func (s *JetStreamSink) Client() *infranats.JetStreamClient {
	return s.client
}
