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
	httpclient "github.com/rogeriocassares/zc8/services/input/http-pull/internal"
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

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Starting HTTP Client Input Adapter...")

	cfg := loadConfig()

	db, err := integration.OpenDatabase(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer db.Close()
	log.Println("Database connected")

	logger := log.New(log.Writer(), "[HTTP-Client] ", log.LstdFlags)

	sinkCfg := integration.SinkConfigFromEnv("http-client")
	ingestSink, err := integration.NewIngestSink(sinkCfg, logger)
	if err != nil {
		log.Fatalf("Failed to create ingest sink: %v", err)
	}
	defer ingestSink.Close()
	parserRegistry := integration.NewParserRegistry(db, logger)
	deviceLookup := integration.NewDeviceLookup(db, logger)

	// COMMANDS stream client
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
		return httpclient.NewHTTPClientAdapter(
			entry,
			db,
			parserRegistry,
			deviceLookup,
			handleMessage,
			nil,
			commandsJSClient,
			commandRegistry,
		), nil
	}

	manager := integration.NewWorkerManager(integration.WorkerManagerConfig{
		DB:                db,
		ServiceType:       "input.http-pull",
		DiscoveryInterval: 30 * time.Second,
		AdapterFactory:    adapterFactory,
		Logger:            logger,
		SvcJS:             ingestSink.SvcJS(),
		StatusInterval:    15 * time.Second,
	})

	startCtx, startCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := manager.Start(startCtx); err != nil {
		startCancel()
		log.Fatalf("Failed to start worker manager: %v", err)
	}
	startCancel()

	healthSrv := integration.NewHealthServer(getenv("HEALTH_PORT", ":9090"), db, ingestSink.NatsConn())
	healthSrv.Start()
	log.Printf("Health server listening on %s", getenv("HEALTH_PORT", ":9090"))

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	log.Println("HTTP Client Input running. Press Ctrl+C to stop.")
	<-sigCh

	log.Println("Shutting down...")
	manager.Stop()
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 3*time.Second)
	healthSrv.Shutdown(shutCtx)
	shutCancel()
	log.Println("Shutdown complete")
}
