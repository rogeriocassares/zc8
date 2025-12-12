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

	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser"
)

type Server struct {
	pb.UnimplementedTelemetryServiceServer
	redis  *redis.Client
	parser *parser.Parser
}

func New(redisClient *redis.Client) *Server {
	return &Server{
		redis:  redisClient,
		parser: parser.New(),
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
	deviceInfo.ParseConfig.Schema = nil

	if err != nil {
		return nil, status.Error(codes.NotFound, err.Error())
	}

	// Check authentication
	if !deviceInfo.IsActive {
		return nil, status.Error(codes.PermissionDenied, "device is inactive")
	}

	if !deviceInfo.IsAuthorized {
		return nil, status.Error(codes.PermissionDenied, "device not authorized")
	}

	// Parse payload using parser
	parsedData, err := s.parser.Parse(in.Data, deviceInfo.ParseConfig)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, fmt.Sprintf("parse failed: %v", err))
	}

	// Write to Redis Stream
	streamKey := fmt.Sprintf("stream:{%s}:data", deviceInfo.OrgID)
	if err := s.writeToStream(ctx, streamKey, in.DeviceId, parsedData); err != nil {
		return nil, status.Error(codes.Internal, fmt.Sprintf("failed to write: %v", err))
	}

	return &pb.IngestTelemetryResponse{
		Success: true,
		// Message:   "Data ingested successfully",
		// StreamKey: streamKey,
	}, nil
}

func (s *Server) getDeviceInfo(ctx context.Context, deviceID string) (*DeviceInfo, error) {
	key := fmt.Sprintf("device:%s", deviceID)
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

func (s *Server) writeToStream(ctx context.Context, streamKey, deviceID string, data interface{}) error {
	dataJSON, _ := json.Marshal(data)

	_, err := s.redis.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey,
		Values: map[string]interface{}{
			"device_id": deviceID,
			"timestamp": time.Now().Unix(),
			"data":      string(dataJSON),
		},
	}).Result()

	fmt.Printf("Message wrote to redis: %v", dataJSON)

	return err
}
