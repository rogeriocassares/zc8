package parser

import (
	datatypes "github.com/rogeriocassares/zc8/packages/go-data"
)

// ===============================
// Parser ID Constants
// ===============================

// Device Vendor Parser IDs (data payload parsers)
const (
	MilesightID datatypes.ParserID = 1001
	KronID      datatypes.ParserID = 1002
	KhompID     datatypes.ParserID = 1003
	ZC2XID      datatypes.ParserID = 1004
	AgentID     datatypes.ParserID = 1005
)

// Gateway Vendor Parser IDs (frame/envelope parsers)
const (
	ChirpstackGatewayID datatypes.ParserID = 2001
	EverynetGatewayID   datatypes.ParserID = 2002
	LNSGatewayID        datatypes.ParserID = 2003
)

// ===============================
// Gateway Parser Interfaces
// ===============================

// GatewayFrame is the output from a gateway parser.
// It represents a device frame extracted from the gateway envelope.
type GatewayFrame struct {
	// Device identification
	DeviceVendor  string // Which device manufacturer (milesight, kron, khomp, zc2x, agent)
	DeviceID      string // Unique device identifier
	DevicePayload []byte // The raw device payload (encrypted or raw)

	// Signal quality metrics
	RSSI float32 // Signal strength (-120 to -30 dBm typically)
	SNR  float32 // Signal-to-noise ratio (dB)

	// Timing
	Timestamp int64 // Message timestamp in milliseconds

	// Gateway metadata
	GatewayID       string
	GatewayMetadata map[string]interface{} // Custom metadata per gateway
}

// GatewayParser parses gateway-specific message formats.
// Input: Raw bytes from the gateway protocol (MQTT, HTTP, gRPC)
// Output: GatewayFrame with extracted device payload and metadata
type GatewayParser interface {
	// Parse decodes the gateway frame and extracts device data
	Parse(data []byte) (*GatewayFrame, error)

	// Name returns the parser name (e.g., "chirpstack", "everynet", "lns")
	Name() string
}

// ===============================
// Parser Registry
// ===============================

// Registry is the interface that services must implement to register parsers.
// Panics on duplicate registrations.
type Registry interface {
	Register(id datatypes.ParserID, p datatypes.Parser)
}
