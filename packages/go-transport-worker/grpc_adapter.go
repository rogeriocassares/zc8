package transport

import (
	"context"
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	"google.golang.org/grpc"
)

// GRPCAdapter handles gRPC connections for a worker
type GRPCAdapter struct {
	worker      *Worker
	server      *grpc.Server
	listener    net.Listener
	mu          sync.RWMutex
	stopCh      chan struct{}
	stopOnce    sync.Once
	logger      *log.Logger
	wp          *WorkerPool
	clientCount int64
}

// NewGRPCAdapter creates a new gRPC adapter
func NewGRPCAdapter(worker *Worker, wp *WorkerPool, logger *log.Logger) *GRPCAdapter {
	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[gRPC:%s] ", worker.ID), log.LstdFlags)
	}
	return &GRPCAdapter{
		worker: worker,
		wp:     wp,
		stopCh: make(chan struct{}),
		logger: logger,
	}
}

// Start initializes the gRPC server
func (ga *GRPCAdapter) Start() error {
	ga.logger.Printf("Starting gRPC adapter for %s", ga.worker.ProviderName)

	// Create listener
	addr := fmt.Sprintf("%s:%d", ga.worker.Config.Host, ga.worker.Config.Port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		ga.logger.Printf("Failed to listen on %s: %v", addr, err)
		return err
	}

	// Create gRPC server with options
	opts := []grpc.ServerOption{
		grpc.MaxConcurrentStreams(100),
		grpc.ConnectionTimeout(30 * time.Second),
		grpc.KeepaliveParams(keepalive.ServerParameters{
			MaxIdle:     5 * time.Minute,
			MaxAgeGrace: 30 * time.Second,
			Time:        2 * time.Hour,
			Timeout:     20 * time.Second,
		}),
	}

	server := grpc.NewServer(opts...)

	// Register services (placeholder - implement actual services based on your protos)
	// pb.RegisterDeviceServiceServer(server, &grpcServiceImpl{adapter: ga})

	ga.mu.Lock()
	ga.server = server
	ga.listener = listener
	ga.worker.Connection = server
	ga.worker.Active = true
	ga.worker.ConnectedAt = time.Now()
	ga.mu.Unlock()

	ga.logger.Printf("gRPC server listening on %s", addr)

	// Start serving in background
	go func() {
		if err := server.Serve(listener); err != nil {
			ga.logger.Printf("Server error: %v", err)
		}
	}()

	// Monitor in background
	go ga.monitorClients()

	return nil
}

// monitorClients keeps track of connected clients
func (ga *GRPCAdapter) monitorClients() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ga.stopCh:
			return
		case <-ticker.C:
			// Log status
			ga.mu.RLock()
			clientCount := ga.clientCount
			ga.mu.RUnlock()

			if clientCount > 0 {
				ga.logger.Printf("Active clients: %d", clientCount)
			}
		}
	}
}

// RouteGRPCMessage handles incoming gRPC messages
func (ga *GRPCAdapter) RouteGRPCMessage(ctx context.Context, clientID string, payload map[string]interface{}) error {
	ga.mu.RLock()
	teamID := ga.worker.TeamID
	teamName := ga.worker.TeamName
	providerID := ga.worker.ProviderID
	providerName := ga.worker.ProviderName
	workerID := ga.worker.ID
	ga.mu.RUnlock()

	// Extract device key from client credentials or payload
	deviceKey := extractDeviceKeyGRPC(clientID, payload)

	// Route to unified ingest
	ingestMsg := Message{
		WorkerID:      workerID,
		TransportType: "grpc",
		TeamID:        teamID,
		TeamName:      teamName,
		ProviderID:    providerID,
		ProviderName:  providerName,
		DeviceKey:     deviceKey,
		Payload:       payload,
		Metadata: map[string]interface{}{
			"client_id":   clientID,
			"received_at": time.Now(),
		},
		ReceivedAt:  time.Now(),
		ProcessedAt: time.Now(),
	}

	ga.wp.RouteMessage(ingestMsg)

	ga.mu.Lock()
	ga.worker.MessageCount++
	ga.worker.LastMessageAt = time.Now()
	ga.mu.Unlock()

	ga.logger.Printf("Message routed from gRPC client %s (device: %s)", clientID, deviceKey)
	return nil
}

// Stop gracefully stops the gRPC adapter
func (ga *GRPCAdapter) Stop() {
	ga.stopOnce.Do(func() {
		ga.logger.Printf("Stopping gRPC adapter")
		close(ga.stopCh)

		ga.mu.Lock()
		if ga.server != nil {
			ga.server.GracefulStop()
			ga.logger.Printf("gRPC server stopped gracefully")
		}
		ga.worker.Active = false
		ga.mu.Unlock()
	})
}

// extractDeviceKeyGRPC extracts device key from gRPC client metadata
func extractDeviceKeyGRPC(clientID string, payload map[string]interface{}) string {
	// First try to get from payload
	if deviceKey, ok := payload["device_id"].(string); ok {
		return deviceKey
	}
	if deviceKey, ok := payload["device_eui"].(string); ok {
		return deviceKey
	}
	if deviceKey, ok := payload["device_key"].(string); ok {
		return deviceKey
	}

	// Fallback: use client ID as device identifier
	return clientID
}

// GetStatus returns adapter status
func (ga *GRPCAdapter) GetStatus() map[string]interface{} {
	ga.mu.RLock()
	defer ga.mu.RUnlock()

	active := false
	addr := ""
	if ga.listener != nil {
		active = true
		addr = ga.listener.Addr().String()
	}

	return map[string]interface{}{
		"worker_id":     ga.worker.ID,
		"transport":     "grpc",
		"provider":      ga.worker.ProviderName,
		"address":       addr,
		"active":        active,
		"client_count":  ga.clientCount,
		"message_count": ga.worker.MessageCount,
		"error_count":   ga.worker.ErrorCount,
	}
}

// Helper for gRPC server parameters (would be imported from google.golang.org/grpc/keepalive)
type keepalive struct {
	ServerParameters struct {
		MaxIdle     time.Duration
		MaxAgeGrace time.Duration
		Time        time.Duration
		Timeout     time.Duration
	}
}

// Placeholder gRPC service implementation
type grpcServiceImpl struct {
	adapter *GRPCAdapter
}

// Example RPC method (placeholder)
func (s *grpcServiceImpl) SendDeviceData(ctx context.Context, req interface{}) (interface{}, error) {
	// This would be a real protobuf message in production
	// Extract client ID from metadata
	clientID := ""
	if md, ok := ctx.Value("metadata").(map[string]string); ok {
		clientID = md["client_id"]
	}

	// Convert request to payload
	payload := make(map[string]interface{})
	// payload["data"] = req (would be real data from proto)

	// Route message
	if err := s.adapter.RouteGRPCMessage(ctx, clientID, payload); err != nil {
		return nil, err
	}

	// Return success response
	return map[string]interface{}{"status": "ok"}, nil
}
