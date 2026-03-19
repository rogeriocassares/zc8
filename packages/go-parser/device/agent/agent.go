package agent

import (
	"encoding/json"
	"fmt"

	"github.com/rogeriocassares/zc8/packages/go-parser"
)

// AgentPayload represents a generic Agent device payload.
// Agents can send various types of data; this implements a flexible format.
type AgentPayload struct {
	// Agent identification and status
	Version *string `json:"version,omitempty"`  // e.g., "2.1.0"
	Status  *string `json:"status,omitempty"`   // "online", "offline", "error"
	Uptime  *uint64 `json:"uptime_s,omitempty"` // Uptime in seconds

	// System metrics
	CPUUsage     *float64 `json:"cpu_usage_percent,omitempty"`
	MemoryUsage  *float64 `json:"memory_usage_percent,omitempty"`
	DiskUsage    *float64 `json:"disk_usage_percent,omitempty"`
	TemperatureC *float64 `json:"temperature_c,omitempty"`

	// Network info
	SignalStrength *int     `json:"signal_strength_dbm,omitempty"` // GSM signal strength
	Latitude       *float64 `json:"latitude,omitempty"`
	Longitude      *float64 `json:"longitude,omitempty"`

	// Custom sensor data
	SensorData map[string]interface{} `json:"sensors,omitempty"`

	// Generic fields for extensibility
	Fields map[string]interface{} `json:"fields,omitempty"`
}

// AgentParser implements the DeviceParser interface for Agent devices.
type AgentParser struct {
	// Can add configuration here if needed
}

// NewAgentParser creates a new Agent device parser.
func NewAgentParser() *AgentParser {
	return &AgentParser{}
}

// Parse decodes an Agent device payload.
//
// Input: Raw bytes (JSON) from Agent device
// Returns: DeviceData with decoded values
// Error: If payload is malformed
func (p *AgentParser) Parse(payload []byte) (*parser.DeviceData, error) {
	var agentData AgentPayload
	if err := json.Unmarshal(payload, &agentData); err != nil {
		return nil, fmt.Errorf("agent: failed to unmarshal payload: %w", err)
	}

	// Extract values into standard format
	values := make(map[string]interface{})

	if agentData.Version != nil {
		values["version"] = *agentData.Version
	}
	if agentData.Status != nil {
		values["status"] = *agentData.Status
	}
	if agentData.Uptime != nil {
		values["uptime_s"] = *agentData.Uptime
	}
	if agentData.CPUUsage != nil {
		values["cpu_usage_percent"] = *agentData.CPUUsage
	}
	if agentData.MemoryUsage != nil {
		values["memory_usage_percent"] = *agentData.MemoryUsage
	}
	if agentData.DiskUsage != nil {
		values["disk_usage_percent"] = *agentData.DiskUsage
	}
	if agentData.TemperatureC != nil {
		values["temperature_c"] = *agentData.TemperatureC
	}
	if agentData.SignalStrength != nil {
		values["signal_strength_dbm"] = *agentData.SignalStrength
	}
	if agentData.Latitude != nil {
		values["latitude"] = *agentData.Latitude
	}
	if agentData.Longitude != nil {
		values["longitude"] = *agentData.Longitude
	}

	// Include sensor data
	if agentData.SensorData != nil {
		for k, v := range agentData.SensorData {
			if _, exists := values[k]; !exists {
				values[k] = v
			}
		}
	}

	// Include generic fields
	if agentData.Fields != nil {
		for k, v := range agentData.Fields {
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
func (p *AgentParser) Name() string {
	return "agent"
}

// ============================================================================
// Example Usage
// ============================================================================

/*
// Typical Agent payload (JSON):
{
  "version": "2.1.0",
  "status": "online",
  "uptime_s": 864000,
  "cpu_usage_percent": 25.5,
  "memory_usage_percent": 48.3,
  "disk_usage_percent": 62.1,
  "temperature_c": 42.0,
  "signal_strength_dbm": -95,
  "latitude": 40.7128,
  "longitude": -74.0060,
  "sensors": {
    "temperature_external": 22.5,
    "humidity": 65.0,
    "co2_ppm": 450
  },
  "fields": {
    "device_id": "agent-001",
    "location": "Office-A"
  }
}

// Parser output:
DeviceData{
  Values: {
    "version": "2.1.0",
    "status": "online",
    "uptime_s": 864000,
    "cpu_usage_percent": 25.5,
    "memory_usage_percent": 48.3,
    "disk_usage_percent": 62.1,
    "temperature_c": 42.0,
    "signal_strength_dbm": -95,
    "latitude": 40.7128,
    "longitude": -74.0060,
    "temperature_external": 22.5,
    "humidity": 65.0,
    "co2_ppm": 450,
    "device_id": "agent-001",
    "location": "Office-A"
  },
  Raw: [...],
  Timestamp: 0 (set by normalizer)
}
*/
