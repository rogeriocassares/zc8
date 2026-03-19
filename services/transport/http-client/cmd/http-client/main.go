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
	httpclient "github.com/rogeriocassares/zc8/services/transport/http-client/internal"
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
	log.Println("Starting HTTP Client Transport Adapter...")

	cfg := loadConfig()

	db, err := transport.OpenDatabase(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer db.Close()
	log.Println("Database connected")

	logger := log.New(log.Writer(), "[HTTP-Client] ", log.LstdFlags)

	sinkCfg := transport.SinkConfigFromEnv("http-client")
	ingestSink, err := transport.NewIngestSink(sinkCfg, logger)
	if err != nil {
		log.Fatalf("Failed to create ingest sink: %v", err)
	}
	defer ingestSink.Close()
	parserRegistry := transport.NewParserRegistry(db, logger)
	deviceLookup := transport.NewDeviceLookup(db, logger)

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
		if typedCfg.HTTP == nil {
			return nil, fmt.Errorf("HTTP config is nil for transport %d", entry.ID)
		}
		return httpclient.NewHTTPClientAdapter(
			entry,
			typedCfg.HTTP,
			parserRegistry,
			deviceLookup,
			handleMessage,
			nil,
		), nil
	}

	manager := transport.NewWorkerManager(transport.WorkerManagerConfig{
		DB:                db,
		TransportTypeCode: "http-client",
		ConfigType:        "http",
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
	log.Println("HTTP Client Transport running. Press Ctrl+C to stop.")
	<-sigCh

	log.Println("Shutting down...")
	manager.Stop()
	log.Println("Shutdown complete")
}
