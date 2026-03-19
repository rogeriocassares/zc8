package data

import (
	"errors"
	"time"
)

// ParserID identifies which parser implementation to use.
type ParserID uint16

// DeviceKey is the internal fast identity used in dataplane.
// It is derived from UUIDv7 at transport layer.
type DeviceKey uint64

// Field represents a parsed measurement field.
// NOTE: This is allocated per parsed event (acceptable after parsing).
type Field struct {
	Key   string
	Value float64
}

// Parser is the interface for device payload parsing implementations.
type Parser interface {
	Parse(payload []byte, dst *[]Field)
}

// NormalizedMessage represents a device message normalized to standard format.
type NormalizedMessage struct {
	DeviceID      string
	DeviceType    string
	Timestamp     int64
	Fields        map[string]float64
	Tags          map[string]string
	CorrelationID string
}

// FieldMetadata contains metadata about a field definition.
type FieldMetadata struct {
	Name     string
	MinValue float64
	MaxValue float64
	Unit     string
	Type     string
}

// DeviceMeta contains metadata resolved from device cache.
type DeviceMeta struct {
	ParserID ParserID
}

// NewNormalizedMessage creates a new normalized message with initialized maps.
func NewNormalizedMessage(deviceID, deviceType string) *NormalizedMessage {
	return &NormalizedMessage{
		DeviceID:   deviceID,
		DeviceType: deviceType,
		Timestamp:  time.Now().UnixMilli(),
		Fields:     make(map[string]float64),
		Tags:       make(map[string]string),
	}
}

// SetField sets a numeric field in the message.
func (m *NormalizedMessage) SetField(key string, value float64) {
	m.Fields[key] = value
}

// SetTag sets a string tag in the message.
func (m *NormalizedMessage) SetTag(key, value string) {
	m.Tags[key] = value
}

// GetField retrieves a numeric field from the message.
func (m *NormalizedMessage) GetField(key string) (float64, bool) {
	v, ok := m.Fields[key]
	return v, ok
}

// ---------------------------------------------------------------------------
// Stream types (merged from go-stream)
// ---------------------------------------------------------------------------

// IngestRouting carries pre-resolved write destinations for zero-lookup routing.
// Populated at the transport layer from the 3-tier cache, carried through the
// entire pipeline so the ingest engine never touches the database.
type IngestRouting struct {
	InfluxDBConfigID    int64
	WriteToInfluxDB     bool
	RequireInfluxDBAck  bool
	InfluxDBHost        string
	InfluxDBToken       string
	InfluxDBBucket      string
	InfluxDBMeasurement string

	RedisConfigID       int64
	WriteToRedis        bool
	RedisMaxHashEntries int32
	RedisHost           string
	RedisKeyPrefix      string

	NATSConfigID      int64
	WriteToNATS       bool
	NATSURL           string
	NATSSubjectPrefix string
}

// Message is the ingestion unit routed through processing shards.
type Message struct {
	DeviceKey       DeviceKey
	ParserID        ParserID
	Payload         []byte
	Ack             chan error
	PreParsedFields []Field
	Routing         *IngestRouting
	OrganizationID  int64
	TeamID          int64
}

// Event represents parsed data ready for writers.
type Event struct {
	DeviceKey      DeviceKey
	Fields         []Field
	Ack            chan error
	Routing        *IngestRouting
	OrganizationID int64
	TeamID         int64
}

// DeviceCache abstracts device metadata resolution.
type DeviceCache interface {
	Get(DeviceKey) (DeviceMeta, bool)
}

// Writer is the interface for persisting parsed events.
type Writer interface {
	Write([]Event) error
}

// Fanout dispatches events to multiple subscribers.
type Fanout interface {
	Dispatch(Event)
}

// ---------------------------------------------------------------------------
// UUID parsing (merged from go-stream)
// ---------------------------------------------------------------------------

var ErrInvalidUUID = errors.New("invalid uuid format")

// ParseUUIDv7ToDeviceKey converts a canonical UUID string into a uint64
// using the lower 64 bits. Zero allocations, safe for hot path.
func ParseUUIDv7ToDeviceKey(s string) (DeviceKey, error) {
	if len(s) != 36 {
		return 0, ErrInvalidUUID
	}
	var result uint64
	for i := 19; i < 23; i++ {
		v, ok := fromHex(s[i])
		if !ok {
			return 0, ErrInvalidUUID
		}
		result = (result << 4) | uint64(v)
	}
	for i := 24; i < 36; i++ {
		v, ok := fromHex(s[i])
		if !ok {
			return 0, ErrInvalidUUID
		}
		result = (result << 4) | uint64(v)
	}
	return DeviceKey(result), nil
}

func fromHex(c byte) (byte, bool) {
	switch {
	case c >= '0' && c <= '9':
		return c - '0', true
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10, true
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10, true
	default:
		return 0, false
	}
}
