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

// StreamingClientConfig holds configuration for streaming client
type StreamingClientConfig struct {
	IngestServiceAddr     string
	MaxReconnectAttempts  int
	ReconnectBackoffMs    int
	SendQueueSize         int
	ReceiveQueueSize      int
	NumWorkers            int
	RequestTimeoutMs      int
	EnableDetailedLogging bool
}

// DefaultStreamingClientConfig returns sensible defaults
func DefaultStreamingClientConfig() StreamingClientConfig {
	return StreamingClientConfig{
		IngestServiceAddr:     "localhost:50051",
		MaxReconnectAttempts:  5,
		ReconnectBackoffMs:    1000,
		SendQueueSize:         1000,
		ReceiveQueueSize:      100,
		NumWorkers:            1,
		RequestTimeoutMs:      5000,
		EnableDetailedLogging: false,
	}
}

// StreamingClient manages a long-lived bidirectional stream to ingest service
type StreamingClient struct {
	config   StreamingClientConfig
	conn     *grpc.ClientConn
	client   pb.TelemetryIngestServiceClient
	stream   grpc.BidiStreamingClient[pb.IngestEnvelope, pb.IngestAck]
	streamMu sync.Mutex
	logger   *log.Logger

	sendQueue chan *pb.IngestEnvelope
	recvQueue chan *pb.IngestAck
	errQueue  chan error

	mu          sync.RWMutex
	isConnected bool
	ctx         context.Context
	cancel      context.CancelFunc
	done        chan struct{}

	workers     int
	workerWg    sync.WaitGroup
	workerReady chan struct{}

	statsMu        sync.RWMutex
	sentCount      uint64
	recvCount      uint64
	errorCount     uint64
	reconnectCount uint64
}

// NewStreamingClient creates a new streaming client
func NewStreamingClient(config StreamingClientConfig, logger *log.Logger) (*StreamingClient, error) {
	if config.IngestServiceAddr == "" {
		config.IngestServiceAddr = "localhost:50051"
	}

	sc := &StreamingClient{
		config:      config,
		logger:      logger,
		sendQueue:   make(chan *pb.IngestEnvelope, config.SendQueueSize),
		recvQueue:   make(chan *pb.IngestAck, config.ReceiveQueueSize),
		errQueue:    make(chan error, 10),
		done:        make(chan struct{}),
		workers:     config.NumWorkers,
		workerReady: make(chan struct{}, config.NumWorkers),
	}

	sc.ctx, sc.cancel = context.WithCancel(context.Background())

	if err := sc.connect(); err != nil {
		return nil, fmt.Errorf("failed to connect to ingest service: %w", err)
	}

	sc.startWorkers()

	sc.workerWg.Add(1)
	go sc.receiveLoop()

	sc.logger.Println("[StreamingClient] Initialized and connected")
	return sc, nil
}

// connect establishes connection and creates stream
func (sc *StreamingClient) connect() error {
	conn, err := grpc.NewClient(
		sc.config.IngestServiceAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return fmt.Errorf("failed to dial: %w", err)
	}

	client := pb.NewTelemetryIngestServiceClient(conn)
	stream, err := client.IngestStream(sc.ctx)
	if err != nil {
		conn.Close()
		return fmt.Errorf("failed to create stream: %w", err)
	}

	sc.conn = conn
	sc.client = client
	sc.stream = stream

	sc.mu.Lock()
	sc.isConnected = true
	sc.mu.Unlock()

	return nil
}

// reconnect attempts to reconnect with backoff
func (sc *StreamingClient) reconnect() error {
	sc.streamMu.Lock()
	defer sc.streamMu.Unlock()

	if sc.conn != nil {
		sc.conn.Close()
	}

	for attempt := 0; attempt < sc.config.MaxReconnectAttempts; attempt++ {
		backoff := time.Duration(sc.config.ReconnectBackoffMs*(1<<uint(attempt))) * time.Millisecond
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}

		sc.logger.Printf("[StreamingClient] Reconnect attempt %d/%d (backoff: %v)",
			attempt+1, sc.config.MaxReconnectAttempts, backoff)

		time.Sleep(backoff)

		if err := sc.connect(); err == nil {
			sc.mu.Lock()
			sc.statsMu.Lock()
			sc.reconnectCount++
			sc.statsMu.Unlock()
			sc.mu.Unlock()
			sc.logger.Println("[StreamingClient] Reconnected successfully")
			return nil
		}
	}

	sc.mu.Lock()
	sc.isConnected = false
	sc.mu.Unlock()

	return fmt.Errorf("failed to reconnect after %d attempts", sc.config.MaxReconnectAttempts)
}

// startWorkers starts worker goroutines
func (sc *StreamingClient) startWorkers() {
	for i := 0; i < sc.workers; i++ {
		sc.workerWg.Add(1)
		go sc.sendWorker(i)
	}
}

// sendWorker processes requests from sendQueue
func (sc *StreamingClient) sendWorker(workerID int) {
	defer sc.workerWg.Done()

	if sc.config.EnableDetailedLogging {
		sc.logger.Printf("[StreamingClient] Worker %d started", workerID)
	}

	for {
		select {
		case <-sc.ctx.Done():
			if sc.config.EnableDetailedLogging {
				sc.logger.Printf("[StreamingClient] Worker %d stopped", workerID)
			}
			return

		case req, ok := <-sc.sendQueue:
			if !ok {
				return
			}

			ctx, cancel := context.WithTimeout(sc.ctx, time.Duration(sc.config.RequestTimeoutMs)*time.Millisecond)
			err := sc.sendRequest(ctx, req)
			cancel()

			if err != nil {
				sc.statsMu.Lock()
				sc.errorCount++
				sc.statsMu.Unlock()

				sc.logger.Printf("[StreamingClient] Worker %d send error: %v, attempting reconnect", workerID, err)

				if err := sc.reconnect(); err != nil {
					sc.errQueue <- fmt.Errorf("send failed and reconnect failed: %w", err)
					return
				}

				ctx, cancel := context.WithTimeout(sc.ctx, time.Duration(sc.config.RequestTimeoutMs)*time.Millisecond)
				if err := sc.sendRequest(ctx, req); err != nil {
					cancel()
					sc.errQueue <- fmt.Errorf("send failed after reconnect: %w", err)
					return
				}
				cancel()
			}

			sc.statsMu.Lock()
			sc.sentCount++
			sc.statsMu.Unlock()
		}
	}
}

// sendRequest sends a single request on the stream
func (sc *StreamingClient) sendRequest(ctx context.Context, req *pb.IngestEnvelope) error {
	sc.streamMu.Lock()
	defer sc.streamMu.Unlock()

	if !sc.isConnected {
		return fmt.Errorf("not connected to ingest service")
	}

	if err := sc.stream.Send(req); err != nil {
		return err
	}

	return nil
}

// receiveLoop continuously receives responses from stream
func (sc *StreamingClient) receiveLoop() {
	defer sc.workerWg.Done()

	sc.logger.Println("[StreamingClient] Receive loop started")

	for {
		select {
		case <-sc.ctx.Done():
			sc.logger.Println("[StreamingClient] Receive loop stopped")
			return
		default:
		}

		sc.streamMu.Lock()
		if !sc.isConnected {
			sc.streamMu.Unlock()
			time.Sleep(100 * time.Millisecond)
			continue
		}

		stream := sc.stream
		sc.streamMu.Unlock()

		ack, err := stream.Recv()

		if err != nil {
			sc.statsMu.Lock()
			sc.errorCount++
			sc.statsMu.Unlock()

			sc.logger.Printf("[StreamingClient] Receive error: %v, attempting reconnect", err)

			if err := sc.reconnect(); err != nil {
				sc.errQueue <- fmt.Errorf("receive failed and reconnect failed: %w", err)
				return
			}
			continue
		}

		sc.statsMu.Lock()
		sc.recvCount++
		sc.statsMu.Unlock()

		select {
		case sc.recvQueue <- ack:
		case <-sc.ctx.Done():
			return
		}
	}
}

// Send sends a request to ingest service (queued for worker processing)
func (sc *StreamingClient) Send(ctx context.Context, req *pb.IngestEnvelope) error {
	select {
	case sc.sendQueue <- req:
		return nil
	case <-sc.ctx.Done():
		return fmt.Errorf("streaming client is closed")
	case <-ctx.Done():
		return fmt.Errorf("context cancelled")
	}
}

// Receive returns the next response from ingest service (non-blocking)
func (sc *StreamingClient) Receive(ctx context.Context) (*pb.IngestAck, error) {
	select {
	case ack := <-sc.recvQueue:
		return ack, nil
	case err := <-sc.errQueue:
		return nil, err
	case <-sc.ctx.Done():
		return nil, fmt.Errorf("streaming client is closed")
	case <-ctx.Done():
		return nil, fmt.Errorf("context cancelled")
	}
}

// ReceiveBatch receives multiple responses (blocking with timeout)
func (sc *StreamingClient) ReceiveBatch(ctx context.Context, maxSize int) ([]*pb.IngestAck, error) {
	acks := make([]*pb.IngestAck, 0, maxSize)
	timer := time.NewTimer(1 * time.Second)
	defer timer.Stop()

	for i := 0; i < maxSize; i++ {
		select {
		case ack := <-sc.recvQueue:
			acks = append(acks, ack)
		case err := <-sc.errQueue:
			return acks, err
		case <-timer.C:
			return acks, nil
		case <-sc.ctx.Done():
			return acks, fmt.Errorf("streaming client is closed")
		case <-ctx.Done():
			return acks, fmt.Errorf("context cancelled")
		}
	}
	return acks, nil
}

// IsConnected returns true if stream is active
func (sc *StreamingClient) IsConnected() bool {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	return sc.isConnected
}

// Stats returns current statistics
func (sc *StreamingClient) Stats() (sent, recv, errors, reconnects uint64) {
	sc.statsMu.RLock()
	defer sc.statsMu.RUnlock()
	return sc.sentCount, sc.recvCount, sc.errorCount, sc.reconnectCount
}

// GetMetrics returns metrics as a map for easier consumption
func (sc *StreamingClient) GetMetrics() map[string]uint64 {
	sent, recv, errs, reconn := sc.Stats()
	return map[string]uint64{
		"sent_count":      sent,
		"recv_count":      recv,
		"error_count":     errs,
		"reconnect_count": reconn,
	}
}

// Close closes the streaming client gracefully
func (sc *StreamingClient) Close() error {
	sc.cancel()

	close(sc.sendQueue)

	sc.workerWg.Wait()

	sc.streamMu.Lock()
	if sc.stream != nil {
		sc.stream.CloseSend()
	}
	if sc.conn != nil {
		sc.conn.Close()
	}
	sc.streamMu.Unlock()

	sc.logger.Println("[StreamingClient] Closed")
	return nil
}
