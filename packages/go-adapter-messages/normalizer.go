package adaptermessages

import (
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// AdapterNormalizer wraps message building with common logic.
type AdapterNormalizer struct {
	builder MessageBuilder
}

// NewAdapterNormalizer creates a new normalizer with specified message builder.
func NewAdapterNormalizer(builder MessageBuilder) *AdapterNormalizer {
	if builder == nil {
		panic("MessageBuilder cannot be nil")
	}
	return &AdapterNormalizer{
		builder: builder,
	}
}

// Normalize builds an IngestEnvelope using the adapter-specific builder.
func (an *AdapterNormalizer) Normalize(deviceKey uint64, payload []byte, sourceTopic string) *pb.IngestEnvelope {
	return an.builder.BuildEnvelope(deviceKey, payload, sourceTopic)
}
