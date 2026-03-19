package influx

import (
	"context"
	"log"
	"time"
)

// InfluxDB3ConfigWatcher polls device_influxdb3_config at a fixed interval
// and keeps the InfluxDB3ConfigRegistry in sync:
//
//   - New active rows  → Register (idempotent, no-ops if already present)
//   - Rows no longer present (deleted or is_active=false) → Deregister (drains workers)
//
// The first sync happens synchronously inside Start() so that the registry is
// fully populated before the gRPC server accepts traffic.
type InfluxDB3ConfigWatcher struct {
	registry *InfluxDB3ConfigRegistry
	repo     InfluxDB3ConfigRepository
	interval time.Duration
	logger   *log.Logger
}

// NewInfluxDB3ConfigWatcher creates a watcher. Call Start() to begin syncing.
func NewInfluxDB3ConfigWatcher(
	registry *InfluxDB3ConfigRegistry,
	repo InfluxDB3ConfigRepository,
	interval time.Duration,
	logger *log.Logger,
) *InfluxDB3ConfigWatcher {
	return &InfluxDB3ConfigWatcher{
		registry: registry,
		repo:     repo,
		interval: interval,
		logger:   logger,
	}
}

// Start performs an initial synchronous sync then launches a background goroutine
// that re-syncs on every interval tick until ctx is cancelled.
func (w *InfluxDB3ConfigWatcher) Start(ctx context.Context) {
	// Warm-start: block until the registry is populated.
	w.sync(ctx)

	go func() {
		ticker := time.NewTicker(w.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				w.sync(ctx)
			}
		}
	}()
}

// sync loads all active rows, registers new ones, and deregisters removed ones.
func (w *InfluxDB3ConfigWatcher) sync(ctx context.Context) {
	entries, err := w.repo.ListActive(ctx)
	if err != nil {
		w.logger.Printf("InfluxDB3ConfigWatcher: sync error: %v", err)
		return
	}

	// Build set of currently-active IDs in the database.
	activeInDB := make(map[int64]struct{}, len(entries))
	for _, e := range entries {
		activeInDB[e.ID] = struct{}{}
		if err := w.registry.Register(ctx, e); err != nil {
			w.logger.Printf("InfluxDB3ConfigWatcher: register configID=%d failed: %v", e.ID, err)
		}
	}

	// Deregister instances that disappeared from the database or became inactive.
	for id := range w.registry.ActiveIDs() {
		if _, stillActive := activeInDB[id]; !stillActive {
			w.logger.Printf("InfluxDB3ConfigWatcher: configID=%d no longer active, deregistering", id)
			w.registry.Deregister(ctx, id)
		}
	}

	w.logger.Printf("InfluxDB3ConfigWatcher: sync complete — %d active instances", w.registry.Size())
}
