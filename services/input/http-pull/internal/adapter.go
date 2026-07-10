package httpclient

import (
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	command "github.com/rogeriocassares/zc8/packages/go-command"
	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	integration "github.com/rogeriocassares/zc8/packages/go-integration"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// HTTPClientAdapter periodically polls an external HTTP endpoint for telemetry data.
type HTTPClientAdapter struct {
	integrationID int64
	entry         *integration.IntegrationEntry
	db            *sql.DB
	client        *http.Client

	// HTTP config extracted from entry.Config
	baseURL         string
	method          string
	headers         map[string]string
	authType        string
	authCredentials *string
	tlsSkipVerify   bool
	timeoutSec      int
	retryDelaySec   int

	parserRegistry    *integration.ParserRegistry
	deviceLookup      *integration.DeviceLookup
	allowlist         *integration.DeviceAllowlist
	messageCallback   func(*integration.Message)
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

	// Command dispatch (optional — nil disables downlink)
	jsCommands  *infranats.JetStreamClient
	commandReg  *command.Registry
	cmdCancelFn context.CancelFunc
}

// NewHTTPClientAdapter creates a polling HTTP client adapter.
func NewHTTPClientAdapter(
	entry *integration.IntegrationEntry,
	db *sql.DB,
	parserRegistry *integration.ParserRegistry,
	deviceLookup *integration.DeviceLookup,
	messageCallback func(*integration.Message),
	logger *log.Logger,
	jsCommands *infranats.JetStreamClient,
	commandReg *command.Registry,
) *HTTPClientAdapter {
	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[HTTP-Client:integration_%d] ", entry.ID), log.LstdFlags)
	}

	gatewayParserCode := entry.ProviderCode
	if gatewayParserCode == "" {
		gatewayParserCode = "default"
	}

	timeoutSec := configInt(entry.Config, "timeout_sec", 30)
	timeout := time.Duration(timeoutSec) * time.Second
	tlsSkipVerify := configBool(entry.Config, "tls_skip_verify", false)

	tlsCfg := &tls.Config{}
	if tlsSkipVerify {
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
		integrationID:     entry.ID,
		entry:             entry,
		db:                db,
		client:            httpClient,
		baseURL:           configString(entry.Config, "base_url", ""),
		method:            configString(entry.Config, "method", "GET"),
		headers:           configStringMap(entry.Config, "headers"),
		authType:          configString(entry.Config, "auth_type", "none"),
		authCredentials:   configStringPtr(entry.Config, "auth_credentials"),
		tlsSkipVerify:     tlsSkipVerify,
		timeoutSec:        timeoutSec,
		retryDelaySec:     configInt(entry.Config, "retry_delay_sec", 30),
		parserRegistry:    parserRegistry,
		deviceLookup:      deviceLookup,
		messageCallback:   messageCallback,
		gatewayParserCode: gatewayParserCode,
		deviceParserCode:  "agent",
		workerSem:         make(chan struct{}, maxWorkers),
		stopCh:            make(chan struct{}),
		logger:            logger,
		jsCommands:        jsCommands,
		commandReg:        commandReg,
	}
}

// Start begins the polling loop.
func (a *HTTPClientAdapter) Start(_ context.Context) error {
	a.mu.Lock()
	a.isRunning = true
	a.mu.Unlock()

	a.allowlist = integration.NewDeviceAllowlist(a.db, a.integrationID, a.logger)
	a.allowlist.Start(context.Background(), 30*time.Second)

	// Start command consumer if command dispatch is configured.
	if a.jsCommands != nil && a.commandReg != nil {
		cmdCtx, cmdCancel := context.WithCancel(context.Background())
		a.cmdCancelFn = cmdCancel
		go a.startCommandConsumer(cmdCtx)
	}

	pollInterval := time.Duration(a.retryDelaySec) * time.Second
	if pollInterval <= 0 {
		pollInterval = 30 * time.Second
	}

	a.logger.Printf("HTTP client adapter started: url=%s method=%s interval=%v", a.baseURL, a.method, pollInterval)

	go a.pollLoop(pollInterval)
	return nil
}

// Stop stops the polling loop.
func (a *HTTPClientAdapter) Stop() {
	a.stopOnce.Do(func() {
		close(a.stopCh)
		if a.cmdCancelFn != nil {
			a.cmdCancelFn()
		}
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
		"service_id":       a.integrationID,
		"service_type":     "input.http-pull",
		"integration_id":   a.integrationID,
		"integration_type": "http-client",
		"org_id":           a.entry.OrganizationID,
		"team_id":          a.entry.TeamID,
		"team_name":        a.entry.TeamName,
		"base_url":         a.baseURL,
		"is_running":       running,
		"message_count":    a.messageCount.Load(),
		"error_count":      a.errorCount.Load(),
		"last_message_at":  lastMsg,
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

	req, err := http.NewRequest(a.method, a.baseURL, nil)
	if err != nil {
		a.errorCount.Add(1)
		a.logger.Printf("Failed to create request: %v", err)
		return
	}

	// Apply headers from config
	for k, v := range a.headers {
		req.Header.Set(k, v)
	}

	// Apply auth
	if a.authType == "bearer" && a.authCredentials != nil {
		req.Header.Set("Authorization", "Bearer "+*a.authCredentials)
	} else if a.authType == "api-key" && a.authCredentials != nil {
		req.Header.Set("X-API-Key", *a.authCredentials)
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
		a.logger.Printf("HTTP %d from %s", resp.StatusCode, a.baseURL)
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

	msg := &integration.Message{
		ServiceID:        a.integrationID,
		ServiceType:      "input.http-pull",
		TeamID:           a.entry.TeamID,
		TeamName:         a.entry.TeamName,
		OrganizationID:   a.entry.OrganizationID,
		DeviceParserCode: a.deviceParserCode,
		ProviderCode:     a.gatewayParserCode,
		DeviceData:       deviceData,
		Metadata: map[string]interface{}{
			"base_url":    a.baseURL,
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
		}
	}

	if devUUID := msg.DeviceUUID; a.allowlist != nil && devUUID != "" && !a.allowlist.ContainsDeviceUUID(devUUID) {
		return // device not routed to this service
	}

	if a.messageCallback != nil {
		a.messageCallback(msg)
	}

	a.messageCount.Add(1)
	a.lastMessageTime.Store(time.Now().UnixNano())
}

// Config extraction helpers for map[string]interface{}.

func configString(m map[string]interface{}, key, def string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return def
}

func configStringPtr(m map[string]interface{}, key string) *string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return &s
		}
	}
	return nil
}

func configInt(m map[string]interface{}, key string, def int) int {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		case int64:
			return int(n)
		case json.Number:
			if i, err := n.Int64(); err == nil {
				return int(i)
			}
		}
	}
	return def
}

func configBool(m map[string]interface{}, key string, def bool) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return def
}

func configStringMap(m map[string]interface{}, key string) map[string]string {
	if v, ok := m[key]; ok {
		if raw, ok := v.(map[string]interface{}); ok {
			result := make(map[string]string, len(raw))
			for k, val := range raw {
				if s, ok := val.(string); ok {
					result[k] = s
				}
			}
			return result
		}
	}
	return nil
}

// startCommandConsumer creates a durable JetStream consumer for this integration's
// HTTP pull downlink commands.
func (a *HTTPClientAdapter) startCommandConsumer(ctx context.Context) {
	consumerName := fmt.Sprintf("http-pull-cmd-%d", a.integrationID)
	subject := fmt.Sprintf("commands.dispatch.http-pull.%d", a.integrationID)

	cons, err := a.jsCommands.CreateConsumer(ctx, infranats.ConsumerConfig{
		Durable:        consumerName,
		FilterSubjects: []string{subject},
		MaxAckPending:  64,
		AckWait:        30 * time.Second,
	})
	if err != nil {
		a.logger.Printf("[cmd] consumer create error: %v", err)
		return
	}

	a.logger.Printf("[cmd] command consumer ready: subject=%s", subject)

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		msgs, err := cons.Fetch(8, infranats.FetchMaxWait(500*time.Millisecond))
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			time.Sleep(100 * time.Millisecond)
			continue
		}

		for msg := range msgs.Messages() {
			a.processCommand(ctx, msg)
		}

		if err := msgs.Error(); err != nil && ctx.Err() == nil {
			a.logger.Printf("[cmd] batch error: %v", err)
		}
	}
}

// processCommand formats and dispatches a single command envelope.
func (a *HTTPClientAdapter) processCommand(_ context.Context, msg infranats.ConsumerMsg) {
	env, err := pb.UnmarshalCommandEnvelope(msg.Data())
	if err != nil {
		a.logger.Printf("[cmd] unmarshal error: %v", err)
		msg.Ack()
		return
	}

	formatted, err := a.commandReg.Format(env)
	if err != nil {
		a.logger.Printf("[cmd] format error [%s]: %v", env.CommandId, err)
		a.publishCommandAck(env, false, err.Error())
		msg.Ack()
		return
	}

	a.logger.Printf("[cmd] dispatched [%s] target=%s", env.CommandId, formatted.Target)
	a.publishCommandAck(env, true, "")
	msg.Ack()
}

// publishCommandAck publishes a command acknowledgement to NATS Core.
func (a *HTTPClientAdapter) publishCommandAck(env *pb.CommandEnvelope, success bool, errMsg string) {
	subject := fmt.Sprintf("commands.ack.%s", env.DeviceKey)
	ack := map[string]interface{}{
		"command_id": env.CommandId,
		"device_key": env.DeviceKey,
		"success":    success,
		"error":      errMsg,
	}
	data, _ := json.Marshal(ack)
	if err := a.jsCommands.Conn().Publish(subject, data); err != nil {
		a.logger.Printf("[cmd] ack publish error: %v", err)
	}
}
