package app

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	infraCache "github.com/rogeriocassares/zc8/packages/go-infra/cache"
	"github.com/rogeriocassares/zc8/services/adapters/chirpstack/internal/config"
)

// Adapter encapsulates ChirpStack device translation logic
type Adapter struct {
	config   *config.Config
	resolver *infraCache.DevEUIResolver
	logger   *log.Logger
}

// NewAdapter creates a new ChirpStack adapter
func NewAdapter(
	cfg *config.Config,
	db *sql.DB,
	logger *log.Logger,
) (*Adapter, error) {
	// Initialize device resolver with caching
	resolver, err := infraCache.NewDevEUIResolver(db, cfg.Cache.MaxEntries)
	if err != nil {
		return nil, fmt.Errorf("device resolver init failed: %w", err)
	}

	return &Adapter{
		config:   cfg,
		resolver: resolver,
		logger:   logger,
	}, nil
}

// ResolveDevice translates ChirpStack device identifier to internal format
func (a *Adapter) ResolveDevice(ctx context.Context, tenantID int64, deviceEUI string) (string, error) {
	deviceID, err := a.resolver.ResolveDevEUI(ctx, tenantID, deviceEUI)
	if err != nil {
		a.logger.Printf("Device resolution failed for EUI %s: %v\n", deviceEUI, err)
		return "", err
	}
	return deviceID, nil
}

// WarmCache pre-populates device cache for better performance
func (a *Adapter) WarmCache(ctx context.Context, tenantID int64) error {
	if err := a.resolver.WarmCache(ctx, tenantID); err != nil {
		a.logger.Printf("Cache warming failed for tenant %d: %v\n", tenantID, err)
		return err
	}
	a.logger.Printf("Cache warmed successfully for tenant %d\n", tenantID)
	return nil
}

// GetCacheMetrics returns device cache performance metrics
func (a *Adapter) GetCacheMetrics() float64 {
	return a.resolver.CacheHitRate()
}

// Shutdown gracefully closes adapter resources
func (a *Adapter) Shutdown() error {
	a.logger.Println("Adapter shutdown complete")
	return nil
}
