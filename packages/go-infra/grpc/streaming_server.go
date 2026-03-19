package grpc

import (
	"context"
	"fmt"
	"log"
	"sync"

	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
	"google.golang.org/grpc"
)

// IngestRequestHandler is the interface for handling ingest requests
type IngestRequestHandler interface {
	HandleIngestRequest(ctx context.Context, req *pb.IngestRequest) (*pb.IngestAck, error)
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

// StreamingServer handles bidirectional streaming for ingest requests
type StreamingServer struct {
	config  StreamingServerConfig
	handler IngestRequestHandler
	logger  *log.Logger

	statsMu        sync.RWMutex
	receivedCount  uint64
	processedCount uint64
	errorCount     uint64
}

// NewStreamingServer creates a new streaming server
func NewStreamingServer(
	config StreamingServerConfig,
	handler IngestRequestHandler,
	logger *log.Logger,
) *StreamingServer {
	return &StreamingServer{
		config:  config,
		handler: handler,
		logger:  logger,
	}
}

// IngestStream implements the bidirectional streaming RPC
func (ss *StreamingServer) IngestStream(stream grpc.BidiStreamingServer[pb.IngestRequest, pb.IngestAck]) error {
	ss.logger.Println("[StreamingServer] New ingest stream connected")

	ctx := stream.Context()
	requestChan := make(chan *pb.IngestRequest, ss.config.NumWorkers*2)
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

// receiveRequests reads requests from the stream until error or context done
func (ss *StreamingServer) receiveRequests(
	ctx context.Context,
	stream grpc.ServerStream,
	requestChan chan<- *pb.IngestRequest,
	errChan chan<- error,
) {
	for {
		select {
		case <-ctx.Done():
			close(requestChan)
			return
		default:
		}

		var req pb.IngestRequest
		if err := stream.RecvMsg(&req); err != nil {
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
			ss.logger.Printf("[StreamingServer] Received request: %s from device %d", req.EventId, req.DeviceKey)
		}

		select {
		case requestChan <- &req:
		case <-ctx.Done():
			close(requestChan)
			return
		}
	}
}

// processRequests processes incoming requests using worker goroutines
func (ss *StreamingServer) processRequests(
	ctx context.Context,
	workerID int,
	requestChan <-chan *pb.IngestRequest,
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

		case req, ok := <-requestChan:
			if !ok {
				if ss.config.EnableDetailedLogging {
					ss.logger.Printf("[StreamingServer] Worker %d channel closed", workerID)
				}
				return
			}

			ack, err := ss.handler.HandleIngestRequest(ctx, req)
			if err != nil {
				ss.logger.Printf("[StreamingServer] Worker %d handler error: %v", workerID, err)
				ss.statsMu.Lock()
				ss.errorCount++
				ss.statsMu.Unlock()

				ack = &pb.IngestAck{
					EventId: req.EventId,
					Status:  pb.IngestStatus_INGEST_INTERNAL_ERROR,
					Reason:  fmt.Sprintf("Handler error: %v", err),
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
func (ss *StreamingServer) IngestUnary(ctx context.Context, req *pb.IngestRequest) (*pb.IngestAck, error) {
	ss.statsMu.Lock()
	ss.receivedCount++
	ss.statsMu.Unlock()

	ack, err := ss.handler.HandleIngestRequest(ctx, req)
	if err != nil {
		ss.statsMu.Lock()
		ss.errorCount++
		ss.statsMu.Unlock()
		return &pb.IngestAck{
			EventId: req.EventId,
			Status:  pb.IngestStatus_INGEST_INTERNAL_ERROR,
			Reason:  err.Error(),
		}, nil
	}

	ss.statsMu.Lock()
	ss.processedCount++
	ss.statsMu.Unlock()

	return ack, nil
}
