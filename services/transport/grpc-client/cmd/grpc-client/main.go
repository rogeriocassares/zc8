package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	tcfg "github.com/rogeriocassares/zc8/packages/go-config/transport"
	transport "github.com/rogeriocassares/zc8/packages/go-transport"
	grpcclient "github.com/rogeriocassares/zc8/services/transport/grpc-client/internal"
)

type Config struct {
	DatabaseURL string
}

func loadConfig() Config {
	return Config{
		DatabaseURL: getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/zc8"),
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Starting gRPC Client Transport Adapter...")

	cfg := loadConfig()

	db, err := transport.OpenDatabase(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer db.Close()
	log.Println("Database connected")

	logger := log.New(log.Writer(), "[gRPC-Client] ", log.LstdFlags)

	sinkCfg := transport.SinkConfigFromEnv("grpc-client")
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
		adapter := grpcclient.NewGRPCClientAdapter(
			entry,
			typedCfg.GRPC,
			parserRegistry,
			deviceLookup,
			handleMessage,
			nil,
		)
		return adapter, nil
	}

	manager := transport.NewWorkerManager(transport.WorkerManagerConfig{
		DB:                db,
		TransportTypeCode: "grpc-client",
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

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	log.Println("gRPC Client Transport running. Press Ctrl+C to stop.")
	<-sigCh

	log.Println("Shutting down...")
	manager.Stop()
	log.Println("Shutdown complete")
}
