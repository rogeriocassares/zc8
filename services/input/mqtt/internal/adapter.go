package mqttsubscriber

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	command "github.com/rogeriocassares/zc8/packages/go-command"
	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	mqtt "github.com/rogeriocassares/zc8/packages/go-infra/paho"
	timestampinfra "github.com/rogeriocassares/zc8/packages/go-infra/time"
	integration "github.com/rogeriocassares/zc8/packages/go-integration"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// MQTTSubscriberAdapter handles MQTT connections for one integration_registry entry.
// Implements the integration.Adapter interface.
type MQTTSubscriberAdapter struct {
	// Configuration
	integrationID int64
	entry         *integration.IntegrationEntry
	db            *sql.DB

	// MQTT config extracted from entry.Config map
	host                    string
	port                    int
	username                *string
	password                *string
	qos                     byte
	cleanSession            bool
	keepAliveSec            int
	connectionTimeoutSec    int
	useTLS                  bool
	topics                  []string
	publishTopicTemplate    string // empty = downlink disabled
	maxReconnectIntervalSec int

	// Shared components
	parserRegistry *integration.ParserRegistry
	deviceLookup   *integration.DeviceLookup
	allowlist      *integration.DeviceAllowlist

	// MQTT client
	client *mqtt.Client

	// Parser codes from integration provider
	gatewayParserCode string
	deviceParserCode  string

	// Bounded worker pool: prevents unbounded goroutines under load.
	workerSem chan struct{}

	// State
	mu              sync.RWMutex
	isConnected     bool
	messageCount    atomic.Int64
	errorCount      atomic.Int64
	lastMessageTime atomic.Int64 // UnixNano

	// Lifecycle
	stopCh   chan struct{}
	stopOnce sync.Once

	// Command dispatch (optional — nil disables downlink)
	jsCommands  *infranats.JetStreamClient
	commandReg  *command.Registry
	cmdCancelFn context.CancelFunc

	// Callbacks
	messageCallback func(*integration.Message)

	// SVC JetStream client — publishes ServiceEvent protos before parsers run.
	// Nil if SVC publishing is not desired.
	svcJS *infranats.JetStreamClient

	// Logging
	logger *log.Logger
}

// NewMQTTSubscriberAdapter creates MQTT adapter for an integration registry entry.
// Pass jsCommands and commandReg (non-nil) to enable MQTT downlink command dispatch;
// pass nil for both to run ingress-only.
func NewMQTTSubscriberAdapter(
	entry *integration.IntegrationEntry,
	db *sql.DB,
	parserRegistry *integration.ParserRegistry,
	deviceLookup *integration.DeviceLookup,
	messageCallback func(*integration.Message),
	logger *log.Logger,
	jsCommands *infranats.JetStreamClient,
	commandReg *command.Registry,
	svcJS *infranats.JetStreamClient,
) *MQTTSubscriberAdapter {
	if logger == nil {
		logger = log.New(
			log.Writer(),
			fmt.Sprintf("[MQTT:integration_%d] ", entry.ID),
			log.LstdFlags,
		)
	}

	gatewayParserCode := entry.ProviderCode
	// No hardcoded fallback — if ProviderCode is empty, determineTopics()
	// will use ProviderDefaultTopics from the DB (service_providers.default_subscribe_topics).

	deviceParserCode := "agent" // Generic fallback

	maxWorkers := runtime.NumCPU() * 4
	if maxWorkers < 8 {
		maxWorkers = 8
	}

	// Extract MQTT config from entry.Config map
	host := configString(entry.Config, "host", "localhost")
	port := configInt(entry.Config, "port", 1883)
	username := configStringPtr(entry.Config, "username")
	password := configStringPtr(entry.Config, "password")
	qos := byte(configInt(entry.Config, "qos", 0))
	cleanSession := configBool(entry.Config, "clean_session", true)
	keepAliveSec := configInt(entry.Config, "keep_alive_sec", 60)
	connectionTimeoutSec := configInt(entry.Config, "connection_timeout_sec", 10)
	useTLS := configBool(entry.Config, "use_tls", false)
	maxReconnectIntervalSec := configInt(entry.Config, "max_reconnect_interval_sec", 10)
	// Subscribe topics (from the service_input_mqtt_config.subscribe_topics column)
	topics := configStringSlice(entry.Config, "subscribe_topics")
	// Downlink publish template (from service_input_mqtt_config.publish_topic_template; empty = disabled)
	publishTopicTemplate := configString(entry.Config, "publish_topic_template", "")

	adapter := &MQTTSubscriberAdapter{
		integrationID:           entry.ID,
		entry:                   entry,
		db:                      db,
		host:                    host,
		port:                    port,
		username:                username,
		password:                password,
		qos:                     qos,
		cleanSession:            cleanSession,
		keepAliveSec:            keepAliveSec,
		connectionTimeoutSec:    connectionTimeoutSec,
		useTLS:                  useTLS,
		topics:                  topics,
		publishTopicTemplate:    publishTopicTemplate,
		maxReconnectIntervalSec: maxReconnectIntervalSec,
		parserRegistry:          parserRegistry,
		deviceLookup:            deviceLookup,
		gatewayParserCode:       gatewayParserCode,
		deviceParserCode:        deviceParserCode,
		workerSem:               make(chan struct{}, maxWorkers),
		stopCh:                  make(chan struct{}),
		messageCallback:         messageCallback,
		logger:                  logger,
		jsCommands:              jsCommands,
		commandReg:              commandReg,
		svcJS:                   svcJS,
	}

	logger.Printf(
		"MQTT adapter initialized for integration %d with parsers: gateway=%s, device=%s",
		entry.ID, gatewayParserCode, deviceParserCode,
	)

	return adapter
}

// Start initializes MQTT connection and begins listening.
func (a *MQTTSubscriberAdapter) Start(_ context.Context) error {
	brokerAddr := fmt.Sprintf("%s:%d", a.host, a.port)
	a.logger.Printf(
		"Starting MQTT adapter for team %s (broker: %s, integration_id: %d)",
		a.entry.TeamName, brokerAddr, a.integrationID,
	)

	a.determineTopics()

	cfg := mqtt.DefaultConfig()
	cfg.Broker = fmt.Sprintf("tcp://%s", brokerAddr)
	cfg.ClientID = fmt.Sprintf("zc8-integration_%d-team%d-%d", a.integrationID, a.entry.TeamID, time.Now().UnixNano()%10000)
	cfg.ConnectTimeout = time.Duration(a.connectionTimeoutSec) * time.Second
	if cfg.ConnectTimeout <= 0 {
		cfg.ConnectTimeout = 10 * time.Second
	}
	cfg.KeepAlive = time.Duration(a.keepAliveSec) * time.Second
	if cfg.KeepAlive <= 0 {
		cfg.KeepAlive = 60 * time.Second
	}
	cfg.AutoReconnect = true
	cfg.ReconnectWait = time.Duration(a.maxReconnectIntervalSec) * time.Second
	if cfg.ReconnectWait <= 0 {
		cfg.ReconnectWait = 10 * time.Second
	}

	if a.username != nil {
		cfg.Username = *a.username
		if a.password != nil {
			cfg.Password = *a.password
		}
	}

	connCtx, cancel := context.WithTimeout(context.Background(), cfg.ConnectTimeout)
	client, err := mqtt.New(connCtx, cfg)
	cancel()
	if err != nil {
		return fmt.Errorf("failed to create MQTT client: %w", err)
	}

	for _, topic := range a.topics {
		if err := client.SubscribeRich(topic, a.qos, a.messageHandler); err != nil {
			a.logger.Printf("Failed to subscribe to %s: %v", topic, err)
			continue
		}
		a.logger.Printf("Subscribed to %s", topic)
	}

	a.client = client
	a.mu.Lock()
	a.isConnected = true
	a.mu.Unlock()

	a.logger.Printf("Connected to broker and subscribed to %d topics", len(a.topics))

	a.allowlist = integration.NewDeviceAllowlist(a.db, a.integrationID, a.logger)
	a.allowlist.Start(context.Background(), 30*time.Second)

	go a.monitorConnection()

	// Start command consumer if command dispatch is configured.
	if a.jsCommands != nil && a.commandReg != nil {
		cmdCtx, cmdCancel := context.WithCancel(context.Background())
		a.cmdCancelFn = cmdCancel
		go a.startCommandConsumer(cmdCtx)
	}
	return nil
}

// determineTopics configures subscribe topics from config or provider DB defaults.
// Topics come from service_input_mqtt_config.subscribe_topics (set in DB).
// If that is empty, the provider's default_subscribe_topics from service_providers are used.
// If BOTH are empty, subscription is skipped and an error is logged — this is a misconfiguration.
func (a *MQTTSubscriberAdapter) determineTopics() {
	if len(a.topics) > 0 {
		a.logger.Printf("Topics from integration config: %v", a.topics)
		return
	}

	// Fall back to provider-level defaults sourced from service_providers.default_subscribe_topics
	// (populated by WorkerManager during discovery — no hardcoded switch statements here).
	if len(a.entry.ProviderDefaultTopics) > 0 {
		a.topics = a.entry.ProviderDefaultTopics
		a.logger.Printf(
			"WARNING: no subscribe_topics in integration config — using provider %q defaults from DB: %v "+
				"(set 'subscribe_topics' in service_input_mqtt_config to silence this)",
			a.gatewayParserCode, a.topics,
		)
		return
	}

	a.logger.Printf(
		"ERROR: integration %d has no subscribe_topics configured and provider %q has no defaults in DB — skipping subscription",
		a.integrationID, a.gatewayParserCode,
	)
}

// messageHandler processes incoming MQTT messages with bounded concurrency.
func (a *MQTTSubscriberAdapter) messageHandler(msg mqtt.RichMessage) {
	msgData := mqttMessageData{
		Topic:    msg.Topic,
		Payload:  append([]byte{}, msg.Payload...),
		QoS:      msg.QoS,
		Retained: msg.Retained,
	}

	select {
	case a.workerSem <- struct{}{}:
		go func() {
			defer func() { <-a.workerSem }()
			a.handleMessage(msgData)
		}()
	case <-a.stopCh:
		return
	}
}

type mqttMessageData struct {
	Topic    string
	Payload  []byte
	QoS      byte
	Retained bool
}

// handleMessage processes a single MQTT message (runs inside bounded worker pool).
// Stage 1: Gateway parser extracts device payload from MQTT envelope
// Stage 2: Device parser decodes the device payload into fields
func (a *MQTTSubscriberAdapter) handleMessage(msgData mqttMessageData) {
	defer func() {
		if r := recover(); r != nil {
			a.logger.Printf("Handler panic recovered: %v", r)
			a.errorCount.Add(1)
		}
	}()

	deviceKey, ok := extractDeviceKey(msgData.Topic)
	if !ok {
		return
	}

	// ── Raw ingest event ───────────────────────────────────────────────────────
	// Publish ServiceEvent{SVC_RAW_INGEST} before any parser runs so the Live
	// Messages panel can show raw device payloads even when parsers fail.
	if a.svcJS != nil {
		preview := msgData.Payload
		if len(preview) > 64 {
			preview = preview[:64]
		}
		ev := &pb.ServiceEvent{
			EventType:      pb.ServiceEventType_SVC_RAW_INGEST,
			ServiceId:      a.integrationID,
			ServiceType:    "input.mqtt",
			OrgId:          a.entry.OrganizationID,
			TeamId:         a.entry.TeamID,
			TeamName:       a.entry.TeamName,
			ReportedAt:     timestampinfra.Now(),
			SourceTopic:    msgData.Topic,
			PayloadPreview: preview,
			PayloadSize:    int32(len(msgData.Payload)),
		}
		data, err := pb.MarshalServiceEvent(ev)
		if err == nil {
			subject := fmt.Sprintf("svc.%d.%d", a.entry.OrganizationID, a.integrationID)
			if _, err := a.svcJS.Publish(context.Background(), subject, data); err != nil {
				a.logger.Printf("[svc] raw ingest publish error: %v", err)
			}
		}
	}

	if a.parserRegistry == nil {
		a.errorCount.Add(1)
		return
	}

	var devicePayload []byte

	// STAGE 1: Parse gateway envelope
	gatewayFrame, devicePayload := func() (*struct{ DevicePayload []byte }, []byte) {
		if a.gatewayParserCode == "" || a.gatewayParserCode == "default" {
			return nil, msgData.Payload
		}
		gp, err := a.parserRegistry.GetGatewayParser(a.gatewayParserCode)
		if err != nil {
			a.errorCount.Add(1)
			return nil, nil
		}
		frame, err := gp.Parse(msgData.Payload)
		if err != nil {
			a.errorCount.Add(1)
			return nil, nil
		}
		return nil, frame.DevicePayload
	}()
	_ = gatewayFrame

	if devicePayload == nil {
		return
	}

	// Determine device parser code
	deviceParserCode := a.deviceParserCode

	// STAGE 2: Parse device payload
	dp, err := a.parserRegistry.GetDeviceParser(deviceParserCode)
	if err != nil {
		a.errorCount.Add(1)
		return
	}
	deviceData, err := dp.Parse(devicePayload)
	if err != nil {
		a.errorCount.Add(1)
		return
	}

	ingestMsg := &integration.Message{
		ServiceID:        a.integrationID,
		ServiceType:      "input.mqtt",
		TeamID:           a.entry.TeamID,
		TeamName:         a.entry.TeamName,
		OrganizationID:   a.entry.OrganizationID,
		DeviceKey:        deviceKey,
		ProviderCode:     a.gatewayParserCode,
		DeviceParserCode: deviceParserCode,
		DeviceData:       deviceData,
		Metadata: map[string]interface{}{
			"topic":    msgData.Topic,
			"qos":      msgData.QoS,
			"retained": msgData.Retained,
		},
		ReceivedAt: time.Now(),
	}

	// Enrich message with device registry data
	if a.deviceLookup != nil {
		devCfg, err := a.deviceLookup.Lookup(context.Background(), deviceKey, a.entry.TeamID)
		if err != nil {
			a.logger.Printf("Device lookup failed for %s: %v", deviceKey, err)
		} else if devCfg != nil {
			ingestMsg.DeviceUUID = devCfg.DeviceUUID
			ingestMsg.DeviceModelCode = devCfg.DeviceModelCode
			ingestMsg.VendorID = devCfg.VendorID
			if a.allowlist != nil && !a.allowlist.ContainsDeviceUUID(devCfg.DeviceUUID) {
				return // device not routed to this service
			}
		} else {
			a.errorCount.Add(1)
			return // unknown device — not registered
		}
	}

	if a.messageCallback != nil {
		a.messageCallback(ingestMsg)
	}

	a.messageCount.Add(1)
	a.lastMessageTime.Store(time.Now().UnixNano())
}

// monitorConnection periodically checks connection status.
func (a *MQTTSubscriberAdapter) monitorConnection() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-a.stopCh:
			return
		case <-ticker.C:
			if a.client != nil && a.client.IsConnected() {
				a.mu.Lock()
				a.isConnected = true
				a.mu.Unlock()
			} else {
				a.mu.Lock()
				a.isConnected = false
				a.mu.Unlock()
				a.logger.Printf("Connection lost, waiting for auto-reconnect...")
			}
		}
	}
}

// startCommandConsumer creates a durable JetStream consumer for this integration's MQTT
// downlink commands and forwards them to the device via the open broker connection.
func (a *MQTTSubscriberAdapter) startCommandConsumer(ctx context.Context) {
	consumerName := fmt.Sprintf("mqtt-cmd-%d", a.integrationID)
	subject := fmt.Sprintf("commands.dispatch.mqtt.%d", a.integrationID)

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

// processCommand formats and dispatches a single command envelope via MQTT.
func (a *MQTTSubscriberAdapter) processCommand(ctx context.Context, msg infranats.ConsumerMsg) {
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

	a.mu.RLock()
	connected := a.isConnected
	a.mu.RUnlock()

	if !connected || a.client == nil {
		a.logger.Printf("[cmd] dropped [%s]: MQTT not connected", env.CommandId)
		msg.Nak()
		return
	}

	if err := a.client.Publish(formatted.Target, 1, false, formatted.Payload); err != nil {
		a.logger.Printf("[cmd] mqtt publish error [%s] topic=%s: %v", env.CommandId, formatted.Target, err)
		a.publishCommandAck(env, false, fmt.Sprintf("mqtt publish: %v", err))
		msg.Nak()
		return
	}

	a.logger.Printf("[cmd] dispatched [%s] topic=%s", env.CommandId, formatted.Target)
	a.publishCommandAck(env, true, "")
	msg.Ack()
}

// publishCommandAck publishes a command acknowledgement to NATS Core.
func (a *MQTTSubscriberAdapter) publishCommandAck(env *pb.CommandEnvelope, success bool, errMsg string) {
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

// Stop gracefully stops the adapter.
func (a *MQTTSubscriberAdapter) Stop() {
	a.stopOnce.Do(func() {
		a.logger.Printf("Stopping MQTT adapter")
		close(a.stopCh)

		// Stop command consumer if running.
		if a.cmdCancelFn != nil {
			a.cmdCancelFn()
		}

		if a.client != nil {
			if err := a.client.Close(); err != nil {
				a.logger.Printf("Error closing MQTT client: %v", err)
			}
		}

		a.mu.Lock()
		a.isConnected = false
		a.mu.Unlock()
	})
}

// Status returns current adapter status.
func (a *MQTTSubscriberAdapter) Status() map[string]interface{} {
	a.mu.RLock()
	connected := a.isConnected
	a.mu.RUnlock()

	lastMsg := ""
	if ts := a.lastMessageTime.Load(); ts > 0 {
		lastMsg = time.Unix(0, ts).Format(time.RFC3339)
	}

	return map[string]interface{}{
		"service_id":       a.integrationID,
		"integration_id":   a.integrationID,
		"service_type":     "input.mqtt",
		"integration_type": "mqtt-subscriber",
		"org_id":           a.entry.OrganizationID,
		"team_id":          a.entry.TeamID,
		"team_name":        a.entry.TeamName,
		"broker":           fmt.Sprintf("%s:%d", a.host, a.port),
		"topics":           a.topics,
		"is_connected":     connected,
		"message_count":    a.messageCount.Load(),
		"error_count":      a.errorCount.Load(),
		"last_message_at":  lastMsg,
	}
}

// extractDeviceKey extracts device identifier from MQTT topic.
func extractDeviceKey(topic string) (string, bool) {
	parts := strings.Split(topic, "/")

	// ChirpStack: applications/{appID}/devices/{deviceID}/up
	if len(parts) >= 4 && parts[0] == "applications" && parts[2] == "devices" {
		return parts[3], true
	}

	// ChirpStack (singular): application/{appID}/device/{deviceID}/event/up
	if len(parts) >= 4 && parts[0] == "application" && parts[2] == "device" {
		return parts[3], true
	}

	// Direct MQTT: devices/{deviceID}/up or devices/{deviceID}/telemetry
	if len(parts) >= 2 && parts[0] == "devices" {
		return parts[1], true
	}

	// Maua: maua/devices/{deviceID}/data
	if len(parts) >= 3 && parts[0] == "maua" && parts[1] == "devices" {
		return parts[2], true
	}

	return "", false
}

// parseTopicsFromJSON is a helper for backward compatibility with JSON topic configs.
func parseTopicsFromJSON(raw interface{}) []string {
	switch v := raw.(type) {
	case []interface{}:
		topics := make([]string, 0, len(v))
		for _, t := range v {
			if s, ok := t.(string); ok {
				topics = append(topics, s)
			}
		}
		return topics
	case string:
		var topics []string
		if err := json.Unmarshal([]byte(v), &topics); err == nil {
			return topics
		}
	}
	return nil
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

func configStringSlice(m map[string]interface{}, key string) []string {
	if v, ok := m[key]; ok {
		if topics := parseTopicsFromJSON(v); len(topics) > 0 {
			return topics
		}
	}
	return nil
}
