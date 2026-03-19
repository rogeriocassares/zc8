package httpclient

import (
	"context"
	"crypto/tls"
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

// HTTPClientAdapter periodically polls an external HTTP endpoint for telemetry
// data. For each transport_registry row with type "http-client", one adapter
// is created. It fetches data, runs 2-stage parsing, and forwards to ingest.
type HTTPClientAdapter struct {
	transportID int64
	entry       *transport.TransportEntry
	httpCfg     *tcfg.HTTPConfig
	client      *http.Client

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

// NewHTTPClientAdapter creates a polling HTTP client adapter.
func NewHTTPClientAdapter(
	entry *transport.TransportEntry,
	httpCfg *tcfg.HTTPConfig,
	parserRegistry *transport.ParserRegistry,
	deviceLookup *transport.DeviceLookup,
	messageCallback func(*transport.Message),
	logger *log.Logger,
) *HTTPClientAdapter {
	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[HTTP-Client:transport_%d] ", entry.ID), log.LstdFlags)
	}

	gatewayParserCode := entry.ParserCode
	if gatewayParserCode == "" {
		gatewayParserCode = "default"
	}

	timeout := time.Duration(httpCfg.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}

	tlsCfg := &tls.Config{}
	if httpCfg.TLSSkipVerify {
		tlsCfg.InsecureSkipVerify = true
	}

	httpClient := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			TLSClientConfig: tlsCfg,
			MaxIdleConns:    10,
			IdleConnTimeout: 60 * time.Second,
		},
	}

	maxWorkers := runtime.NumCPU() * 2
	if maxWorkers < 4 {
		maxWorkers = 4
	}

	return &HTTPClientAdapter{
		transportID:       entry.ID,
		entry:             entry,
		httpCfg:           httpCfg,
		client:            httpClient,
		parserRegistry:    parserRegistry,
		deviceLookup:      deviceLookup,
		messageCallback:   messageCallback,
		gatewayParserCode: gatewayParserCode,
		deviceParserCode:  "agent",
		workerSem:         make(chan struct{}, maxWorkers),
		stopCh:            make(chan struct{}),
		logger:            logger,
	}
}

// Start begins the polling loop.
func (a *HTTPClientAdapter) Start(_ context.Context) error {
	a.mu.Lock()
	a.isRunning = true
	a.mu.Unlock()

	pollInterval := time.Duration(a.httpCfg.RetryDelaySec) * time.Second
	if pollInterval <= 0 {
		pollInterval = 30 * time.Second
	}

	a.logger.Printf("HTTP client adapter started: url=%s method=%s interval=%v", a.httpCfg.BaseURL, a.httpCfg.Method, pollInterval)

	go a.pollLoop(pollInterval)
	return nil
}

// Stop stops the polling loop.
func (a *HTTPClientAdapter) Stop() {
	a.stopOnce.Do(func() {
		close(a.stopCh)
		a.mu.Lock()
		a.isRunning = false
		a.mu.Unlock()
		a.logger.Printf("HTTP client adapter stopped")
	})
}

// Status returns adapter metrics.
func (a *HTTPClientAdapter) Status() map[string]interface{} {
	a.mu.RLock()
	running := a.isRunning
	a.mu.RUnlock()

	lastMsg := ""
	if ts := a.lastMessageTime.Load(); ts > 0 {
		lastMsg = time.Unix(0, ts).Format(time.RFC3339)
	}

	return map[string]interface{}{
		"transport_id":    a.transportID,
		"transport_type":  "http-client",
		"team_id":         a.entry.TeamID,
		"team_name":       a.entry.TeamName,
		"base_url":        a.httpCfg.BaseURL,
		"is_running":      running,
		"message_count":   a.messageCount.Load(),
		"error_count":     a.errorCount.Load(),
		"last_message_at": lastMsg,
	}
}

func (a *HTTPClientAdapter) pollLoop(interval time.Duration) {
	// Fetch once immediately
	a.fetchAndProcess()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-a.stopCh:
			return
		case <-ticker.C:
			a.fetchAndProcess()
		}
	}
}

func (a *HTTPClientAdapter) fetchAndProcess() {
	select {
	case a.workerSem <- struct{}{}:
		defer func() { <-a.workerSem }()
	case <-a.stopCh:
		return
	}

	defer func() {
		if rv := recover(); rv != nil {
			a.logger.Printf("Fetch panic recovered: %v", rv)
			a.errorCount.Add(1)
		}
	}()

	req, err := http.NewRequest(a.httpCfg.Method, a.httpCfg.BaseURL, nil)
	if err != nil {
		a.errorCount.Add(1)
		a.logger.Printf("Failed to create request: %v", err)
		return
	}

	// Apply headers from config
	for k, v := range a.httpCfg.Headers {
		req.Header.Set(k, v)
	}

	// Apply auth
	if a.httpCfg.AuthType == "bearer" && a.httpCfg.AuthCredentials != nil {
		req.Header.Set("Authorization", "Bearer "+*a.httpCfg.AuthCredentials)
	} else if a.httpCfg.AuthType == "api-key" && a.httpCfg.AuthCredentials != nil {
		req.Header.Set("X-API-Key", *a.httpCfg.AuthCredentials)
	}

	resp, err := a.client.Do(req)
	if err != nil {
		a.errorCount.Add(1)
		a.logger.Printf("HTTP request failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		a.errorCount.Add(1)
		a.logger.Printf("HTTP %d from %s", resp.StatusCode, a.httpCfg.BaseURL)
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		a.errorCount.Add(1)
		return
	}

	if len(body) == 0 {
		return
	}

	devicePayload := body

	// Stage 1: Gateway parser
	if a.gatewayParserCode != "" && a.gatewayParserCode != "default" {
		gp, err := a.parserRegistry.GetGatewayParser(a.gatewayParserCode)
		if err != nil {
			a.errorCount.Add(1)
			return
		}
		frame, err := gp.Parse(body)
		if err != nil {
			a.errorCount.Add(1)
			return
		}
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

	msg := &transport.Message{
		TransportRegistryID: a.transportID,
		TransportType:       "http-client",
		TeamID:              a.entry.TeamID,
		TeamName:            a.entry.TeamName,
		OrganizationID:      a.entry.OrganizationID,
		DeviceParserCode:    a.deviceParserCode,
		GatewayParserCode:   a.gatewayParserCode,
		DeviceData:          deviceData,
		Metadata: map[string]interface{}{
			"base_url":    a.httpCfg.BaseURL,
			"status_code": resp.StatusCode,
		},
		ReceivedAt: time.Now(),
	}

	// Enrich with device lookup if possible
	if dkHeader := resp.Header.Get("X-Device-Key"); dkHeader != "" {
		msg.DeviceKey = dkHeader
		devCfg, err := a.deviceLookup.Lookup(context.Background(), dkHeader, a.entry.TeamID)
		if err == nil && devCfg != nil {
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
