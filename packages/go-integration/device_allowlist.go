package integration

import (
	"context"
	"database/sql"
	"log"
	"sync"
	"time"

	data "github.com/rogeriocassares/zc8/packages/go-data"
)

// DeviceAllowlist caches the set of uint64 device keys whose devices have an
// active device_services row pointing to this specific service.
//
// Each service worker (input or output) holds one DeviceAllowlist. On every
// message the adapter calls ContainsDevice(deviceKey uint64) — O(1) map
// lookup, no DB round-trips on the hot path.
//
// The uint64 key matches IngestRequest.DeviceKey, which is derived from the
// device's UUID via data.ParseUUIDv7ToDeviceKey — the same derivation used
// here when loading from the database.
//
// Refreshed every interval (same cadence as WorkerManager) via a single
// background goroutine per adapter.
type DeviceAllowlist struct {
	db        *sql.DB
	serviceID int64
	logger    *log.Logger

	mu      sync.RWMutex
	allowed map[uint64]bool
}

// NewDeviceAllowlist creates a DeviceAllowlist for the given service.
// Call Start() to begin background refreshes.
func NewDeviceAllowlist(db *sql.DB, serviceID int64, logger *log.Logger) *DeviceAllowlist {
	if logger == nil {
		logger = log.New(log.Writer(), "[DeviceAllowlist] ", log.LstdFlags)
	}
	return &DeviceAllowlist{
		db:        db,
		serviceID: serviceID,
		logger:    logger,
		allowed:   make(map[uint64]bool),
	}
}

// Load performs one synchronous reload from the database.
func (a *DeviceAllowlist) Load(ctx context.Context) error {
	const query = `
		SELECT d.id
		FROM devices d
		JOIN device_services ds ON ds.device_id = d.id
		WHERE ds.service_id = $1
		  AND ds.is_active = true
		  AND d.is_active = true
	`

	rows, err := a.db.QueryContext(ctx, query, a.serviceID)
	if err != nil {
		return err
	}
	defer rows.Close()

	next := make(map[uint64]bool)
	for rows.Next() {
		var uuidStr string
		if err := rows.Scan(&uuidStr); err != nil {
			a.logger.Printf("scan error: %v", err)
			continue
		}
		dk, err := data.ParseUUIDv7ToDeviceKey(uuidStr)
		if err != nil {
			// UUID may be v4 — ParseUUIDv7ToDeviceKey is still deterministic
			// for any UUID format, so this error should not occur in practice.
			a.logger.Printf("device key parse error for %s: %v", uuidStr, err)
			continue
		}
		next[uint64(dk)] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}

	a.mu.Lock()
	a.allowed = next
	a.mu.Unlock()

	a.logger.Printf("loaded %d allowed devices for service %d", len(next), a.serviceID)
	return nil
}

// Start runs an initial Load then refreshes every interval in the background.
// The background goroutine exits when ctx is cancelled.
func (a *DeviceAllowlist) Start(ctx context.Context, interval time.Duration) {
	if err := a.Load(ctx); err != nil {
		a.logger.Printf("initial load error: %v", err)
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := a.Load(ctx); err != nil {
					a.logger.Printf("refresh error: %v", err)
				}
			}
		}
	}()
}

// ContainsDevice returns true if a device with the given uint64 key has an
// active device_services row for this service. O(1) map lookup.
func (a *DeviceAllowlist) ContainsDevice(deviceKey uint64) bool {
	if deviceKey == 0 {
		return false
	}
	a.mu.RLock()
	ok := a.allowed[deviceKey]
	a.mu.RUnlock()
	return ok
}

// ContainsDeviceUUID is a convenience wrapper for input adapters that have the
// device UUID string (from DeviceLookup) rather than the uint64 numeric key.
func (a *DeviceAllowlist) ContainsDeviceUUID(uuidStr string) bool {
	dk, err := data.ParseUUIDv7ToDeviceKey(uuidStr)
	if err != nil {
		return false
	}
	return a.ContainsDevice(uint64(dk))
}
