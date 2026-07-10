package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	MQTT "github.com/eclipse/paho.mqtt.golang"
	_ "github.com/lib/pq"

	"github.com/rogeriocassares/zc8/services/adapters/chirpstack/internal/app"
	"github.com/rogeriocassares/zc8/services/adapters/chirpstack/internal/config"
)

func main() {
	// ---------------------------------------------------
	// Context for graceful shutdown
	// ---------------------------------------------------
	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	logger := log.New(os.Stdout, "[chirpstack-adapter] ", log.LstdFlags|log.Lshortfile)

	// ---------------------------------------------------
	// Configuration
	// ---------------------------------------------------
	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("Failed to load config:", err)
	}

	// ---------------------------------------------------
	// Database Connection (Device Registry)
	// ---------------------------------------------------
	psqlInfo := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		cfg.Postgres.Host,
		cfg.Postgres.Port,
		cfg.Postgres.User,
		cfg.Postgres.Password,
		cfg.Postgres.Database,
		cfg.Postgres.SSLMode,
	)

	db, err := sql.Open("postgres", psqlInfo)
	if err != nil {
		logger.Fatal("Failed to connect to database:", err)
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		logger.Fatal("Database ping failed:", err)
	}
	logger.Println("Connected to PostgreSQL device registry")

	// ---------------------------------------------------
	// Adapter Application Layer
	// ---------------------------------------------------
	adapter, err := app.NewAdapter(cfg, db, logger)
	if err != nil {
		logger.Fatal("Failed to initialize adapter:", err)
	}

	// Warm cache on startup
	const tenantID = 1 // Default tenant for ChirpStack
	if err := adapter.WarmCache(ctx, tenantID); err != nil {
		logger.Printf("Warning: Failed to warm cache (non-fatal): %v\n", err)
	}

	// ---------------------------------------------------
	// MQTT Subscription
	// ---------------------------------------------------
	mqttOpts := MQTT.NewClientOptions()
	mqttOpts.AddBroker(cfg.MQTT.BrokerURL)
	mqttOpts.SetClientID(cfg.MQTT.ClientID)
	if cfg.MQTT.Username != "" {
		mqttOpts.SetUsername(cfg.MQTT.Username)
		mqttOpts.SetPassword(cfg.MQTT.Password)
	}
	mqttOpts.SetAutoReconnect(true)
	mqttOpts.SetConnectRetry(true)
	mqttOpts.SetConnectRetryInterval(1 * time.Second)
	mqttOpts.SetMaxReconnectInterval(30 * time.Second)

	// Topic subscription: application/{app_id}/device/{device_id}/event/up
	subscr := MQTT.NewClient(mqttOpts)
	if token := subscr.Connect(); token.Wait() && token.Error() != nil {
		logger.Fatal("Failed to connect MQTT subscriber:", token.Error())
	}
	logger.Printf("Connected to MQTT broker: %s\n", cfg.MQTT.BrokerURL)
	defer subscr.Disconnect(250)

	// ---------------------------------------------------
	// MQTT Publishing (forward to ingest service)
	// ---------------------------------------------------
	pubOpts := MQTT.NewClientOptions()
	pubOpts.AddBroker(cfg.MQTT.BrokerURL)
	pubOpts.SetClientID(cfg.MQTT.ClientID + "-pub")
	if cfg.MQTT.Username != "" {
		pubOpts.SetUsername(cfg.MQTT.Username)
		pubOpts.SetPassword(cfg.MQTT.Password)
	}

	publisher := MQTT.NewClient(pubOpts)
	if token := publisher.Connect(); token.Wait() && token.Error() != nil {
		logger.Fatal("Failed to connect MQTT publisher:", token.Error())
	}
	defer publisher.Disconnect(250)

	// Subscribe to ChirpStack events
	subscribeTopics := make(map[string]byte)
	for _, topic := range cfg.MQTT.Topics {
		subscribeTopics[topic] = cfg.MQTT.QoS
	}

	if token := subscr.SubscribeMultiple(subscribeTopics, subscribeHandler(ctx, adapter, publisher, cfg, logger)); token.Wait() && token.Error() != nil {
		logger.Fatal("Failed to subscribe to topics:", token.Error())
	}
	logger.Println("Subscribed to ChirpStack device events")

	// ---------------------------------------------------
	// Wait for shutdown signal
	// ---------------------------------------------------
	<-ctx.Done()

	logger.Println("Shutting down adapter...")

	// Log final cache metrics
	hitRate := adapter.GetCacheMetrics()
	logger.Printf("Final cache hit rate: %.1f%%\n", hitRate*100)

	// Clean shutdown
	adapter.Shutdown()

	logger.Println("Adapter stopped")
}

// subscribeHandler creates the MQTT message handler
func subscribeHandler(ctx context.Context, adapter *app.Adapter, publisher MQTT.Client, cfg *config.Config, logger *log.Logger) MQTT.MessageHandler {
	return func(client MQTT.Client, msg MQTT.Message) {
		topic := msg.Topic()
		payload := msg.Payload()

		// Parse ChirpStack topic: application/{app_id}/device/{device_id}/event/up
		parts := strings.Split(topic, "/")
		if len(parts) < 4 {
			logger.Printf("Invalid topic format: %s\n", topic)
			return
		}

		deviceEUI := parts[3]
		const tenantID = 1

		// Resolve DevEUI to internal device ID using adapter
		deviceID, err := adapter.ResolveDevice(ctx, tenantID, deviceEUI)
		if err != nil {
			logger.Printf("Failed to resolve device %s: %v\n", deviceEUI, err)
			return
		}

		// Forward to ingest service
		outTopic := fmt.Sprintf("device/%s/telemetry", deviceID)
		if token := publisher.Publish(outTopic, cfg.MQTT.QoS, false, payload); token.Wait() && token.Error() != nil {
			logger.Printf("Failed to publish to %s: %v\n", outTopic, token.Error())
			return
		}

		logger.Printf("Forwarded DevEUI=%s → DeviceID=%s\n", deviceEUI, deviceID)
	}
}
