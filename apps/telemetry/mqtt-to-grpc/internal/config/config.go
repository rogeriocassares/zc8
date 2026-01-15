package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	GrpcServer GrpcServerConfig
}

type GrpcServerConfig struct {
	Host string
	Port string
}

// Load loads configuration from environment variables
func Load() *Config {
	// Load .env file if it exists (optional, for local development)
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}

	return &Config{
		GrpcServer: GrpcServerConfig{
			Host: getEnv("GRPC_SERVER_HOST", "127.0.0.1"),
			Port: getEnv("GRPC_SERVER_PORT", "50054"),
		},
	}
}

// Helper functions
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
