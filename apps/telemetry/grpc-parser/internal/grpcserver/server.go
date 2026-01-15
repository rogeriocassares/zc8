package grpcserver

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/InfluxCommunity/influxdb3-go/v2/influxdb3"
	"github.com/redis/go-redis/v9"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/util"
	pb "github.com/rogeriocassares/zc8/packages/proto/gen/go/telemetry/v1"

	// _ "github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser"
	// _ "github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser/binary/kron"
	_ "github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser/kron"
	_ "github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser/milesight"
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
	TeamID       string             `json:"team_id"`
	ParseConfig  parser.ParseConfig `json:"parse_config"`
}

func (s *Server) IngestTelemetry(ctx context.Context, in *pb.IngestTelemetryRequest) (*pb.IngestTelemetryResponse, error) {

	// fmt.Printf("\nMessage received: %v", in.Data)
	fmt.Printf("\nDevice received: %v", in.DeviceId)
	// Get device info from Redis
	// deviceInfo, err := s.getDeviceInfo(ctx, in.DeviceId)
	var deviceInfo DeviceInfo

	deviceInfo.IsActive = true
	deviceInfo.IsAuthorized = true
	deviceInfo.OrgID = "org123"
	deviceInfo.TeamID = "team123"
	deviceInfo.ParseConfig.Direction = "uplink"

	switch in.DeviceId {
	case "019b76c4-d38a-7eba-9036-3586652112a4":
		deviceInfo.ParseConfig.Vendor = "agent"
		deviceInfo.ParseConfig.Model = "ping"

	case "019b08df-26e7-7506-a5f6-916b2bef24f4",
		"019b08df-26e7-71b5-8df6-56c2e954ac91",
		"019b08df-26e7-7119-97da-523f9236db80",
		"019b08df-26e7-7f7b-a18f-b3d6c3fdf248",
		"019b08df-26e7-7866-a0fb-1768122b8584":
		deviceInfo.ParseConfig.Vendor = "kron"
		deviceInfo.ParseConfig.Model = "ks3000_wifi"

	case "24e124136f315508":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em300_di"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"

		in.DeviceId = "019b9ade-55a0-746e-8d41-b2537631441c"

	case "24e124126d284622":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em500_swl"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"

		in.DeviceId = "019b9ae2-fc84-7396-9ea8-fd2a041b7664"

	case "24e124535f318437":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "ws101"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"

		in.DeviceId = "019b9ae3-337e-7fa0-9b72-3861f0e6c6bd"

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
	parsedData, err := s.parser.Parse(deviceInfo.ParseConfig, in.Data)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, fmt.Sprintf("parse failed: %v", err))
	}

	parsedData.Tags["device_id"] = in.DeviceId

	// Write to Redis Stream
	streamKey := fmt.Sprintf("stream:{%s}:data", deviceInfo.OrgID)
	if err := s.writeToRedisStream(ctx, streamKey, in.DeviceId, *parsedData); err != nil {
		return nil, status.Error(codes.Internal, fmt.Sprintf("failed to write: %v", err))
	}

	// Write to Influxdb3
	if err := s.writeToInfluxdb3(ctx, *parsedData); err != nil {
		return nil, status.Error(codes.Internal, fmt.Sprintf("failed to write: %v", err))
	}

	return &pb.IngestTelemetryResponse{
		Success: true,
		// Message:   "Data ingested successfully",
		// StreamKey: streamKey,
	}, nil
}

// func (s *Server) getDeviceInfo(ctx context.Context, deviceId string) (*DeviceInfo, error) {
// 	key := fmt.Sprintf("device:%s", deviceId)
// 	data, err := s.redis.Get(ctx, key).Result()
// 	if err == redis.Nil {
// 		return nil, fmt.Errorf("device not found")
// 	} else if err != nil {
// 		return nil, err
// 	}

// 	var deviceInfo DeviceInfo
// 	if err := json.Unmarshal([]byte(data), &deviceInfo); err != nil {
// 		return nil, err
// 	}

// 	return &deviceInfo, nil
// }

func (s *Server) writeToRedisStream(ctx context.Context, streamKey, deviceId string, data util.ParsedData) error {
	// dataJSON, _ := json.Marshal(data)
	dataJSON := util.MarshalToJson(data)

	if dataJSON == "" {
		return fmt.Errorf("no data written to Redis, errors encountered. No fields were provided")
	}

	_, err := s.redis.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey,
		Values: map[string]interface{}{
			"device_id": deviceId,
			"timestamp": time.Now().Unix(),
			"data":      string(dataJSON),
		},
	}).Result()

	fmt.Printf("\nMessage wrote to redis: %v\n", dataJSON)

	return err
}

func (s *Server) writeToInfluxdb3(ctx context.Context, data util.ParsedData) error {
	dataInflux := util.MarshalToInflux(data)

	if dataInflux == "" {
		return fmt.Errorf("no data written to Influxdb, errors encountered. No fields were provided")
	}

	// err := s.influxdb3.Write(context.Background(), []byte(dataInflux))
	err := s.influxdb3.Write(ctx, []byte(dataInflux))

	if err != nil {
		fmt.Printf("\nError writing to InfluxDB: %v", err)
		return err
	}

	fmt.Printf("\nMessage wrote to influxdb3: %v", dataInflux)
	fmt.Printf("\n--------------------------------------\n\n")

	return err
}
