package adapterfactory

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"
)

// AdapterInstance wraps an adapter with metadata about its lifecycle
type AdapterInstance struct {
	ID              string
	TenantID        int64
	OrganizationID  string
	AdapterType     string
	Direction       string
	Adapter         interface{} // InputAdapter or OutputAdapter
	Context         AdapterContext
	StartedAt       int64 // Unix milliseconds
	mu              sync.RWMutex
	health          AdapterHealth
	lastHealthCheck int64
}

// Registry manages running adapter instances per tenant
type Registry struct {
	logger *log.Logger
	mu     sync.RWMutex
	// Map: (TenantID) -> Map[AdapterID]AdapterInstance
	instances map[string]map[string]*AdapterInstance

	// Factories for creating adapters
	factories map[string]AdapterFactory

	// Config store for persisting adapter configurations
	configStore AdapterConfigStore
}

// NewRegistry creates a new adapter registry
func NewRegistry(logger *log.Logger, configStore AdapterConfigStore) *Registry {
	if logger == nil {
		panic("logger cannot be nil")
	}
	return &Registry{
		logger:      logger,
		instances:   make(map[string]map[string]*AdapterInstance),
		factories:   make(map[string]AdapterFactory),
		configStore: configStore,
	}
}

// RegisterFactory registers an adapter factory for a specific type
func (r *Registry) RegisterFactory(adapterType string, factory AdapterFactory) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.factories[adapterType]; exists {
		return fmt.Errorf("factory already registered for adapter type: %s", adapterType)
	}

	r.factories[adapterType] = factory
	r.logger.Printf("Registered factory for adapter type: %s", adapterType)
	return nil
}

// CreateAndStart creates a new adapter instance and starts it
func (r *Registry) CreateAndStart(ctx context.Context, config *AdapterConfig) (*AdapterInstance, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Get factory
	factory, exists := r.factories[config.AdapterType]
	if !exists {
		return nil, fmt.Errorf("no factory registered for adapter type: %s", config.AdapterType)
	}

	// Create adapter instance using factory
	adapter, err := factory.Create(config.AdapterType, config.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create adapter: %w", err)
	}

	// Create adapter context
	adapterCtx := AdapterContext{
		TenantID:       config.TenantID,
		OrganizationID: config.OrganizationID,
		AdapterID:      config.ID,
		AdapterType:    config.AdapterType,
		Config:         config.Config,
		Ctx:            ctx,
	}

	// Initialize adapter
	if inputAdapter, ok := adapter.(InputAdapter); ok {
		if err := inputAdapter.Init(adapterCtx); err != nil {
			return nil, fmt.Errorf("failed to initialize input adapter: %w", err)
		}
	} else if outputAdapter, ok := adapter.(OutputAdapter); ok {
		if err := outputAdapter.Init(adapterCtx); err != nil {
			return nil, fmt.Errorf("failed to initialize output adapter: %w", err)
		}
	}

	// Start adapter
	if inputAdapter, ok := adapter.(InputAdapter); ok {
		if err := inputAdapter.Start(ctx); err != nil {
			return nil, fmt.Errorf("failed to start input adapter: %w", err)
		}
	} else if outputAdapter, ok := adapter.(OutputAdapter); ok {
		if err := outputAdapter.Start(ctx); err != nil {
			return nil, fmt.Errorf("failed to start output adapter: %w", err)
		}
	}

	// Create instance
	now := time.Now().UnixMilli()
	instance := &AdapterInstance{
		ID:              config.ID,
		TenantID:        config.TenantID,
		OrganizationID:  config.OrganizationID,
		AdapterType:     config.AdapterType,
		Direction:       config.Direction,
		Adapter:         adapter,
		Context:         adapterCtx,
		StartedAt:       now,
		lastHealthCheck: now,
	}

	// Store instance
	tenantKey := fmt.Sprintf("%d", config.TenantID)
	if _, exists := r.instances[tenantKey]; !exists {
		r.instances[tenantKey] = make(map[string]*AdapterInstance)
	}
	r.instances[tenantKey][config.ID] = instance

	r.logger.Printf("Started adapter instance: tenant=%d, id=%s, type=%s", config.TenantID, config.ID, config.AdapterType)
	return instance, nil
}

// Stop stops and removes an adapter instance
func (r *Registry) Stop(tenantID int64, adapterID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	tenantKey := fmt.Sprintf("%d", tenantID)
	instances, exists := r.instances[tenantKey]
	if !exists {
		return fmt.Errorf("no adapters for tenant %d", tenantID)
	}

	instance, exists := instances[adapterID]
	if !exists {
		return fmt.Errorf("adapter instance not found: %s", adapterID)
	}

	// Stop adapter
	if inputAdapter, ok := instance.Adapter.(InputAdapter); ok {
		if err := inputAdapter.Stop(); err != nil {
			r.logger.Printf("Error stopping input adapter: %v", err)
		}
		if err := inputAdapter.Destroy(); err != nil {
			r.logger.Printf("Error destroying input adapter: %v", err)
		}
	} else if outputAdapter, ok := instance.Adapter.(OutputAdapter); ok {
		if err := outputAdapter.Stop(); err != nil {
			r.logger.Printf("Error stopping output adapter: %v", err)
		}
		if err := outputAdapter.Destroy(); err != nil {
			r.logger.Printf("Error destroying output adapter: %v", err)
		}
	}

	delete(instances, adapterID)
	r.logger.Printf("Stopped adapter instance: tenant=%d, id=%s", tenantID, adapterID)
	return nil
}

// Get retrieves a running adapter instance
func (r *Registry) Get(tenantID int64, adapterID string) (*AdapterInstance, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	tenantKey := fmt.Sprintf("%d", tenantID)
	instances, exists := r.instances[tenantKey]
	if !exists {
		return nil, fmt.Errorf("no adapters for tenant %d", tenantID)
	}

	instance, exists := instances[adapterID]
	if !exists {
		return nil, fmt.Errorf("adapter instance not found: %s", adapterID)
	}

	return instance, nil
}

// ListByTenant lists all running adapter instances for a tenant
func (r *Registry) ListByTenant(tenantID int64) ([]*AdapterInstance, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	tenantKey := fmt.Sprintf("%d", tenantID)
	instances, exists := r.instances[tenantKey]
	if !exists {
		return []*AdapterInstance{}, nil
	}

	result := make([]*AdapterInstance, 0, len(instances))
	for _, instance := range instances {
		result = append(result, instance)
	}

	return result, nil
}

// ListByTenantAndType lists adapters of a specific type for a tenant
func (r *Registry) ListByTenantAndType(tenantID int64, adapterType string) ([]*AdapterInstance, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	tenantKey := fmt.Sprintf("%d", tenantID)
	instances, exists := r.instances[tenantKey]
	if !exists {
		return []*AdapterInstance{}, nil
	}

	result := make([]*AdapterInstance, 0)
	for _, instance := range instances {
		if instance.AdapterType == adapterType {
			result = append(result, instance)
		}
	}

	return result, nil
}

// StopAll stops all adapters for a tenant
func (r *Registry) StopAll(tenantID int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	tenantKey := fmt.Sprintf("%d", tenantID)
	instances, exists := r.instances[tenantKey]
	if !exists {
		return nil
	}

	for adapterID, instance := range instances {
		if inputAdapter, ok := instance.Adapter.(InputAdapter); ok {
			if err := inputAdapter.Stop(); err != nil {
				r.logger.Printf("Error stopping input adapter: %v", err)
			}
			if err := inputAdapter.Destroy(); err != nil {
				r.logger.Printf("Error destroying input adapter: %v", err)
			}
		} else if outputAdapter, ok := instance.Adapter.(OutputAdapter); ok {
			if err := outputAdapter.Stop(); err != nil {
				r.logger.Printf("Error stopping output adapter: %v", err)
			}
			if err := outputAdapter.Destroy(); err != nil {
				r.logger.Printf("Error destroying output adapter: %v", err)
			}
		}
		delete(instances, adapterID)
	}

	r.logger.Printf("Stopped all adapters for tenant %d", tenantID)
	return nil
}
