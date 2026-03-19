package grpc

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// IngestBatchClientConfig configures the batch gRPC client that uses the
// IngestBatch RPC for efficient bulk delivery.
type IngestBatchClientConfig struct {
	// Target is the gRPC address of the ingest service (e.g., "localhost:50054").
	Target string
	// BatchSize is the number of messages to accumulate before flushing.
	BatchSize int
	// FlushInterval is the maximum time to wait before flushing a partial batch.
	FlushInterval time.Duration
	// QueueSize is the capacity of the internal message queue.
	QueueSize int
}

// DefaultIngestBatchClientConfig returns sensible defaults for high-throughput ingest.
func DefaultIngestBatchClientConfig() IngestBatchClientConfig {
	return IngestBatchClientConfig{
		Target:        "localhost:50054",
		BatchSize:     256,
		FlushInterval: 10 * time.Millisecond,
		QueueSize:     16384,
	}
}

// IngestBatchClient batches IngestRequests and forwards them to the ingest
// service using the IngestBatch RPC. It accumulates messages in a channel
// and flushes when batchSize is reached or flushInterval expires.
type IngestBatchClient struct {
	conn   *grpc.ClientConn
	client pb.TelemetryIngestServiceClient

	batchCh       chan *pb.IngestRequest
	batchSize     int
	flushInterval time.Duration

	stopCh chan struct{}
	wg     sync.WaitGroup
	logger *log.Logger
}

// NewIngestBatchClient dials the ingest service and starts the batch flusher.
func NewIngestBatchClient(cfg IngestBatchClientConfig, logger *log.Logger) (*IngestBatchClient, error) {
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 256
	}
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = 10 * time.Millisecond
	}
	if cfg.QueueSize <= 0 {
		cfg.QueueSize = 16384
	}
	if logger == nil {
		logger = log.New(log.Writer(), "[IngestBatchClient] ", log.LstdFlags)
	}

	conn, err := grpc.NewClient(
		cfg.Target,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return nil, fmt.Errorf("dial ingest service: %w", err)
	}

	ic := &IngestBatchClient{
		conn:          conn,
		client:        pb.NewTelemetryIngestServiceClient(conn),
		batchCh:       make(chan *pb.IngestRequest, cfg.QueueSize),
		batchSize:     cfg.BatchSize,
		flushInterval: cfg.FlushInterval,
		stopCh:        make(chan struct{}),
		logger:        logger,
	}

	ic.wg.Add(1)
	go ic.flushLoop()

	logger.Printf("Connected to ingest service at %s (batch=%d, flush=%v)",
		cfg.Target, cfg.BatchSize, cfg.FlushInterval)

	return ic, nil
}

// Submit enqueues an IngestRequest for batched delivery.
// Non-blocking: returns false if the queue is full (backpressure signal).
func (ic *IngestBatchClient) Submit(req *pb.IngestRequest) bool {
	select {
	case ic.batchCh <- req:
		return true
	default:
		return false
	}
}

// flushLoop accumulates messages and sends them as batches.
func (ic *IngestBatchClient) flushLoop() {
	defer ic.wg.Done()

	batch := make([]*pb.IngestRequest, 0, ic.batchSize)
	ticker := time.NewTicker(ic.flushInterval)
	defer ticker.Stop()

	flush := func() {
		if len(batch) == 0 {
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		batchReq := &pb.IngestBatchRequest{
			Requests: batch,
		}

		ack, err := ic.client.IngestBatch(ctx, batchReq)
		if err != nil {
			ic.logger.Printf("Batch send failed (%d msgs): %v", len(batch), err)
		} else if ack.Rejected > 0 {
			ic.logger.Printf("Batch sent: %d accepted, %d rejected", ack.Accepted, ack.Rejected)
		}

		batch = batch[:0]
	}

	for {
		select {
		case req := <-ic.batchCh:
			batch = append(batch, req)
			if len(batch) >= ic.batchSize {
				flush()
			}

		case <-ticker.C:
			flush()

		case <-ic.stopCh:
			// Drain remaining messages
			for {
				select {
				case req := <-ic.batchCh:
					batch = append(batch, req)
				default:
					flush()
					return
				}
			}
		}
	}
}

// Close gracefully shuts down the client, flushing any pending batch.
func (ic *IngestBatchClient) Close() error {
	close(ic.stopCh)
	ic.wg.Wait()
	return ic.conn.Close()
}
