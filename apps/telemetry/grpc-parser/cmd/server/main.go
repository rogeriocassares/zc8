package main

import (
	"encoding/base64"
	"encoding/json"

	// "flag"
	"fmt"
	"log"
	"net"
	"strconv"
	"strings"

	// "time"

	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/config"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/redis"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/server"
	pb "github.com/rogeriocassares/zc8/packages/proto/gen/go/telemetry/v1"

	"google.golang.org/grpc"
)

// var (
// 	port = flag.Int("port", 50054, "The server port")
// )

// type Input struct {
// 	Tags   InputTags
// 	Fields InputFields
// }

type Output struct {
	Name      string                 `json:"name"`
	Fields    map[string]interface{} `json:"fields"`
	Tags      map[string]interface{} `json:"tags"`
	Timestamp uint64                 `json:"timestamp"`
}

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

// MessageType enum
type MessageType int

const (
	MessageTypeUnknown MessageType = iota
	MessageTypeData
	MessageTypeLog
)

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
	fmt.Println("    Metadata fields:")

	// Print all fields dynamically
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

// server is used to implement helloworld.GreeterServer.
// type server struct {
// 	pb.UnimplementedTelemetryServiceServer
// 	redis *redis.Client
// }

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

func marshalToJson(msg Output) string {
	outputMsgJson, _ := json.Marshal(msg)
	// if err != nil {
	// 	fmt.Println(err.Error())
	// }
	return string(outputMsgJson[:])
}

func marshalToInflux(msg Output) string {
	var sb strings.Builder
	sb.WriteString(msg.Name)
	sb.WriteString(",")
	sb.WriteString(mapToCommaString(msg.Tags))
	sb.WriteString(" ")
	sb.WriteString(mapToCommaString(msg.Fields))
	sb.WriteString(" ")
	sb.WriteString(strconv.FormatUint(uint64(msg.Timestamp), 10))

	return string(sb.String())
}

func b64ToByte(b64 string) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		log.Fatal(err)
	}
	return b, err
}

// B64 to Byte
// b, err := b64ToByte(canData)
// if err != nil {
// 	// fmt.Print(data)
// 	log.Panic(err)
// }

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

// func parse(deviceId string, data []byte) Output {
// 	// var tags map[string]interface{}
// 	var output Output
// 	// log.Printf("deviceId: %v, data: %v", deviceId, data)

// 	// READ FROM REDIS HERE WHAT IS IMPORTANT TO PARSE THE data: "deviceModel"
// 	// deviceId: 019b08df-26e7-7506-a5f6-916b2bef24f4, deviceModel: ks3000, measurement: instant, deviceSerial: 491028
// 	// deviceId: 019b08df-26e7-71b5-8df6-56c2e954ac91, deviceModel: ks3000, measurement: instant, deviceSerial: 2515111
// 	// deviceId: 019b08df-26e7-7119-97da-523f9236db80, deviceModel: ks3000, measurement: instant, deviceSerial: 2515112
// 	// deviceId: 019b08df-26e7-7f7b-a18f-b3d6c3fdf248, deviceModel: ks3000, measurement: instant, deviceSerial: 2515113
// 	// deviceId: 019b08df-26e7-7866-a0fb-1768122b8584, deviceModel: ks3000, measurement: instant, deviceSerial: 2515114

// 	deviceModel := "ks3000"

// 	switch deviceModel {
// 	// unstrucrured datas

// 	// Kron
// 	case "ks3000":
// 		// Identify the data by keys
// 		// [{"variable": "data","time":"2025-12-10 21:24:08","metadata":{"U0":215.32,"I0":1.28,"F1":60.02,"P0":476.53,"Q0":-15.86,"S0":476.80,"FP0":1.00,"CE":0}}]
// 		if "variable" == "data" {
// 			// TODO: Analyze metadata fields. If contains U0, I0, F1, P0, Q0, S0, FP0, CE then it's from ks3000 instant measurment table in influxdb
// 		}

// 		fmt.Printf("\n=== Processing Message ===\n")

// 		// msgType, data, err := RouteMessage(data)
// 		// if err != nil {
// 		// 	log.Printf("Error routing message: %v\n", err)
// 		// 	// continue
// 		// }

// 		// ProcessMessage(msgType, data)

// 		// structured datas

// 		// // AspectMidia
// 		// case "am19_smartlight":
// 		// case "am19_counter":
// 		// case "am19_milkfat":
// 		// // Milesight
// 		// case "em410_rdl":
// 		// case "em103":
// 		// case "ct310":

// 		// Khomp

// 		// SagaMedicao

// 	}

// 	// Marshal InputMsg.Data interface{} to Json string represented in bytes
// 	// inputMsgData, _ := json.Marshal(input.Fields.Data)

// 	// comment
// 	//inputMsgData := input.Fields.Data

// 	// fmt.Printf("inputMsgData: ", inputMsgData)

// 	// if message == "" {
// 	// 	return "No message to parse"
// 	// }

// 	// comment
// 	// if input.Tags.Direction == "up" {
// 	// 	tags = map[string]interface{}{
// 	// 		"deviceType": input.Tags.DeviceType,
// 	// 		"deviceId":   input.Tags.DeviceId,
// 	// 		"direction":  input.Tags.Direction,
// 	// 		"origin":     input.Tags.Etc,
// 	// 	}

// 	// 	switch input.Tags.DeviceType {
// 	// 	case "Car":
// 	// 		switch input.Tags.Measurement {

// 	// 		case "Can":
// 	// 			s := strings.Split(inputMsgData, ",")
// 	// 			canId := s[0]
// 	// 			canData := s[1]

// 	// 			// B64 to Byte
// 	// 			b, err := b64ToByte(canData)
// 	// 			if err != nil {
// 	// 				// fmt.Print(data)
// 	// 				log.Panic(err)
// 	// 			}

// 	// 			var carCanData CarCanData
// 	// 			d := protocolParserCanDataByCanId(canId, b)
// 	// 			json.Unmarshal([]byte(d), &carCanData)

// 	// 			var sbCanData strings.Builder
// 	// 			sbCanData.WriteString(`"`)
// 	// 			sbCanData.WriteString(canData)
// 	// 			sbCanData.WriteString(`"`)

// 	// 			if canId == "5" {
// 	// 				var carCan5 CarCan5
// 	// 				carCan5.GroundSpeed = carCanData.GroundSpeed
// 	// 				carCan5.Gear = carCanData.Gear
// 	// 				carCan5.ThrottlePosition = carCanData.ThrottlePosition
// 	// 				carCan5.BrakePressureFront = carCanData.BrakePressureFront

// 	// 				tags := map[string]interface{}{
// 	// 					"deviceType": input.Tags.DeviceType,
// 	// 					"canId":      canId,
// 	// 					"message":    "CarCan5",
// 	// 				}
// 	// 				fields := map[string]interface{}{
// 	// 					// "data":        sbCanData.String(),
// 	// 					"data":               canData,
// 	// 					"groundSpeed":        carCan5.GroundSpeed,
// 	// 					"gear":               carCan5.Gear,
// 	// 					"throttlePosition":   carCan5.ThrottlePosition,
// 	// 					"brakePressureFront": carCan5.BrakePressureFront,
// 	// 				}
// 	// 				output.Tags = tags
// 	// 				output.Fields = fields
// 	// 			}

// 	// 		}
// 	// 	}
// 	// }

// 	// fmt.Printf("\n@@@@@@inputTags %v", input.Tags)
// 	// fmt.Printf("\n@@@@@@inputFields: %v", input.Fields)
// 	// fmt.Printf("\n@@@@@@inputMsgData: %v", inputMsgData)
// 	// fmt.Printf("\n")

// 	// fmt.Printf("\n")
// 	// fmt.Printf("\n+++++++++parsedTags: %v", output.Tags)
// 	// fmt.Printf("\n+++++++++parsedFields: %v", output.Fields)

// 	// mergedTags := mergeKeysAndValues(tags, output.Tags)

// 	// Timestamp_ns
// 	// now := time.Now()      // current local time
// 	// nsec := now.UnixNano() // number of nanoseconds since January 1, 1970 UTC

// 	// output.Name = input.Tags.Measurement
// 	// output.Tags = mergedTags
// 	// // output.Fields = parsedFields
// 	// output.Timestamp = uint64(nsec)

// 	return output
// }

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

// Initialize Redis connection
// func newRedisClient() *redis.Client {
// 	rdb := redis.NewClient(&redis.Options{
// 		Addr:         "localhost:6379",
// 		Password:     "",
// 		DB:           0,
// 		PoolSize:     20,
// 		MinIdleConns: 5,
// 		DialTimeout:  5 * time.Second,
// 		ReadTimeout:  3 * time.Second,
// 		WriteTimeout: 3 * time.Second,
// 	})

// 	// Test connection
// 	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
// 	defer cancel()

// 	if err := rdb.Ping(ctx).Err(); err != nil {
// 		log.Fatal("Failed to connect to Redis:", err)
// 	}

// 	log.Println("Connected to Redis successfully")
// 	return rdb
// }

// func (s *server) getDeviceInfoCached(ctx context.Context, deviceId string) (*DeviceInfo, error) {
// 	// Check memory cache (e.g., sync.Map or groupcache)
// 	if cached, ok := s.deviceCache.Get(deviceId); ok {
// 		return cached.(*DeviceInfo), nil
// 	}

// 	// Cache miss - fetch from Redis
// 	deviceInfo, err := s.getDeviceInfoFromRedis(ctx, deviceId)
// 	if err != nil {
// 		return nil, err
// 	}

// 	// Cache for 5 minutes
// 	s.deviceCache.SetWithTTL(deviceId, deviceInfo, 5*time.Minute)
// 	return deviceInfo, nil
// }

// func (s *server) getDeviceInfo(ctx context.Context, deviceID string) (*DeviceInfo, error) {
// 	key := fmt.Sprintf("device:%s", deviceID)

// 	// Get JSON data from Redis
// 	data, err := s.redis.Get(ctx, key).Result()
// 	if err == redis.Nil {
// 		return nil, fmt.Errorf("device not found")
// 	} else if err != nil {
// 		return nil, fmt.Errorf("redis error: %w", err)
// 	}

// 	// Parse JSON
// 	var deviceInfo DeviceInfo
// 	if err := json.Unmarshal([]byte(data), &deviceInfo); err != nil {
// 		return nil, fmt.Errorf("failed to parse device info: %w", err)
// 	}

// 	return &deviceInfo, nil
// }

// SendMessageToServer implements helloworld.GreeterServerS
// func (s *server) IngestTelemetry(ctx context.Context, in *pb.IngestTelemetryRequest) (*pb.IngestTelemetryResponse, error) {
// 	// TODO: 1 - Authenticate: "Does this deviceId exist and is it active?" RETURN ERROR IF NOT
// 	// TODO: 2.- Authorize: "Is this organization allowed to write?"
// 	// TODO: 3 - Fetch parsing config for this deviceId

// 	deviceInfo, err := s.getDeviceInfo(ctx, in.DeviceId)
// 	if err != nil {
// 		return nil, status.Error(codes.NotFound, err.Error())
// 	}

// 	// Check authentication
// 	if !deviceInfo.IsActive {
// 		return nil, status.Error(codes.PermissionDenied, "device is inactive")
// 	}

// 	if !deviceInfo.IsAuthorized {
// 		return nil, status.Error(codes.PermissionDenied, "device not authorized")
// 	}

// 	// Parse with config
// 	parsedData, err := s.parse(in.Data, deviceInfo.ParseConfig)
// 	if err != nil {
// 		return nil, status.Error(codes.InvalidArgument, fmt.Sprintf("parse failed: %v", err))
// 	}
// 	// Write to Redis
// 	// Write parsed data to Redis Stream
// 	streamKey := fmt.Sprintf("stream:{%s}:data", deviceInfo.OrgID)
// 	messageID, err := s.writeToStream(ctx, streamKey, in.DeviceId, parsedData)
// 	if err != nil {
// 		return nil, status.Error(codes.Internal, fmt.Sprintf("failed to write to stream: %v", err))
// 	}

// 	return &pb.IngestTelemetryResponse{
// 		Success: true,
// 		// Message:   "Data ingested successfully",
// 		// StreamKey: streamKey,
// 	}, nil
// 	// return s.writeToStream(ctx, in.DeviceId, parsedData)
// 	// s.writeToStream(ctx, in.DeviceId, parsedData)

// 	// output := parse(in.DeviceId, in.Data)
// 	// parse(in.DeviceId, string(in.Data))
// 	// log.Printf("\n=======>output: %v", output)

// 	// outputJson := marshalToJson(output)
// 	// outputInflux := marshalToInflux(output)
// 	// log.Printf("\noutputJson: %v", outputJson)
// 	// log.Printf("\noutputInflux: %v", outputInflux)

// 	// return &pb.IngestTelemetryResponse{Success: true}, nil
// }

// Write to Redis Stream
// func (s *server) writeToStream(ctx context.Context, streamKey, deviceID string, data map[string]interface{}) (string, error) {
// 	// Convert parsed data to Redis stream format
// 	values := map[string]interface{}{
// 		"device_id": deviceID,
// 		"timestamp": time.Now().Unix(),
// 		"data":      mustJSON(data),
// 	}

// 	// Add to stream with XADD
// 	messageID, err := s.redis.XAdd(ctx, &redis.XAddArgs{
// 		Stream: streamKey,
// 		Values: values,
// 	}).Result()

// 	if err != nil {
// 		return "", err
// 	}

// 	return messageID, nil
// }

// Parse payload based on config
func parsePayload(rawPayload []byte, config ParseConfig) (map[string]interface{}, error) {
	var result map[string]interface{}

	switch config.Type {
	case "json":
		if err := json.Unmarshal(rawPayload, &result); err != nil {
			return nil, fmt.Errorf("json parse error: %w", err)
		}

	case "binary":
		// Custom binary parsing logic based on schema
		result = parseBinaryData(rawPayload, config.Schema)

	default:
		return nil, fmt.Errorf("unsupported parse type: %s", config.Type)
	}

	return result, nil
}

func parseBinaryData(data []byte, schema json.RawMessage) map[string]interface{} {
	// Implement your binary parsing logic here
	return map[string]interface{}{
		"raw": data,
	}
}

func mustJSON(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func main() {
	// Load configuration
	cfg := config.Load()

	// Initialize Redis
	redisClient := redis.NewClient(&cfg.Redis)
	defer redisClient.Close()

	// Create gRPC server
	addr := cfg.Server.Host + ":" + cfg.Server.Port
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	s := grpc.NewServer()
	pb.RegisterTelemetryServiceServer(s, server.New(redisClient))

	log.Printf("server listening at %v", lis.Addr())
	if err := s.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}
