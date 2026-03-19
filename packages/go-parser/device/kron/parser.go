package kron

import (
	"encoding/binary"
	"encoding/json"

	"github.com/rogeriocassares/zc8/packages/go-parser"
)

// KronParser parses Kron power monitoring device payloads
// Supports both binary and JSON formats
type KronParser struct{}

// NewKronParser creates a new Kron parser
func NewKronParser() *KronParser {
	return &KronParser{}
}

// Parse implements parser.DeviceParser interface for Kron devices
func (p *KronParser) Parse(payload []byte) (*parser.DeviceData, error) {
	if len(payload) == 0 {
		return &parser.DeviceData{
			Values:    make(map[string]interface{}),
			Metadata:  make(map[string]string),
			Raw:       payload,
			Timestamp: 0,
		}, nil
	}

	values := make(map[string]interface{})

	// Try JSON format first (typical for WiFi uplinks)
	if isJSON(payload) {
		p.parseJSON(payload, values)
	} else {
		// Fall back to binary format (LoRaWAN payloads)
		p.parseBinary(payload, values)
	}

	return &parser.DeviceData{
		Values:    values,
		Metadata:  make(map[string]string),
		Raw:       payload,
		Timestamp: 0,
	}, nil
}

// parseJSON handles JSON payload format with power metrics
func (p *KronParser) parseJSON(payload []byte, values map[string]interface{}) {
	// Try to parse as JSON object with 16 power metrics
	// Expected fields from old code: U0, I0, F1, P0, Q0, FP0, EA, ER, EAN, ERN, CE
	type metadata struct {
		U0  float64 `json:"U0"`
		I0  float64 `json:"I0"`
		F1  float64 `json:"F1"`
		P0  float64 `json:"P0"`
		Q0  float64 `json:"Q0"`
		FP0 float64 `json:"FP0"`
		EA  float64 `json:"EA"`
		ER  float64 `json:"ER"`
		EAN float64 `json:"EAN"`
		ERN float64 `json:"ERN"`
		CE  float64 `json:"CE"`
	}

	var data metadata
	err := json.Unmarshal(payload, &data)
	if err != nil {
		return
	}

	if data.U0 != 0 {
		values["voltage_phase1"] = data.U0
	}
	if data.I0 != 0 {
		values["current_phase1"] = data.I0
	}
	if data.F1 != 0 {
		values["frequency"] = data.F1
	}
	if data.P0 != 0 {
		values["power_active"] = data.P0
	}
	if data.Q0 != 0 {
		values["power_reactive"] = data.Q0
	}
	if data.FP0 != 0 {
		values["power_factor"] = data.FP0
	}
	if data.EA != 0 {
		values["energy_active"] = data.EA
	}
	if data.ER != 0 {
		values["energy_reactive"] = data.ER
	}
	if data.EAN != 0 {
		values["energy_active_net"] = data.EAN
	}
	if data.ERN != 0 {
		values["energy_reactive_net"] = data.ERN
	}
	if data.CE != 0 {
		values["cumulative_energy"] = data.CE
	}
}

// parseBinary handles binary payload format
func (p *KronParser) parseBinary(payload []byte, values map[string]interface{}) {
	if len(payload) < 2 {
		return
	}

	// Binary format: 16 big-endian int16 values (32 bytes total)
	// Channels: U0, I0, F1, P0, Q0, FP0, EA, ER, EAN, ERN, CE (11 * 2 bytes = 22 bytes minimum)
	// Detailed format TBD - using simple iteration for now
	for i := 0; i+1 < len(payload); i += 2 {
		val := int16(binary.BigEndian.Uint16(payload[i : i+2]))
		fieldNum := i / 2
		key := ""
		switch fieldNum {
		case 0:
			key = "voltage_phase1"
		case 1:
			key = "current_phase1"
		case 2:
			key = "frequency"
		case 3:
			key = "power_active"
		case 4:
			key = "power_reactive"
		case 5:
			key = "power_factor"
		case 6:
			key = "energy_active"
		case 7:
			key = "energy_reactive"
		case 8:
			key = "energy_active_net"
		case 9:
			key = "energy_reactive_net"
		case 10:
			key = "cumulative_energy"
		default:
			continue
		}
		values[key] = float64(val)
	}
}

// Name implements parser.DeviceParser interface
func (p *KronParser) Name() string {
	return "kron"
}

// isJSON checks if payload is JSON format
func isJSON(payload []byte) bool {
	if len(payload) == 0 {
		return false
	}
	// JSON typically starts with { or [
	return payload[0] == '{' || payload[0] == '['
}
