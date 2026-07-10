package influx

import (
	"context"

	infrainflux "github.com/rogeriocassares/zc8/packages/go-infra/influx"
	"github.com/rogeriocassares/zc8/services/ingest/internal/config"
)

// Client re-exports the generic influx client from packages
type Client = infrainflux.Client

// New creates a new InfluxDB client with service config
func New(ctx context.Context, cfg *config.InfluxConfig) (*Client, error) {
	return infrainflux.New(ctx, infrainflux.Config{
		URL:   cfg.URL,
		Token: cfg.Token,
	})
}
