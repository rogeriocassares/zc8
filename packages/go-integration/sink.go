package integration

import (
	"github.com/nats-io/nats.go"
	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// IngestSink is the interface for sending IngestEnvelopes to the NATS JetStream pipeline.
// The subject is computed from the envelope's PayloadType and DeviceContext:
//
//	data.{orgId}.{teamId}.{deviceKey}.raw     — PayloadType=PAYLOAD_RAW
//	data.{orgId}.{teamId}.{deviceKey}.decoded — PayloadType=PAYLOAD_DECODED
type IngestSink interface {
	// Submit enqueues an IngestEnvelope for delivery.
	// Non-blocking: returns false if backpressure is applied (queue full).
	Submit(env *pb.IngestEnvelope) bool

	// NatsConn returns the underlying NATS Core connection (e.g. for HealthServer).
	NatsConn() *nats.Conn

	// SvcJS returns the JetStream client for the SVC stream.
	// Used by WorkerManager to publish ServiceEvent heartbeats and tombstones.
	SvcJS() *infranats.JetStreamClient

	// Close gracefully drains pending messages and releases resources.
	Close() error
}
