package repository

import (
	"context"
	"fmt"

	"github.com/rogeriocassares/zc8/packages/go-infra/postgres"
	"github.com/rogeriocassares/zc8/services/ingest/internal/config"
)

// InitDB initializes PostgreSQL connection pool using go-infra abstraction
func InitDB(cfg *config.PostgresConfig) (*postgres.Client, error) {
	ctx := context.Background()

	pgCfg := postgres.Config{
		Host:     cfg.Host,
		Port:     cfg.Port,
		User:     cfg.User,
		Password: cfg.Password,
		Database: cfg.Database,
		SSLMode:  cfg.SSLMode,
		MaxConns: cfg.MaxConns,
	}

	client, err := postgres.New(ctx, pgCfg)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize postgres: %w", err)
	}

	if err := client.Health(ctx); err != nil {
		return nil, fmt.Errorf("postgres health check failed: %w", err)
	}

	return client, nil
}
