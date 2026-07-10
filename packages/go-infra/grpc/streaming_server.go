package grpc

import (
	"context"
	"fmt"
	"log"
	"sync"

	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
	"google.golang.org/grpc"
)

// IngestEnvelopeHandler is the interface for handling ingest envelopes
type IngestEnvelopeHandler interface {
	HandleIngestEnvelope(ctx context.Context, env *pb.IngestEnvelope) (*pb.IngestAck, error)
}

// StreamingServerConfig holds configuration for streaming server
type StreamingServerConfig struct {
	NumWorkers            int
	EnableDetailedLogging bool
}

// DefaultStreamingServerConfig returns sensible defaults
func DefaultStreamingServerConfig() StreamingServerConfig {
	return StreamingServerConfig{
		NumWorkers:            4,
		EnableDetailedLogging: false,
	}
}

// StreamingServer handles bidirectional streaming for ingest envelopes
type StreamingServer struct {
	config  StreamingServerConfig
	handler IngestEnvelopeHandler
	logger  *log.Logger

	statsMu        sync.RWMutex
	receivedCount  uint64
	processedCount uint64
	errorCount     uint64
}

// NewStreamingServer creates a new streaming server
func NewStreamingServer(
	config StreamingServerConfig,
	handler IngestEnvelopeHandler,
	logger *log.Logger,
) *StreamingServer {
	return &StreamingServer{
		config:  config,
		handler: handler,
		logger:  logger,
	}
}

// IngestStream implements the bidirectional streaming RPC
func (ss *StreamingServer) IngestStream(stream grpc.BidiStreamingServer[pb.IngestEnvelope, pb.IngestAck]) error {
	ss.logger.Println("[StreamingServer] New ingest stream connected")

	ctx := stream.Context()
	requestChan := make(chan *pb.IngestEnvelope, ss.config.NumWorkers*2)
	ackChan := make(chan *pb.IngestAck, ss.config.NumWorkers*2)
	errChan := make(chan error, 1)

	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		ss.receiveRequests(ctx, stream, requestChan, errChan)
	}()

	for i := 0; i < ss.config.NumWorkers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			ss.processRequests(ctx, workerID, requestChan, ackChan, errChan)
		}(i)
	}

	wg.Add(1)
	go func() {
		defer wg.Done()
		ss.sendAcks(ctx, stream, ackChan, errChan)
	}()

	wg.Wait()

	ss.logger.Println("[StreamingServer] Ingest stream closed")
	return nil
}

// receiveRequests reads envelopes from the stream until error or context done
func (ss *StreamingServer) receiveRequests(
	ctx context.Context,
	stream grpc.ServerStream,
	requestChan chan<- *pb.IngestEnvelope,
	errChan chan<- error,
) {
	for {
		select {
		case <-ctx.Done():
			close(requestChan)
			return
		default:
		}

		var env pb.IngestEnvelope
		if err := stream.RecvMsg(&env); err != nil {
			close(requestChan)
			if err.Error() != "EOF" {
				ss.logger.Printf("[StreamingServer] Receive error: %v", err)
				errChan <- err
			}
			return
		}

		ss.statsMu.Lock()
		ss.receivedCount++
		ss.statsMu.Unlock()

		if ss.config.EnableDetailedLogging {
			ss.logger.Printf("[StreamingServer] Received envelope: %s from device %d", env.EventId, env.DeviceKey)
		}

		select {
		case requestChan <- &env:
		case <-ctx.Done():
			close(requestChan)
			return
		}
	}
}

// processRequests processes incoming envelopes using worker goroutines
func (ss *StreamingServer) processRequests(
	ctx context.Context,
	workerID int,
	requestChan <-chan *pb.IngestEnvelope,
	ackChan chan<- *pb.IngestAck,
	errChan chan<- error,
) {
	if ss.config.EnableDetailedLogging {
		ss.logger.Printf("[StreamingServer] Worker %d started", workerID)
	}

	for {
		select {
		case <-ctx.Done():
			if ss.config.EnableDetailedLogging {
				ss.logger.Printf("[StreamingServer] Worker %d stopped", workerID)
			}
			return

		case env, ok := <-requestChan:
			if !ok {
				if ss.config.EnableDetailedLogging {
					ss.logger.Printf("[StreamingServer] Worker %d channel closed", workerID)
				}
				return
			}

			ack, err := ss.handler.HandleIngestEnvelope(ctx, env)
			if err != nil {
				ss.logger.Printf("[StreamingServer] Worker %d handler error: %v", workerID, err)
				ss.statsMu.Lock()
				ss.errorCount++
				ss.statsMu.Unlock()

				ack = &pb.IngestAck{
					EventId:  env.EventId,
					Accepted: false,
					Reason:   fmt.Sprintf("Handler error: %v", err),
				}
			} else {
				ss.statsMu.Lock()
				ss.processedCount++
				ss.statsMu.Unlock()
			}

			select {
			case ackChan <- ack:
			case <-ctx.Done():
				return
			}
		}
	}
}

// sendAcks sends acknowledgments back to client
func (ss *StreamingServer) sendAcks(
	ctx context.Context,
	stream grpc.ServerStream,
	ackChan <-chan *pb.IngestAck,
	errChan <-chan error,
) {
	for {
		select {
		case <-ctx.Done():
			return

		case err := <-errChan:
			if err != nil {
				ss.logger.Printf("[StreamingServer] Fatal error: %v", err)
				return
			}

		case ack, ok := <-ackChan:
			if !ok {
				return
			}

			if ss.config.EnableDetailedLogging {
				ss.logger.Printf("[StreamingServer] Sending ACK: %s", ack.EventId)
			}

			if err := stream.SendMsg(ack); err != nil {
				ss.logger.Printf("[StreamingServer] Send error: %v", err)
				return
			}
		}
	}
}

// Stats returns current statistics
func (ss *StreamingServer) Stats() (received, processed, errors uint64) {
	ss.statsMu.RLock()
	defer ss.statsMu.RUnlock()
	return ss.receivedCount, ss.processedCount, ss.errorCount
}

// IngestUnary implements the unary RPC (for simple single request-response)
func (ss *StreamingServer) IngestUnary(ctx context.Context, env *pb.IngestEnvelope) (*pb.IngestAck, error) {
	ss.statsMu.Lock()
	ss.receivedCount++
	ss.statsMu.Unlock()

	ack, err := ss.handler.HandleIngestEnvelope(ctx, env)
	if err != nil {
		ss.statsMu.Lock()
		ss.errorCount++
		ss.statsMu.Unlock()
		return &pb.IngestAck{
			EventId:  env.EventId,
			Accepted: false,
			Reason:   err.Error(),
		}, nil
	}

	ss.statsMu.Lock()
	ss.processedCount++
	ss.statsMu.Unlock()

	return ack, nil
}
