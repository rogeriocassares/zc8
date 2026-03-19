package processor

import (
	"encoding/json"
	"fmt"
	"strconv"

	gdata "github.com/rogeriocassares/zc8/packages/go-data"
)

// MQTTJSONHandler handles MQTT JSON payloads with flexible field mapping
type MQTTJSONHandler struct{}

func NewMQTTJSONHandler() *MQTTJSONHandler {
	return &MQTTJSONHandler{}
}

func (h *MQTTJSONHandler) ProcessJSON(payload []byte, deviceID string) (*gdata.NormalizedMessage, error) {
	if len(payload) == 0 {
		return nil, fmt.Errorf("empty payload")
	}

	var jsonData map[string]interface{}
	if err := json.Unmarshal(payload, &jsonData); err != nil {
		// If JSON parsing fails, try string parsing
		return h.processStringPayload(string(payload), deviceID)
	}

	// Extract fields from JSON
	msg := gdata.NewNormalizedMessage(deviceID, "mqtt_device")
	for key, val := range jsonData {
		switch v := val.(type) {
		case float64:
			msg.SetField(key, v)
		case string:
			// Try to parse string as number first
			if f, err := strconv.ParseFloat(v, 64); err == nil {
				msg.SetField(key, f)
			} else {
				// Otherwise store as tag
				msg.SetTag(key, v)
			}
		case bool:
			if v {
				msg.SetField(key, 1.0)
			} else {
				msg.SetField(key, 0.0)
			}
		case map[string]interface{}:
			// Nested objects stored as tags (JSON string)
			jsonStr, _ := json.Marshal(v)
			msg.SetTag(key, string(jsonStr))
		}
	}

	return msg, nil
}

func (h *MQTTJSONHandler) processStringPayload(value string, deviceID string) (*gdata.NormalizedMessage, error) {
	msg := gdata.NewNormalizedMessage(deviceID, "mqtt_device")

	// Try parsing as float
	if f, err := strconv.ParseFloat(value, 64); err == nil {
		msg.SetField("value", f)
	} else {
		// Store as string tag
		msg.SetTag("value", value)
	}

	return msg, nil
}

// HTTPJSONHandler handles HTTP JSON payloads with straightforward conversion
type HTTPJSONHandler struct{}

func NewHTTPJSONHandler() *HTTPJSONHandler {
	return &HTTPJSONHandler{}
}

func (h *HTTPJSONHandler) ProcessJSON(payload []byte, deviceID string) (*gdata.NormalizedMessage, error) {
	if len(payload) == 0 {
		return nil, fmt.Errorf("empty payload")
	}

	var jsonData map[string]interface{}
	if err := json.Unmarshal(payload, &jsonData); err != nil {
		return nil, fmt.Errorf("failed to parse JSON: %w", err)
	}

	// Extract numeric fields
	msg := gdata.NewNormalizedMessage(deviceID, "http_device")
	for key, val := range jsonData {
		switch v := val.(type) {
		case float64:
			msg.SetField(key, v)
		case int:
			msg.SetField(key, float64(v))
		case bool:
			// Convert booleans to float (1.0 or 0.0)
			if v {
				msg.SetField(key, 1.0)
			} else {
				msg.SetField(key, 0.0)
			}
		case string:
			// For string values, set as tag (metadata)
			msg.SetTag(key, v)
		}
	}

	return msg, nil
}

// AgentJSONHandler handles Agent JSON payloads with special metadata handling
type AgentJSONHandler struct{}

func NewAgentJSONHandler() *AgentJSONHandler {
	return &AgentJSONHandler{}
}

func (h *AgentJSONHandler) ProcessJSON(payload []byte, deviceID string) (*gdata.NormalizedMessage, error) {
	if len(payload) == 0 {
		return nil, fmt.Errorf("empty payload")
	}

	var jsonData map[string]interface{}
	if err := json.Unmarshal(payload, &jsonData); err != nil {
		return nil, fmt.Errorf("failed to parse JSON: %w", err)
	}

	// Create message with agent identifier tag
	msg := gdata.NewNormalizedMessage(deviceID, "agent_device")

	// Extract fields and metadata
	for key, val := range jsonData {
		switch v := val.(type) {
		case float64:
			msg.SetField(key, v)
		case int:
			msg.SetField(key, float64(v))
		case bool:
			if v {
				msg.SetField(key, 1.0)
			} else {
				msg.SetField(key, 0.0)
			}
		case string:
			// Special handling for agent_id
			if key == "agent_id" {
				msg.SetTag("agent_id", v)
			} else {
				msg.SetTag(key, v)
			}
		case map[string]interface{}:
			// Nested objects - flatten one level deep
			for nestedKey, nestedVal := range v {
				if f, ok := nestedVal.(float64); ok {
					msg.SetField(fmt.Sprintf("%s_%s", key, nestedKey), f)
				}
			}
		}
	}

	return msg, nil
}

// LNSJSONHandler rejects JSON (LNS only accepts binary)
type LNSJSONHandler struct{}

func NewLNSJSONHandler() *LNSJSONHandler {
	return &LNSJSONHandler{}
}

func (h *LNSJSONHandler) ProcessJSON(payload []byte, deviceID string) (*gdata.NormalizedMessage, error) {
	return nil, fmt.Errorf("LNS adapter expects binary payloads, not JSON")
}

// ZC2XJSONHandler handles ZC2X JSON payloads with recursive flattening
type ZC2XJSONHandler struct{}

func NewZC2XJSONHandler() *ZC2XJSONHandler {
	return &ZC2XJSONHandler{}
}

func (h *ZC2XJSONHandler) ProcessJSON(payload []byte, deviceID string) (*gdata.NormalizedMessage, error) {
	if len(payload) == 0 {
		return nil, fmt.Errorf("empty payload")
	}

	var jsonData map[string]interface{}
	if err := json.Unmarshal(payload, &jsonData); err != nil {
		return nil, fmt.Errorf("failed to parse JSON: %w", err)
	}

	msg := gdata.NewNormalizedMessage(deviceID, "zc2x_device")

	// Recursively flatten nested data
	h.flattenData(jsonData, "", msg)

	return msg, nil
}

// flattenData recursively flattens nested JSON objects
// prefix is used to build hierarchical keys like "device.sensor.temp"
func (h *ZC2XJSONHandler) flattenData(jsonData map[string]interface{}, prefix string, msg *gdata.NormalizedMessage) {
	for key, val := range jsonData {
		var fullKey string
		if prefix == "" {
			fullKey = key
		} else {
			fullKey = prefix + "." + key
		}

		switch v := val.(type) {
		case float64:
			msg.SetField(fullKey, v)
		case int:
			msg.SetField(fullKey, float64(v))
		case bool:
			if v {
				msg.SetField(fullKey, 1.0)
			} else {
				msg.SetField(fullKey, 0.0)
			}
		case string:
			msg.SetTag(fullKey, v)
		case map[string]interface{}:
			// Recursively flatten nested objects
			h.flattenData(v, fullKey, msg)
		case []interface{}:
			// Handle arrays (store serialized JSON)
			if jsonBytes, err := json.Marshal(v); err == nil {
				msg.SetTag(fullKey, string(jsonBytes))
			}
		}
	}
}
