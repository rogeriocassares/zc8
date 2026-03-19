package adapterfactory

import (
	"context"

	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// AdapterContext contains tenant and runtime information for an adapter
type AdapterContext struct {
	TenantID       int64
	OrganizationID string
	AdapterID      string
	AdapterType    string
	Config         map[string]interface{}
	Ctx            context.Context
}

// AdapterHealth represents the health status of an adapter instance
type AdapterHealth struct {
	Status          string // "healthy", "degraded", "unhealthy"
	Message         string
	LastCheck       int64 // Unix milliseconds
	EventsProcessed int64
	ErrorCount      int64
}

// InputAdapter receives data from external sources and sends to ingest
type InputAdapter interface {
	// Init initializes the adapter with tenant context
	Init(ctx AdapterContext) error

	// Start begins processing events
	Start(ctx context.Context) error

	// Stop gracefully stops the adapter
	Stop() error

	// GetHealth returns current health status
	GetHealth() AdapterHealth

	// Type returns adapter type identifier
	Type() string

	// Destroy cleans up resources
	Destroy() error
}

// OutputAdapter receives normalized data from ingest and sends to external targets
type OutputAdapter interface {
	// Init initializes the adapter with tenant context
	Init(ctx AdapterContext) error

	// Start begins listening for output events
	Start(ctx context.Context) error

	// SendEvent sends a normalized event to external target
	SendEvent(event *pb.IngestRequest) error

	// Stop gracefully stops the adapter
	Stop() error

	// GetHealth returns current health status
	GetHealth() AdapterHealth

	// Type returns adapter type identifier
	Type() string

	// Destroy cleans up resources
	Destroy() error
}

// BiDirectionalAdapter can act as both input and output
type BiDirectionalAdapter interface {
	InputAdapter
	OutputAdapter
}

// AdapterFactory creates adapter instances
type AdapterFactory interface {
	// Create instantiates a new adapter
	Create(adapterType string, config map[string]interface{}) (interface{}, error)

	// Supports returns whether factory can create this adapter type
	Supports(adapterType string) bool

	// SupportedTypes returns list of adapter types this factory creates
	SupportedTypes() []string
}

// AdapterConfig persists adapter configuration for a specific tenant
type AdapterConfig struct {
	ID              string                 // Unique adapter instance ID
	TenantID        int64                  // Tenant this adapter belongs to
	OrganizationID  string                 // Organization this adapter belongs to
	AdapterType     string                 // "mqtt", "lns", "http", "agent", "zc2x", etc.
	Direction       string                 // "input", "output", "bidirectional"
	Name            string                 // Human-readable name
	Config          map[string]interface{} // Adapter-specific configuration
	Enabled         bool                   // Is this adapter enabled
	CreatedAt       int64                  // Unix milliseconds
	UpdatedAt       int64                  // Unix milliseconds
	Status          string                 // "running", "stopped", "error"
	LastStatusCheck int64                  // Unix milliseconds
}

// AdapterConfigStore stores and retrieves adapter configurations
type AdapterConfigStore interface {
	// Save persists an adapter configuration
	Save(config *AdapterConfig) error

	// Get retrieves an adapter configuration by ID
	Get(id string) (*AdapterConfig, error)

	// ListByTenant retrieves all configurations for a tenant
	ListByTenant(tenantID int64) ([]*AdapterConfig, error)

	// ListByTenantAndType retrieves adapters of specific type for a tenant
	ListByTenantAndType(tenantID int64, adapterType string) ([]*AdapterConfig, error)

	// Delete removes an adapter configuration
	Delete(id string) error

	// Update modifies an existing configuration
	Update(config *AdapterConfig) error
}
