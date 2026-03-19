package influx

import (
	"context"
	"fmt"

	influxdb3 "github.com/InfluxCommunity/influxdb3-go/v2/influxdb3"
)

// Client is an InfluxDB 3 client wrapper
type Client struct {
	client *influxdb3.Client
}

// Config holds InfluxDB connection configuration
type Config struct {
	URL   string
	Token string
}

// New creates a new InfluxDB client
func New(ctx context.Context, cfg Config) (*Client, error) {
	client, err := influxdb3.New(influxdb3.ClientConfig{
		Host:  cfg.URL,
		Token: cfg.Token,
	})
	if err != nil {
		return nil, fmt.Errorf("influx connect: %w", err)
	}

	return &Client{client: client}, nil
}

// Unwrap returns the underlying influx.Client
func (c *Client) Unwrap() *influxdb3.Client {
	return c.client
}

// Health checks the InfluxDB connection
func (c *Client) Health(ctx context.Context) error {
	if c.client == nil {
		return fmt.Errorf("influx client not initialized")
	}
	return nil
}

// Close closes the InfluxDB connection
func (c *Client) Close() error {
	if c.client != nil {
		return c.client.Close()
	}
	return nil
}

// WriteLineProtocol writes raw line protocol data to the specified database synchronously.
func (c *Client) WriteLineProtocol(ctx context.Context, database string, data []byte) error {
	return c.client.Write(ctx, data, influxdb3.WithDatabase(database))
}

// WriteModel is the interface for data to write to InfluxDB
type WriteModel interface {
	DeviceKey() string
	Database() string
	LineProtocol() string
}
