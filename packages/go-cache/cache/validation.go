package cache

import (
	"context"
)

// ValidationResult represents the result of device validation
// Used for batch validation tracking and metrics
type ValidationResult struct {
	// Message identifiers
	EventID  string
	DeviceID string

	// Validation outcome
	Status ValidStatus
	Reason string

	// Resolved device state (if valid)
	DeviceState *DeviceData

	// Performance metrics
	ProcessingTimeMS int64
	CacheHit         bool // Was this a cache hit or DB lookup?
}

// ValidStatus represents the result of device validation
type ValidStatus string

const (
	// Valid device, forwarded to ingest service
	ValidStatusAccepted ValidStatus = "accepted"

	// Invalid device, discarded (no retry)
	ValidStatusRejected ValidStatus = "rejected"

	// Ambiguous state, queued for retry
	ValidStatusDeferred ValidStatus = "deferred"
)

// DeviceValidator encapsulates validation logic
// Implementations should use the cache for fast lookups
type DeviceValidator interface {
	// ValidateDevice checks if a device is authorized to send messages
	// Returns: (canIngest bool, reason string, error)
	ValidateDevice(ctx context.Context, deviceID string, deviceKey uint64) (bool, string, error)

	// ValidateTenantAccess checks if device belongs to tenant
	ValidateTenantAccess(ctx context.Context, deviceKey uint64, tenantID int64) (bool, error)

	// ValidateAuthToken verifies device authentication token
	ValidateAuthToken(ctx context.Context, deviceKey uint64, tokenHash string) (bool, error)

	// CollectRejectionMetrics batches rejection metrics for monitoring
	CollectRejectionMetrics(results []ValidationResult) error
}
