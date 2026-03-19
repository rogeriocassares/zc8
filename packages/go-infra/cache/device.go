package cache

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"

	"github.com/dgraph-io/ristretto"
)

// DeviceEntry holds resolved device information
type DeviceEntry struct {
	DeviceID    string
	DevEUI      string
	TenantID    int64
	Status      string
	SyncStatus  string
	LastUpdated time.Time
}

// Resolver is the interface for device resolution across all adapters
type Resolver interface {
	ResolveDevEUI(ctx context.Context, tenantID int64, deveui string) (deviceID string, err error)
	ResolveDeviceID(ctx context.Context, tenantID int64, deviceID string) (*DeviceEntry, error)
	InvalidateDevEUI(tenantID int64, deveui string)
	InvalidateDeviceID(tenantID int64, deviceID string)
	WarmCache(ctx context.Context, tenantID int64) error
	CacheHitRate() float64
}

// DevEUIResolver implements high-performance device resolution
type DevEUIResolver struct {
	db    *sql.DB
	cache *ristretto.Cache
	mu    sync.RWMutex

	hits, misses uint64
}

// NewDevEUIResolver creates resolver with multi-tier caching
func NewDevEUIResolver(db *sql.DB, cacheSize int) (*DevEUIResolver, error) {
	cache, err := ristretto.NewCache(&ristretto.Config{
		NumCounters: int64(cacheSize * 10),
		MaxCost:     int64(cacheSize),
		BufferItems: 64,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create cache: %w", err)
	}

	return &DevEUIResolver{
		db:    db,
		cache: cache,
	}, nil
}

// ResolveDevEUI resolves DevEUI→DeviceID with caching
func (r *DevEUIResolver) ResolveDevEUI(ctx context.Context, tenantID int64, deveui string) (string, error) {
	cacheKey := fmt.Sprintf("deveui:%d:%s", tenantID, deveui)

	if v, found := r.cache.Get(cacheKey); found {
		r.recordHit()
		return v.(string), nil
	}

	var deviceID string
	err := r.db.QueryRowContext(ctx,
		`SELECT device_id FROM device_lns
		 WHERE tenant_id = $1 AND deveui = $2 LIMIT 1`,
		tenantID, deveui,
	).Scan(&deviceID)

	if err != nil {
		r.recordMiss()
		return "", fmt.Errorf("device not found: %w", err)
	}

	r.cache.SetWithTTL(cacheKey, deviceID, 1, 24*time.Hour)
	r.recordMiss()
	return deviceID, nil
}

// ResolveDeviceID resolves DeviceID→full entry
func (r *DevEUIResolver) ResolveDeviceID(ctx context.Context, tenantID int64, deviceID string) (*DeviceEntry, error) {
	cacheKey := fmt.Sprintf("device:%d:%s", tenantID, deviceID)

	if v, found := r.cache.Get(cacheKey); found {
		r.recordHit()
		return v.(*DeviceEntry), nil
	}

	var entry DeviceEntry
	err := r.db.QueryRowContext(ctx,
		`SELECT device_id, device_key, status, sync_status, updated_at
		 FROM device_registry
		 WHERE tenant_id = $1 AND device_id = $2`,
		tenantID, deviceID,
	).Scan(&entry.DeviceID, &entry.DevEUI, &entry.Status, &entry.SyncStatus, &entry.LastUpdated)

	if err != nil {
		r.recordMiss()
		return nil, fmt.Errorf("device entry not found: %w", err)
	}

	entry.TenantID = tenantID
	r.cache.SetWithTTL(cacheKey, &entry, 1, 24*time.Hour)
	r.recordMiss()

	return &entry, nil
}

// InvalidateDevEUI removes cached entry
func (r *DevEUIResolver) InvalidateDevEUI(tenantID int64, deveui string) {
	cacheKey := fmt.Sprintf("deveui:%d:%s", tenantID, deveui)
	r.cache.Del(cacheKey)
}

// InvalidateDeviceID removes cached device
func (r *DevEUIResolver) InvalidateDeviceID(tenantID int64, deviceID string) {
	cacheKey := fmt.Sprintf("device:%d:%s", tenantID, deviceID)
	r.cache.Del(cacheKey)
}

// WarmCache pre-loads all devices for a tenant
func (r *DevEUIResolver) WarmCache(ctx context.Context, tenantID int64) error {
	rows, err := r.db.QueryContext(ctx,
		`SELECT device_id, deveui, status, sync_status, updated_at
		 FROM device_registry WHERE tenant_id = $1`,
		tenantID,
	)
	if err != nil {
		return fmt.Errorf("warm cache query failed: %w", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var entry DeviceEntry
		if err := rows.Scan(&entry.DeviceID, &entry.DevEUI, &entry.Status, &entry.SyncStatus, &entry.LastUpdated); err != nil {
			continue
		}
		entry.TenantID = tenantID
		key := fmt.Sprintf("device:%d:%s", tenantID, entry.DeviceID)
		r.cache.Set(key, &entry, 1)
		count++
	}

	return rows.Err()
}

// CacheHitRate returns hit ratio
func (r *DevEUIResolver) CacheHitRate() float64 {
	r.mu.RLock()
	defer r.mu.RUnlock()

	total := r.hits + r.misses
	if total == 0 {
		return 0
	}
	return float64(r.hits) / float64(total)
}

// recordHit increments hit counter
func (r *DevEUIResolver) recordHit() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.hits++
}

// recordMiss increments miss counter
func (r *DevEUIResolver) recordMiss() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.misses++
}
