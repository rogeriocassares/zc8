package integration

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// JetStreamSinkConfig configures the NATS JetStream ingest sink.
type JetStreamSinkConfig struct {
	URL             string
	StreamName      string
	SubjectPrefix   string
	IntegrationType string
	QueueSize       int
	BatchSize       int
	FlushInterval   time.Duration
	MaxBytes        int64
	MaxAge          time.Duration
	// MaxMsgsPerSubject limits stored messages per unique subject.
	// Set via NATS_MAX_MSGS_PER_SUBJECT env var (default 100).
	MaxMsgsPerSubject int64
	Replicas          int
	// SvcStreamName is the JetStream SVC stream name (default "SVC").
	// When non-empty, the sink also creates/connects to the SVC stream.
	SvcStreamName string
}

// JetStreamSink publishes proto-serialized IngestEnvelopes to the DATA JetStream stream.
type JetStreamSink struct {
	client          *infranats.JetStreamClient
	svcClient       *infranats.JetStreamClient // SVC stream — may be nil
	subjectPrefix   string
	fallbackSubject string
	queue           chan *pb.IngestEnvelope
	stopCh          chan struct{}
	wg              sync.WaitGroup
	logger          *log.Logger
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
		cfg.StreamName = "DATA"
	}
	if cfg.SubjectPrefix == "" {
		cfg.SubjectPrefix = "data"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := infranats.NewJetStream(ctx, infranats.JetStreamConfig{
		URL:               cfg.URL,
		StreamName:        cfg.StreamName,
		Subjects:          []string{cfg.SubjectPrefix + ".>"},
		MaxBytes:          cfg.MaxBytes,
		MaxAge:            cfg.MaxAge,
		MaxMsgsPerSubject: cfg.MaxMsgsPerSubject,
		Replicas:          cfg.Replicas,
	}, logger)
	if err != nil {
		return nil, fmt.Errorf("jetstream sink init: %w", err)
	}

	// Also connect to the SVC stream if a stream name is provided.
	var svcClient *infranats.JetStreamClient
	svcStreamName := cfg.SvcStreamName
	if svcStreamName == "" {
		svcStreamName = "SVC"
	}
	svcCtx, svcCancel := context.WithTimeout(context.Background(), 10*time.Second)
	svc, err := infranats.NewJetStream(svcCtx, infranats.JetStreamConfig{
		URL:        cfg.URL,
		StreamName: svcStreamName,
		Subjects:   []string{"svc.>"},
		Replicas:   cfg.Replicas,
	}, logger)
	svcCancel()
	if err != nil {
		logger.Printf("SVC stream init warning (non-fatal): %v", err)
	} else {
		svcClient = svc
	}

	subject := cfg.SubjectPrefix + "." + cfg.IntegrationType

	sink := &JetStreamSink{
		client:          client,
		svcClient:       svcClient,
		subjectPrefix:   cfg.SubjectPrefix,
		fallbackSubject: subject,
		queue:           make(chan *pb.IngestEnvelope, cfg.QueueSize),
		stopCh:          make(chan struct{}),
		logger:          logger,
	}

	sink.wg.Add(1)
	go sink.publishLoop(cfg.BatchSize, cfg.FlushInterval)

	logger.Printf("JetStream sink ready: subject_prefix=%s fallback=%s, batch=%d, flush=%v",
		cfg.SubjectPrefix, subject, cfg.BatchSize, cfg.FlushInterval)

	return sink, nil
}

// Submit enqueues an IngestEnvelope for batched JetStream publication.
func (s *JetStreamSink) Submit(env *pb.IngestEnvelope) bool {
	select {
	case s.queue <- env:
		return true
	default:
		return false
	}
}

// NatsConn returns the underlying *nats.Conn so callers can use NATS Core
// (e.g. for HealthServer).
func (s *JetStreamSink) NatsConn() *nats.Conn {
	return s.client.Conn()
}

// SvcJS returns the JetStream client for the SVC stream.
// Returns nil if the SVC stream was not available at startup.
func (s *JetStreamSink) SvcJS() *infranats.JetStreamClient {
	return s.svcClient
}

// Close drains the queue and shuts down the JetStream connection.
func (s *JetStreamSink) Close() error {
	close(s.stopCh)
	s.wg.Wait()
	if s.svcClient != nil {
		s.svcClient.Close()
	}
	return s.client.Close()
}

// publishLoop serializes and publishes batches of IngestEnvelopes.
func (s *JetStreamSink) publishLoop(batchSize int, flushInterval time.Duration) {
	defer s.wg.Done()

	batch := make([]*pb.IngestEnvelope, 0, batchSize)
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()

	flush := func() {
		if len(batch) == 0 {
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		published := 0
		for _, env := range batch {
			data, err := pb.MarshalEnvelope(env)
			if err != nil {
				s.logger.Printf("proto marshal error: %v", err)
				continue
			}

			subject := s.computeSubject(env)
			_, err = s.client.Publish(ctx, subject, data)
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
		case env := <-s.queue:
			batch = append(batch, env)
			if len(batch) >= batchSize {
				flush()
			}

		case <-ticker.C:
			flush()

		case <-s.stopCh:
			for {
				select {
				case env := <-s.queue:
					batch = append(batch, env)
				default:
					flush()
					return
				}
			}
		}
	}
}

// Client returns the underlying JetStreamClient for advanced usage.
func (s *JetStreamSink) Client() *infranats.JetStreamClient {
	return s.client
}

// computeSubject derives a per-device JetStream subject from the IngestEnvelope.
// Subject format:
//
//	data.{orgId}.{teamId}.{deviceKey}.raw     (PayloadType=PAYLOAD_RAW)
//	data.{orgId}.{teamId}.{deviceKey}.decoded (PayloadType=PAYLOAD_DECODED)
//
// Falls back to the integration-type subject when context is missing.
func (s *JetStreamSink) computeSubject(env *pb.IngestEnvelope) string {
	var kind string
	switch env.Type {
	case pb.PayloadType_PAYLOAD_DECODED:
		kind = "decoded"
	default:
		kind = "raw"
	}
	if env.DeviceKey > 0 && env.Context != nil && env.Context.OrganizationId > 0 {
		return fmt.Sprintf("%s.%d.%d.%d.%s",
			s.subjectPrefix,
			env.Context.OrganizationId,
			env.Context.TeamId,
			env.DeviceKey,
			kind,
		)
	}
	return s.fallbackSubject + "." + kind
}
