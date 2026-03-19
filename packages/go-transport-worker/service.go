package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	transport "github.com/rogeriocassares/zc8/packages/go-transport-worker"
)

// TransportService manages all transport worker pools and ingest processing
type TransportService struct {
	db          *sql.DB
	logger      *log.Logger
	ingestChan  chan transport.Message
	ingestProc  *transport.IngestProcessor
	workerPools map[string]*transport.WorkerPool
	poolMu      sync.RWMutex
	httpServer  *http.Server
	ctx         context.Context
	cancel      context.CancelFunc
	stopCh      chan struct{}
	stopOnce    sync.Once
}

// NewTransportService creates a new service
func NewTransportService(db *sql.DB, logger *log.Logger) *TransportService {
	if logger == nil {
		logger = log.New(os.Stdout, "[TransportService] ", log.LstdFlags)
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &TransportService{
		db:          db,
		logger:      logger,
		ingestChan:  make(chan transport.Message, 1000), // Buffered channel
		workerPools: make(map[string]*transport.WorkerPool),
		ctx:         ctx,
		cancel:      cancel,
		stopCh:      make(chan struct{}),
	}
}

// Start initializes and starts all transport workers
func (ts *TransportService) Start() error {
	ts.logger.Printf("Starting transport service")

	// Create ingest processor
	ingestProc := transport.NewIngestProcessor(ts.db, 1000, ts.logger)
	ts.ingestProc = ingestProc

	// Register default processors
	if influxProc := transport.NewInfluxDBProcessor(ts.logger); influxProc != nil {
		ingestProc.RegisterProcessor("influxdb", influxProc)
	}
	if webhookProc := transport.NewWebhookProcessor(ts.logger); webhookProc != nil {
		ingestProc.RegisterProcessor("webhooks", webhookProc)
	}

	// Start ingest processor
	if err := ingestProc.Start(ts.ctx); err != nil {
		return fmt.Errorf("failed to start ingest processor: %w", err)
	}

	// Create worker pools for each transport type
	transportTypes := []string{"mqtt", "grpc", "http_server", "http_client"}

	for _, transportType := range transportTypes {
		pool := transport.NewWorkerPool(
			ts.ctx,
			transportType,
			ts.db,
			ts.ingestChan,
			ts.logger,
		)

		if err := pool.Start(ts.ctx); err != nil {
			ts.logger.Printf("Failed to start %s pool: %v", transportType, err)
			continue
		}

		ts.poolMu.Lock()
		ts.workerPools[transportType] = pool
		ts.poolMu.Unlock()

		ts.logger.Printf("%s worker pool started", transportType)
	}

	// Start message router (forwards from ingestChan to processor)
	go ts.messageRouter()

	// Start metrics server
	go ts.startMetricsServer()

	// Handle graceful shutdown
	go ts.handleShutdown()

	ts.logger.Printf("Transport service started successfully with %d pools", len(ts.workerPools))
	return nil
}

// messageRouter forwards messages from transport workers to ingest processor
func (ts *TransportService) messageRouter() {
	for {
		select {
		case <-ts.stopCh:
			ts.logger.Printf("Message router stopping")
			return
		case msg := <-ts.ingestChan:
			if err := ts.ingestProc.ReceiveMessage(msg); err != nil {
				ts.logger.Printf("Failed to route message: %v", err)
			}
		}
	}
}

// startMetricsServer starts the metrics HTTP server
func (ts *TransportService) startMetricsServer() {
	port := 9090
	if p := os.Getenv("METRICS_PORT"); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil {
			port = parsed
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/metrics", ts.handleMetrics)
	mux.HandleFunc("/status", ts.handleStatus)
	mux.HandleFunc("/health", ts.handleHealth)

	ts.httpServer = &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: mux,
	}

	ts.logger.Printf("Metrics server listening on :%d", port)
	if err := ts.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		ts.logger.Printf("Metrics server error: %v", err)
	}
}

// handleMetrics returns Prometheus-style metrics
func (ts *TransportService) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")

	// Ingest processor stats
	stats := ts.ingestProc.GetStats()
	fmt.Fprintf(w, "# HELP ingest_messages_total Total messages processed\n")
	fmt.Fprintf(w, "# TYPE ingest_messages_total counter\n")
	fmt.Fprintf(w, "ingest_messages_total %v\n", stats["processed_messages"])

	fmt.Fprintf(w, "# HELP ingest_messages_failed Failed message count\n")
	fmt.Fprintf(w, "# TYPE ingest_messages_failed counter\n")
	fmt.Fprintf(w, "ingest_messages_failed %v\n", stats["failed_messages"])

	fmt.Fprintf(w, "# HELP ingest_queue_size Current queue size\n")
	fmt.Fprintf(w, "# TYPE ingest_queue_size gauge\n")
	fmt.Fprintf(w, "ingest_queue_size %v\n", stats["queue_size"])

	// Worker pool metrics
	ts.poolMu.RLock()
	for transportType, pool := range ts.workerPools {
		metrics := pool.MetricsSnapshot()
		fmt.Fprintf(w, "transport_workers{type=\"%s\"} %v\n", transportType, metrics["worker_count"])
		fmt.Fprintf(w, "transport_messages{type=\"%s\"} %v\n", transportType, metrics["total_messages"])
		fmt.Fprintf(w, "transport_errors{type=\"%s\"} %v\n", transportType, metrics["total_errors"])
	}
	ts.poolMu.RUnlock()
}

// handleStatus returns detailed status of all workers
func (ts *TransportService) handleStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	status := map[string]interface{}{
		"status":    "ok",
		"timestamp": time.Now(),
		"pools":     make(map[string]interface{}),
	}

	ts.poolMu.RLock()
	for transportType, pool := range ts.workerPools {
		status["pools"].(map[string]interface{})[transportType] = pool.GetStatus()
	}
	ts.poolMu.RUnlock()

	// Add ingest processor status
	status["ingest"] = ts.ingestProc.GetStats()

	w.Header().Set("Content-Type", "application/json")
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	encoder.Encode(status)
}

// handleHealth returns basic health check
func (ts *TransportService) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	poolCount := len(ts.workerPools)
	healthy := poolCount > 0

	if healthy {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"healthy","pools":%d}`, poolCount)
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprintf(w, `{"status":"init","pools":%d}`, poolCount)
	}
}

// handleShutdown waits for shutdown signals
func (ts *TransportService) handleShutdown() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	<-sigCh
	ts.logger.Printf("Shutdown signal received")
	ts.Stop()
}

// Stop gracefully shuts down the service
func (ts *TransportService) Stop() {
	ts.stopOnce.Do(func() {
		ts.logger.Printf("Stopping transport service")
		close(ts.stopCh)

		// Stop all worker pools
		ts.poolMu.Lock()
		for name, pool := range ts.workerPools {
			ts.logger.Printf("Stopping %s pool", name)
			pool.Stop(ts.ctx)
		}
		ts.poolMu.Unlock()

		// Stop ingest processor
		if ts.ingestProc != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			ts.ingestProc.Stop(ctx)
			cancel()
		}

		// Stop metrics server
		if ts.httpServer != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			ts.httpServer.Shutdown(ctx)
			cancel()
		}

		ts.cancel()
		ts.logger.Printf("Transport service stopped")
	})
}

// Main entry point demonstrates usage
func ExampleMain() {
	// Setup database connection (replace with actual connection)
	db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	logger := log.New(os.Stdout, "", log.LstdFlags)

	// Create and start service
	svc := NewTransportService(db, logger)
	if err := svc.Start(); err != nil {
		log.Fatalf("Failed to start service: %v", err)
	}

	// Service runs until interrupted
	select {}
}
