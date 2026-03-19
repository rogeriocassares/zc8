package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	tcfg "github.com/rogeriocassares/zc8/packages/go-config/transport"
	transport "github.com/rogeriocassares/zc8/packages/go-transport"
	httpserver "github.com/rogeriocassares/zc8/services/transport/http-server/internal"
)

type Config struct {
	DatabaseURL string
	ListenPort  int
}

func loadConfig() Config {
	return Config{
		DatabaseURL: getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/zc8"),
		ListenPort:  getenvInt("LISTEN_PORT", 8081),
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

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Starting HTTP Server Transport Adapter...")

	cfg := loadConfig()

	// Database
	db, err := transport.OpenDatabase(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer db.Close()
	log.Println("Database connected")

	// Ingest sink
	logger := log.New(log.Writer(), "[HTTP-Server] ", log.LstdFlags)
	sinkCfg := transport.SinkConfigFromEnv("http-server")
	ingestSink, err := transport.NewIngestSink(sinkCfg, logger)
	if err != nil {
		log.Fatalf("Failed to create ingest sink: %v", err)
	}
	defer ingestSink.Close()
	log.Println("Ingest sink ready")

	// Shared dependencies
	parserRegistry := transport.NewParserRegistry(db, logger)
	deviceLookup := transport.NewDeviceLookup(db, logger)

	// Pre-load parsers
	loadCtx, loadCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := parserRegistry.LoadFromDatabase(loadCtx); err != nil {
		logger.Printf("Warning: failed to load parsers: %v", err)
	}
	loadCancel()

	// HTTP mux — adapters register themselves as handlers
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Track adapters for dynamic routing
	var adaptersMu sync.RWMutex
	adapters := make(map[int64]*httpserver.HTTPServerAdapter)

	// Callback: convert message and submit to ingest
	handleMessage := func(msg *transport.Message) {
		if msg == nil {
			return
		}
		req := transport.MessageToProto(msg)
		if !ingestSink.Submit(req) {
			logger.Printf("Ingest queue full, dropped message for device %s", msg.DeviceKey)
		}
	}

	// Adapter factory for the generic WorkerManager
	adapterFactory := func(entry *transport.TransportEntry, typedCfg *tcfg.TransportConfig) (transport.Adapter, error) {
		if typedCfg.HTTP == nil {
			return nil, fmt.Errorf("HTTP config is nil for transport %d", entry.ID)
		}

		adapter := httpserver.NewHTTPServerAdapter(
			entry,
			typedCfg.HTTP,
			parserRegistry,
			deviceLookup,
			handleMessage,
			nil,
		)

		// Register HTTP handler for this transport
		path := fmt.Sprintf("/ingest/%d", entry.ID)
		mux.Handle(path, adapter)

		// Also register a catch-all webhook path with team context
		teamPath := fmt.Sprintf("/webhook/team/%d/transport/%d", entry.TeamID, entry.ID)
		mux.Handle(teamPath, adapter)

		adaptersMu.Lock()
		adapters[entry.ID] = adapter
		adaptersMu.Unlock()

		logger.Printf("Registered HTTP endpoint: POST %s", path)
		return adapter, nil
	}

	// Worker manager discovers transports and creates adapters
	manager := transport.NewWorkerManager(transport.WorkerManagerConfig{
		DB:                db,
		TransportTypeCode: "http-server",
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

	// Status endpoint
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"adapters_count":%d}`, len(adapters))
	})

	// Start HTTP server
	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.ListenPort),
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("HTTP server listening on :%d", cfg.ListenPort)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// Shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	log.Println("HTTP Server Transport running. Press Ctrl+C to stop.")
	<-sigCh

	log.Println("Shutting down...")
	manager.Stop()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	server.Shutdown(shutdownCtx)
	shutdownCancel()
	log.Println("Shutdown complete")
}
