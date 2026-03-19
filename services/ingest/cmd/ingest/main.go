package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/rogeriocassares/zc8/services/ingest/internal/app"
	"github.com/rogeriocassares/zc8/services/ingest/internal/config"
	ingestnats "github.com/rogeriocassares/zc8/services/ingest/internal/transport/nats"
)

func main() {
	logger := log.New(os.Stdout, "[ingest] ", log.LstdFlags|log.Lshortfile)

	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("Failed to load config:", err)
	}

	ingestSvc, err := app.NewIngest(ctx, cfg, logger)
	if err != nil {
		logger.Fatal("Failed to initialize ingest service:", err)
	}
	defer ingestSvc.Shutdown(ctx)

	jsConsumer, err := ingestnats.NewConsumer(ctx, ingestnats.ConsumerConfig{
		NATSURL:      cfg.NATS.URL,
		StreamName:   getenv("NATS_STREAM_NAME", "TELEMETRY"),
		ConsumerName: getenv("NATS_CONSUMER_NAME", "ingest-workers"),
	}, ingestSvc.GetEngine(), logger)
	if err != nil {
		logger.Fatal("Failed to create JetStream consumer:", err)
	}

	if err := jsConsumer.Start(ctx); err != nil {
		logger.Fatal("Failed to start JetStream consumer:", err)
	}
	logger.Println("Ingest dataplane started (JetStream consumer)")

	<-ctx.Done()

	logger.Println("Shutting down...")
	if err := jsConsumer.Stop(); err != nil {
		logger.Printf("JetStream consumer stop error: %v", err)
	}
	logger.Println("Stopped")
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
