package postgres

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/config"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/util"
)

type Client = pgxpool.Pool

func NewClient(cfg *config.PostgresConfig) *Client {
	// Build connection string
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		cfg.Host,
		cfg.Port,
		cfg.User,
		cfg.Password,
		cfg.Database,
		cfg.SSLMode,
	)

	// Parse config
	poolConfig, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		log.Fatal("Failed to parse PostgreSQL config:", err)
	}

	poolConfig.MaxConns = util.StrToInt32(cfg.MaxConns)
	poolConfig.MinConns = util.StrToInt32(cfg.MinConns)
	poolConfig.MaxConnLifetime = util.StrToTimeDuration(cfg.MaxConnLifetime)
	poolConfig.MaxConnIdleTime = util.StrToTimeDuration(cfg.MaxConnIdleTime)
	poolConfig.HealthCheckPeriod = util.StrToTimeDuration(cfg.HealthCheckPeriod)
	poolConfig.ConnConfig.ConnectTimeout = util.StrToTimeDuration(cfg.ConnectTimeout)

	st := util.StrToTimeDuration(cfg.StatementTimeout)
	// Optional: Statement timeout for all queries
	if st > 0 {
		poolConfig.ConnConfig.RuntimeParams = map[string]string{
			"statement_timeout": fmt.Sprintf("%dms", st.Milliseconds()),
		}
	}

	// Create pool
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		log.Fatal("Failed to create PostgreSQL pool:", err)
	}

	// Test connection
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		log.Fatal("Failed to ping PostgreSQL:", err)
	}

	log.Printf("Connected to PostgreSQL successfully (max_conns=%v, min_conns=%v)",
		cfg.MaxConns, cfg.MinConns)

	return pool
}

// Optional: Graceful shutdown helper
func Close(pool *pgxpool.Pool) {
	if pool != nil {
		pool.Close()
		log.Println("PostgreSQL connection pool closed")
	}
}

// Optional: Health check helper
func HealthCheck(ctx context.Context, pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("postgres health check failed: %w", err)
	}

	// Optional: Check pool stats
	stats := pool.Stat()
	if stats.AcquireCount() > 0 && stats.IdleConns() == 0 && stats.TotalConns() == stats.MaxConns() {
		log.Printf("WARNING: PostgreSQL pool exhausted (max_conns=%d, idle=0)", stats.MaxConns())
	}

	return nil
}
