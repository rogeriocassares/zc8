package adaptermessages

import (
	"fmt"
	"time"

	timestampinfra "github.com/rogeriocassares/zc8/packages/go-infra/time"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// newEventID generates a unique event ID for each envelope.
func newEventID() string {
	return fmt.Sprintf("evt-%d", time.Now().UnixNano())
}

// MessageBuilder builds adapter-specific IngestEnvelope messages.
type MessageBuilder interface {
	BuildEnvelope(deviceKey uint64, payload []byte, sourceTopic string) *pb.IngestEnvelope
}

// MQTTMessageBuilder builds MQTT-specific IngestEnvelope messages.
type MQTTMessageBuilder struct{}

func NewMQTTMessageBuilder() *MQTTMessageBuilder {
	return &MQTTMessageBuilder{}
}

func (mb *MQTTMessageBuilder) BuildEnvelope(deviceKey uint64, payload []byte, sourceTopic string) *pb.IngestEnvelope {
	return &pb.IngestEnvelope{
		EventId:   newEventID(),
		Ts:        timestampinfra.Now(),
		IngestTs:  timestampinfra.Now(),
		Source:    pb.IngestSource_SOURCE_MQTT,
		Type:      pb.PayloadType_PAYLOAD_RAW,
		DeviceKey: deviceKey,
		Payload: &pb.IngestEnvelope_Raw{
			Raw: &pb.RawPayload{
				Data:        payload,
				SourceTopic: sourceTopic,
			},
		},
	}
}

// LNSMessageBuilder builds LoRaWAN-specific IngestEnvelope messages.
type LNSMessageBuilder struct{}

func NewLNSMessageBuilder() *LNSMessageBuilder {
	return &LNSMessageBuilder{}
}

func (lb *LNSMessageBuilder) BuildEnvelope(deviceKey uint64, payload []byte, sourceTopic string) *pb.IngestEnvelope {
	return &pb.IngestEnvelope{
		EventId:   newEventID(),
		Ts:        timestampinfra.Now(),
		IngestTs:  timestampinfra.Now(),
		Source:    pb.IngestSource_SOURCE_GRPC,
		Type:      pb.PayloadType_PAYLOAD_RAW,
		DeviceKey: deviceKey,
		Payload: &pb.IngestEnvelope_Raw{
			Raw: &pb.RawPayload{
				Data:        payload,
				SourceTopic: sourceTopic,
			},
		},
	}
}

// HTTPMessageBuilder builds HTTP-specific IngestEnvelope messages.
type HTTPMessageBuilder struct{}

func NewHTTPMessageBuilder() *HTTPMessageBuilder {
	return &HTTPMessageBuilder{}
}

func (hb *HTTPMessageBuilder) BuildEnvelope(deviceKey uint64, payload []byte, sourceTopic string) *pb.IngestEnvelope {
	return &pb.IngestEnvelope{
		EventId:   newEventID(),
		Ts:        timestampinfra.Now(),
		IngestTs:  timestampinfra.Now(),
		Source:    pb.IngestSource_SOURCE_HTTP,
		Type:      pb.PayloadType_PAYLOAD_RAW,
		DeviceKey: deviceKey,
		Payload: &pb.IngestEnvelope_Raw{
			Raw: &pb.RawPayload{
				Data:        payload,
				SourceTopic: sourceTopic,
			},
		},
	}
}
