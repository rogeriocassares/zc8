package grpc

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// BatchingClientConfig configures batching behavior
type BatchingClientConfig struct {
	// Base streaming config
	StreamingConfig StreamingClientConfig

	// Batching strategy
	BatchSize     int  // Max messages per batch (e.g., 1000)
	FlushMs       int  // Max time between flushes (e.g., 100ms)
	NumBatchers   int  // Concurrent batcher goroutines (default 4)
	EnableMetrics bool // Track batching metrics
}

// DefaultBatchingClientConfig returns sensible defaults for 10M msg/sec
func DefaultBatchingClientConfig() BatchingClientConfig {
	return BatchingClientConfig{
		StreamingConfig: StreamingClientConfig{
			IngestServiceAddr:     "localhost:50051",
			MaxReconnectAttempts:  5,
			ReconnectBackoffMs:    1000,
			SendQueueSize:         10000, // Larger queue for batch accumulation
			ReceiveQueueSize:      100,
			NumWorkers:            4, // More workers to handle batches
			RequestTimeoutMs:      5000,
			EnableDetailedLogging: false,
		},
		BatchSize:     1000, // 1000 messages per batch
		FlushMs:       100,  // Flush every 100ms max
		NumBatchers:   4,    // 4 concurrent batchers
		EnableMetrics: true,
	}
}

// BatchingClient wraps StreamingClient with batching logic
type BatchingClient struct {
	config BatchingClientConfig
	client *StreamingClient
	logger *log.Logger

	// Input queue for individual envelopes
	inputQueue chan *pb.IngestEnvelope

	// Batcher goroutines
	batchers  int
	batcherWg sync.WaitGroup
	done      chan struct{}

	// Metrics
	mu           sync.RWMutex
	batchCount   uint64
	messageCount uint64
	errorCount   uint64
}

// NewBatchingClient creates a new batching client wrapping StreamingClient
func NewBatchingClient(config BatchingClientConfig, logger *log.Logger) (*BatchingClient, error) {
	// Create underlying streaming client
	streamingClient, err := NewStreamingClient(config.StreamingConfig, logger)
	if err != nil {
		return nil, fmt.Errorf("failed to create streaming client: %w", err)
	}

	bc := &BatchingClient{
		config:     config,
		client:     streamingClient,
		logger:     logger,
		inputQueue: make(chan *pb.IngestEnvelope, config.StreamingConfig.SendQueueSize),
		batchers:   config.NumBatchers,
		done:       make(chan struct{}),
	}

	// Start batcher goroutines
	for i := 0; i < bc.batchers; i++ {
		bc.batcherWg.Add(1)
		go bc.batcherLoop(i)
	}

	bc.logger.Printf("[BatchingClient] Started with batch_size=%d, flush_ms=%d, num_batchers=%d",
		config.BatchSize, config.FlushMs, config.NumBatchers)

	return bc, nil
}

// batcherLoop accumulates messages into batches
func (bc *BatchingClient) batcherLoop(batcherID int) {
	defer bc.batcherWg.Done()

	batch := make([]*pb.IngestEnvelope, 0, bc.config.BatchSize)
	ticker := time.NewTicker(time.Duration(bc.config.FlushMs) * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-bc.done:
			// Flush remaining messages on shutdown
			if len(batch) > 0 {
				bc.flushBatch(batcherID, batch)
			}
			return

		case <-ticker.C:
			// Flush by time
			if len(batch) > 0 {
				batch = bc.flushBatch(batcherID, batch)
			}

		case env, ok := <-bc.inputQueue:
			if !ok {
				// Input queue closed, flush remaining
				if len(batch) > 0 {
					bc.flushBatch(batcherID, batch)
				}
				return
			}

			batch = append(batch, env)

			// Flush by size
			if len(batch) >= bc.config.BatchSize {
				batch = bc.flushBatch(batcherID, batch)
			}
		}
	}
}

// flushBatch sends accumulated batch to streaming client
func (bc *BatchingClient) flushBatch(batcherID int, batch []*pb.IngestEnvelope) []*pb.IngestEnvelope {
	if len(batch) == 0 {
		return batch
	}

	size := len(batch)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Send each envelope individually through StreamingClient
	for _, env := range batch {
		if err := bc.client.Send(ctx, env); err != nil {
			bc.mu.Lock()
			bc.errorCount++
			bc.mu.Unlock()

			bc.logger.Printf("[BatchingClient] Batcher %d flush error: %v", batcherID, err)
			return batch // Retry on next flush
		}
	}

	bc.mu.Lock()
	bc.batchCount++
	bc.messageCount += uint64(size)
	bc.mu.Unlock()

	if bc.config.EnableMetrics {
		bc.logger.Printf("[BatchingClient] Batcher %d flushed %d messages", batcherID, size)
	}

	return make([]*pb.IngestEnvelope, 0, bc.config.BatchSize)
}

// Send adds an envelope to be batched and sent
func (bc *BatchingClient) Send(ctx context.Context, req *pb.IngestEnvelope) error {
	select {
	case bc.inputQueue <- req:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("context cancelled")
	case <-bc.done:
		return fmt.Errorf("batching client is closed")
	}
}

// IsConnected returns true if underlying streaming client is connected
func (bc *BatchingClient) IsConnected() bool {
	return bc.client.IsConnected()
}

// GetMetrics returns batching statistics
func (bc *BatchingClient) GetMetrics() map[string]uint64 {
	bc.mu.RLock()
	defer bc.mu.RUnlock()

	streamMetrics := bc.client.GetMetrics()
	return map[string]uint64{
		"batches_sent":     bc.batchCount,
		"messages_batched": bc.messageCount,
		"batching_errors":  bc.errorCount,
		"stream_sent":      streamMetrics["sent_count"],
		"stream_errors":    streamMetrics["error_count"],
	}
}

// Close closes the batching client and underlying streaming client
func (bc *BatchingClient) Close() error {
	close(bc.done)
	close(bc.inputQueue)
	bc.batcherWg.Wait()
	return bc.client.Close()
}
