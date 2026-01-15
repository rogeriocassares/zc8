package config

import (
	"log"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	GrpcServer GrpcServerConfig
	Redis      RedisConfig
	Influxdb3  Influxdb3Config
}

type GrpcServerConfig struct {
	BindAdress string
	Port       string
}
type Influxdb3Config struct {
	Host     string
	Port     string
	Token    string
	Database string
}

type RedisConfig struct {
	Host         string
	Port         string
	Password     string
	DB           int
	PoolSize     int
	MinIdleConns int
	DialTimeout  time.Duration
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
}

// Load loads configuration from environment variables
func Load() *Config {
	// Load .env file if it exists (optional, for local development)
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}

	return &Config{
		GrpcServer: GrpcServerConfig{
			BindAdress: getEnv("GRPC_SERVER_BIND_ADDRESS", "0.0.0.0"),
			Port:       getEnv("GRPC_SERVER_PORT", "50054"),
		},
		Redis: RedisConfig{
			Host:         getEnv("REDIS_HOST", "127.0.0.1"),
			Port:         getEnv("REDIS_PORT", "6379"),
			Password:     getEnv("REDIS_PASSWORD", ""),
			DB:           getEnvAsInt("REDIS_DB", 0),
			PoolSize:     getEnvAsInt("REDIS_POOL_SIZE", 20),
			MinIdleConns: getEnvAsInt("REDIS_MIN_IDLE_CONNS", 5),
			DialTimeout:  getEnvAsDuration("REDIS_DIAL_TIMEOUT", 5*time.Second),
			ReadTimeout:  getEnvAsDuration("REDIS_READ_TIMEOUT", 3*time.Second),
			WriteTimeout: getEnvAsDuration("REDIS_WRITE_TIMEOUT", 3*time.Second),
		},
		Influxdb3: Influxdb3Config{
			Host:     getEnv("INFLUXDB3_HOST", "localhost"),
			Port:     getEnv("INFLUXDB3_PORT", "8181"),
			Token:    getEnv("INFLUXDB3_TOKEN", "0.0.0.0"),
			Database: getEnv("INFLUXDB3_DATABASE", "iot_rp40d"),
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

func getEnvAsInt(key string, defaultValue int) int {
	valueStr := getEnv(key, "")
	if value, err := strconv.Atoi(valueStr); err == nil {
		return value
	}
	return defaultValue
}

func getEnvAsDuration(key string, defaultValue time.Duration) time.Duration {
	valueStr := getEnv(key, "")
	if value, err := time.ParseDuration(valueStr); err == nil {
		return value
	}
	return defaultValue
}
