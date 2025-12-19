package parser

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type ParsedData struct {
	Name      string                 `json:"name"`
	Fields    map[string]interface{} `json:"fields"`
	Tags      map[string]interface{} `json:"tags"`
	Timestamp uint64                 `json:"timestamp"`
}

type KS3000 struct {
	Variable string          `json:"variable"`
	Param    string          `json:"param"`
	Time     string          `json:"time"`
	Metadata KS3000_Metadata `json:"metadata"`
	Id       string          `json:"ID"`
	Msg      string          `json:"msg"`
}

type KS3000_Metadata struct {
	Variable string             `json:"variable"`
	Time     string             `json:"time"`
	Metadata KS3000_Metadata_IM `json:"metadata"`
}

type KS3000_Metadata_IM struct {
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

// ParseConfig defines how to parse device data
type ParseConfig struct {
	Type   string          `json:"type"`   // "json", "binary", "hex", "array", "protobuf"
	Model  string          `json:"model"`  // "json", "binary", "hex", "array", "protobuf"
	Custom bool            `json:"custom"` // "json", "binary", "hex", "array", "protobuf"
	Schema json.RawMessage `json:"schema"` // Device-specific schema
}

// Result is the parsed output
type Result struct {
	Data      map[string]interface{} `json:"data"`
	Timestamp int64                  `json:"timestamp"`
	DeviceId  string                 `json:"device_id"`
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

// Parser handles data parsing based on device configuration
type Parser struct {
	// Can add custom parsers or plugins here
}

// New creates a new Parser instance
func New() *Parser {
	return &Parser{}
}

func MarshalToJson(msg ParsedData) string {
	outputMsgJson, _ := json.Marshal(msg)
	// if err != nil {
	// 	fmt.Println(err.Error())
	// }
	return string(outputMsgJson[:])
}

func MarshalToInflux(msg ParsedData) string {
	var sb strings.Builder
	sb.WriteString(msg.Name)
	sb.WriteString(",")
	sb.WriteString(mapToCommaString(msg.Tags))
	sb.WriteString(" ")
	sb.WriteString(mapToCommaString(msg.Fields))
	sb.WriteString(" ")
	sb.WriteString(strconv.FormatUint(uint64(msg.Timestamp), 10))

	fmt.Printf("MarshalToInflux: %s", sb.String())
	return string(sb.String())
}

func mapToCommaString(m map[string]interface{}) string {
	var sb strings.Builder
	for k, v := range m {
		sb.WriteString(",")
		sb.WriteString(k)
		sb.WriteString("=")
		switch v.(type) {
		case string:
			if k == "data" {
				sb.WriteString(`"`)
				sb.WriteString(v.(string))
				sb.WriteString(`"`)
			} else {
				sb.WriteString(v.(string))
			}
		case float64:
			sb.WriteString(strconv.FormatFloat(v.(float64), 'f', -1, 64))
		case uint64:
			sb.WriteString(strconv.FormatUint(v.(uint64), 10))
		}

	}
	return strings.Replace(sb.String(), ",", "", 1)
}

// Parse takes raw payload and config, returns structured data
func (p *Parser) Parse(data []byte, config ParseConfig) (*ParsedData, error) {

	switch config.Type {
	case "json":
		return p.parseJSON(data, "ks3000_wifi")

	// case "binary":
	// 	return p.parseBinary(data, config.Schema)

	// case "hex":
	// 	return p.parseHex(data, config.Schema)

	// case "protobuf":
	// 	return p.parseProtobuf(data, config.Schema)

	default:
		return nil, fmt.Errorf("unsupported parse type: %s", config.Type)
	}
}

func (r *KS3000) UnmarshalKS3000JSON(data []byte) error {
	// First, unmarshal into a map to inspect structure
	var objMap map[string]json.RawMessage
	if err := json.Unmarshal(data, &objMap); err != nil {
		return err
	}

	// Check for 'variable' field to determine type
	if _, hasVar := objMap["variable"]; hasVar {
		// First format: data with metadata
		json.Unmarshal(objMap["variable"], &r.Variable)
		json.Unmarshal(objMap["time"], &r.Time)
		json.Unmarshal(objMap["metadata"], &r.Metadata)
	} else if _, hasParam := objMap["param"]; hasParam {
		// Second format: log message
		json.Unmarshal(objMap["param"], &r.Param)
		json.Unmarshal(objMap["id"], &r.Id)
		json.Unmarshal(objMap["msg"], &r.Msg)
		// Time not present in this format
	}
	return nil
}

func isJSONArray(data []byte) bool {
	trimmed := bytes.TrimLeft(data, " \t\r\n")
	return len(trimmed) > 0 && trimmed[0] == '['
}

func isJSONObject(data []byte) bool {
	trimmed := bytes.TrimLeft(data, " \t\r\n")
	return len(trimmed) > 0 && trimmed[0] == '{'
}

// parseJSON parses JSON payload
func (p *Parser) parseJSON(data []byte, deviceModel string) (*ParsedData, error) {
	// var sbRawData strings.Builder
	// sbRawData.WriteString(`'`)
	// sbRawData.WriteString(string(data))
	// sbRawData.WriteString(`'`)

	switch deviceModel {
	case "ks3000_wifi":
		if isJSONArray(data) {
			var ks3000_metadata []KS3000_Metadata
			if err := json.Unmarshal(data, &ks3000_metadata); err != nil {
				return nil, err
			}
			if len(ks3000_metadata) == 0 {
				return nil, fmt.Errorf("empty metadata array")
			}
			// Use the first element's embedded metadata IM
			im := ks3000_metadata[0].Metadata
			ts, err := time.Parse("2006-01-02 15:04:05", ks3000_metadata[0].Time)
			if err != nil {
				fmt.Println("Error parsing time:", err)
				return nil, err
			}

			return &ParsedData{
				Name: "ks3000_im",
				Fields: map[string]interface{}{
					"u_ll_avg":     im.U0,
					"i_avg":        im.I0,
					"frequency":    im.F1,
					"p_total":      im.P0,
					"q_total":      im.Q0,
					"power_factor": im.FP0,
					"a_plus":       im.EA,
					"q_plus":       im.ER,
					"a_minus":      im.EAN,
					"q_minus":      im.ERN,
					"error_code":   im.CE,
					"created_at":   uint64(time.Now().UnixNano()),
					// "raw_data":   sbRawData.String(),
				},
				Tags: map[string]interface{}{
						// "variable": ks3000_metadata[0].Variable,
				}, Timestamp: uint64(ts.UnixNano()),
			}, nil
		} else {
			var ks3000_stats KS3000
			if err := json.Unmarshal(data, &ks3000_stats); err != nil {
				return nil, err
			}
			var sbMsg strings.Builder
			// sbMsg.WriteString(`'`)
			sbMsg.WriteString(ks3000_stats.Msg)
			// sbMsg.WriteString(`'`)
			return &ParsedData{
				Name: "ks3000_stats",
				Fields: map[string]interface{}{
					"msg": sbMsg.String(),
				},
				Tags: map[string]interface{}{
					"deviceId": ks3000_stats.Id,
					"params":   ks3000_stats.Param,
				}, Timestamp: uint64(time.Now().UnixNano()),
			}, nil
		}
	case "healthpack":
		return nil, nil
	case "iotyre":
		return nil, nil
	default:
		return nil, fmt.Errorf("unsupported device model: %s", deviceModel)
	}
	// return nil, nil

	// // Check for 'variable' field to determine type
	// if _, hasVar := objMap["variable"]; hasVar {
	// 	// First format: data with metadata
	// 	json.Unmarshal(objMap["variable"], &p.)
	// 	json.Unmarshal(objMap["time"], &p.Time)
	// 	json.Unmarshal(objMap["metadata"], &p.Metadata)
	// } else if _, hasParam := objMap["param"]; hasParam {
	// 	// Second format: log message
	// 	json.Unmarshal(objMap["param"], &p.Param)
	// 	json.Unmarshal(objMap["id"], &p.ID)
	// 	json.Unmarshal(objMap["msg"], &p.Msg)
	// 	// Time not present in this format
	// }
	// return nil, nil

	// switch deviceType {
	// case "ks3000":
	// 	// [map[metadata:map[CE:0 F1:59.94 FP0:0 I0:0 P0:0 Q0:0 S0:0 U0:221.25] time:2025-12-12 13:34:00 variable:data]]

	// 	if err := json.Unmarshal(data, &telemetry); err != nil {
	// 		return nil, fmt.Errorf("json parse error: %w", err)
	// 	}

	// }

	// result := &ParsedData{
	// 	Name: "ks3000_im",
	// 	Fields: map[string]interface{}{
	// 		"F1":  ks3000_im.F1,
	// 		"FP0": ks3000_im.FP0,
	// 		"I0":  ks3000_im.I0,
	// 		"P0":  ks3000_im.P0,
	// 		"Q0":  ks3000_im.Q0,
	// 		"S0":  ks3000_im.S0,
	// 		"U0":  ks3000_im.U0,
	// 	},
	// 	Tags: map[string]interface{}{
	// 		"deviceType": deviceType,
	// 	}, Timestamp: 11234567890,
	// }
	// fmt.Printf("\n /////////////TELEMETRY: %v\n", telemetry.Telemetry)

	// fmt.Printf("\n PARSE JSON RESULT: %v", result)
	// return result, nil
}

// parseBinary parses binary data according to schema
// func (p *Parser) parseBinary(data []byte, schema json.RawMessage) (map[string]interface{}, error) {
// 	// Parse schema to understand binary format
// 	var binarySchema BinarySchema
// 	if err := json.Unmarshal(schema, &binarySchema); err != nil {
// 		return nil, fmt.Errorf("invalid binary schema: %w", err)
// 	}

// 	result := make(map[string]interface{})
// 	offset := 0

// 	// Parse according to field definitions
// 	for _, field := range binarySchema.Fields {
// 		value, bytesRead, err := p.parseBinaryField(data[offset:], field)
// 		if err != nil {
// 			return nil, fmt.Errorf("error parsing field %s: %w", field.Name, err)
// 		}

// 		result[field.Name] = value
// 		offset += bytesRead
// 	}

// 	return result, nil
// }

// parseBinaryField extracts a single field from binary data
// func (p *Parser) parseBinaryField(data []byte, field BinaryField) (interface{}, int, error) {
// 	if len(data) == 0 {
// 		return nil, 0, fmt.Errorf("insufficient data")
// 	}

// 	var value interface{}
// 	var bytesRead int

// 	switch field.Type {
// 	case "uint8":
// 		if len(data) < 1 {
// 			return nil, 0, fmt.Errorf("insufficient data for uint8")
// 		}
// 		value = uint64(data[0])
// 		bytesRead = 1

// 	case "uint16":
// 		if len(data) < 2 {
// 			return nil, 0, fmt.Errorf("insufficient data for uint16")
// 		}
// 		if field.Endian == "big" {
// 			value = uint64(binary.BigEndian.Uint16(data[:2]))
// 		} else {
// 			value = uint64(binary.LittleEndian.Uint16(data[:2]))
// 		}
// 		bytesRead = 2

// 	case "uint32":
// 		if len(data) < 4 {
// 			return nil, 0, fmt.Errorf("insufficient data for uint32")
// 		}
// 		if field.Endian == "big" {
// 			value = uint64(binary.BigEndian.Uint32(data[:4]))
// 		} else {
// 			value = uint64(binary.LittleEndian.Uint32(data[:4]))
// 		}
// 		bytesRead = 4

// 	case "float32":
// 		if len(data) < 4 {
// 			return nil, 0, fmt.Errorf("insufficient data for float32")
// 		}
// 		var bits uint32
// 		if field.Endian == "big" {
// 			bits = binary.BigEndian.Uint32(data[:4])
// 		} else {
// 			bits = binary.LittleEndian.Uint32(data[:4])
// 		}
// 		value = float64(bits) // Simplified, use math.Float32frombits for actual conversion
// 		bytesRead = 4

// 	case "string":
// 		if field.Length > 0 {
// 			if len(data) < field.Length {
// 				return nil, 0, fmt.Errorf("insufficient data for string")
// 			}
// 			value = string(data[:field.Length])
// 			bytesRead = field.Length
// 		} else {
// 			// Null-terminated string
// 			end := 0
// 			for end < len(data) && data[end] != 0 {
// 				end++
// 			}
// 			value = string(data[:end])
// 			bytesRead = end + 1 // Include null terminator
// 		}

// 	default:
// 		return nil, 0, fmt.Errorf("unsupported field type: %s", field.Type)
// 	}

// 	// Apply scale and offset if specified
// 	if numValue, ok := value.(uint64); ok {
// 		floatValue := float64(numValue)
// 		if field.Scale != 0 {
// 			floatValue *= field.Scale
// 		}
// 		if field.Offset != 0 {
// 			floatValue += field.Offset
// 		}
// 		value = floatValue
// 	}

// 	return value, bytesRead, nil
// }

// parseHex parses hex-encoded data
// func (p *Parser) parseHex(data []byte, schema json.RawMessage) (map[string]interface{}, error) {
// 	// Decode hex string to binary
// 	decoded, err := hex.DecodeString(string(data))
// 	if err != nil {
// 		return nil, fmt.Errorf("hex decode error: %w", err)
// 	}

// 	// Then parse as binary
// 	return p.parseBinary(decoded, schema)
// }

// parseProtobuf parses protobuf data (placeholder)
// func (p *Parser) parseProtobuf(data []byte, schema json.RawMessage) (map[string]interface{}, error) {
// 	// TODO: Implement protobuf parsing
// 	// This would require dynamic protobuf decoding based on schema
// 	return nil, fmt.Errorf("protobuf parsing not yet implemented")
// }

// Validate checks if the parser can handle the given config
// func (p *Parser) Validate(config ParseConfig) error {
// 	switch config.Type {
// 	case "json":
// 		return nil

// 	case "binary", "hex":
// 		var schema BinarySchema
// 		if err := json.Unmarshal(config.Schema, &schema); err != nil {
// 			return fmt.Errorf("invalid binary schema: %w", err)
// 		}
// 		if len(schema.Fields) == 0 {
// 			return fmt.Errorf("binary schema must have at least one field")
// 		}
// 		return nil

// 	case "protobuf":
// 		return fmt.Errorf("protobuf not yet supported")

// 	default:
// 		return fmt.Errorf("unsupported parse type: %s", config.Type)
// 	}
// }
