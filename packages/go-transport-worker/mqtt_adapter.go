package transport

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

// MQTTAdapter handles MQTT connections for a worker
type MQTTAdapter struct {
	worker   *Worker
	client   mqtt.Client
	topics   []string
	mu       sync.RWMutex
	stopCh   chan struct{}
	stopOnce sync.Once
	logger   *log.Logger
	wp       *WorkerPool
}

// NewMQTTAdapter creates a new MQTT adapter
func NewMQTTAdapter(worker *Worker, wp *WorkerPool, logger *log.Logger) *MQTTAdapter {
	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[MQTT:%s] ", worker.ID), log.LstdFlags)
	}
	return &MQTTAdapter{
		worker: worker,
		wp:     wp,
		topics: []string{},
		stopCh: make(chan struct{}),
		logger: logger,
	}
}

// Start initializes the MQTT connection
func (ma *MQTTAdapter) Start() error {
	ma.logger.Printf("Starting MQTT adapter for team %s (provider: %s)", ma.worker.TeamName, ma.worker.ProviderName)

	// Determine topics based on provider
	ma.determineTopic()

	// Create MQTT client options
	opts := mqtt.NewClientOptions()
	opts.AddBroker(fmt.Sprintf("mqtt://%s", ma.worker.Config.BrokerAddr))
	opts.SetClientID(ma.generateClientID())
	opts.SetConnectTimeout(10 * time.Second)
	opts.SetKeepAlive(60 * time.Second)
	opts.SetAutoReconnect(true)
	opts.SetMaxReconnectInterval(10 * time.Second)

	// Set credentials if available
	if username, ok := ma.worker.Config.TeamConfig["username"].(string); ok {
		opts.SetUsername(username)
		if password, ok := ma.worker.Config.TeamConfig["password"].(string); ok {
			opts.SetPassword(password)
		}
	}

	// Set callbacks
	opts.OnConnect = ma.onConnect
	opts.OnConnectionLost = ma.onConnectionLost
	opts.OnReconnecting = ma.onReconnecting

	// Create and connect client
	ma.client = mqtt.NewClient(opts)
	token := ma.client.Connect()
	if !token.WaitTimeout(10 * time.Second) {
		return fmt.Errorf("connection timeout")
	}
	if token.Error() != nil {
		return fmt.Errorf("connection failed: %w", token.Error())
	}

	ma.mu.Lock()
	ma.worker.Connection = ma.client
	ma.worker.Active = true
	ma.worker.ConnectedAt = time.Now()
	ma.mu.Unlock()

	ma.logger.Printf("MQTT adapter started successfully")

	// Monitor connection in background
	go ma.monitorConnection()

	return nil
}

// determineTopic sets topics from config (TransportConfig.TopicConfig).
// Topics must be populated from the integration_config_mqtt.subscribe_topics column.
// If not configured, no topics are set and subscription is skipped.
func (ma *MQTTAdapter) determineTopic() {
	if len(ma.worker.Config.TopicConfig) > 0 {
		ma.topics = ma.worker.Config.TopicConfig
		ma.logger.Printf("Topics from config for provider %s: %v", ma.worker.ProviderName, ma.topics)
		return
	}
	ma.logger.Printf(
		"WARNING: no topics configured for provider %q worker %s — set subscribe_topics in integration_config_mqtt",
		ma.worker.ProviderName, ma.worker.ID,
	)
}

// generateClientID creates a unique client ID
func (ma *MQTTAdapter) generateClientID() string {
	return fmt.Sprintf("zc8-team%d-%s-%d", ma.worker.TeamID, strings.ToLower(ma.worker.ProviderName), time.Now().UnixNano()%10000)
}

// onConnect is called when the client connects
func (ma *MQTTAdapter) onConnect(client mqtt.Client) {
	ma.logger.Printf("Connected to broker %s", ma.worker.Config.BrokerAddr)

	// Subscribe to all topics
	for _, topic := range ma.topics {
		token := client.Subscribe(topic, 1, ma.messageHandler)
		if err := token.Error(); err != nil {
			ma.logger.Printf("Failed to subscribe to topic %s: %v", topic, err)
			continue
		}
		ma.logger.Printf("Subscribed to topic: %s", topic)
	}
}

// onConnectionLost is called when the connection is lost
func (ma *MQTTAdapter) onConnectionLost(client mqtt.Client, err error) {
	ma.logger.Printf("Connection lost: %v", err)

	ma.mu.Lock()
	ma.worker.Active = false
	ma.mu.Unlock()
}

// onReconnecting is called when attempting to reconnect
func (ma *MQTTAdapter) onReconnecting(client mqtt.Client, opts mqtt.ClientOptions) {
	ma.logger.Printf("Attempting to reconnect...")
}

// messageHandler processes incoming MQTT messages
func (ma *MQTTAdapter) messageHandler(client mqtt.Client, msg mqtt.Message) {
	ma.mu.RLock()
	teamID := ma.worker.TeamID
	teamName := ma.worker.TeamName
	providerID := ma.worker.ProviderID
	providerName := ma.worker.ProviderName
	workerID := ma.worker.ID
	ma.mu.RUnlock()

	// Parse message based on provider
	payload := ma.parsePayload(msg)

	// Route to unified ingest
	ingestMsg := Message{
		WorkerID:      workerID,
		TransportType: "mqtt",
		TeamID:        teamID,
		TeamName:      teamName,
		ProviderID:    providerID,
		ProviderName:  providerName,
		Payload:       payload,
		Metadata: map[string]interface{}{
			"topic":       msg.Topic(),
			"qos":         msg.Qos(),
			"retained":    msg.Retained(),
			"received_at": time.Now(),
		},
		ReceivedAt:  time.Now(),
		ProcessedAt: time.Now(),
	}

	// Extract device key from topic
	if deviceKey, ok := extractDeviceKeyFromTopic(msg.Topic()); ok {
		ingestMsg.DeviceKey = deviceKey
	}

	ma.wp.RouteMessage(ingestMsg)

	ma.mu.Lock()
	ma.worker.MessageCount++
	ma.worker.LastMessageAt = time.Now()
	ma.mu.Unlock()

	ma.logger.Printf("Message routed from %s topic %s (device: %s)", providerName, msg.Topic(), ingestMsg.DeviceKey)
}

// parsePayload converts the raw MQTT message to unified format
func (ma *MQTTAdapter) parsePayload(msg mqtt.Message) map[string]interface{} {
	payload := make(map[string]interface{})

	// Try to parse as JSON first
	var jsonData map[string]interface{}
	if err := (&payload).unmarshalJSON(msg.Payload()); err == nil {
		return jsonData
	}

	// Fallback: store as raw bytes
	payload["raw_data"] = string(msg.Payload())
	payload["raw_bytes_length"] = len(msg.Payload())

	return payload
}

// monitorConnection periodically checks connection status
func (ma *MQTTAdapter) monitorConnection() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ma.stopCh:
			return
		case <-ticker.C:
			if ma.client != nil && ma.client.IsConnected() {
				ma.mu.Lock()
				ma.worker.Active = true
				ma.mu.Unlock()
			} else {
				ma.mu.Lock()
				ma.worker.Active = false
				ma.mu.Unlock()
				ma.logger.Printf("Connection lost, waiting for auto-reconnect...")
			}
		}
	}
}

// Stop gracefully stops the MQTT adapter
func (ma *MQTTAdapter) Stop() {
	ma.stopOnce.Do(func() {
		ma.logger.Printf("Stopping MQTT adapter")
		close(ma.stopCh)

		if ma.client != nil && ma.client.IsConnected() {
			// Unsubscribe from all topics
			for _, topic := range ma.topics {
				ma.client.Unsubscribe(topic)
			}

			// Disconnect
			ma.client.Disconnect(1000) // Wait 1 second for graceful disconnect
		}

		ma.mu.Lock()
		ma.worker.Active = false
		ma.mu.Unlock()
	})
}

// extractDeviceKeyFromTopic extracts the device identifier from MQTT topic
func extractDeviceKeyFromTopic(topic string) (string, bool) {
	parts := strings.Split(topic, "/")

	// ChirpStack format: applications/{appID}/devices/{deviceID}/up
	if len(parts) >= 4 && parts[0] == "applications" && parts[2] == "devices" {
		return parts[3], true
	}

	// Direct MQTT format: devices/{deviceID}/up or devices/{deviceID}/telemetry
	if len(parts) >= 2 && parts[0] == "devices" {
		return parts[1], true
	}

	// Maua format: maua/devices/{deviceID}/data or maua/telemetry/{deviceID}/up
	if len(parts) >= 3 && parts[0] == "maua" {
		if parts[1] == "devices" {
			return parts[2], true
		} else if parts[1] == "telemetry" {
			return parts[2], true
		}
	}

	return "", false
}

// Helper function to unmarshal JSON (simple implementation)
func (p map[string]interface{}) unmarshalJSON(data []byte) error {
	// This is a placeholder - in real code, use encoding/json.Unmarshal
	return fmt.Errorf("not implemented")
}

// GetStatus returns adapter status
func (ma *MQTTAdapter) GetStatus() map[string]interface{} {
	ma.mu.RLock()
	defer ma.mu.RUnlock()

	connected := false
	if ma.client != nil {
		connected = ma.client.IsConnected()
	}

	return map[string]interface{}{
		"worker_id":     ma.worker.ID,
		"transport":     "mqtt",
		"provider":      ma.worker.ProviderName,
		"broker":        ma.worker.Config.BrokerAddr,
		"topics":        ma.topics,
		"connected":     connected,
		"message_count": ma.worker.MessageCount,
		"error_count":   ma.worker.ErrorCount,
	}
}
