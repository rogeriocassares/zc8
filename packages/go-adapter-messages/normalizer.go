package adaptermessages

import (
	"fmt"

	timestampinfra "github.com/rogeriocassares/zc8/packages/go-infra/time"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// MessageBuilder builds adapter-specific IngestRequest messages
type MessageBuilder interface {
	BuildMessage(deviceID string, payload []byte, eventID string) *pb.IngestRequest
}

// AdapterNormalizer wraps message building with common logic
type AdapterNormalizer struct {
	builder MessageBuilder
}

// NewAdapterNormalizer creates a new normalizer with specified message builder
func NewAdapterNormalizer(builder MessageBuilder) *AdapterNormalizer {
	if builder == nil {
		panic("MessageBuilder cannot be nil")
	}
	return &AdapterNormalizer{
		builder: builder,
	}
}

// Normalize builds an IngestRequest using the adapter-specific builder
func (an *AdapterNormalizer) Normalize(deviceID string, payload []byte, eventID string) *pb.IngestRequest {
	if deviceID == "" {
		deviceID = "unknown"
	}
	if eventID == "" {
		eventID = fmt.Sprintf("evt-%d", timestampinfra.Now())
	}
	return an.builder.BuildMessage(deviceID, payload, eventID)
}
