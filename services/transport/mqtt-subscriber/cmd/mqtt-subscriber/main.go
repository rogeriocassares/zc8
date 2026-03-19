package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	tcfg "github.com/rogeriocassares/zc8/packages/go-config/transport"
	transport "github.com/rogeriocassares/zc8/packages/go-transport"
	mqttsubscriber "github.com/rogeriocassares/zc8/services/transport/mqtt-subscriber/internal"
)

type Config struct {
	DatabaseURL string
}

func loadConfig() Config {
	return Config{
		DatabaseURL: getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/zc8"),
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
	log.Println("Starting MQTT Subscriber Transport Adapter...")

	cfg := loadConfig()
	log.Printf("Config: DB=%s", cfg.DatabaseURL)

	db, err := transport.OpenDatabase(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer db.Close()
	log.Println("Database connected")

	logger := log.New(log.Writer(), "[MQTT-Subscriber] ", log.LstdFlags)

	sinkCfg := transport.SinkConfigFromEnv("mqtt-subscriber")
	ingestSink, err := transport.NewIngestSink(sinkCfg, logger)
	if err != nil {
		log.Fatalf("Failed to create ingest sink: %v", err)
	}
	defer ingestSink.Close()
	log.Println("Ingest sink ready")
	parserRegistry := transport.NewParserRegistry(db, logger)
	deviceLookup := transport.NewDeviceLookup(db, logger)

	loadCtx, loadCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := parserRegistry.LoadFromDatabase(loadCtx); err != nil {
		logger.Printf("Warning: failed to load parsers: %v", err)
	}
	loadCancel()

	handleMessage := func(msg *transport.Message) {
		if msg == nil {
			return
		}
		req := transport.MessageToProto(msg)
		if !ingestSink.Submit(req) {
			logger.Printf("Ingest queue full, dropped message for device %s", msg.DeviceKey)
		}
	}

	adapterFactory := func(entry *transport.TransportEntry, typedCfg *tcfg.TransportConfig) (transport.Adapter, error) {
		if typedCfg.MQTT == nil {
			return nil, fmt.Errorf("MQTT config is nil for transport %d", entry.ID)
		}
		adapter := mqttsubscriber.NewMQTTSubscriberAdapter(
			entry,
			typedCfg.MQTT,
			db,
			parserRegistry,
			deviceLookup,
			handleMessage,
			nil,
		)
		return adapter, nil
	}

	manager := transport.NewWorkerManager(transport.WorkerManagerConfig{
		DB:                db,
		TransportTypeCode: "mqtt-subscriber",
		ConfigType:        "mqtt",
		DiscoveryInterval: 30 * time.Second,
		AdapterFactory:    adapterFactory,
		Logger:            logger,
	})

	startCtx, startCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := manager.Start(startCtx); err != nil {
		startCancel()
		log.Fatalf("Failed to start worker manager: %v", err)
	}
	startCancel()
	log.Println("Worker manager started")

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	log.Println("MQTT Subscriber Transport running. Press Ctrl+C to stop.")
	<-sigChan

	log.Println("Shutting down...")
	manager.Stop()
	log.Println("Shutdown complete")
}
