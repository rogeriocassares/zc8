package nats

import (
	"context"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
)

// Client is a NATS connection wrapper
type Client struct {
	conn *nats.Conn
}

// Config holds NATS connection configuration
type Config struct {
	URL string
}

// New creates a new NATS connection
func New(ctx context.Context, cfg Config) (*Client, error) {
	// Apply timeout context
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	opts := []nats.Option{
		nats.MaxReconnects(-1),
		nats.ReconnectWait(1 * time.Second),
	}

	conn, err := nats.Connect(cfg.URL, opts...)
	if err != nil {
		return nil, fmt.Errorf("nats connect: %w", err)
	}

	return &Client{conn: conn}, nil
}

// Conn returns the underlying nats.Conn
func (c *Client) Conn() *nats.Conn {
	return c.conn
}

// Health checks the NATS connection
func (c *Client) Health() error {
	if c.conn.IsClosed() {
		return fmt.Errorf("nats connection closed")
	}
	return nil
}

// Close closes the NATS connection
func (c *Client) Close() error {
	c.conn.Close()
	return nil
}