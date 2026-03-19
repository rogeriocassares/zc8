package cache

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log"
	"sync"
	"time"
)

// CacheBackend defines the cache interface for device validation
// Implemented by MultiTierCache
type CacheBackend interface {
	Get(deviceKey uint64) (DeviceData, bool)
}

// DefaultDeviceValidator implements DeviceValidator using the cache
type DefaultDeviceValidator struct {
	cache      CacheBackend
	repository DeviceRepository
	logger     *log.Logger
	mu         sync.Mutex
	// Metrics collection (could be moved to a separate metrics service)
	rejectionMetrics map[string]int64 // reason -> count
}

// NewDeviceValidator creates a new device validator with cache backend
func NewDeviceValidator(cache CacheBackend, repository DeviceRepository, logger *log.Logger) *DefaultDeviceValidator {
	return &DefaultDeviceValidator{
		cache:            cache,
		repository:       repository,
		logger:           logger,
		rejectionMetrics: make(map[string]int64),
	}
}

// ValidateDevice checks if a device is authorized to send messages
// This is the primary validation entry point used by adapters/gateways
func (v *DefaultDeviceValidator) ValidateDevice(
	ctx context.Context,
	deviceID string,
	deviceKey uint64,
) (bool, string, error) {
	// Lookup device in cache (O(1) for LRU, O(1) for Redis)
	deviceMeta, found := v.cache.Get(deviceKey)
	if !found {
		v.recordRejection("device_not_in_cache")
		return false, "device_not_found_in_registry", nil
	}

	// Check device activation status
	canIngest, reason := deviceMeta.CanIngestMessage()
	if !canIngest {
		v.recordRejection(reason)
		switch reason {
		case "device_suspended_blacklisted":
			v.logger.Printf("[SECURITY] Attempted ingest from suspended device: %s (key: %d)", deviceID, deviceKey)
		}
		return false, reason, nil
	}

	// Device is valid and authorized
	return true, "", nil
}

// ValidateTenantAccess checks if a device belongs to the requesting tenant
// Used for multi-tenant isolation verification
func (v *DefaultDeviceValidator) ValidateTenantAccess(
	ctx context.Context,
	deviceKey uint64,
	requestingTenantID int64,
) (bool, error) {
	deviceMeta, found := v.cache.Get(deviceKey)
	if !found {
		v.recordRejection("device_not_found_tenant_check")
		return false, fmt.Errorf("device not found in cache")
	}

	// Check tenant match
	if deviceMeta.TenantID != requestingTenantID {
		v.recordRejection("unauthorized_tenant_access")
		v.logger.Printf("[SECURITY] Cross-tenant access attempt: device belongs to tenant %d, request from %d",
			deviceMeta.TenantID, requestingTenantID)
		return false, fmt.Errorf("device does not belong to tenant")
	}

	return true, nil
}

// ValidateAuthToken verifies device authentication token
// Used for direct device connections (e.g., ZC2X, agent services)
func (v *DefaultDeviceValidator) ValidateAuthToken(
	ctx context.Context,
	deviceKey uint64,
	providedTokenHash string,
) (bool, error) {
	deviceMeta, found := v.cache.Get(deviceKey)
	if !found {
		return false, fmt.Errorf("device not found in cache")
	}

	// Empty token hash means device allows unauthenticated access (not recommended)
	if deviceMeta.AuthTokenHash == "" {
		return true, nil
	}

	// Compare provided token hash with cached token hash
	if providedTokenHash != deviceMeta.AuthTokenHash {
		v.recordRejection("invalid_auth_token")
		v.logger.Printf("[SECURITY] Invalid auth token for device (key: %d)", deviceKey)
		return false, fmt.Errorf("authentication token mismatch")
	}

	// Check token expiration
	if !deviceMeta.ExpiresAt.IsZero() && time.Now().After(deviceMeta.ExpiresAt) {
		v.recordRejection("auth_token_expired")
		return false, fmt.Errorf("authentication token expired")
	}

	return true, nil
}

// CollectRejectionMetrics batches rejection metrics for monitoring
// Called periodically (e.g., every 10 seconds) to report rejection patterns
func (v *DefaultDeviceValidator) CollectRejectionMetrics(results []ValidationResult) error {
	v.mu.Lock()
	defer v.mu.Unlock()

	// In a real implementation, you'd write these to a monitoring service
	// For now, we'll just log a summary
	for _, result := range results {
		if result.Status == ValidStatusRejected {
			v.rejectionMetrics[result.Reason]++
		}
	}

	// Every 100 rejections, log a summary
	totalRejections := int64(0)
	for _, count := range v.rejectionMetrics {
		totalRejections += count
	}

	if totalRejections%100 == 0 && totalRejections > 0 {
		v.logger.Printf("[METRICS] Rejection summary (total: %d):", totalRejections)
		for reason, count := range v.rejectionMetrics {
			v.logger.Printf("  - %s: %d", reason, count)
		}
	}

	return nil
}

// Helper: record rejection reason for metrics
func (v *DefaultDeviceValidator) recordRejection(reason string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.rejectionMetrics[reason]++
}

// ===================================== ===============================================
// ADAPTER VALIDATION HELPER
// ============================================================================
// Use this helper in adapters/gateways to validate and batch messages

// AdapterValidator wraps validation logic for adapter use
type AdapterValidator struct {
	validator DeviceValidator
	cache     CacheBackend
	logger    *log.Logger
}

// NewAdapterValidator creates a validator for use in adapters
// Takes the cache components and initializes the underlying validator
func NewAdapterValidator(
	repository DeviceRepository,
	cache CacheBackend,
	logger *log.Logger,
) *AdapterValidator {
	validator := NewDeviceValidator(cache, repository, logger)
	return &AdapterValidator{
		validator: validator,
		cache:     cache,
		logger:    logger,
	}
}

// ValidateAndApply processes a device ID through validation
// Returns: (valid bool, reason string, deviceState *DeviceData, error)
func (av *AdapterValidator) ValidateAndApply(
	ctx context.Context,
	deviceID string,
	deviceKey uint64,
	tenantID int64,
) (bool, string, *DeviceData, error) {

	start := time.Now()

	// PRIMARY VALIDATION: Check if device can ingest
	valid, reason, err := av.validator.ValidateDevice(ctx, deviceID, deviceKey)
	if err != nil {
		av.logger.Printf("[Adapter] Validation error for device %s: %v", deviceID, err)
		return false, "validation_error", nil, err
	}

	if !valid {
		av.logger.Printf("[Adapter] Device rejected: %s (reason: %s, time: %dms)",
			deviceID, reason, time.Since(start).Milliseconds())
		return false, reason, nil, nil
	}

	// MULTI-TENANCY CHECK: Verify tenant access
	hasAccess, err := av.validator.ValidateTenantAccess(ctx, deviceKey, tenantID)
	if err != nil {
		av.logger.Printf("[Adapter] Tenant check failed for device %s: %v", deviceID, err)
		return false, "tenant_authorization_failed", nil, err
	}

	if !hasAccess {
		av.logger.Printf("[Adapter] Device rejected: %s (tenant mismatch)", deviceID)
		return false, "unauthorized_tenant", nil, nil
	}

	// Device is valid - fetch metadata for downstream processing
	deviceMeta, found := av.cache.Get(deviceKey)
	if !found {
		return false, "device_disappeared_from_cache", nil, nil
	}

	av.logger.Printf("[Adapter] Device validated: %s (vendor: %d, parser: %d, time: %dms)",
		deviceID, deviceMeta.VendorID, deviceMeta.ParserID,
		time.Since(start).Milliseconds())

	return true, "", &deviceMeta, nil
}

// ============================================================================
// SERVER VALIDATION HELPER (for direct device connections)
// ============================================================================

// ServerValidator wraps validation for gRPC server use
type ServerValidator struct {
	validator DeviceValidator
	logger    *log.Logger
}

// NewServerValidator creates a validator for use in gRPC server
func NewServerValidator(
	repository DeviceRepository,
	cache CacheBackend,
	logger *log.Logger,
) *ServerValidator {
	validator := NewDeviceValidator(cache, repository, logger)
	return &ServerValidator{
		validator: validator,
		logger:    logger,
	}
}

// ValidateIngressMessage validates a message at server entry point
// Used for direct device connections (ZC2X, agents, etc)
func (sv *ServerValidator) ValidateIngressMessage(
	ctx context.Context,
	deviceID string,
	deviceKey uint64,
	tenantID int64,
	authTokenHash string,
) (bool, string, error) {

	start := time.Now()

	// Check device exists and is active
	valid, reason, err := sv.validator.ValidateDevice(ctx, deviceID, deviceKey)
	if err != nil {
		sv.logger.Printf("[Server] Device validation error: %v", err)
		return false, "validation_error", err
	}

	if !valid {
		sv.logger.Printf("[Server] Device rejected: %s (reason: %s)", deviceID, reason)
		return false, reason, nil
	}

	// Verify tenant ownership
	hasAccess, err := sv.validator.ValidateTenantAccess(ctx, deviceKey, tenantID)
	if err != nil {
		sv.logger.Printf("[Server] Tenant check failed: %v", err)
		return false, "tenant_check_failed", err
	}

	if !hasAccess {
		return false, "unauthorized_tenant", nil
	}

	// If provided, validate authentication token
	if authTokenHash != "" {
		authValid, err := sv.validator.ValidateAuthToken(ctx, deviceKey, authTokenHash)
		if err != nil {
			sv.logger.Printf("[Server] Auth token validation failed: %v", err)
			return false, "authentication_failed", err
		}

		if !authValid {
			sv.logger.Printf("[Server] Invalid authentication token for device: %s", deviceID)
			return false, "invalid_auth_token", nil
		}
	}

	sv.logger.Printf("[Server] Device validated at entry: %s (time: %dms)",
		deviceID, time.Since(start).Milliseconds())

	return true, "", nil
}

// ============================================================================
// TOKEN HASHING UTILITY
// ============================================================================

// HashAuthToken creates a SHA256 hash of an auth token
// Used when comparing tokens or storing in cache
func HashAuthToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", hash)
}
