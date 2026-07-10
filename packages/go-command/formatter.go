package command

import (
	"encoding/json"
	"fmt"

	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// FormattedCommand is the output of a CommandFormatter.
// It contains the transport-specific target and payload ready for dispatch.
type FormattedCommand struct {
	// Target is transport-specific: MQTT topic, HTTP URL, gRPC method, etc.
	Target string
	// Payload is the formatted bytes to send over the transport.
	Payload []byte
	// Headers are optional HTTP headers (only used by HTTP formatters).
	Headers map[string]string
	// Method is the HTTP method (only used by HTTP formatters).
	Method string
}

// CommandFormatter transforms a CommandEnvelope into a transport-specific payload.
type CommandFormatter interface {
	// Format builds the transport-specific target and payload from the envelope.
	Format(env *pb.CommandEnvelope) (*FormattedCommand, error)
	// Code returns the formatter_code string matching the database seed.
	Code() string
}

// Registry maps formatter_code to CommandFormatter implementation.
type Registry struct {
	formatters map[string]CommandFormatter
}

// NewRegistry creates a Registry pre-loaded with all built-in formatters.
func NewRegistry() *Registry {
	r := &Registry{formatters: make(map[string]CommandFormatter)}
	r.Register(&ChirpStackMQTTFormatter{})
	r.Register(&TTNMQTTFormatter{})
	r.Register(&DirectMQTTFormatter{})
	r.Register(&EverynetHTTPFormatter{})
	r.Register(&ActilityHTTPFormatter{})
	r.Register(&LoriotHTTPFormatter{})
	r.Register(&GenericHTTPFormatter{})
	r.Register(&GRPCBidirectionalFormatter{})
	return r
}

// Register adds a formatter to the registry.
func (r *Registry) Register(f CommandFormatter) {
	r.formatters[f.Code()] = f
}

// Get returns the formatter for the given code, or an error if not found.
func (r *Registry) Get(code string) (CommandFormatter, error) {
	f, ok := r.formatters[code]
	if !ok {
		return nil, fmt.Errorf("unknown formatter_code: %q", code)
	}
	return f, nil
}

// Format resolves the formatter by code and formats the envelope.
func (r *Registry) Format(env *pb.CommandEnvelope) (*FormattedCommand, error) {
	f, err := r.Get(env.FormatterCode)
	if err != nil {
		return nil, err
	}
	return f.Format(env)
}

// metadataString extracts a string value from the JSON device_metadata.
func metadataString(env *pb.CommandEnvelope, key string) string {
	if len(env.DeviceMetadata) == 0 {
		return ""
	}
	var m map[string]interface{}
	if err := json.Unmarshal(env.DeviceMetadata, &m); err != nil {
		return ""
	}
	v, _ := m[key].(string)
	return v
}
