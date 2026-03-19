package zc2x

import (
	"encoding/json"
	"fmt"

	"github.com/rogeriocassares/zc8/packages/go-parser"
)

// ZC2XPayload represents a ZigBee converter device payload.
// ZC2X devices send structured data that can be JSON or binary.
// This implementation assumes JSON format for flexibility.
type ZC2XPayload struct {
	// Device state indicators
	SwitchState *bool   `json:"switch_state,omitempty"`
	Status      *int    `json:"status,omitempty"`
	Mode        *string `json:"mode,omitempty"`

	// Power metrics
	Power    *float64 `json:"power,omitempty"`     // Watts
	Voltage  *float64 `json:"voltage,omitempty"`   // Volts
	CurrentA *float64 `json:"current_a,omitempty"` // Amperes

	// Temperature
	Temperature *float64 `json:"temperature,omitempty"` // Celsius

	// Generic fields map for extensibility
	Fields map[string]interface{} `json:"fields,omitempty"`
}

// ZC2XParser implements the DeviceParser interface for ZC2X devices.
type ZC2XParser struct {
	// Can add configuration here if needed
}

// NewZC2XParser creates a new ZC2X device parser.
func NewZC2XParser() *ZC2XParser {
	return &ZC2XParser{}
}

// Parse decodes a ZC2X device payload.
//
// Input: Raw bytes (JSON or binary) from ZC2X device
// Returns: DeviceData with decoded values
// Error: If payload is malformed
func (p *ZC2XParser) Parse(payload []byte) (*parser.DeviceData, error) {
	var zc2xData ZC2XPayload
	if err := json.Unmarshal(payload, &zc2xData); err != nil {
		// If JSON parsing fails, treat as unknown binary format
		// In production, might try binary parsing here
		return nil, fmt.Errorf("zc2x: failed to unmarshal payload: %w", err)
	}

	// Extract values into standard format
	values := make(map[string]interface{})

	if zc2xData.SwitchState != nil {
		values["switch_state"] = *zc2xData.SwitchState
	}
	if zc2xData.Status != nil {
		values["status"] = *zc2xData.Status
	}
	if zc2xData.Mode != nil {
		values["mode"] = *zc2xData.Mode
	}
	if zc2xData.Power != nil {
		values["power_w"] = *zc2xData.Power
	}
	if zc2xData.Voltage != nil {
		values["voltage_v"] = *zc2xData.Voltage
	}
	if zc2xData.CurrentA != nil {
		values["current_a"] = *zc2xData.CurrentA
	}
	if zc2xData.Temperature != nil {
		values["temperature_c"] = *zc2xData.Temperature
	}

	// Include any additional fields
	if zc2xData.Fields != nil {
		for k, v := range zc2xData.Fields {
			if _, exists := values[k]; !exists {
				values[k] = v
			}
		}
	}

	return &parser.DeviceData{
		Values:    values,
		Metadata:  make(map[string]string),
		Raw:       payload,
		Timestamp: 0, // Will be filled by normalizer
	}, nil
}

// Name returns the parser name.
func (p *ZC2XParser) Name() string {
	return "zc2x"
}

// ============================================================================
// Example Usage
// ============================================================================

/*
// Typical ZC2X payload (JSON):
{
  "switch_state": true,
  "status": 1,
  "power": 2500.5,
  "voltage": 230.2,
  "current_a": 10.87,
  "temperature": 45.3,
  "fields": {
    "firmware": "v2.1.0"
  }
}

// Parser output:
DeviceData{
  Values: {
    "switch_state": true,
    "status": 1,
    "power_w": 2500.5,
    "voltage_v": 230.2,
    "current_a": 10.87,
    "temperature_c": 45.3,
    "firmware": "v2.1.0"
  },
  Raw: [...],
  Timestamp: 0 (set by normalizer)
}
*/
