package util

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math"
	"strconv"
	"strings"
	"time"
)

type DeviceInfo struct {
	IsActive     bool        `json:"is_active"`
	IsAuthorized bool        `json:"is_authorized"`
	OrgID        string      `json:"org_id"`
	ParseConfig  ParseConfig `json:"parse_config"`
}

type ParseConfig struct {
	Type   string          `json:"type"`   // "json", "protobuf", "binary"
	Schema json.RawMessage `json:"schema"` // Device-specific schema
}

type ParsedData struct {
	Fields    map[string]any
	Tags      map[string]string
	Timestamp uint64
}

// type Output struct {
// 	Name string `json:"name"`
// 	// Fields    map[string]interface{} `json:"fields"`
// 	Field     interface{}            `json:"field"`
// 	Tags      map[string]interface{} `json:"tags"`
// 	Timestamp uint64                 `json:"timestamp"`
// }

// Message type 1: Data payload with dynamic metadata
type DataMessage struct {
	Variable string                 `json:"variable"`
	Time     string                 `json:"time"`
	Metadata map[string]interface{} `json:"metadata"`
}

// Message type 2: Log payload
type LogMessage struct {
	Param string `json:"param"`
	ID    string `json:"ID"`
	Msg   string `json:"msg"`
}

type FieldsValue struct {
	Key   string
	Value any
}

// MessageType enum
type MessageType int

const (
	MessageTypeUnknown MessageType = iota
	MessageTypeData
	MessageTypeLog
)

// AddField appends a field only if the value is non-nil.
func AddField(fields *[]FieldsValue, key string, value any) {
	if value != nil {
		*fields = append(*fields, FieldsValue{
			Key:   key,
			Value: value,
		})
	}
}
func IsJSONArray(data []byte) bool {
	trimmed := bytes.TrimLeft(data, " \t\r\n")
	return len(trimmed) > 0 && trimmed[0] == '['
}

func IsJSONObject(data []byte) bool {
	trimmed := bytes.TrimLeft(data, " \t\r\n")
	return len(trimmed) > 0 && trimmed[0] == '{'
}

func MarshalToJson(msg ParsedData) string {
	outputMsgJson, _ := json.Marshal(msg)
	// if err != nil {
	// 	fmt.Println(err.Error())
	// }
	return string(outputMsgJson[:])
}

// func MarshalToInflux(msg ParsedData) string {
// 	var sb strings.Builder
// 	// REVIEWME: change to map for fields
// 	strField := ""
// 	for _, f := range msg.Fields {
// 		if strField != "" {
// 			strField += ","
// 		}
// 		// strField += fmt.Sprintf("%s=%g", f.Key, f.Value)
// 	}
// 	sb.WriteString(msg.Name)
// 	sb.WriteString(",")
// 	// sb.WriteString(MapToCommaString(msg.Tags))
// 	sb.WriteString(" ")
// 	// sb.WriteString(MapToCommaString(msg.Fields))
// 	sb.WriteString(strField)
// 	sb.WriteString(" ")
// 	sb.WriteString(strconv.FormatUint(uint64(msg.Timestamp), 10))

// 	// fmt.Printf("MarshalToInflux: %s", sb.String())
// 	return string(sb.String())
// }

func EscapeTag(s string) string {
	s = strings.ReplaceAll(s, " ", "\\ ")
	s = strings.ReplaceAll(s, ",", "\\,")
	s = strings.ReplaceAll(s, "=", "\\=")
	return s
}

func EscapeStringValue(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	s = strings.ReplaceAll(s, "\n", "\\n")
	s = strings.ReplaceAll(s, "\r", "\\r")
	s = strings.ReplaceAll(s, "\t", "\\t")
	return s
}

// convertToString returns (dataType, stringValue)
func ConvertToString(value interface{}) (string, string) {
	switch v := value.(type) {
	case float32:
		return "float", strconv.FormatFloat(float64(v), 'f', -1, 32)
	case float64:
		return "float", strconv.FormatFloat(v, 'f', -1, 64)
	case int:
		return "int", strconv.Itoa(v)
	case int8:
		return "int", strconv.FormatInt(int64(v), 10)
	case int16:
		return "int", strconv.FormatInt(int64(v), 10)
	case int32:
		return "int", strconv.FormatInt(int64(v), 10)
	case int64:
		return "int", strconv.FormatInt(v, 10)
	case uint:
		return "int", strconv.FormatUint(uint64(v), 10)
	case uint8:
		return "int", strconv.FormatUint(uint64(v), 10)
	case uint16:
		return "int", strconv.FormatUint(uint64(v), 10)
	case uint32:
		return "int", strconv.FormatUint(uint64(v), 10)
	case uint64:
		return "int", strconv.FormatUint(v, 10)
	case bool:
		return "bool", strconv.FormatBool(v)
	case []byte:
		return "byte", (hex.EncodeToString(v))
	default:
		return "string", fmt.Sprintf("%v", v)
	}
}

func DiscoverType(value any) string {
	switch value.(type) {
	case float32:
		return "float"
	case float64:
		return "float"
	case int:
		return "int"
	case int8:
		return "int"
	case int16:
		return "int"
	case int32:
		return "int"
	case int64:
		return "int"
	case uint:
		return "int"
	case uint8:
		return "int"
	case uint16:
		return "int"
	case uint32:
		return "int"
	case uint64:
		return "int"
	case bool:
		return "bool"
	case []byte:
		return "byte"
	default:
		return "string"
	}
}

func ShardForDevice(deviceID string, shardCount uint32) uint32 {
	h := fnv.New32a()
	h.Write([]byte(deviceID))
	return h.Sum32() % shardCount
}

func MapToCommaString(m map[string]interface{}) string {
	// fmt.Printf("\n\nMapToCommaString: %v\n", m)
	var sb strings.Builder
	for k, v := range m {
		sb.WriteString(",")
		sb.WriteString(k)
		sb.WriteString("=")
		switch v := v.(type) {
		case string:
			if k == "data" {
				sb.WriteString(`"`)
				sb.WriteString(v)
				sb.WriteString(`"`)
			} else {
				sb.WriteString(v)
			}
		case []byte:
			if k == "data" {
				sb.WriteString(`"`)
				sb.WriteString(hex.EncodeToString(v))
				sb.WriteString(`"`)
			} else {
				sb.WriteString(hex.EncodeToString(v))
			}
		case float64:
			sb.WriteString(strconv.FormatFloat(v, 'f', -1, 64))
		case uint64:
			sb.WriteString(strconv.FormatUint(v, 10))
		case int64:
			sb.WriteString(strconv.FormatInt(int64(v), 10))

		}
	}
	// fmt.Printf("\n\nMapToCommaString ==> %v\n", strings.Replace(sb.String(), ",", "", 1))
	return strings.Replace(sb.String(), ",", "", 1)
}

func HexToBytes(s string) []byte {
	fromHex := [256]byte{
		'0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
		'8': 8, '9': 9, 'a': 10, 'b': 11, 'c': 12, 'd': 13, 'e': 14, 'f': 15,
		'A': 10, 'B': 11, 'C': 12, 'D': 13, 'E': 14, 'F': 15,
	}
	b := make([]byte, 0, len(s)/2)
	for i := 0; i < len(s); i += 2 {
		hi := fromHex[s[i]]
		lo := fromHex[s[i+1]]
		b = append(b, (hi<<4)|lo)
	}
	return b
}

// CONVERT B64 to BYTE
func Base64ToByte(b64 string) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("base64 decode error: %w", err)
	}
	return b, err
}

func mergeKeysAndValues(keys1, keys2 map[string]interface{}) map[string]interface{} {
	merged := make(map[string]interface{})
	for k, v := range keys1 {
		merged[k] = v
	}
	for k, v := range keys2 {
		merged[k] = v
	}
	return merged
}

// Helper function to safely get float64 from metadata
func getFloat64(m map[string]interface{}, key string) (float64, bool) {
	val, ok := m[key]
	if !ok {
		return 0, false
	}

	switch v := val.(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	default:
		return 0, false
	}
}

// Helper function to safely get int from metadata
func getInt(m map[string]interface{}, key string) (int, bool) {
	val, ok := m[key]
	if !ok {
		return 0, false
	}

	switch v := val.(type) {
	case float64:
		return int(v), true
	case int:
		return v, true
	case int64:
		return int(v), true
	default:
		return 0, false
	}
}

// Process metadata dynamically
func ProcessMetadata(metadata map[string]interface{}) {
	fmt.Println("    Metadata field:")

	// Print all field dynamically
	for key, value := range metadata {
		switch v := value.(type) {
		case float64:
			fmt.Printf("      %s: %.2f\n", key, v)
		case int:
			fmt.Printf("      %s: %d\n", key, v)
		case string:
			fmt.Printf("      %s: %s\n", key, v)
		default:
			fmt.Printf("      %s: %v\n", key, v)
		}
	}

	// Example: Check for specific field patterns
	if u0, ok := getFloat64(metadata, "U0"); ok {
		fmt.Printf("    ⚡ Detected electrical data (U0=%.2fV)\n", u0)
	}

	if adp, ok := getFloat64(metadata, "ADP"); ok {
		fmt.Printf("    📈 Detected analog data (ADP=%.2f)\n", adp)
	}
}

// Process message based on type
func ProcessMessage(msgType MessageType, data interface{}) {
	switch msgType {
	case MessageTypeData:
		switch v := data.(type) {
		case []DataMessage:
			fmt.Println("📊 Processing Data Messages (Array):")
			for i, msg := range v {
				fmt.Printf("  Message %d:\n", i)
				fmt.Printf("    Variable: %s\n", msg.Variable)
				fmt.Printf("    Time: %s\n", msg.Time)
				ProcessMetadata(msg.Metadata)
			}
		case DataMessage:
			fmt.Println("📊 Processing Data Message (Single):")
			fmt.Printf("  Variable: %s\n", v.Variable)
			fmt.Printf("  Time: %s\n", v.Time)
			ProcessMetadata(v.Metadata)
		}

	case MessageTypeLog:
		if logMsg, ok := data.(LogMessage); ok {
			fmt.Println("📝 Processing Log Message:")
			fmt.Printf("  ID: %s\n", logMsg.ID)
			fmt.Printf("  Message: %s\n", logMsg.Msg)
		}

	case MessageTypeUnknown:
		fmt.Println("❌ Unknown message type")
	}
	fmt.Println()
}

// Message router
func RouteMessage(jsonStr string) (MessageType, interface{}, error) {
	// Check if it's an array (data messages come as array)
	if jsonStr[0] == '[' {
		var dataMessages []DataMessage
		err := json.Unmarshal([]byte(jsonStr), &dataMessages)
		if err != nil {
			return MessageTypeUnknown, nil, fmt.Errorf("failed to unmarshal data message: %w", err)
		}
		return MessageTypeData, dataMessages, nil
	}

	// Try to unmarshal as object
	var raw map[string]interface{}
	err := json.Unmarshal([]byte(jsonStr), &raw)
	if err != nil {
		return MessageTypeUnknown, nil, fmt.Errorf("failed to unmarshal JSON: %w", err)
	}

	// Check for log message (has "param" field)
	if param, ok := raw["param"].(string); ok && param == "log" {
		var logMsg LogMessage
		err := json.Unmarshal([]byte(jsonStr), &logMsg)
		if err != nil {
			return MessageTypeUnknown, nil, fmt.Errorf("failed to unmarshal log message: %w", err)
		}
		return MessageTypeLog, logMsg, nil
	}

	// Check for data message (has "variable" field)
	if _, ok := raw["variable"]; ok {
		var dataMsg DataMessage
		err := json.Unmarshal([]byte(jsonStr), &dataMsg)
		if err != nil {
			return MessageTypeUnknown, nil, fmt.Errorf("failed to unmarshal data message: %w", err)
		}
		return MessageTypeData, dataMsg, nil
	}

	return MessageTypeUnknown, nil, fmt.Errorf("unknown message type")
}

func FloatToTime(timestamp float64) time.Time {
	// Handle negative timestamps properly
	if timestamp >= 0 {
		sec := int64(timestamp)
		nsec := int64(math.Round((timestamp - float64(sec)) * 1e9))
		return time.Unix(sec, nsec).UTC()
	} else {
		sec := int64(math.Ceil(timestamp)) - 1
		nsec := int64(math.Round((timestamp - float64(sec)) * 1e9))
		return time.Unix(sec, nsec).UTC()
	}
}

func RoundFloat(val float64, precision uint) float64 {
	ratio := math.Pow(10, float64(precision))
	return math.Round(val*ratio) / ratio
}

func StrToInt32(s string) int32 {
	i64, err := strconv.ParseInt(s, 10, 32)
	if err != nil {
		fmt.Printf("StrToInt32: Invalid Conversion")
	}
	return int32(i64)
}

func StrToTimeDuration(s string) time.Duration {
	dur, err := time.ParseDuration(s)
	if err != nil {
		fmt.Printf("StrToTimeDuration: Invalid Conversion")
	}
	return dur
}
