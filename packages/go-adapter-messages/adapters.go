package adaptermessages

import (
	"time"

	timestampinfra "github.com/rogeriocassares/zc8/packages/go-infra/time"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// MQTTMessageBuilder builds MQTT-specific IngestRequest messages
type MQTTMessageBuilder struct{}

func NewMQTTMessageBuilder() *MQTTMessageBuilder {
	return &MQTTMessageBuilder{}
}

func (mb *MQTTMessageBuilder) BuildMessage(deviceID string, payload []byte, eventID string) *pb.IngestRequest {
	mqttMsg := &pb.MQTTGatewayMessage{
		Event: &pb.MQTTEventMetadata{
			EventId:       eventID,
			GeneratedAtMs: time.Now().UnixMilli(),
			SourceAdapter: "mqtt",
		},
		Device: &pb.MQTTDeviceIdentification{
			DeviceId:   deviceID,
			DeviceName: "MQTT Device",
		},
		Mqtt: &pb.MQTTClientInfo{
			Topic: "/telemetry",
			Qos:   1,
		},
		Payload: payload,
	}

	return &pb.IngestRequest{
		EventId:   eventID,
		Timestamp: timestampinfra.Now(),
		Source:    pb.IngestSource_SOURCE_MQTT,
		DeviceKey: 3,
		Payload: &pb.IngestRequest_MqttMessage{
			MqttMessage: mqttMsg,
		},
	}
}

// LNSMessageBuilder builds LoRaWAN-specific IngestRequest messages
type LNSMessageBuilder struct{}

func NewLNSMessageBuilder() *LNSMessageBuilder {
	return &LNSMessageBuilder{}
}

func (lb *LNSMessageBuilder) BuildMessage(deviceID string, payload []byte, eventID string) *pb.IngestRequest {
	lnsMsg := &pb.LNSAdapterMessage{
		Event: &pb.EventMetadata{
			EventId:       eventID,
			GeneratedAtMs: time.Now().UnixMilli(),
			SourceAdapter: "lns",
		},
		Identification: &pb.DeviceIdentification{
			DevEui:   deviceID,
			DeviceId: deviceID,
		},
		Frame: &pb.LoRaWANFrame{
			Port:        10,
			Payload:     payload,
			TimestampMs: time.Now().UnixMilli(),
		},
	}

	return &pb.IngestRequest{
		EventId:   eventID,
		Timestamp: timestampinfra.Now(),
		Source:    pb.IngestSource_SOURCE_GRPC,
		DeviceKey: 2,
		Payload: &pb.IngestRequest_LnsMessage{
			LnsMessage: lnsMsg,
		},
	}
}

// HTTPMessageBuilder builds HTTP-specific IngestRequest messages
type HTTPMessageBuilder struct{}

func NewHTTPMessageBuilder() *HTTPMessageBuilder {
	return &HTTPMessageBuilder{}
}

func (hb *HTTPMessageBuilder) BuildMessage(deviceID string, payload []byte, eventID string) *pb.IngestRequest {
	mqttMsg := &pb.MQTTGatewayMessage{
		Event: &pb.MQTTEventMetadata{
			EventId:       eventID,
			GeneratedAtMs: time.Now().UnixMilli(),
			SourceAdapter: "http",
		},
		Device: &pb.MQTTDeviceIdentification{
			DeviceId:   deviceID,
			DeviceName: "HTTP Device",
		},
		Mqtt: &pb.MQTTClientInfo{
			Topic: "/telemetry",
			Qos:   1,
		},
		Payload: payload,
	}

	return &pb.IngestRequest{
		EventId:   eventID,
		Timestamp: timestampinfra.Now(),
		Source:    pb.IngestSource_SOURCE_GRPC,
		DeviceKey: 4,
		Payload: &pb.IngestRequest_MqttMessage{
			MqttMessage: mqttMsg,
		},
	}
}

// AgentMessageBuilder builds Agent-specific IngestRequest messages
type AgentMessageBuilder struct{}

func NewAgentMessageBuilder() *AgentMessageBuilder {
	return &AgentMessageBuilder{}
}

func (amb *AgentMessageBuilder) BuildMessage(deviceID string, payload []byte, eventID string) *pb.IngestRequest {
	agentMsg := &pb.AgentAdapterMessage{
		EventId:       eventID,
		GeneratedAtMs: time.Now().UnixMilli(),
		SourceAdapter: "agent",
		DeviceId:      deviceID,
		DeviceName:    "Agent Device",
		AgentId:       "agent-1",
		GatewayId:     "gateway-1",
		RawPayload:    payload,
		TimestampMs:   time.Now().UnixMilli(),
	}

	return &pb.IngestRequest{
		EventId:   eventID,
		Timestamp: timestampinfra.Now(),
		Source:    pb.IngestSource_SOURCE_GRPC,
		DeviceKey: 1,
		Payload: &pb.IngestRequest_AgentMessage{
			AgentMessage: agentMsg,
		},
	}
}

// ZC2XMessageBuilder builds ZC2X-specific IngestRequest messages
type ZC2XMessageBuilder struct{}

func NewZC2XMessageBuilder() *ZC2XMessageBuilder {
	return &ZC2XMessageBuilder{}
}

func (zb *ZC2XMessageBuilder) BuildMessage(deviceID string, payload []byte, eventID string) *pb.IngestRequest {
	zc2xMsg := &pb.Zc2XAdapterMessage{
		EventId:       eventID,
		GeneratedAtMs: time.Now().UnixMilli(),
		SourceAdapter: "zc2x",
		DeviceId:      deviceID,
		DeviceName:    "ZC2X Device",
		RawPayload:    payload,
		TimestampMs:   time.Now().UnixMilli(),
	}

	return &pb.IngestRequest{
		EventId:   eventID,
		Timestamp: timestampinfra.Now(),
		Source:    pb.IngestSource_SOURCE_GRPC,
		DeviceKey: 5,
		Payload: &pb.IngestRequest_Zc2XMessage{
			Zc2XMessage: zc2xMsg,
		},
	}
}
