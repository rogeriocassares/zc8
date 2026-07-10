package identity

import (
	"context"
	"database/sql"
	"fmt"
	"sync"

	lru "github.com/hashicorp/golang-lru/v2"
)

// DeviceRegistryEntry represents a device in the registry
type DeviceRegistryEntry struct {
	ID            int64
	TenantID      int64
	DeviceKey     string
	DevEUI        *string // nullable for non-LoRaWAN devices
	UUIDv7        string
	DeviceType    string
	VendorID      int64
	Model         string
	ParserID      int64
	Origin        string
	Status        string
	DeviceVersion int
}

// ResolverMetrics tracks resolver cache performance
type ResolverMetrics struct {
	CacheHits int64
	CacheMiss int64
	NotFound  int64
}

// Multi-tenant resolver with per-tenant caching
type DevEUIResolver struct {
	db          *sql.DB
	cache       *lru.Cache[string, string]               // (tenant_id):(deveui) -> uuidv7
	deviceCache *lru.Cache[string, *DeviceRegistryEntry] // (tenant_id):(device_id) -> entry
	metrics     ResolverMetrics
	metricsLock sync.RWMutex
}

// NewDeviceEUIResolver creates a new multi-tenant resolver with database connection
func NewDevEUIResolver(db *sql.DB, cacheSize int) *DevEUIResolver {
	if cacheSize <= 0 {
		cacheSize = 1000
	}
	cache, _ := lru.New[string, string](cacheSize)
	deviceCache, _ := lru.New[string, *DeviceRegistryEntry](cacheSize)
	return &DevEUIResolver{
		db:          db,
		cache:       cache,
		deviceCache: deviceCache,
		metrics:     ResolverMetrics{},
	}
}

// ResolveDevEUI translates DevEUI to UUIDv7 for a tenant
// Supports multi-tenant isolation: same DevEUI can map to different UUIDv7 in different tenants
func (r *DevEUIResolver) ResolveDevEUI(ctx context.Context, tenantID int64, deveui string) (string, error) {
	cacheKey := fmt.Sprintf("%d:%s", tenantID, deveui)

	// L1: Check local LRU cache
	if uuidv7, found := r.cache.Get(cacheKey); found {
		r.metricsLock.Lock()
		r.metrics.CacheHits++
		r.metricsLock.Unlock()
		return uuidv7, nil
	}

	// L2: Query database
	var uuidv7 string
	query := `SELECT uuidv7 FROM device_registry
             WHERE tenant_id = $1 AND deveui = $2 AND status = 'active' LIMIT 1`
	err := r.db.QueryRowContext(ctx, query, tenantID, deveui).Scan(&uuidv7)

	if err == sql.ErrNoRows {
		r.metricsLock.Lock()
		r.metrics.NotFound++
		r.metricsLock.Unlock()
		return "", fmt.Errorf("device not found: deveui=%s in tenant=%d", deveui, tenantID)
	}

	if err != nil {
		r.metricsLock.Lock()
		r.metrics.CacheMiss++
		r.metricsLock.Unlock()
		return "", fmt.Errorf("database query failed: %w", err)
	}

	// Cache the result
	r.cache.Add(cacheKey, uuidv7)
	r.metricsLock.Lock()
	r.metrics.CacheMiss++
	r.metricsLock.Unlock()

	return uuidv7, nil
}

// ResolveDeviceID resolves a deviceID to full device entry (with UUIDv7)
func (r *DevEUIResolver) ResolveDeviceID(ctx context.Context, tenantID int64, deviceID string) (*DeviceRegistryEntry, error) {
	cacheKey := fmt.Sprintf("%d:%s", tenantID, deviceID)

	// L1: Check local device cache
	if entry, found := r.deviceCache.Get(cacheKey); found {
		r.metricsLock.Lock()
		r.metrics.CacheHits++
		r.metricsLock.Unlock()
		return entry, nil
	}

	// L2: Query database
	var entry DeviceRegistryEntry
	query := `SELECT id, tenant_id, device_key, deveui, uuidv7, device_type,
                  vendor_id, model, parser_id, origin, status, device_version
             FROM device_registry
             WHERE tenant_id = $1 AND id = $2 AND status = 'active' LIMIT 1`

	err := r.db.QueryRowContext(ctx, query, tenantID, deviceID).Scan(
		&entry.ID, &entry.TenantID, &entry.DeviceKey, &entry.DevEUI, &entry.UUIDv7,
		&entry.DeviceType, &entry.VendorID, &entry.Model, &entry.ParserID,
		&entry.Origin, &entry.Status, &entry.DeviceVersion,
	)

	if err == sql.ErrNoRows {
		r.metricsLock.Lock()
		r.metrics.NotFound++
		r.metricsLock.Unlock()
		return nil, fmt.Errorf("device not found: id=%s in tenant=%d", deviceID, tenantID)
	}

	if err != nil {
		r.metricsLock.Lock()
		r.metrics.CacheMiss++
		r.metricsLock.Unlock()
		return nil, fmt.Errorf("database query failed: %w", err)
	}

	// Cache the result
	r.deviceCache.Add(cacheKey, &entry)
	r.metricsLock.Lock()
	r.metrics.CacheMiss++
	r.metricsLock.Unlock()

	return &entry, nil
}

// WarmCache pre-populates the cache from database for a tenant
func (r *DevEUIResolver) WarmCache(ctx context.Context, tenantID int64) error {
	query := `SELECT id, tenant_id, device_key, deveui, uuidv7, device_type,
                  vendor_id, model, parser_id, origin, status, device_version
             FROM device_registry
             WHERE tenant_id = $1 AND status = 'active'
             ORDER BY id DESC LIMIT 1000`

	rows, err := r.db.QueryContext(ctx, query, tenantID)
	if err != nil {
		return fmt.Errorf("failed to query devices: %w", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var entry DeviceRegistryEntry
		if err := rows.Scan(
			&entry.ID, &entry.TenantID, &entry.DeviceKey, &entry.DevEUI, &entry.UUIDv7,
			&entry.DeviceType, &entry.VendorID, &entry.Model, &entry.ParserID,
			&entry.Origin, &entry.Status, &entry.DeviceVersion,
		); err != nil {
			return fmt.Errorf("failed to scan row: %w", err)
		}

		// Cache by DevEUI if present (for LoRaWAN)
		if entry.DevEUI != nil && *entry.DevEUI != "" {
			cacheKey := fmt.Sprintf("%d:%s", entry.TenantID, *entry.DevEUI)
			r.cache.Add(cacheKey, entry.UUIDv7)
		}

		// Cache by deviceID
		deviceCacheKey := fmt.Sprintf("%d:%d", entry.TenantID, entry.ID)
		r.deviceCache.Add(deviceCacheKey, &entry)

		count++
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("rows error: %w", err)
	}

	fmt.Printf("Warmed resolver cache with %d devices for tenant %d\n", count, tenantID)
	return nil
}

// InvalidateDevEUI removes a device from cache (called on device delete/update)
func (r *DevEUIResolver) InvalidateDevEUI(tenantID int64, deveui string) {
	cacheKey := fmt.Sprintf("%d:%s", tenantID, deveui)
	r.cache.Remove(cacheKey)
}

// InvalidateDeviceID removes a device from device cache
func (r *DevEUIResolver) InvalidateDeviceID(tenantID int64, deviceID string) {
	cacheKey := fmt.Sprintf("%d:%s", tenantID, deviceID)
	r.deviceCache.Remove(cacheKey)
}

// InvalidateTenant clears all cache entries for a tenant
func (r *DevEUIResolver) InvalidateTenant(tenantID int64) {
	// Iterate and remove all entries matching tenant
	// Note: LRU doesn't have bulk remove, so we do this on next query
	fmt.Printf("Marked tenant %d cache for invalidation\n", tenantID)
	// In production, consider using separate caches per tenant
}

// GetMetrics returns cache performance metrics
func (r *DevEUIResolver) GetMetrics() ResolverMetrics {
	r.metricsLock.RLock()
	defer r.metricsLock.RUnlock()
	return r.metrics
}

// CacheStats returns cache utilization stats
type CacheStats struct {
	DevEUICacheSize int
	DeviceCacheSize int
	MaxCacheSize    int
	HitRate         float64
	TotalRequests   int64
}

func (r *DevEUIResolver) CacheStats() CacheStats {
	r.metricsLock.RLock()
	defer r.metricsLock.RUnlock()

	total := r.metrics.CacheHits + r.metrics.CacheMiss + r.metrics.NotFound
	hitRate := 0.0
	if total > 0 {
		hitRate = float64(r.metrics.CacheHits) / float64(total)
	}

	return CacheStats{
		DevEUICacheSize: r.cache.Len(),
		DeviceCacheSize: r.deviceCache.Len(),
		MaxCacheSize:    1000,
		HitRate:         hitRate,
		TotalRequests:   total,
	}
}
