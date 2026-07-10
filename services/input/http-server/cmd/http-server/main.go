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

	command "github.com/rogeriocassares/zc8/packages/go-command"
	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	integration "github.com/rogeriocassares/zc8/packages/go-integration"
	httpserver "github.com/rogeriocassares/zc8/services/input/http-server/internal"
)

type Config struct {
	DatabaseURL string
	ListenPort  int
	NATSURL     string
}

func loadConfig() Config {
	return Config{
		DatabaseURL: getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/zc8?sslmode=disable"),
		ListenPort:  getenvInt("LISTEN_PORT", 8081),
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

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Starting HTTP Server Input Adapter...")

	cfg := loadConfig()

	// Database
	db, err := integration.OpenDatabase(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer db.Close()
	log.Println("Database connected")

	// Ingest sink
	logger := log.New(log.Writer(), "[HTTP-Server] ", log.LstdFlags)
	sinkCfg := integration.SinkConfigFromEnv("http-server")
	ingestSink, err := integration.NewIngestSink(sinkCfg, logger)
	if err != nil {
		log.Fatalf("Failed to create ingest sink: %v", err)
	}
	defer ingestSink.Close()
	log.Println("Ingest sink ready")

	// COMMANDS stream client — used by adapters for per-integration downlink consumers.
	commandsSJSClient, err := infranats.NewJetStream(context.Background(), infranats.JetStreamConfig{
		URL:        cfg.NATSURL,
		StreamName: "COMMANDS",
		Subjects:   []string{"commands.dispatch.>"},
		Replicas:   1,
	}, logger)
	if err != nil {
		log.Fatalf("Failed to connect to COMMANDS stream: %v", err)
	}
	defer commandsSJSClient.Close()
	log.Println("COMMANDS JetStream ready")

	commandRegistry := command.NewRegistry()

	// Shared dependencies
	parserRegistry := integration.NewParserRegistry(db, logger)
	deviceLookup := integration.NewDeviceLookup(db, logger)

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

	// Callback: convert message and submit both raw + decoded envelopes
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

	// Adapter factory for the generic WorkerManager
	adapterFactory := func(entry *integration.IntegrationEntry) (integration.Adapter, error) {
		adapter := httpserver.NewHTTPServerAdapter(
			entry,
			db,
			parserRegistry,
			deviceLookup,
			handleMessage,
			nil,
			commandsSJSClient,
			commandRegistry,
		)

		// Register HTTP handler for this integration
		path := fmt.Sprintf("/ingest/%d", entry.ID)
		mux.Handle(path, adapter)

		// Also register a catch-all webhook path with team context
		teamPath := fmt.Sprintf("/webhook/team/%d/integration/%d", entry.TeamID, entry.ID)
		mux.Handle(teamPath, adapter)

		adaptersMu.Lock()
		adapters[entry.ID] = adapter
		adaptersMu.Unlock()

		logger.Printf("Registered HTTP endpoint: POST %s", path)
		return adapter, nil
	}

	// Worker manager discovers integrations and creates adapters
	manager := integration.NewWorkerManager(integration.WorkerManagerConfig{
		DB:                db,
		ServiceType:       "input.http-server",
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
	log.Println("HTTP Server Input running. Press Ctrl+C to stop.")

	healthSrv := integration.NewHealthServer(getenv("HEALTH_PORT", ":9090"), db, ingestSink.NatsConn())
	healthSrv.Start()
	log.Printf("Health server listening on %s", getenv("HEALTH_PORT", ":9090"))

	<-sigCh

	log.Println("Shutting down...")
	manager.Stop()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	server.Shutdown(shutdownCtx)
	healthSrv.Shutdown(shutdownCtx)
	shutdownCancel()
	log.Println("Shutdown complete")
}
