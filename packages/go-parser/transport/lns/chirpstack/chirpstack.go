package chirpstack

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/rogeriocassares/zc8/packages/go-parser"
)

// ChirpstackFrame represents a Chirpstack uplink message from MQTT.
// This is the format that Chirpstack publishes to MQTT topics like:
// application/{applicationID}/device/{deviceName}/up
type ChirpstackFrame struct {
	ApplicationID   int    `json:"applicationID"`
	ApplicationName string `json:"applicationName"`
	DeviceName      string `json:"deviceName"`
	DeviceEUI       string `json:"deviceEUI"`

	// Base64 encoded device payload
	Data string `json:"data"`

	// FPort identifies which port on the LoRaWAN device sent this
	FPort int `json:"fPort"`

	// Uplink counter
	FCnt uint32 `json:"fCnt"`

	// Receive info (first entry is typically the best signal)
	RxInfo []struct {
		MAC       string  `json:"mac"`
		Name      string  `json:"name"`
		RSSI      int     `json:"rssi"`
		LoRaSNR   float32 `json:"loRaSNR"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	} `json:"rxInfo"`

	// Transmission info
	TxInfo struct {
		Frequency uint32 `json:"frequency"`
		DR        int    `json:"dr"`
		ADR       bool   `json:"adr"`
		CodeRate  string `json:"codeRate"`
	} `json:"txInfo"`

	// Timestamps
	Time string `json:"time"` // RFC3339 timestamp
}

// ChirpstackParser implements the GatewayParser interface for Chirpstack.
type ChirpstackParser struct {
	// Can add configuration here if needed (e.g., device vendor mappings)
}

// NewChirpstackParser creates a new Chirpstack gateway parser.
func NewChirpstackParser() *ChirpstackParser {
	return &ChirpstackParser{}
}

// Parse decodes a Chirpstack uplink message from MQTT JSON format.
//
// Input: Raw JSON bytes from MQTT topic application/{appID}/device/{name}/up
// Returns: GatewayFrame with extracted device payload and metadata
// Error: If JSON is malformed or base64 decoding fails
func (p *ChirpstackParser) Parse(data []byte) (*parser.GatewayFrame, error) {
	var frame ChirpstackFrame
	if err := json.Unmarshal(data, &frame); err != nil {
		return nil, fmt.Errorf("chirpstack: failed to unmarshal JSON: %w", err)
	}

	// Decode base64 payload
	devicePayload, err := base64.StdEncoding.DecodeString(frame.Data)
	if err != nil {
		return nil, fmt.Errorf("chirpstack: failed to decode base64 payload: %w", err)
	}

	// Parse timestamp
	var timestamp int64
	if frame.Time != "" {
		t, err := time.Parse(time.RFC3339Nano, frame.Time)
		if err != nil {
			// Fallback to current time if parsing fails
			timestamp = time.Now().UnixMilli()
		} else {
			timestamp = t.UnixMilli()
		}
	} else {
		timestamp = time.Now().UnixMilli()
	}

	// Use best RSSI/SNR (first RxInfo entry)
	rssi := float32(0)
	snr := float32(0)
	var bestGatewayID, bestGatewayName string
	var latitude, longitude float64
	if len(frame.RxInfo) > 0 {
		rssi = float32(frame.RxInfo[0].RSSI)
		snr = frame.RxInfo[0].LoRaSNR
		bestGatewayID = frame.RxInfo[0].MAC
		bestGatewayName = frame.RxInfo[0].Name
		latitude = frame.RxInfo[0].Latitude
		longitude = frame.RxInfo[0].Longitude
	}

	// Create gateway frame with metadata
	result := &parser.GatewayFrame{
		DeviceVendor:  "",               // To be determined by caller or device registry
		DeviceID:      frame.DeviceName, // Use device name as ID
		DevicePayload: devicePayload,
		RSSI:          rssi,
		SNR:           snr,
		Timestamp:     timestamp,
		GatewayID:     bestGatewayID,
		GatewayMetadata: map[string]interface{}{
			"gateway_name":     bestGatewayName,
			"application_id":   frame.ApplicationID,
			"application_name": frame.ApplicationName,
			"device_eui":       frame.DeviceEUI,
			"fport":            frame.FPort,
			"fcnt":             frame.FCnt,
			"latitude":         latitude,
			"longitude":        longitude,
			"frequency_hz":     frame.TxInfo.Frequency,
			"data_rate":        frame.TxInfo.DR,
			"code_rate":        frame.TxInfo.CodeRate,
			"adr_enabled":      frame.TxInfo.ADR,
		},
	}

	return result, nil
}

// Name returns the parser name.
func (p *ChirpstackParser) Name() string {
	return "chirpstack"
}

// ============================================================================
// Example Usage
// ============================================================================

/*
// Typical Chirpstack MQTT message JSON:
{
  "applicationID": "1",
  "applicationName": "IMT_Sensors",
  "deviceName": "milesight-sensor-001",
  "deviceEUI": "70B3D57ED...",
  "data": "02890C23400D6841...",  // Base64 encoded
  "fPort": 10,
  "fCnt": 12345,
  "rxInfo": [
    {
      "mac": "70B3D5FFFF...",
      "name": "Gateway01",
      "rssi": -82,
      "loRaSNR": 9.5,
      "latitude": 40.7128,
      "longitude": -74.0060
    }
  ],
  "txInfo": {
    "frequency": 868500000,
    "dr": 5,
    "adr": true,
    "codeRate": "4/5"
  },
  "time": "2024-03-09T12:34:56.789Z"
}

// Parser output:
GatewayFrame{
  DeviceID: "milesight-sensor-001",
  DevicePayload: [0x02 0x89 0x0C 0x23 0x40 0x0D 0x68 0x41...],
  RSSI: -82,
  SNR: 9.5,
  Timestamp: 1709862896789,
  GatewayID: "70B3D5FFFF...",
  GatewayMetadata: {
    "application_id": 1,
    "device_eui": "70B3D57ED...",
    "fport": 10,
    ...
  }
}
*/
