package nats

import (
	"log"

	"github.com/nats-io/nats.go"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/config"
)

func NewClient(cfg *config.NatsConfig) *nats.Conn {
	addr := "nats://" + cfg.Host + ":" + cfg.Port

	client, err := nats.Connect(addr)
	if err != nil {
		log.Fatal("Failed to connect to NATS:", err)
	}

	log.Println("Connected to NATS successfully")
	return client
}
