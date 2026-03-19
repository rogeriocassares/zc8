package normalizer

import (
	"sync"

	"github.com/rogeriocassares/zc8/packages/go-data"
)

// FieldValidator defines the interface for field validation
type FieldValidator interface {
	ValidateField(key string, value float64) (float64, bool)
	RegisterFieldMetadata(metadata data.FieldMetadata)
}

// defaultFieldValidator implements FieldValidator with thread-safe metadata management
type defaultFieldValidator struct {
	mu       sync.RWMutex
	metadata map[string]data.FieldMetadata
}

// NewFieldValidator creates a new default field validator
func NewFieldValidator() FieldValidator {
	v := &defaultFieldValidator{
		metadata: make(map[string]data.FieldMetadata),
	}
	v.registerCommonFields()
	return v
}

// registerCommonFields registers standard IoT sensor fields
func (v *defaultFieldValidator) registerCommonFields() {
	v.RegisterFieldMetadata(data.FieldMetadata{
		Name:     "temperature",
		MinValue: -50,
		MaxValue: 125,
		Unit:     "°C",
		Type:     "float",
	})

	v.RegisterFieldMetadata(data.FieldMetadata{
		Name:     "humidity",
		MinValue: 0,
		MaxValue: 100,
		Unit:     "%",
		Type:     "float",
	})

	v.RegisterFieldMetadata(data.FieldMetadata{
		Name:     "co2",
		MinValue: 0,
		MaxValue: 5000,
		Unit:     "ppm",
		Type:     "float",
	})

	v.RegisterFieldMetadata(data.FieldMetadata{
		Name:     "pressure",
		MinValue: 30,
		MaxValue: 110,
		Unit:     "kPa",
		Type:     "float",
	})

	v.RegisterFieldMetadata(data.FieldMetadata{
		Name:     "rssi",
		MinValue: -120,
		MaxValue: 0,
		Unit:     "dBm",
		Type:     "float",
	})

	v.RegisterFieldMetadata(data.FieldMetadata{
		Name:     "battery",
		MinValue: 0,
		MaxValue: 100,
		Unit:     "%",
		Type:     "float",
	})
}

// ValidateField checks if a field value is within acceptable bounds
func (v *defaultFieldValidator) ValidateField(key string, value float64) (float64, bool) {
	v.mu.RLock()
	metadata, exists := v.metadata[key]
	v.mu.RUnlock()

	if !exists {
		// If field not registered, accept it as valid
		return value, true
	}

	if value < metadata.MinValue || value > metadata.MaxValue {
		return value, false
	}

	return value, true
}

// RegisterFieldMetadata adds or updates field metadata
func (v *defaultFieldValidator) RegisterFieldMetadata(metadata data.FieldMetadata) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.metadata[metadata.Name] = metadata
}

// NoOpValidator is a no-op validator for testing
type NoOpValidator struct{}

// ValidateField always returns true
func (n *NoOpValidator) ValidateField(key string, value float64) (float64, bool) {
	return value, true
}

// RegisterFieldMetadata does nothing
func (n *NoOpValidator) RegisterFieldMetadata(metadata data.FieldMetadata) {
}
