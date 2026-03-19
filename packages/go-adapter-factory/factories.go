package adapterfactory

import (
	"fmt"
	"log"
)

// StandardAdapterFactory creates instances of standard adapters
type StandardAdapterFactory struct {
	logger    *log.Logger
	factories map[string]func(config map[string]interface{}) (interface{}, error)
}

// NewStandardAdapterFactory creates a new standard adapter factory
func NewStandardAdapterFactory(logger *log.Logger) *StandardAdapterFactory {
	return &StandardAdapterFactory{
		logger:    logger,
		factories: make(map[string]func(config map[string]interface{}) (interface{}, error)),
	}
}

// Register registers a factory function for an adapter type
func (saf *StandardAdapterFactory) Register(
	adapterType string,
	factoryFn func(config map[string]interface{}) (interface{}, error),
) error {
	if _, exists := saf.factories[adapterType]; exists {
		return fmt.Errorf("adapter type already registered: %s", adapterType)
	}
	saf.factories[adapterType] = factoryFn
	return nil
}

// Create creates a new adapter instance
func (saf *StandardAdapterFactory) Create(adapterType string, config map[string]interface{}) (interface{}, error) {
	factoryFn, exists := saf.factories[adapterType]
	if !exists {
		return nil, fmt.Errorf("no factory registered for adapter type: %s", adapterType)
	}

	return factoryFn(config)
}

// Supports checks if this factory can create an adapter type
func (saf *StandardAdapterFactory) Supports(adapterType string) bool {
	_, exists := saf.factories[adapterType]
	return exists
}

// SupportedTypes returns all supported adapter types
func (saf *StandardAdapterFactory) SupportedTypes() []string {
	types := make([]string, 0, len(saf.factories))
	for adapterType := range saf.factories {
		types = append(types, adapterType)
	}
	return types
}

// MultiFactory manages multiple adapter factories
type MultiFactory struct {
	logger    *log.Logger
	factories map[string]AdapterFactory
}

// NewMultiFactory creates a new multi factory
func NewMultiFactory(logger *log.Logger) *MultiFactory {
	return &MultiFactory{
		logger:    logger,
		factories: make(map[string]AdapterFactory),
	}
}

// Register registers a factory for a specific adapter type
func (mf *MultiFactory) Register(adapterType string, factory AdapterFactory) error {
	if _, exists := mf.factories[adapterType]; exists {
		return fmt.Errorf("factory already registered for adapter type: %s", adapterType)
	}
	mf.factories[adapterType] = factory
	return nil
}

// Create creates a new adapter instance
func (mf *MultiFactory) Create(adapterType string, config map[string]interface{}) (interface{}, error) {
	factory, exists := mf.factories[adapterType]
	if !exists {
		return nil, fmt.Errorf("no factory registered for adapter type: %s", adapterType)
	}

	return factory.Create(adapterType, config)
}

// Supports checks if this factory can create an adapter type
func (mf *MultiFactory) Supports(adapterType string) bool {
	_, exists := mf.factories[adapterType]
	return exists
}

// SupportedTypes returns all supported adapter types
func (mf *MultiFactory) SupportedTypes() []string {
	types := make([]string, 0)
	for adapterType := range mf.factories {
		types = append(types, adapterType)
	}
	return types
}
