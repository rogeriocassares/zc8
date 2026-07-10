package v1

import "google.golang.org/protobuf/proto"

// ─── IngestEnvelope ───────────────────────────────────────────────────────────

// MarshalEnvelope serializes an IngestEnvelope to protobuf wire format.
func MarshalEnvelope(env *IngestEnvelope) ([]byte, error) {
	return proto.Marshal(env)
}

// UnmarshalEnvelope deserializes an IngestEnvelope from wire format.
func UnmarshalEnvelope(data []byte) (*IngestEnvelope, error) {
	var env IngestEnvelope
	if err := proto.Unmarshal(data, &env); err != nil {
		return nil, err
	}
	return &env, nil
}

// ─── ServiceEvent ─────────────────────────────────────────────────────────────

// MarshalServiceEvent serializes a ServiceEvent to protobuf wire format.
func MarshalServiceEvent(ev *ServiceEvent) ([]byte, error) {
	return proto.Marshal(ev)
}

// UnmarshalServiceEvent deserializes a ServiceEvent from wire format.
func UnmarshalServiceEvent(data []byte) (*ServiceEvent, error) {
	var ev ServiceEvent
	if err := proto.Unmarshal(data, &ev); err != nil {
		return nil, err
	}
	return &ev, nil
}

// ─── CommandEnvelope ─────────────────────────────────────────────────────────

// MarshalCommandEnvelope serializes a CommandEnvelope to wire format.
func MarshalCommandEnvelope(env *CommandEnvelope) ([]byte, error) {
	return proto.Marshal(env)
}

// UnmarshalCommandEnvelope deserializes a CommandEnvelope from wire format.
func UnmarshalCommandEnvelope(data []byte) (*CommandEnvelope, error) {
	var env CommandEnvelope
	if err := proto.Unmarshal(data, &env); err != nil {
		return nil, err
	}
	return &env, nil
}
