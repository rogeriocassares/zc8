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

	command "github.com/rogeriocassares/zc8/packages/go-command"
	infragrpc "github.com/rogeriocassares/zc8/packages/go-infra/grpc"
	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	integration "github.com/rogeriocassares/zc8/packages/go-integration"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
	grpcserver "github.com/rogeriocassares/zc8/services/input/grpc-server/internal"
	"google.golang.org/grpc"
)

type Config struct {
	DatabaseURL string
	ListenPort  int
	NATSURL     string
}

func loadConfig() Config {
	return Config{
		DatabaseURL: getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/zc8?sslmode=disable"),
		ListenPort:  getenvInt("LISTEN_PORT", 50051),
		NATSURL:     getenv("NATS_URL", "nats://localhost:4222"),
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
	// Default adapter for requests without explicit routing
	defaultAdapter *grpcserver.GRPCServerAdapter
	ingestSink     integration.IngestSink
	logger         *log.Logger
}

func (h *grpcHandler) IngestUnary(ctx context.Context, env *pb.IngestEnvelope) (*pb.IngestAck, error) {
	adapter := h.resolveAdapter(env)
	if adapter == nil {
		// Forward directly to downstream ingest sink
		if !h.ingestSink.Submit(env) {
			return &pb.IngestAck{EventId: env.EventId, Accepted: false, Reason: "queue full"}, nil
		}
		return &pb.IngestAck{EventId: env.EventId, Accepted: true}, nil
	}
	return adapter.HandleIngestEnvelope(ctx, env)
}

func (h *grpcHandler) IngestBatch(ctx context.Context, batchReq *pb.IngestBatchRequest) (*pb.IngestBatchAck, error) {
	acks := make([]*pb.IngestAck, 0, len(batchReq.Envelopes))
	var accepted, rejected int32

	for _, env := range batchReq.Envelopes {
		ack, err := h.IngestUnary(ctx, env)
		if err != nil {
			acks = append(acks, &pb.IngestAck{EventId: env.EventId, Accepted: false, Reason: err.Error()})
			rejected++
		} else {
			acks = append(acks, ack)
			if ack.Accepted {
				accepted++
			} else {
				rejected++
			}
		}
	}

	return &pb.IngestBatchAck{Acks: acks, Accepted: accepted, Rejected: rejected}, nil
}

func (h *grpcHandler) resolveAdapter(env *pb.IngestEnvelope) *grpcserver.GRPCServerAdapter {
	h.mu.RLock()
	defer h.mu.RUnlock()
	// Could route by team_id or org_id from Context
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
	log.Println("Starting gRPC Server Input Adapter...")

	cfg := loadConfig()

	db, err := integration.OpenDatabase(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer db.Close()
	log.Println("Database connected")

	logger := log.New(log.Writer(), "[gRPC-Server] ", log.LstdFlags)

	sinkCfg := integration.SinkConfigFromEnv("grpc-server")
	ingestSink, err := integration.NewIngestSink(sinkCfg, logger)
	if err != nil {
		log.Fatalf("Failed to create ingest sink: %v", err)
	}
	defer ingestSink.Close()
	parserRegistry := integration.NewParserRegistry(db, logger)
	deviceLookup := integration.NewDeviceLookup(db, logger)

	// COMMANDS stream client
	commandsJSClient, err := infranats.NewJetStream(context.Background(), infranats.JetStreamConfig{
		URL:        cfg.NATSURL,
		StreamName: "COMMANDS",
		Subjects:   []string{"commands.dispatch.>"},
		Replicas:   1,
	}, logger)
	if err != nil {
		log.Fatalf("Failed to connect to COMMANDS stream: %v", err)
	}
	defer commandsJSClient.Close()
	log.Println("COMMANDS JetStream ready")

	commandRegistry := command.NewRegistry()

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

	handleMessage := func(msg *integration.Message) {
		if msg == nil {
			return
		}
		rawEnv := integration.MessageToRawEnvelope(msg, nil, "")
		if !ingestSink.Submit(rawEnv) {
			logger.Printf("Ingest queue full (raw), dropped message for device %s", msg.DeviceKey)
		}
		decodedEnv := integration.MessageToDecodedEnvelope(msg)
		if !ingestSink.Submit(decodedEnv) {
			logger.Printf("Ingest queue full (decoded), dropped message for device %s", msg.DeviceKey)
		}
	}

	adapterFactory := func(entry *integration.IntegrationEntry) (integration.Adapter, error) {
		adapter := grpcserver.NewGRPCServerAdapter(
			db,
			entry,
			parserRegistry,
			deviceLookup,
			handleMessage,
			nil,
			commandsJSClient,
			commandRegistry,
		)
		handler.setAdapter(entry.ID, adapter)
		logger.Printf("Registered gRPC adapter for integration %d", entry.ID)
		return adapter, nil
	}

	manager := integration.NewWorkerManager(integration.WorkerManagerConfig{
		DB:                db,
		ServiceType:       "input.grpc-server",
		DiscoveryInterval: 30 * time.Second,
		AdapterFactory:    adapterFactory,
		SvcJS:             ingestSink.SvcJS(),
		StatusInterval:    15 * time.Second,
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

	healthSrv := integration.NewHealthServer(getenv("HEALTH_PORT", ":9090"), db, ingestSink.NatsConn())
	healthSrv.Start()
	log.Printf("Health server listening on %s", getenv("HEALTH_PORT", ":9090"))

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	log.Println("gRPC Server Input running. Press Ctrl+C to stop.")
	<-sigCh

	log.Println("Shutting down...")
	srv.GracefulStop()
	manager.Stop()
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 3*time.Second)
	healthSrv.Shutdown(shutCtx)
	shutCancel()
	log.Println("Shutdown complete")
}
