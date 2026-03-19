package transport

import pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"

// IngestSink is the interface for sending parsed messages to the ingest layer.
// Implementations may use gRPC, NATS JetStream, or Go channels.
type IngestSink interface {
	// Submit enqueues an IngestRequest for delivery.
	// Non-blocking: returns false if backpressure is applied (queue full).
	Submit(req *pb.IngestRequest) bool

	// Close gracefully drains pending messages and releases resources.
	Close() error
}
