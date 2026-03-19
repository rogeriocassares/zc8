package lns

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/rogeriocassares/zc8/packages/go-parser"
)

// LNSUplinkMessage represents a generic LoRaWAN Network Server uplink message.
// This format is compatible with standard LNS implementations (Chirpstack, TTN, etc.)
type LNSUplinkMessage struct {
	// Device information
	DeviceID   string `json:"device_id"`
	DeviceEUI  string `json:"device_eui,omitempty"`
	DeviceName string `json:"device_name,omitempty"`

	// Payload
	Payload   string `json:"payload"` // Base64 encoded
	Port      int    `json:"port,omitempty"`
	Confirmed bool   `json:"confirmed,omitempty"`

	// Counter
	FCnt uint32 `json:"fcnt,omitempty"`

	// Signal strength
	RSSI float32 `json:"rssi,omitempty"`
	SNR  float32 `json:"snr,omitempty"`

	// Gateway
	GatewayID   string  `json:"gateway_id,omitempty"`
	GatewayName string  `json:"gateway_name,omitempty"`
	Latitude    float64 `json:"latitude,omitempty"`
	Longitude   float64 `json:"longitude,omitempty"`

	// Frequency
	Frequency uint32 `json:"frequency,omitempty"` // Hz
	DataRate  string `json:"data_rate,omitempty"`

	// Timestamps
	Timestamp  int64  `json:"timestamp,omitempty"`   // Unix milliseconds
	ReceivedAt string `json:"received_at,omitempty"` // RFC3339
}

// LNSParser implements the GatewayParser interface for generic LoRaWAN Network Servers.
type LNSParser struct {
	// Can add configuration here if needed
}

// NewLNSParser creates a new generic LNS gateway parser.
func NewLNSParser() *LNSParser {
	return &LNSParser{}
}

// Parse decodes a generic LNS uplink message from JSON format.
//
// Input: Raw JSON bytes from LNS (MQTT or HTTP)
// Returns: GatewayFrame with extracted device payload and metadata
// Error: If JSON is malformed or base64 decoding fails
func (p *LNSParser) Parse(data []byte) (*parser.GatewayFrame, error) {
	var msg LNSUplinkMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, fmt.Errorf("lns: failed to unmarshal JSON: %w", err)
	}

	// Decode base64 payload
	devicePayload, err := base64.StdEncoding.DecodeString(msg.Payload)
	if err != nil {
		return nil, fmt.Errorf("lns: failed to decode base64 payload: %w", err)
	}

	// Determine device ID
	deviceID := msg.DeviceName
	if deviceID == "" {
		deviceID = msg.DeviceID
	}
	if deviceID == "" {
		deviceID = msg.DeviceEUI
	}

	// Determine timestamp
	var timestamp int64
	if msg.Timestamp > 0 {
		timestamp = msg.Timestamp
	} else if msg.ReceivedAt != "" {
		t, err := time.Parse(time.RFC3339Nano, msg.ReceivedAt)
		if err != nil {
			timestamp = time.Now().UnixMilli()
		} else {
			timestamp = t.UnixMilli()
		}
	} else {
		timestamp = time.Now().UnixMilli()
	}

	// Create gateway frame
	result := &parser.GatewayFrame{
		DeviceVendor:  "", // To be determined by caller or device registry
		DeviceID:      deviceID,
		DevicePayload: devicePayload,
		RSSI:          msg.RSSI,
		SNR:           msg.SNR,
		Timestamp:     timestamp,
		GatewayID:     msg.GatewayID,
		GatewayMetadata: map[string]interface{}{
			"device_eui":   msg.DeviceEUI,
			"gateway_name": msg.GatewayName,
			"port":         msg.Port,
			"fcnt":         msg.FCnt,
			"confirmed":    msg.Confirmed,
			"frequency_hz": msg.Frequency,
			"data_rate":    msg.DataRate,
			"latitude":     msg.Latitude,
			"longitude":    msg.Longitude,
		},
	}

	return result, nil
}

// Name returns the parser name.
func (p *LNSParser) Name() string {
	return "lns"
}

// ============================================================================
// Example Usage
// ============================================================================

/*
// Typical generic LNS message JSON:
{
  "device_id": "generic-device-001",
  "device_eui": "0011223344556677",
  "device_name": "sensor-001",
  "payload": "1A2B3C4D...",
  "port": 10,
  "fcnt": 123,
  "confirmed": false,
  "rssi": -87,
  "snr": 8.5,
  "gateway_id": "gw-001",
  "gateway_name": "Gateway-East",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "frequency": 868500000,
  "data_rate": "SF10BW125",
  "timestamp": 1709862896789,
  "received_at": "2024-03-09T12:34:56.789Z"
}

// Parser output:
GatewayFrame{
  DeviceID: "sensor-001",
  DevicePayload: [0x1A 0x2B 0x3C 0x4D...],
  RSSI: -87,
  SNR: 8.5,
  Timestamp: 1709862896789,
  GatewayID: "gw-001",
  GatewayMetadata: {
    "device_eui": "0011223344556677",
    "port": 10,
    "fcnt": 123,
    ...
  }
}
*/
