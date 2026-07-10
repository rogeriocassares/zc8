package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	command "github.com/rogeriocassares/zc8/packages/go-command"
	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	integration "github.com/rogeriocassares/zc8/packages/go-integration"
	mqttsubscriber "github.com/rogeriocassares/zc8/services/input/mqtt/internal"
)

type Config struct {
	DatabaseURL string
	NATSURL     string
}

func loadConfig() Config {
	return Config{
		DatabaseURL: getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/zc8?sslmode=disable"),
		NATSURL:     getenv("NATS_URL", "nats://localhost:4222"),
	}
}

func getenv(key, defaultValue string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultValue
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Starting MQTT Subscriber Input Adapter...")

	cfg := loadConfig()
	log.Printf("Config: DB=%s NATS=%s", cfg.DatabaseURL, cfg.NATSURL)

	db, err := integration.OpenDatabase(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer db.Close()
	log.Println("Database connected")

	logger := log.New(log.Writer(), "[MQTT-Subscriber] ", log.LstdFlags)

	sinkCfg := integration.SinkConfigFromEnv("mqtt-subscriber")
	ingestSink, err := integration.NewIngestSink(sinkCfg, logger)
	if err != nil {
		log.Fatalf("Failed to create ingest sink: %v", err)
	}
	defer ingestSink.Close()
	log.Println("Ingest sink ready")

	// SVC stream client — publishes ServiceEvent heartbeats for all adapters.
	svcJSClient, err := infranats.NewJetStream(context.Background(), infranats.JetStreamConfig{
		URL:        cfg.NATSURL,
		StreamName: "SVC",
		Subjects:   []string{"svc.>"},
		Replicas:   1,
	}, logger)
	if err != nil {
		log.Fatalf("Failed to connect to SVC stream: %v", err)
	}
	defer svcJSClient.Close()
	log.Println("SVC JetStream ready")

	// COMMANDS stream client — used by adapters for per-integration downlink consumers.
	commandsJSClient, err := infranats.NewJetStream(context.Background(), infranats.JetStreamConfig{
		URL:        cfg.NATSURL,
		StreamName: "COMMANDS",
		Subjects:   []string{"commands.dispatch.>"},
		Replicas:   1,
	}, logger)
	if err != nil {
		log.Fatalf("Failed to connect to COMMANDS stream: %v", err)
	}
	defer commandsJSClient.Close()
	log.Println("COMMANDS JetStream ready")

	commandRegistry := command.NewRegistry()

	parserRegistry := integration.NewParserRegistry(db, logger)
	deviceLookup := integration.NewDeviceLookup(db, logger)

	loadCtx, loadCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := parserRegistry.LoadFromDatabase(loadCtx); err != nil {
		logger.Printf("Warning: failed to load parsers: %v", err)
	}
	loadCancel()

	handleMessage := func(msg *integration.Message) {
		if msg == nil {
			return
		}
		rawEnv := integration.MessageToRawEnvelope(msg, nil, "")
		if !ingestSink.Submit(rawEnv) {
			logger.Printf("Ingest queue full (raw), dropped message for device %s", msg.DeviceKey)
		}
		decodedEnv := integration.MessageToDecodedEnvelope(msg)
		if !ingestSink.Submit(decodedEnv) {
			logger.Printf("Ingest queue full (decoded), dropped message for device %s", msg.DeviceKey)
		}
	}

	adapterFactory := func(entry *integration.IntegrationEntry) (integration.Adapter, error) {
		adapter := mqttsubscriber.NewMQTTSubscriberAdapter(
			entry,
			db,
			parserRegistry,
			deviceLookup,
			handleMessage,
			nil,
			commandsJSClient,
			commandRegistry,
			svcJSClient,
		)
		return adapter, nil
	}

	manager := integration.NewWorkerManager(integration.WorkerManagerConfig{
		DB:                db,
		ServiceType:       "input.mqtt",
		DiscoveryInterval: 30 * time.Second,
		AdapterFactory:    adapterFactory,
		Logger:            logger,
		SvcJS:             svcJSClient,
		StatusInterval:    15 * time.Second,
	})

	startCtx, startCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := manager.Start(startCtx); err != nil {
		startCancel()
		log.Fatalf("Failed to start worker manager: %v", err)
	}
	startCancel()
	log.Println("Worker manager started")

	healthSrv := integration.NewHealthServer(getenv("HEALTH_PORT", ":9090"), db, svcJSClient.Conn())
	healthSrv.Start()
	log.Printf("Health server listening on %s", getenv("HEALTH_PORT", ":9090"))

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	log.Println("MQTT Subscriber Input running. Press Ctrl+C to stop.")
	<-sigChan

	log.Println("Shutting down...")
	manager.Stop()
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 3*time.Second)
	healthSrv.Shutdown(shutCtx)
	shutCancel()
	log.Println("Shutdown complete")
}
