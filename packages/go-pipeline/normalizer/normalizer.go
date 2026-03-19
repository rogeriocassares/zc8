package normalizer

import (
	"github.com/rogeriocassares/zc8/packages/go-data"
)

// Normalizer defines the interface for normalizing messages
type Normalizer interface {
	Normalize(deviceID string, deviceType string, fields map[string]float64, tags map[string]string, correlationID string) (*data.NormalizedMessage, error)
}

// defaultNormalizer implements Normalizer
type defaultNormalizer struct {
	validator    FieldValidator
	deduplicator Deduplicator
}

// NewNormalizer creates a new normalizer with default validator and deduplicator
func NewNormalizer() Normalizer {
	return &defaultNormalizer{
		validator:    NewFieldValidator(),
		deduplicator: NewDeduplicator(),
	}
}

// NormalizerBuilder provides a builder pattern for creating normalizers
type NormalizerBuilder struct {
	validator    FieldValidator
	deduplicator Deduplicator
}

// NewNormalizerBuilder creates a new builder with defaults
func NewNormalizerBuilder() *NormalizerBuilder {
	return &NormalizerBuilder{
		validator:    NewFieldValidator(),
		deduplicator: NewDeduplicator(),
	}
}

// WithValidator sets a custom validator
func (b *NormalizerBuilder) WithValidator(validator FieldValidator) *NormalizerBuilder {
	b.validator = validator
	return b
}

// WithDeduplicator sets a custom deduplicator
func (b *NormalizerBuilder) WithDeduplicator(deduplicator Deduplicator) *NormalizerBuilder {
	b.deduplicator = deduplicator
	return b
}

// Build creates a Normalizer from the builder configuration
func (b *NormalizerBuilder) Build() Normalizer {
	return &defaultNormalizer{
		validator:    b.validator,
		deduplicator: b.deduplicator,
	}
}

// Normalize processes and validates a message
func (n *defaultNormalizer) Normalize(deviceID string, deviceType string, fields map[string]float64, tags map[string]string, correlationID string) (*data.NormalizedMessage, error) {
	// Create base message
	msg := data.NewNormalizedMessage(deviceID, deviceType)
	msg.CorrelationID = correlationID

	// Round timestamp to second
	msg.Timestamp = roundTimestampToSecond(msg.Timestamp)

	// Check for duplicates
	if n.deduplicator.IsDuplicate(deviceID, msg.Timestamp) {
		// Record anyway to keep TTL fresh
		n.deduplicator.RecordMessage(deviceID, msg.Timestamp)
		return nil, ErrDuplicate
	}

	// Record this message to prevent duplicates
	n.deduplicator.RecordMessage(deviceID, msg.Timestamp)

	// Validate and set fields
	for key, value := range fields {
		validatedValue, isValid := n.validator.ValidateField(key, value)
		if isValid {
			msg.SetField(key, validatedValue)
		}
	}

	// Set tags
	for key, value := range tags {
		msg.SetTag(key, value)
	}

	return msg, nil
}

// roundTimestampToSecond rounds a millisecond timestamp to the nearest second
func roundTimestampToSecond(timestampMs int64) int64 {
	return (timestampMs / 1000) * 1000
}
