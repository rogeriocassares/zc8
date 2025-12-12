package parser

import (
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// ParseConfig defines how to parse device data
type ParseConfig struct {
	Type   string          `json:"type"`   // "json", "binary", "hex", "array", "protobuf"
	Schema json.RawMessage `json:"schema"` // Device-specific schema
}

// Result is the parsed output
type Result struct {
	Data      map[string]interface{} `json:"data"`
	Timestamp int64                  `json:"timestamp"`
	DeviceID  string                 `json:"device_id"`
}

// Parser handles data parsing based on device configuration
type Parser struct {
	// Can add custom parsers or plugins here
}

// New creates a new Parser instance
func New() *Parser {
	return &Parser{}
}

// Parse takes raw payload and config, returns structured data
func (p *Parser) Parse(rawPayload []byte, config ParseConfig) (interface{}, error) {
	switch config.Type {
	case "json":
		return p.parseJSON(rawPayload)

	case "binary":
		return p.parseBinary(rawPayload, config.Schema)

	case "hex":
		return p.parseHex(rawPayload, config.Schema)

	case "protobuf":
		return p.parseProtobuf(rawPayload, config.Schema)

	default:
		return nil, fmt.Errorf("unsupported parse type: %s", config.Type)
	}
}

// parseJSON parses JSON payload
func (p *Parser) parseJSON(rawPayload []byte) (interface{}, error) {
	var result interface{}

	if err := json.Unmarshal(rawPayload, &result); err != nil {
		return nil, fmt.Errorf("json parse error: %w", err)
	}

	fmt.Printf("\n PARSE JSON RESULT: %v", result)
	// [map[metadata:map[CE:0 F1:59.94 FP0:0 I0:0 P0:0 Q0:0 S0:0 U0:221.25] time:2025-12-12 13:34:00 variable:data]]
	return result, nil
}

// parseBinary parses binary data according to schema
func (p *Parser) parseBinary(rawPayload []byte, schema json.RawMessage) (map[string]interface{}, error) {
	// Parse schema to understand binary format
	var binarySchema BinarySchema
	if err := json.Unmarshal(schema, &binarySchema); err != nil {
		return nil, fmt.Errorf("invalid binary schema: %w", err)
	}

	result := make(map[string]interface{})
	offset := 0

	// Parse according to field definitions
	for _, field := range binarySchema.Fields {
		value, bytesRead, err := p.parseBinaryField(rawPayload[offset:], field)
		if err != nil {
			return nil, fmt.Errorf("error parsing field %s: %w", field.Name, err)
		}

		result[field.Name] = value
		offset += bytesRead
	}

	return result, nil
}

// BinarySchema defines binary data structure
type BinarySchema struct {
	Fields []BinaryField `json:"fields"`
}

type BinaryField struct {
	Name   string  `json:"name"`
	Type   string  `json:"type"`   // "uint8", "uint16", "uint32", "float32", "string"
	Length int     `json:"length"` // For strings or byte arrays
	Endian string  `json:"endian"` // "big" or "little"
	Scale  float64 `json:"scale"`  // Optional: multiply value by this
	Offset float64 `json:"offset"` // Optional: add this to value
}

// parseBinaryField extracts a single field from binary data
func (p *Parser) parseBinaryField(data []byte, field BinaryField) (interface{}, int, error) {
	if len(data) == 0 {
		return nil, 0, fmt.Errorf("insufficient data")
	}

	var value interface{}
	var bytesRead int

	switch field.Type {
	case "uint8":
		if len(data) < 1 {
			return nil, 0, fmt.Errorf("insufficient data for uint8")
		}
		value = uint64(data[0])
		bytesRead = 1

	case "uint16":
		if len(data) < 2 {
			return nil, 0, fmt.Errorf("insufficient data for uint16")
		}
		if field.Endian == "big" {
			value = uint64(binary.BigEndian.Uint16(data[:2]))
		} else {
			value = uint64(binary.LittleEndian.Uint16(data[:2]))
		}
		bytesRead = 2

	case "uint32":
		if len(data) < 4 {
			return nil, 0, fmt.Errorf("insufficient data for uint32")
		}
		if field.Endian == "big" {
			value = uint64(binary.BigEndian.Uint32(data[:4]))
		} else {
			value = uint64(binary.LittleEndian.Uint32(data[:4]))
		}
		bytesRead = 4

	case "float32":
		if len(data) < 4 {
			return nil, 0, fmt.Errorf("insufficient data for float32")
		}
		var bits uint32
		if field.Endian == "big" {
			bits = binary.BigEndian.Uint32(data[:4])
		} else {
			bits = binary.LittleEndian.Uint32(data[:4])
		}
		value = float64(bits) // Simplified, use math.Float32frombits for actual conversion
		bytesRead = 4

	case "string":
		if field.Length > 0 {
			if len(data) < field.Length {
				return nil, 0, fmt.Errorf("insufficient data for string")
			}
			value = string(data[:field.Length])
			bytesRead = field.Length
		} else {
			// Null-terminated string
			end := 0
			for end < len(data) && data[end] != 0 {
				end++
			}
			value = string(data[:end])
			bytesRead = end + 1 // Include null terminator
		}

	default:
		return nil, 0, fmt.Errorf("unsupported field type: %s", field.Type)
	}

	// Apply scale and offset if specified
	if numValue, ok := value.(uint64); ok {
		floatValue := float64(numValue)
		if field.Scale != 0 {
			floatValue *= field.Scale
		}
		if field.Offset != 0 {
			floatValue += field.Offset
		}
		value = floatValue
	}

	return value, bytesRead, nil
}

// parseHex parses hex-encoded data
func (p *Parser) parseHex(rawPayload []byte, schema json.RawMessage) (map[string]interface{}, error) {
	// Decode hex string to binary
	decoded, err := hex.DecodeString(string(rawPayload))
	if err != nil {
		return nil, fmt.Errorf("hex decode error: %w", err)
	}

	// Then parse as binary
	return p.parseBinary(decoded, schema)
}

// parseProtobuf parses protobuf data (placeholder)
func (p *Parser) parseProtobuf(rawPayload []byte, schema json.RawMessage) (map[string]interface{}, error) {
	// TODO: Implement protobuf parsing
	// This would require dynamic protobuf decoding based on schema
	return nil, fmt.Errorf("protobuf parsing not yet implemented")
}

// Validate checks if the parser can handle the given config
func (p *Parser) Validate(config ParseConfig) error {
	switch config.Type {
	case "json":
		return nil

	case "binary", "hex":
		var schema BinarySchema
		if err := json.Unmarshal(config.Schema, &schema); err != nil {
			return fmt.Errorf("invalid binary schema: %w", err)
		}
		if len(schema.Fields) == 0 {
			return fmt.Errorf("binary schema must have at least one field")
		}
		return nil

	case "protobuf":
		return fmt.Errorf("protobuf not yet supported")

	default:
		return fmt.Errorf("unsupported parse type: %s", config.Type)
	}
}
