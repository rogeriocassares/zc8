package influxdb3

import (
	"log"

	"github.com/InfluxCommunity/influxdb3-go/v2/influxdb3"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/config"
)

// var Client *influxdb3.Client

func NewClient(cfg *config.Influxdb3Config) *influxdb3.Client {
	client, err := influxdb3.New(influxdb3.ClientConfig{
		Host:     cfg.Host,
		Token:    cfg.Token,
		Database: cfg.Database,
	})

	defer func(client *influxdb3.Client) {
		err := client.Close()
		if err != nil {
			log.Fatal("Failed to connect to Redis:", err)
			panic(err)
		}
	}(client)

	if err != nil {
		log.Fatal("Failed to connect to Redis:", err)
	}

	log.Println("Connected to Influxdb3 successfully")
	return client
}
