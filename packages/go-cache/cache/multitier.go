package cache

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/rogeriocassares/zc8/packages/go-data"
)

// DeviceKey is a type alias for data.DeviceKey
type DeviceKey = data.DeviceKey

// DeviceMeta is a type alias for data.DeviceMeta (which has ParserID)
type DeviceMeta = data.DeviceMeta

// DeviceRepository is the interface for persistent cold cache
type DeviceRepository interface {
	Find(id uint64) (DeviceData, error)
	FindAll(ctx context.Context) ([]DeviceData, error)
	// FindByTenantAndStatus retrieves devices by tenant and status (for cache warming)
	FindByTenantAndStatus(ctx context.Context, tenantID int64, status DeviceStatus) ([]DeviceData, error)
}

// DeviceStatus represents the lifecycle state of a device
type DeviceStatus string

const (
	// ACTIVE: Device is operational and can ingest messages
	DeviceStatusActive DeviceStatus = "active"

	// INACTIVE: Device is disabled, reject all messages silently
	DeviceStatusInactive DeviceStatus = "inactive"

	// SUSPENDED: Device is blacklisted, reject with audit logging
	DeviceStatusSuspended DeviceStatus = "suspended"

	// DEPRECATED: Legacy device, accept but log for monitoring
	DeviceStatusDeprecated DeviceStatus = "deprecated"

	// MAINTENANCE: Temporary maintenance, return 503 backpressure
	DeviceStatusMaintenance DeviceStatus = "maintenance"
)

// DeviceData represents persistent device metadata in the cache
// Enhanced schema that includes device state and authorization information
type DeviceData struct {
	// === IDENTIFIER ===
	ID uint64 // device_key (primary lookup key - UUIDv7 first 8 bytes as uint64)

	// === DEVICE INFO ===
	VendorID uint64
	Model    string
	ParserID uint64

	// === DEVICE ACTIVATION & STATUS ===
	IsActive bool         // Quick check: is device accepting messages?
	Status   DeviceStatus // Detailed status (active, inactive, suspended, etc)

	// === MULTI-TENANCY & AUTHORIZATION ===
	TenantID int64  // Multi-tenant isolation (required)
	TeamID   *int64 // Optional team assignment (for team-based access control)

	// === AUTHENTICATION & SECURITY ===
	AuthTokenHash string    // SHA256(device_auth_token) for validation
	ExpiresAt     time.Time // Token expiration time (0 = never expires)

	// === DEVICE TAGS & METADATA ===
	Tags []string // e.g., ["production", "test", "pilot", "iot-core"]
}

// IsAuthorized checks if the device is authorized to send messages
// Considers: active status, expiration, and tenant membership
func (d *DeviceData) IsAuthorized() bool {
	// Must be active status
	if !d.IsActive || d.Status != DeviceStatusActive {
		return false
	}

	// Check token expiration (if expiration is set)
	if !d.ExpiresAt.IsZero() && time.Now().After(d.ExpiresAt) {
		return false
	}

	return true
}

// CanIngestMessage returns true if device can ingest this message
// More detailed than IsAuthorized - includes status-specific logic
func (d *DeviceData) CanIngestMessage() (bool, string) {
	if !d.IsActive {
		return false, "device_inactive"
	}

	switch d.Status {
	case DeviceStatusActive:
		return true, ""

	case DeviceStatusInactive:
		return false, "device_inactive"

	case DeviceStatusSuspended:
		return false, "device_suspended_blacklisted"

	case DeviceStatusDeprecated:
		// Accept deprecated devices but signal for monitoring
		return true, "device_deprecated"

	case DeviceStatusMaintenance:
		return false, "device_under_maintenance"

	default:
		return false, "device_status_unknown"
	}
}

// MultiTierCache implements engine.DeviceCache with three tiers:
// 1. LRU (hot, in-memory, nanoseconds)
// 2. NATS KV (warm, distributed, ~1-5 ms, JetStream-backed)
// 3. PostgreSQL (cold, persistent, ~10-50 ms)
type MultiTierCache struct {
	lru        *LRUCache
	warm       *NATSKVCache
	repository DeviceRepository

	// Metrics
	hitLRU   uint64
	hitWarm  uint64
	missCold uint64
}

// NewMultiTierCache creates a new three-tier cache.
// Pass a non-nil NATSKVCache as the warm tier; pass nil to run LRU → PostgreSQL only.
func NewMultiTierCache(
	lruSize int,
	warm *NATSKVCache,
	repo DeviceRepository,
) (*MultiTierCache, error) {
	lru, err := NewLRUCache(lruSize)
	if err != nil {
		return nil, fmt.Errorf("failed to create LRU cache: %w", err)
	}

	return &MultiTierCache{
		lru:        lru,
		warm:       warm,
		repository: repo,
	}, nil
}

// Get implements device cache interface
// Returns DeviceMeta with ParserID needed by cache consumers
func (m *MultiTierCache) Get(deviceKey DeviceKey) (DeviceMeta, bool) {
	// L1: Check LRU cache (hot, nanoseconds)
	if meta, ok := m.lru.Get(uint64(deviceKey)); ok {
		m.hitLRU++
		return DeviceMeta{ParserID: data.ParserID(meta.ParserID)}, true
	}

	// L2: Check NATS KV warm cache (~1-5 ms)
	if m.warm != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		if meta, err := m.warm.Get(ctx, uint64(deviceKey)); err == nil && meta != nil {
			m.hitWarm++
			// Repopulate LRU from NATS KV hit
			m.lru.Set(uint64(deviceKey), meta)
			return DeviceMeta{ParserID: data.ParserID(meta.ParserID)}, true
		}
	}

	// L3: Query PostgreSQL (cold, 5+ milliseconds, but source of truth)
	device, err := m.repository.Find(uint64(deviceKey))
	if err != nil {
		if err == sql.ErrNoRows {
			m.missCold++
			return DeviceMeta{}, false
		}
		// Log error but don't fail - return miss
		return DeviceMeta{}, false
	}

	// Cache miss at all tiers, but found in database
	// Repopulate both Redis and LRU
	meta := &DeviceMetaJSON{
		ParserID: device.ParserID,
		VendorID: device.VendorID,
		Model:    device.Model,
	}

	m.lru.Set(uint64(deviceKey), meta)

	// Async NATS KV update to avoid blocking the caller
	if m.warm != nil {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = m.warm.Set(ctx, uint64(deviceKey), meta)
		}()
	}

	m.missCold++
	return DeviceMeta{ParserID: data.ParserID(device.ParserID)}, true
}

// WarmCache pre-populates all cache tiers from database
func (m *MultiTierCache) WarmCache(ctx context.Context) error {
	// Fetch all devices from database
	devices, err := m.repository.FindAll(ctx)
	if err != nil {
		return fmt.Errorf("failed to fetch devices from database: %w", err)
	}

	// Build map for LRU and Redis
	lruMap := make(map[uint64]*DeviceMetaJSON)
	for _, d := range devices {
		meta := &DeviceMetaJSON{
			ParserID: d.ParserID,
			VendorID: d.VendorID,
			Model:    d.Model,
		}
		lruMap[d.ID] = meta
		m.lru.Set(d.ID, meta)
	}

	// Populate NATS KV warm tier
	if m.warm != nil {
		if err := m.warm.WarmAll(ctx, lruMap); err != nil {
			return fmt.Errorf("failed to warm NATS KV cache: %w", err)
		}
	}

	return nil
}

// InvalidateDevice removes from all tiers
func (m *MultiTierCache) InvalidateDevice(ctx context.Context, deviceKey DeviceKey) error {
	m.lru.Del(uint64(deviceKey))

	if m.warm != nil {
		if err := m.warm.Del(ctx, uint64(deviceKey)); err != nil {
			return fmt.Errorf("failed to invalidate NATS KV: %w", err)
		}
	}

	return nil
}

// UpdateDevice refreshes device metadata in all tiers
func (m *MultiTierCache) UpdateDevice(
	ctx context.Context,
	deviceKey DeviceKey,
	meta DeviceMeta,
) error {
	deviceMeta := &DeviceMetaJSON{
		ParserID: uint64(meta.ParserID),
	}

	m.lru.Set(uint64(deviceKey), deviceMeta)

	if m.warm != nil {
		if err := m.warm.Set(ctx, uint64(deviceKey), deviceMeta); err != nil {
			return fmt.Errorf("failed to update NATS KV: %w", err)
		}
	}

	return nil
}

// CacheMetrics tracks cache performance across all tiers.
type CacheMetrics struct {
	HitLRU   uint64
	HitWarm  uint64 // NATS KV warm tier
	MissCold uint64
	TotalOps uint64
	HitRate  float64
	LRUStats CacheStats
}

func (m *MultiTierCache) GetMetrics() CacheMetrics {
	total := m.hitLRU + m.hitWarm + m.missCold
	hitRate := 0.0
	if total > 0 {
		hitRate = float64(m.hitLRU+m.hitWarm) / float64(total) * 100
	}

	return CacheMetrics{
		HitLRU:   m.hitLRU,
		HitWarm:  m.hitWarm,
		MissCold: m.missCold,
		TotalOps: total,
		HitRate:  hitRate,
		LRUStats: m.lru.Stats(),
	}
}
