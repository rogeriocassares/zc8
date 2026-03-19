package everynet

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/rogeriocassares/zc8/packages/go-parser"
)

// EverynetUplinkMessage represents an Everynet uplink webhook message.
// This is the format that Everynet sends via HTTP webhooks.
type EverynetUplinkMessage struct {
	Type string `json:"type"` // "uplink"

	// Device identification
	DeviceID   string `json:"device_id"`
	DeviceEUI  string `json:"device_eui"`
	DeviceName string `json:"device_name"`

	// Payload (base64 encoded)
	Payload string `json:"payload"`
	Port    int    `json:"port"`

	// Counter
	Counter uint32 `json:"counter"`

	// Gateway information
	Gateways []struct {
		ID        string  `json:"id"`
		Name      string  `json:"name"`
		RSSI      int     `json:"rssi"`
		SNR       float32 `json:"snr"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	} `json:"gateways"`

	// Frequency info
	Frequency int    `json:"frequency"` // Hz
	DataRate  string `json:"data_rate"` // e.g., "SF10BW125"

	// Timestamps
	Timestamp  int64  `json:"timestamp"`   // Unix milliseconds
	ReceivedAt string `json:"received_at"` // RFC3339
}

// EverynetParser implements the GatewayParser interface for Everynet.
type EverynetParser struct {
	// Can add configuration here if needed
}

// NewEverynetParser creates a new Everynet gateway parser.
func NewEverynetParser() *EverynetParser {
	return &EverynetParser{}
}

// Parse decodes an Everynet uplink message from HTTP webhook JSON format.
//
// Input: Raw JSON bytes from Everynet webhook
// Returns: GatewayFrame with extracted device payload and metadata
// Error: If JSON is malformed or base64 decoding fails
func (p *EverynetParser) Parse(data []byte) (*parser.GatewayFrame, error) {
	var msg EverynetUplinkMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, fmt.Errorf("everynet: failed to unmarshal JSON: %w", err)
	}

	// Filter for uplink messages only
	if msg.Type != "uplink" {
		return nil, fmt.Errorf("everynet: not an uplink message (type: %s)", msg.Type)
	}

	// Decode base64 payload
	devicePayload, err := base64.StdEncoding.DecodeString(msg.Payload)
	if err != nil {
		return nil, fmt.Errorf("everynet: failed to decode base64 payload: %w", err)
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

	// Use best gateway (first one if multiple)
	rssi := float32(0)
	snr := float32(0)
	var bestGatewayID, bestGatewayName string
	var latitude, longitude float64
	if len(msg.Gateways) > 0 {
		rssi = float32(msg.Gateways[0].RSSI)
		snr = msg.Gateways[0].SNR
		bestGatewayID = msg.Gateways[0].ID
		bestGatewayName = msg.Gateways[0].Name
		latitude = msg.Gateways[0].Latitude
		longitude = msg.Gateways[0].Longitude
	}

	// Create gateway frame
	result := &parser.GatewayFrame{
		DeviceVendor:  "",             // To be determined by caller or device registry
		DeviceID:      msg.DeviceName, // Use device name; fallback to device_id
		DevicePayload: devicePayload,
		RSSI:          rssi,
		SNR:           snr,
		Timestamp:     timestamp,
		GatewayID:     bestGatewayID,
		GatewayMetadata: map[string]interface{}{
			"gateway_name":  bestGatewayName,
			"device_eui":    msg.DeviceEUI,
			"port":          msg.Port,
			"counter":       msg.Counter,
			"frequency_hz":  msg.Frequency,
			"data_rate":     msg.DataRate,
			"latitude":      latitude,
			"longitude":     longitude,
			"gateway_count": len(msg.Gateways),
		},
	}

	return result, nil
}

// Name returns the parser name.
func (p *EverynetParser) Name() string {
	return "everynet"
}

// ============================================================================
// Example Usage
// ============================================================================

/*
// Typical Everynet webhook message JSON:
{
  "type": "uplink",
  "device_id": "org5-meter-001",
  "device_eui": "A0B1C2D3E4F5G6H7",
  "device_name": "kron-meter-001",
  "payload": "02F10A03E2...",  // Base64 encoded
  "port": 100,
  "counter": 542,
  "gateways": [
    {
      "id": "gw-everynet-001",
      "name": "Everynet-Gateway-EU",
      "rssi": -95,
      "snr": 5.2,
      "latitude": 48.856613,
      "longitude": 2.352222
    }
  ],
  "frequency": 868100000,
  "data_rate": "SF10BW125",
  "timestamp": 1709862896789,
  "received_at": "2024-03-09T12:34:56.789Z"
}

// Parser output:
GatewayFrame{
  DeviceID: "kron-meter-001",
  DevicePayload: [0x02 0xF1 0x0A 0x03 0xE2...],
  RSSI: -95,
  SNR: 5.2,
  Timestamp: 1709862896789,
  GatewayID: "gw-everynet-001",
  GatewayMetadata: {
    "device_eui": "A0B1C2D3E4F5G6H7",
    "port": 100,
    "counter": 542,
    ...
  }
}
*/
