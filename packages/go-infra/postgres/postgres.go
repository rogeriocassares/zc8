package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Client is a PostgreSQL connection pool wrapper
type Client struct {
	pool *pgxpool.Pool
}

// Config holds PostgreSQL connection configuration
type Config struct {
	Host     string
	Port     int
	User     string
	Password string
	Database string
	SSLMode  string
	MaxConns int
}

// New creates a new PostgreSQL connection pool
func New(ctx context.Context, cfg Config) (*Client, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	connStr := fmt.Sprintf(
		"user=%s password=%s host=%s port=%d dbname=%s sslmode=%s",
		cfg.User,
		cfg.Password,
		cfg.Host,
		cfg.Port,
		cfg.Database,
		cfg.SSLMode,
	)

	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		return nil, fmt.Errorf("postgres connect: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("postgres ping: %w", err)
	}

	pool.Config().MaxConns = int32(cfg.MaxConns)

	return &Client{pool: pool}, nil
}

// Pool returns the underlying pgxpool.Pool
func (c *Client) Pool() *pgxpool.Pool {
	return c.pool
}

// Health checks the database connection
func (c *Client) Health(ctx context.Context) error {
	return c.pool.Ping(ctx)
}

// Close closes the connection pool
func (c *Client) Close() error {
	c.pool.Close()
	return nil
}

// IsNoRowsError checks if an error is a "no rows" error from pgx
// This abstracts pgx.ErrNoRows from service code
func IsNoRowsError(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
