package server

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "github.com/rogeriocassares/zc8/packages/proto/gen/go/telemetry/v1"

	"github.com/InfluxCommunity/influxdb3-go/v2/influxdb3"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser"
)

type Server struct {
	pb.UnimplementedTelemetryServiceServer
	redis     *redis.Client
	influxdb3 *influxdb3.Client
	parser    *parser.Parser
}

func New(redisClient *redis.Client, influxdb3Client *influxdb3.Client) *Server {
	return &Server{
		redis:     redisClient,
		parser:    parser.New(),
		influxdb3: influxdb3Client,
	}
}

type DeviceInfo struct {
	IsActive     bool               `json:"is_active"`
	IsAuthorized bool               `json:"is_authorized"`
	OrgID        string             `json:"org_id"`
	ParseConfig  parser.ParseConfig `json:"parse_config"`
}

func (s *Server) IngestTelemetry(ctx context.Context, in *pb.IngestTelemetryRequest) (*pb.IngestTelemetryResponse, error) {
	// Get device info from Redis
	// deviceInfo, err := s.getDeviceInfo(ctx, in.DeviceId)
	var deviceInfo DeviceInfo
	var err error
	deviceInfo.IsActive = true
	deviceInfo.IsAuthorized = true
	deviceInfo.OrgID = "org123"
	deviceInfo.ParseConfig.Type = "json"
	deviceInfo.ParseConfig.Model = "deviceModel"
	deviceInfo.ParseConfig.Schema = nil
	deviceInfo.ParseConfig.Custom = false

	if err != nil {
		return nil, status.Error(codes.NotFound, err.Error())
	}

	// Check activation
	if !deviceInfo.IsActive {
		return nil, status.Error(codes.PermissionDenied, "device is inactive")
	}

	// Check authorization
	if !deviceInfo.IsAuthorized {
		return nil, status.Error(codes.PermissionDenied, "device not authorized")
	}

	// Parse payload using parser
	parsedData, err := s.parser.Parse(in.Data, deviceInfo.ParseConfig)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, fmt.Sprintf("parse failed: %v", err))
	}

	// parsedData.Fields = map[string]interface{}{
	// 	"raw_data": in.Data}
	parsedData.Tags = map[string]interface{}{
		"deviceId": in.DeviceId}
	// "variable": ks3000_metadata[0].Variable,
	// parsedData.Tags = in.DeviceId

	// Write to Redis Stream
	streamKey := fmt.Sprintf("stream:{%s}:data", deviceInfo.OrgID)
	if err := s.writeToStream(ctx, streamKey, in.DeviceId, *parsedData); err != nil {
		return nil, status.Error(codes.Internal, fmt.Sprintf("failed to write: %v", err))
	}

	// Write to Influxdb3
	// streamKey := fmt.Sprintf("stream:{%s}:data", deviceInfo.OrgID)
	if err := s.writeToInfluxdb3(ctx, streamKey, in.DeviceId, *parsedData); err != nil {
		return nil, status.Error(codes.Internal, fmt.Sprintf("failed to write: %v", err))
	}

	return &pb.IngestTelemetryResponse{
		Success: true,
		// Message:   "Data ingested successfully",
		// StreamKey: streamKey,
	}, nil
}

func (s *Server) getDeviceInfo(ctx context.Context, deviceId string) (*DeviceInfo, error) {
	key := fmt.Sprintf("device:%s", deviceId)
	data, err := s.redis.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, fmt.Errorf("device not found")
	} else if err != nil {
		return nil, err
	}

	var deviceInfo DeviceInfo
	if err := json.Unmarshal([]byte(data), &deviceInfo); err != nil {
		return nil, err
	}

	return &deviceInfo, nil
}

func (s *Server) writeToStream(ctx context.Context, streamKey, deviceId string, data parser.ParsedData) error {
	// dataJSON, _ := json.Marshal(data)
	dataJSON := parser.MarshalToJson(data)

	_, err := s.redis.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey,
		Values: map[string]interface{}{
			"device_id": deviceId,
			"timestamp": time.Now().Unix(),
			"data":      string(dataJSON),
		},
	}).Result()

	fmt.Printf("Message wrote to redis: %v", dataJSON)

	return err
}

func (s *Server) writeToInfluxdb3(ctx context.Context, influxdb3Client, deviceId string, data parser.ParsedData) error {
	dataInflux := parser.MarshalToInflux(data)

	err := s.influxdb3.Write(context.Background(), []byte(dataInflux))

	if err != nil {
		panic(err)
	}

	fmt.Printf("Message wrote to redis: %v", dataInflux)

	return err
}

// Write to Influxdb
// func WriteLineProtocol() error {
// 	url := "https://us-east-1-1.aws.cloud2.influxdata.com"
// 	token := os.Getenv("INFLUX_TOKEN")
// 	database := os.Getenv("INFLUX_DATABASE")

// 	client, err := influx.New(influx.Configs{
// 		HostURL:   url,
// 		AuthToken: token,
// 	})

// 	defer func(client *influx.Client) {
// 		err := client.Close()
// 		if err != nil {
// 			panic(err)
// 		}
// 	}(client)

// 	record := "home,room=Living\\ Room temp=22.2,hum=36.4,co=17i"
// 	fmt.Println("Writing record: ", record)
// 	err = client.Write(context.Background(), database, []byte(record))

// 	if err != nil {
// 		panic(err)
// 	}
// 	return nil
// }
