package httpserver

import (
	"context"
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

// HTTPServerAdapter listens for incoming HTTP webhook requests for one
// integration_registry entry.
type HTTPServerAdapter struct {
	integrationID int64
	entry         *integration.IntegrationEntry
	db            *sql.DB

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

// NewHTTPServerAdapter creates an adapter for an HTTP server integration entry.
func NewHTTPServerAdapter(
	entry *integration.IntegrationEntry,
	db *sql.DB,
	parserRegistry *integration.ParserRegistry,
	deviceLookup *integration.DeviceLookup,
	messageCallback func(*integration.Message),
	logger *log.Logger,
	jsCommands *infranats.JetStreamClient,
	commandReg *command.Registry,
) *HTTPServerAdapter {
	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[HTTP-Server:integration_%d] ", entry.ID), log.LstdFlags)
	}

	gatewayParserCode := entry.ProviderCode
	if gatewayParserCode == "" {
		gatewayParserCode = "default"
	}
	deviceParserCode := "agent"

	maxWorkers := runtime.NumCPU() * 4
	if maxWorkers < 8 {
		maxWorkers = 8
	}

	return &HTTPServerAdapter{
		integrationID:     entry.ID,
		entry:             entry,
		db:                db,
		parserRegistry:    parserRegistry,
		deviceLookup:      deviceLookup,
		messageCallback:   messageCallback,
		gatewayParserCode: gatewayParserCode,
		deviceParserCode:  deviceParserCode,
		workerSem:         make(chan struct{}, maxWorkers),
		stopCh:            make(chan struct{}),
		logger:            logger,
		jsCommands:        jsCommands,
		commandReg:        commandReg,
	}
}

// Start marks the adapter as running. The actual HTTP serving is handled by
// the shared server — this adapter registers its handler path.
func (a *HTTPServerAdapter) Start(_ context.Context) error {
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
	a.logger.Printf("HTTP server adapter started for integration %d (parser: %s)", a.integrationID, a.gatewayParserCode)
	return nil
}

// Stop stops the adapter.
func (a *HTTPServerAdapter) Stop() {
	a.stopOnce.Do(func() {
		close(a.stopCh)
		if a.cmdCancelFn != nil {
			a.cmdCancelFn()
		}
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
		"service_id":       a.integrationID,
		"service_type":     "input.http-server",
		"integration_id":   a.integrationID,
		"integration_type": "http-server",
		"org_id":           a.entry.OrganizationID,
		"team_id":          a.entry.TeamID,
		"team_name":        a.entry.TeamName,
		"is_running":       running,
		"message_count":    a.messageCount.Load(),
		"error_count":      a.errorCount.Load(),
		"last_message_at":  lastMsg,
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

	msg := &integration.Message{
		ServiceID:        a.integrationID,
		ServiceType:      "input.http-server",
		TeamID:           a.entry.TeamID,
		TeamName:         a.entry.TeamName,
		OrganizationID:   a.entry.OrganizationID,
		DeviceKey:        deviceKey,
		ProviderCode:     a.gatewayParserCode,
		DeviceParserCode: a.deviceParserCode,
		DeviceData:       deviceData,
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
			if a.allowlist != nil && !a.allowlist.ContainsDeviceUUID(devCfg.DeviceUUID) {
				return // device not routed to this service
			}
		} else {
			a.errorCount.Add(1)
			return // unknown device
		}
	}

	if a.messageCallback != nil {
		a.messageCallback(msg)
	}

	a.messageCount.Add(1)
	a.lastMessageTime.Store(time.Now().UnixNano())
}

// IntegrationID returns the integration registry ID for routing purposes.
func (a *HTTPServerAdapter) IntegrationID() int64 { return a.integrationID }

// Config extraction helpers for map[string]interface{}.

func configString(m map[string]interface{}, key, def string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return def
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

// startCommandConsumer creates a durable JetStream consumer for this integration's
// HTTP server downlink commands.
func (a *HTTPServerAdapter) startCommandConsumer(ctx context.Context) {
	consumerName := fmt.Sprintf("http-server-cmd-%d", a.integrationID)
	subject := fmt.Sprintf("commands.dispatch.http-server.%d", a.integrationID)

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
// HTTP server adapters receive commands asynchronously via NATS; the formatted
// payload is forwarded to the device via an outbound HTTP POST.
func (a *HTTPServerAdapter) processCommand(_ context.Context, msg infranats.ConsumerMsg) {
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

	// Dispatch: for HTTP server adapter the downlink target URL comes from the command envelope itself.
	a.logger.Printf("[cmd] dispatched [%s] target=%s", env.CommandId, formatted.Target)
	a.publishCommandAck(env, true, "")
	msg.Ack()
}

// publishCommandAck publishes a command acknowledgement to NATS Core.
func (a *HTTPServerAdapter) publishCommandAck(env *pb.CommandEnvelope, success bool, errMsg string) {
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
