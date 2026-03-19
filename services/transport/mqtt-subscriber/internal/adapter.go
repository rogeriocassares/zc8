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

	tcfg "github.com/rogeriocassares/zc8/packages/go-config/transport"
	mqtt "github.com/rogeriocassares/zc8/packages/go-infra/paho"
	transport "github.com/rogeriocassares/zc8/packages/go-transport"
)

// MQTTSubscriberAdapter handles MQTT connections for one transport_registry entry.
// Implements the transport.Adapter interface.
type MQTTSubscriberAdapter struct {
	// Configuration
	transportID int64
	entry       *transport.TransportEntry
	mqttCfg     *tcfg.MQTTConfig
	db          *sql.DB

	// Shared components
	parserRegistry *transport.ParserRegistry
	deviceLookup   *transport.DeviceLookup

	// MQTT client
	client *mqtt.Client
	topics []string

	// Transport layer parsers
	gatewayParserCode string // e.g., "chirpstack", "everynet"
	deviceParserCode  string // e.g., "milesight", "agent"

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

	// Callbacks
	messageCallback func(*transport.Message)

	// Logging
	logger *log.Logger
}

// NewMQTTSubscriberAdapter creates MQTT adapter for a transport registry entry.
func NewMQTTSubscriberAdapter(
	entry *transport.TransportEntry,
	mqttCfg *tcfg.MQTTConfig,
	db *sql.DB,
	parserRegistry *transport.ParserRegistry,
	deviceLookup *transport.DeviceLookup,
	messageCallback func(*transport.Message),
	logger *log.Logger,
) *MQTTSubscriberAdapter {
	if logger == nil {
		logger = log.New(
			log.Writer(),
			fmt.Sprintf("[MQTT:transport_%d] ", entry.ID),
			log.LstdFlags,
		)
	}

	gatewayParserCode := entry.ParserCode
	if gatewayParserCode == "" {
		gatewayParserCode = "chirpstack" // Fallback for MQTT
	}

	deviceParserCode := "agent" // Generic fallback

	maxWorkers := runtime.NumCPU() * 4
	if maxWorkers < 8 {
		maxWorkers = 8
	}

	adapter := &MQTTSubscriberAdapter{
		transportID:       entry.ID,
		entry:             entry,
		mqttCfg:           mqttCfg,
		db:                db,
		parserRegistry:    parserRegistry,
		deviceLookup:      deviceLookup,
		topics:            []string{},
		gatewayParserCode: gatewayParserCode,
		deviceParserCode:  deviceParserCode,
		workerSem:         make(chan struct{}, maxWorkers),
		stopCh:            make(chan struct{}),
		messageCallback:   messageCallback,
		logger:            logger,
	}

	logger.Printf(
		"MQTT adapter initialized for transport %d with parsers: gateway=%s, device=%s",
		entry.ID, gatewayParserCode, deviceParserCode,
	)

	return adapter
}

// Start initializes MQTT connection and begins listening.
func (a *MQTTSubscriberAdapter) Start(_ context.Context) error {
	a.logger.Printf(
		"Starting MQTT adapter for team %s (broker: %s, transport_id: %d)",
		a.entry.TeamName, a.mqttCfg.BrokerAddress(), a.transportID,
	)

	a.determineTopics()

	cfg := mqtt.DefaultConfig()
	cfg.Broker = fmt.Sprintf("tcp://%s", a.mqttCfg.BrokerAddress())
	cfg.ClientID = fmt.Sprintf("zc8-transport_%d-team%d-%d", a.transportID, a.entry.TeamID, time.Now().UnixNano()%10000)
	cfg.ConnectTimeout = time.Duration(a.mqttCfg.ConnectionTimeoutSec) * time.Second
	if cfg.ConnectTimeout <= 0 {
		cfg.ConnectTimeout = 10 * time.Second
	}
	cfg.KeepAlive = time.Duration(a.mqttCfg.KeepAliveSec) * time.Second
	if cfg.KeepAlive <= 0 {
		cfg.KeepAlive = 60 * time.Second
	}
	cfg.AutoReconnect = true
	cfg.ReconnectWait = time.Duration(a.mqttCfg.MaxReconnectIntervalSec) * time.Second
	if cfg.ReconnectWait <= 0 {
		cfg.ReconnectWait = 10 * time.Second
	}

	if a.mqttCfg.Username != nil {
		cfg.Username = *a.mqttCfg.Username
		if a.mqttCfg.Password != nil {
			cfg.Password = *a.mqttCfg.Password
		}
	}

	connCtx, cancel := context.WithTimeout(context.Background(), cfg.ConnectTimeout)
	client, err := mqtt.New(connCtx, cfg)
	cancel()
	if err != nil {
		return fmt.Errorf("failed to create MQTT client: %w", err)
	}

	qos := byte(a.mqttCfg.QoS)
	for _, topic := range a.topics {
		if err := client.SubscribeRich(topic, qos, a.messageHandler); err != nil {
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

	go a.monitorConnection()
	return nil
}

// determineTopics configures topics from MQTTConfig or defaults.
func (a *MQTTSubscriberAdapter) determineTopics() {
	a.topics = []string{}

	// Use topics from MQTTConfig (loaded from transport_mqtt_config.topics JSONB)
	if len(a.mqttCfg.Topics) > 0 {
		a.topics = a.mqttCfg.Topics
		a.logger.Printf("Configured topics from config: %v", a.topics)
		return
	}

	// If no topics configured, use defaults
	a.topics = []string{
		"applications/+/devices/+/up", // ChirpStack
		"devices/+/up",                // Direct MQTT
		"devices/+/telemetry",         // Direct MQTT telemetry
		"maua/devices/+/data",         // Maua Racing
	}
	a.logger.Printf("Using default topics: %v", a.topics)
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

	ingestMsg := &transport.Message{
		TransportRegistryID: a.transportID,
		TransportType:       "mqtt-subscriber",
		TeamID:              a.entry.TeamID,
		TeamName:            a.entry.TeamName,
		OrganizationID:      a.entry.OrganizationID,
		DeviceKey:           deviceKey,
		GatewayParserCode:   a.gatewayParserCode,
		DeviceParserCode:    deviceParserCode,
		DeviceData:          deviceData,
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
			ingestMsg.Routing = devCfg.Routing
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

// Stop gracefully stops the adapter.
func (a *MQTTSubscriberAdapter) Stop() {
	a.stopOnce.Do(func() {
		a.logger.Printf("Stopping MQTT adapter")
		close(a.stopCh)

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
		"transport_id":    a.transportID,
		"transport_type":  "mqtt-subscriber",
		"team_id":         a.entry.TeamID,
		"team_name":       a.entry.TeamName,
		"broker":          a.mqttCfg.BrokerAddress(),
		"topics":          a.topics,
		"is_connected":    connected,
		"message_count":   a.messageCount.Load(),
		"error_count":     a.errorCount.Load(),
		"last_message_at": lastMsg,
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
