package transport

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// HTTPServerAdapter handles HTTP server (webhook receiver) for a worker
type HTTPServerAdapter struct {
	worker   *Worker
	server   *http.Server
	mu       sync.RWMutex
	stopCh   chan struct{}
	stopOnce sync.Once
	logger   *log.Logger
	wp       *WorkerPool
	routes   map[string]bool // Registered HTTP routes
}

// NewHTTPServerAdapter creates a new HTTP server adapter
func NewHTTPServerAdapter(worker *Worker, wp *WorkerPool, logger *log.Logger) *HTTPServerAdapter {
	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[HTTP-Server:%s] ", worker.ID), log.LstdFlags)
	}
	return &HTTPServerAdapter{
		worker: worker,
		wp:     wp,
		stopCh: make(chan struct{}),
		logger: logger,
		routes: make(map[string]bool),
	}
}

// Start initializes the HTTP server
func (ha *HTTPServerAdapter) Start() error {
	ha.logger.Printf("Starting HTTP server adapter for %s", ha.worker.ProviderName)

	// Setup routes based on provider
	mux := http.NewServeMux()
	ha.setupRoutes(mux)

	// Create server
	addr := fmt.Sprintf("%s:%d", ha.worker.Config.Host, ha.worker.Config.Port)
	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1MB
		ReadHeaderTimeout: 5 * time.Second,
	}

	ha.mu.Lock()
	ha.server = server
	ha.worker.Connection = server
	ha.worker.Active = true
	ha.worker.ConnectedAt = time.Now()
	ha.mu.Unlock()

	ha.logger.Printf("HTTP server listening on %s", addr)

	// Start serving in background
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			ha.logger.Printf("Server error: %v", err)
		}
	}()

	return nil
}

// setupRoutes configures HTTP routes based on provider
func (ha *HTTPServerAdapter) setupRoutes(mux *http.ServeMux) {
	switch strings.ToLower(ha.worker.ProviderName) {
	case "everynet":
		mux.HandleFunc("/devices", ha.handleEverynetDevices)
		mux.HandleFunc("/events", ha.handleEverynetEvents)
		ha.routes["/devices"] = true
		ha.routes["/events"] = true
	case "senseair", "sensair":
		mux.HandleFunc("/api/data", ha.handleSenseairData)
		ha.routes["/api/data"] = true
	default:
		// Generic webhook endpoint
		mux.HandleFunc("/webhook", ha.handleGenericWebhook)
		mux.HandleFunc("/data", ha.handleGenericWebhook)
		ha.routes["/webhook"] = true
		ha.routes["/data"] = true
	}

	ha.logger.Printf("Configured routes: %v", ha.routes)
}

// handleEverynetDevices handles Everynet device registrations
func (ha *HTTPServerAdapter) handleEverynetDevices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		ha.logger.Printf("Failed to decode device request: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	ha.routeHTTPMessage(payload, "everynet_devices")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// handleEverynetEvents handles Everynet device events
func (ha *HTTPServerAdapter) handleEverynetEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		ha.logger.Printf("Failed to decode event request: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	ha.routeHTTPMessage(payload, "everynet_events")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// handleSenseairData handles Senseair sensor data
func (ha *HTTPServerAdapter) handleSenseairData(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		ha.logger.Printf("Failed to decode sensor data: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	ha.routeHTTPMessage(payload, "senseair_data")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// handleGenericWebhook handles generic webhook requests
func (ha *HTTPServerAdapter) handleGenericWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		ha.logger.Printf("Failed to decode webhook: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	ha.routeHTTPMessage(payload, "webhook")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// routeHTTPMessage routes an HTTP message through unified ingest
func (ha *HTTPServerAdapter) routeHTTPMessage(payload map[string]interface{}, source string) {
	ha.mu.RLock()
	teamID := ha.worker.TeamID
	teamName := ha.worker.TeamName
	providerID := ha.worker.ProviderID
	providerName := ha.worker.ProviderName
	workerID := ha.worker.ID
	ha.mu.RUnlock()

	// Extract device key from payload
	deviceKey := extractDeviceKeyHTTP(payload)

	ingestMsg := Message{
		WorkerID:      workerID,
		TransportType: "http_server",
		TeamID:        teamID,
		TeamName:      teamName,
		ProviderID:    providerID,
		ProviderName:  providerName,
		DeviceKey:     deviceKey,
		Payload:       payload,
		Metadata: map[string]interface{}{
			"source":      source,
			"received_at": time.Now(),
		},
		ReceivedAt:  time.Now(),
		ProcessedAt: time.Now(),
	}

	ha.wp.RouteMessage(ingestMsg)

	ha.mu.Lock()
	ha.worker.MessageCount++
	ha.worker.LastMessageAt = time.Now()
	ha.mu.Unlock()

	ha.logger.Printf("Message routed from HTTP %s (device: %s)", source, deviceKey)
}

// Stop gracefully stops the HTTP server
func (ha *HTTPServerAdapter) Stop() {
	ha.stopOnce.Do(func() {
		ha.logger.Printf("Stopping HTTP server adapter")
		close(ha.stopCh)

		ha.mu.Lock()
		if ha.server != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			ha.server.Shutdown(ctx)
		}
		ha.worker.Active = false
		ha.mu.Unlock()
	})
}

// extractDeviceKeyHTTP extracts device key from HTTP payload
func extractDeviceKeyHTTP(payload map[string]interface{}) string {
	// Try common field names
	for _, fieldName := range []string{"device_id", "device_eui", "device_key", "deviceId", "deviceEUI", "id"} {
		if val, ok := payload[fieldName].(string); ok {
			return val
		}
	}
	return ""
}

// GetStatus returns HTTP server status
func (ha *HTTPServerAdapter) GetStatus() map[string]interface{} {
	ha.mu.RLock()
	defer ha.mu.RUnlock()

	addr := ""
	if ha.server != nil {
		addr = ha.server.Addr
	}

	return map[string]interface{}{
		"worker_id":     ha.worker.ID,
		"transport":     "http_server",
		"provider":      ha.worker.ProviderName,
		"address":       addr,
		"routes":        ha.routes,
		"message_count": ha.worker.MessageCount,
		"error_count":   ha.worker.ErrorCount,
	}
}

// ============================================================
// HTTP CLIENT ADAPTER
// ============================================================

// HTTPClientAdapter handles HTTP client (polling/streaming) for a worker
type HTTPClientAdapter struct {
	worker   *Worker
	client   *http.Client
	mu       sync.RWMutex
	stopCh   chan struct{}
	stopOnce sync.Once
	logger   *log.Logger
	wp       *WorkerPool
	ticker   *time.Ticker
}

// NewHTTPClientAdapter creates a new HTTP client adapter
func NewHTTPClientAdapter(worker *Worker, wp *WorkerPool, logger *log.Logger) *HTTPClientAdapter {
	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[HTTP-Client:%s] ", worker.ID), log.LstdFlags)
	}
	return &HTTPClientAdapter{
		worker: worker,
		wp:     wp,
		stopCh: make(chan struct{}),
		logger: logger,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Start initializes the HTTP client and begins polling
func (hca *HTTPClientAdapter) Start() error {
	hca.logger.Printf("Starting HTTP client adapter for %s", hca.worker.ProviderName)

	// Get polling interval from config
	pollingInterval := 60 * time.Second
	if interval, ok := hca.worker.Config.EndpointConfig["polling_interval"].(float64); ok {
		pollingInterval = time.Duration(int64(interval)) * time.Second
	}

	hca.ticker = time.NewTicker(pollingInterval)

	hca.mu.Lock()
	hca.worker.Active = true
	hca.worker.ConnectedAt = time.Now()
	hca.mu.Unlock()

	hca.logger.Printf("HTTP client polling every %s", pollingInterval)

	// Start polling in background
	go hca.pollLoop()

	return nil
}

// pollLoop continuously polls the remote endpoint
func (hca *HTTPClientAdapter) pollLoop() {
	// Send initial request immediately
	hca.poll()

	for {
		select {
		case <-hca.stopCh:
			hca.ticker.Stop()
			return
		case <-hca.ticker.C:
			hca.poll()
		}
	}
}

// poll fetches data from remote endpoint
func (hca *HTTPClientAdapter) poll() {
	hca.mu.RLock()
	brokerAddr := hca.worker.Config.BrokerAddr
	headers := hca.worker.Config.TeamConfig
	hca.mu.RUnlock()

	// Build request URL
	url := fmt.Sprintf("https://%s", brokerAddr)
	if !strings.HasPrefix(brokerAddr, "http") {
		url = fmt.Sprintf("https://%s", brokerAddr)
	}

	// Create request
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		hca.logger.Printf("Failed to create request: %v", err)
		hca.increaseErrorCount()
		return
	}

	// Add authorization if available
	if token, ok := headers["token"].(string); ok {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	}
	if apiKey, ok := headers["api_key"].(string); ok {
		req.Header.Set("X-API-Key", apiKey)
	}

	// Send request
	resp, err := hca.client.Do(req)
	if err != nil {
		hca.logger.Printf("Poll failed: %v", err)
		hca.increaseErrorCount()
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		hca.logger.Printf("Unexpected status code: %d", resp.StatusCode)
		hca.increaseErrorCount()
		return
	}

	// Parse response
	var payload interface{}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		hca.logger.Printf("Failed to decode response: %v", err)
		hca.increaseErrorCount()
		return
	}

	// Route message
	hca.routePolledData(payload)
}

// routePolledData routes polled data through unified ingest
func (hca *HTTPClientAdapter) routePolledData(payload interface{}) {
	hca.mu.RLock()
	teamID := hca.worker.TeamID
	teamName := hca.worker.TeamName
	providerID := hca.worker.ProviderID
	providerName := hca.worker.ProviderName
	workerID := hca.worker.ID
	hca.mu.RUnlock()

	// Convert payload to map if needed
	payloadMap := make(map[string]interface{})
	if m, ok := payload.(map[string]interface{}); ok {
		payloadMap = m
	} else {
		payloadMap["data"] = payload
	}

	ingestMsg := Message{
		WorkerID:      workerID,
		TransportType: "http_client",
		TeamID:        teamID,
		TeamName:      teamName,
		ProviderID:    providerID,
		ProviderName:  providerName,
		Payload:       payloadMap,
		Metadata: map[string]interface{}{
			"received_at": time.Now(),
		},
		ReceivedAt:  time.Now(),
		ProcessedAt: time.Now(),
	}

	hca.wp.RouteMessage(ingestMsg)

	hca.mu.Lock()
	hca.worker.MessageCount++
	hca.worker.LastMessageAt = time.Now()
	hca.mu.Unlock()
}

// increaseErrorCount increments worker error counter
func (hca *HTTPClientAdapter) increaseErrorCount() {
	hca.mu.Lock()
	defer hca.mu.Unlock()
	hca.worker.ErrorCount++
}

// Stop gracefully stops the HTTP client adapter
func (hca *HTTPClientAdapter) Stop() {
	hca.stopOnce.Do(func() {
		hca.logger.Printf("Stopping HTTP client adapter")
		close(hca.stopCh)

		hca.mu.Lock()
		hca.worker.Active = false
		hca.mu.Unlock()
	})
}

// GetStatus returns HTTP client status
func (hca *HTTPClientAdapter) GetStatus() map[string]interface{} {
	hca.mu.RLock()
	defer hca.mu.RUnlock()

	return map[string]interface{}{
		"worker_id":     hca.worker.ID,
		"transport":     "http_client",
		"provider":      hca.worker.ProviderName,
		"endpoint":      hca.worker.Config.BrokerAddr,
		"message_count": hca.worker.MessageCount,
		"error_count":   hca.worker.ErrorCount,
	}
}
