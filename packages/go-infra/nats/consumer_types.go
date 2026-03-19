package nats

import (
	"time"

	"github.com/nats-io/nats.go/jetstream"
)

// Re-export jetstream consumer types so service code doesn't need
// to import nats.go/jetstream directly. All JetStream interaction
// goes through go-infra/nats.

// PullConsumer is a JetStream pull consumer handle.
type PullConsumer = jetstream.Consumer

// ConsumerMsg is a single message received from a JetStream consumer.
type ConsumerMsg = jetstream.Msg

// MessageBatch is a batch of messages returned by Fetch().
type MessageBatch = jetstream.MessageBatch

// FetchOpt is a functional option for the Fetch call.
type FetchOpt = jetstream.FetchOpt

// FetchMaxWait sets the maximum time to wait for messages in a Fetch call.
func FetchMaxWait(d time.Duration) FetchOpt {
	return jetstream.FetchMaxWait(d)
}
