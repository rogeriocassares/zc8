package httpserver

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	tcfg "github.com/rogeriocassares/zc8/packages/go-config/transport"
	transport "github.com/rogeriocassares/zc8/packages/go-transport"
)

// HTTPServerAdapter listens for incoming HTTP webhook requests for one
// transport_registry entry. Each adapter maps to a URL path and receives
// POST payloads that go through 2-stage parsing (gateway + device) before
// being forwarded to the ingest pipeline.
type HTTPServerAdapter struct {
	transportID int64
	entry       *transport.TransportEntry
	httpCfg     *tcfg.HTTPConfig

	parserRegistry    *transport.ParserRegistry
	deviceLookup      *transport.DeviceLookup
	messageCallback   func(*transport.Message)
	gatewayParserCode string
	deviceParserCode  string

	workerSem chan struct{}

	mu              sync.RWMutex
	isRunning       bool
	messageCount    atomic.Int64
	errorCount      atomic.Int64
	lastMessageTime atomic.Int64

	stopCh   chan struct{}
	stopOnce sync.Once
	logger   *log.Logger
}

// NewHTTPServerAdapter creates an adapter for an HTTP server transport entry.
func NewHTTPServerAdapter(
	entry *transport.TransportEntry,
	httpCfg *tcfg.HTTPConfig,
	parserRegistry *transport.ParserRegistry,
	deviceLookup *transport.DeviceLookup,
	messageCallback func(*transport.Message),
	logger *log.Logger,
) *HTTPServerAdapter {
	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[HTTP-Server:transport_%d] ", entry.ID), log.LstdFlags)
	}

	gatewayParserCode := entry.ParserCode
	if gatewayParserCode == "" {
		gatewayParserCode = "default"
	}
	deviceParserCode := "agent"

	maxWorkers := runtime.NumCPU() * 4
	if maxWorkers < 8 {
		maxWorkers = 8
	}

	return &HTTPServerAdapter{
		transportID:       entry.ID,
		entry:             entry,
		httpCfg:           httpCfg,
		parserRegistry:    parserRegistry,
		deviceLookup:      deviceLookup,
		messageCallback:   messageCallback,
		gatewayParserCode: gatewayParserCode,
		deviceParserCode:  deviceParserCode,
		workerSem:         make(chan struct{}, maxWorkers),
		stopCh:            make(chan struct{}),
		logger:            logger,
	}
}

// Start marks the adapter as running. The actual HTTP serving is handled by
// the shared server — this adapter registers its handler path.
func (a *HTTPServerAdapter) Start(_ context.Context) error {
	a.mu.Lock()
	a.isRunning = true
	a.mu.Unlock()
	a.logger.Printf("HTTP server adapter started for transport %d (parser: %s)", a.transportID, a.gatewayParserCode)
	return nil
}

// Stop stops the adapter.
func (a *HTTPServerAdapter) Stop() {
	a.stopOnce.Do(func() {
		close(a.stopCh)
		a.mu.Lock()
		a.isRunning = false
		a.mu.Unlock()
		a.logger.Printf("HTTP server adapter stopped")
	})
}

// Status returns adapter metrics.
func (a *HTTPServerAdapter) Status() map[string]interface{} {
	a.mu.RLock()
	running := a.isRunning
	a.mu.RUnlock()

	lastMsg := ""
	if ts := a.lastMessageTime.Load(); ts > 0 {
		lastMsg = time.Unix(0, ts).Format(time.RFC3339)
	}

	return map[string]interface{}{
		"transport_id":    a.transportID,
		"transport_type":  "http-server",
		"team_id":         a.entry.TeamID,
		"team_name":       a.entry.TeamName,
		"is_running":      running,
		"message_count":   a.messageCount.Load(),
		"error_count":     a.errorCount.Load(),
		"last_message_at": lastMsg,
	}
}

// ServeHTTP implements http.Handler so the adapter can be mounted on a mux.
func (a *HTTPServerAdapter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	r.Body.Close()
	if err != nil {
		a.errorCount.Add(1)
		http.Error(w, "read body failed", http.StatusBadRequest)
		return
	}

	select {
	case a.workerSem <- struct{}{}:
		go func() {
			defer func() { <-a.workerSem }()
			a.handlePayload(body, r)
		}()
	case <-a.stopCh:
		http.Error(w, "shutting down", http.StatusServiceUnavailable)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"status":"accepted"}`))
}

func (a *HTTPServerAdapter) handlePayload(payload []byte, r *http.Request) {
	defer func() {
		if rv := recover(); rv != nil {
			a.logger.Printf("Handler panic recovered: %v", rv)
			a.errorCount.Add(1)
		}
	}()

	devicePayload := payload

	// Stage 1: Gateway parser
	var gatewayFrame interface{}
	if a.gatewayParserCode != "" && a.gatewayParserCode != "default" {
		gp, err := a.parserRegistry.GetGatewayParser(a.gatewayParserCode)
		if err != nil {
			a.errorCount.Add(1)
			return
		}
		frame, err := gp.Parse(payload)
		if err != nil {
			a.errorCount.Add(1)
			return
		}
		gatewayFrame = frame
		devicePayload = frame.DevicePayload
	}

	// Stage 2: Device parser
	dp, err := a.parserRegistry.GetDeviceParser(a.deviceParserCode)
	if err != nil {
		a.errorCount.Add(1)
		return
	}
	deviceData, err := dp.Parse(devicePayload)
	if err != nil {
		a.errorCount.Add(1)
		return
	}

	// Extract device key from query or header
	deviceKey := r.URL.Query().Get("device_key")
	if deviceKey == "" {
		deviceKey = r.Header.Get("X-Device-Key")
	}

	msg := &transport.Message{
		TransportRegistryID: a.transportID,
		TransportType:       "http-server",
		TeamID:              a.entry.TeamID,
		TeamName:            a.entry.TeamName,
		OrganizationID:      a.entry.OrganizationID,
		DeviceKey:           deviceKey,
		GatewayParserCode:   a.gatewayParserCode,
		DeviceParserCode:    a.deviceParserCode,
		DeviceData:          deviceData,
		Metadata: map[string]interface{}{
			"content_type": r.Header.Get("Content-Type"),
			"remote_addr":  r.RemoteAddr,
		},
		ReceivedAt: time.Now(),
	}

	// Set gateway frame if parsed
	if gf, ok := gatewayFrame.(interface{ GetDevicePayload() []byte }); ok {
		_ = gf // type assertion for documentation only
	}

	// Enrich with device registry data
	if deviceKey != "" {
		devCfg, err := a.deviceLookup.Lookup(context.Background(), deviceKey, a.entry.TeamID)
		if err != nil {
			a.logger.Printf("Device lookup failed for %s: %v", deviceKey, err)
		} else if devCfg != nil {
			msg.DeviceUUID = devCfg.DeviceUUID
			msg.DeviceModelCode = devCfg.DeviceModelCode
			msg.VendorID = devCfg.VendorID
			msg.Routing = devCfg.Routing
		}
	}

	if a.messageCallback != nil {
		a.messageCallback(msg)
	}

	a.messageCount.Add(1)
	a.lastMessageTime.Store(time.Now().UnixNano())
}

// TransportID returns the transport registry ID for routing purposes.
func (a *HTTPServerAdapter) TransportID() int64 { return a.transportID }
