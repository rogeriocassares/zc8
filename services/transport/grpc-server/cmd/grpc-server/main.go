package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	tcfg "github.com/rogeriocassares/zc8/packages/go-config/transport"
	infragrpc "github.com/rogeriocassares/zc8/packages/go-infra/grpc"
	transport "github.com/rogeriocassares/zc8/packages/go-transport"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
	grpcserver "github.com/rogeriocassares/zc8/services/transport/grpc-server/internal"
	"google.golang.org/grpc"
)

type Config struct {
	DatabaseURL string
	ListenPort  int
}

func loadConfig() Config {
	return Config{
		DatabaseURL: getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/zc8"),
		ListenPort:  getenvInt("LISTEN_PORT", 50051),
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		var i int
		if _, err := fmt.Sscanf(v, "%d", &i); err == nil {
			return i
		}
	}
	return def
}

// grpcHandler dispatches incoming IngestRequests to the correct adapter
// based on DeviceContext metadata, or to a default adapter.
type grpcHandler struct {
	pb.UnimplementedTelemetryIngestServiceServer
	mu       sync.RWMutex
	adapters map[int64]*grpcserver.GRPCServerAdapter
	// Default adapter for requests without explicit transport routing
	defaultAdapter *grpcserver.GRPCServerAdapter
	ingestSink     transport.IngestSink
	logger         *log.Logger
}

func (h *grpcHandler) IngestUnary(ctx context.Context, req *pb.IngestRequest) (*pb.IngestAck, error) {
	adapter := h.resolveAdapter(req)
	if adapter == nil {
		// Forward directly to downstream ingest service
		if !h.ingestSink.Submit(req) {
			return &pb.IngestAck{EventId: req.EventId, Status: pb.IngestStatus_INGEST_BACKPRESSURE, Reason: "queue full"}, nil
		}
		return &pb.IngestAck{EventId: req.EventId, Status: pb.IngestStatus_INGEST_OK}, nil
	}
	return adapter.HandleIngestRequest(ctx, req)
}

func (h *grpcHandler) IngestBatch(ctx context.Context, batchReq *pb.IngestBatchRequest) (*pb.IngestBatchAck, error) {
	acks := make([]*pb.IngestAck, 0, len(batchReq.Requests))
	var accepted, rejected int32

	for _, req := range batchReq.Requests {
		ack, err := h.IngestUnary(ctx, req)
		if err != nil {
			acks = append(acks, &pb.IngestAck{EventId: req.EventId, Status: pb.IngestStatus_INGEST_INTERNAL_ERROR, Reason: err.Error()})
			rejected++
		} else {
			acks = append(acks, ack)
			if ack.Status == pb.IngestStatus_INGEST_OK {
				accepted++
			} else {
				rejected++
			}
		}
	}

	return &pb.IngestBatchAck{Acks: acks, Accepted: accepted, Rejected: rejected}, nil
}

func (h *grpcHandler) resolveAdapter(req *pb.IngestRequest) *grpcserver.GRPCServerAdapter {
	h.mu.RLock()
	defer h.mu.RUnlock()
	// Could route by team_id or org_id from DeviceContext
	if h.defaultAdapter != nil {
		return h.defaultAdapter
	}
	return nil
}

func (h *grpcHandler) setAdapter(id int64, a *grpcserver.GRPCServerAdapter) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.adapters[id] = a
	if h.defaultAdapter == nil {
		h.defaultAdapter = a
	}
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Starting gRPC Server Transport Adapter...")

	cfg := loadConfig()

	db, err := transport.OpenDatabase(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer db.Close()
	log.Println("Database connected")

	logger := log.New(log.Writer(), "[gRPC-Server] ", log.LstdFlags)

	sinkCfg := transport.SinkConfigFromEnv("grpc-server")
	ingestSink, err := transport.NewIngestSink(sinkCfg, logger)
	if err != nil {
		log.Fatalf("Failed to create ingest sink: %v", err)
	}
	defer ingestSink.Close()
	parserRegistry := transport.NewParserRegistry(db, logger)
	deviceLookup := transport.NewDeviceLookup(db, logger)

	loadCtx, loadCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := parserRegistry.LoadFromDatabase(loadCtx); err != nil {
		logger.Printf("Warning: failed to load parsers: %v", err)
	}
	loadCancel()

	handler := &grpcHandler{
		adapters:   make(map[int64]*grpcserver.GRPCServerAdapter),
		ingestSink: ingestSink,
		logger:     logger,
	}

	handleMessage := func(msg *transport.Message) {
		if msg == nil {
			return
		}
		req := transport.MessageToProto(msg)
		if !ingestSink.Submit(req) {
			logger.Printf("Ingest queue full, dropped message for device %s", msg.DeviceKey)
		}
	}

	adapterFactory := func(entry *transport.TransportEntry, typedCfg *tcfg.TransportConfig) (transport.Adapter, error) {
		if typedCfg.GRPC == nil {
			return nil, fmt.Errorf("gRPC config is nil for transport %d", entry.ID)
		}
		adapter := grpcserver.NewGRPCServerAdapter(
			entry,
			typedCfg.GRPC,
			parserRegistry,
			deviceLookup,
			handleMessage,
			nil,
		)
		handler.setAdapter(entry.ID, adapter)
		logger.Printf("Registered gRPC adapter for transport %d (service: %s)", entry.ID, typedCfg.GRPC.ServiceName)
		return adapter, nil
	}

	manager := transport.NewWorkerManager(transport.WorkerManagerConfig{
		DB:                db,
		TransportTypeCode: "grpc-server",
		ConfigType:        "grpc",
		DiscoveryInterval: 30 * time.Second,
		AdapterFactory:    adapterFactory,
		Logger:            logger,
	})

	startCtx, startCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := manager.Start(startCtx); err != nil {
		startCancel()
		log.Fatalf("Failed to start worker manager: %v", err)
	}
	startCancel()

	// Start gRPC server
	srv := infragrpc.NewServer(
		grpc.UnaryInterceptor(infragrpc.UnaryServerInterceptor(logger)),
		grpc.StreamInterceptor(infragrpc.StreamServerInterceptor(logger)),
	)
	pb.RegisterTelemetryIngestServiceServer(srv, handler)

	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.ListenPort))
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	go func() {
		log.Printf("gRPC server listening on :%d", cfg.ListenPort)
		if err := srv.Serve(lis); err != nil {
			log.Fatalf("gRPC serve error: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	log.Println("gRPC Server Transport running. Press Ctrl+C to stop.")
	<-sigCh

	log.Println("Shutting down...")
	srv.GracefulStop()
	manager.Stop()
	log.Println("Shutdown complete")
}
