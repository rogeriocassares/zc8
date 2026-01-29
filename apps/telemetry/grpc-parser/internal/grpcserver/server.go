package grpcserver

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/InfluxCommunity/influxdb3-go/v2/influxdb3"
	"github.com/dgraph-io/ristretto"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/postgres"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/util"
	pb "github.com/rogeriocassares/zc8/packages/proto/gen/go/telemetry/v1"

	_ "github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser/agent"
	_ "github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser/aspect"
	_ "github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser/kron"
	_ "github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser/milesight"
)

type Server struct {
	pb.UnimplementedTelemetryServiceServer
	redis      *redis.Client
	postgres   *postgres.Client
	influxdb3  *influxdb3.Client
	parser     *parser.Parser
	localCache *ristretto.Cache // Local in-memory cache
	devicePool *sync.Pool       // Object pooling
}

// func NewServer(redisClient *redis.Client, postgresClient *postgres.Client, influxdb3Client *influxdb3.Client) *Server {
func NewServer(redisClient *redis.Client, influxdb3Client *influxdb3.Client) *Server {
	// Initialize Ristretto cache (high-performance local cache)
	cache, err := ristretto.NewCache(&ristretto.Config{
		NumCounters: 1e7,     // 10M counters
		MaxCost:     1 << 30, // 1GB max memory
		BufferItems: 64,
	})
	if err != nil {
		return nil
	}

	return &Server{
		redis: redisClient,
		// postgres:   postgresClient,
		parser:     parser.NewServer(),
		influxdb3:  influxdb3Client,
		localCache: cache,
		devicePool: &sync.Pool{
			New: func() interface{} {
				return &DeviceInfo{}
			},
		},
	}
}

type DeviceInfo struct {
	IsActive     bool               `json:"is_active"`
	IsAuthorized bool               `json:"is_authorized"`
	TenantID     string             `json:"tenant_id"`
	TeamID       string             `json:"team_id"`
	ParseConfig  parser.ParseConfig `json:"parse_config"`
}

func (s *Server) validateDeviceInCacheOrDB(ctx context.Context, deviceID string) (bool, error) {
	// 1. Check Redis first
	val, err := s.redis.Get(ctx, "auth:"+deviceID).Result()
	if err == nil {
		valid := val == "true"
		return valid, nil
	}
	if err != redis.Nil {
		return false, err // Redis error
	}

	// // 2. Fallback to PostgreSQL
	// valid, err := validateDeviceInDB(deviceID)
	// if err != nil {
	// 	return false, err
	// }
	// bypass:
	valid := true

	// 3. Cache result (even if false)
	status := "false"
	if valid {
		status = "true"
	}
	s.redis.Set(ctx, "auth:"+deviceID, status, time.Hour)

	return valid, nil
}

func (s *Server) IngestTelemetry(ctx context.Context, in *pb.IngestTelemetryRequest) (*pb.IngestTelemetryResponse, error) {
	// Fast validation
	if in.DeviceId == "" {
		return nil, status.Error(codes.InvalidArgument, "device_id is required")
	}
	// Get device info with multi-tier caching
	// deviceInfo, err := s.getDeviceInfoCached(ctx, in.DeviceId)
	// if err != nil {
	// 	return nil, status.Error(codes.NotFound, fmt.Sprintf("device not found: %v", err))
	// }

	// fmt.Printf("\nMessage received: %v", in.Data)
	// fmt.Printf("\nDevice received: %v", in.DeviceId)
	// Get device info from Redis
	// deviceInfo, err := s.getDeviceInfo(ctx, in.DeviceId)
	var deviceInfo DeviceInfo
	// Redis Stream key
	// {tenant_id}:event:{device_id}:{event_type}:public
	// acme:event:24e124136f315508:up:public
	// up: Uplink application data (e.g., sensor readings)
	// join: Device joined the network
	// ack: Downlink acknowledgment received
	// status: Battery, signal margin, or device health
	// error: Payload or scheduling error

	deviceInfo.IsActive = true
	deviceInfo.IsAuthorized = true
	deviceInfo.TenantID = "org123"
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
		deviceInfo.ParseConfig.Model = "ks3000"

	// ks3000_lora
	// 	case "":
	// 		deviceInfo.ParseConfig.Vendor = "milesight"
	// 		deviceInfo.ParseConfig.Model = "ks3000"
	// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 		in.DeviceId = "019be702-190b-7d8d-b057-4b6ab585792c"

	// case "":
	// 		deviceInfo.ParseConfig.Vendor = "milesight"
	// 		deviceInfo.ParseConfig.Model = "ks3000"
	// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 		in.DeviceId = "019be702-190b-764a-9dbf-d28c33b11b3d"

	// case "":
	// 		deviceInfo.ParseConfig.Vendor = "milesight"
	// 		deviceInfo.ParseConfig.Model = "ks3000"
	// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 		in.DeviceId = "019be702-190b-7bc0-83f2-48660dc8681b"

	// case "":
	// 		deviceInfo.ParseConfig.Vendor = "milesight"
	// 		deviceInfo.ParseConfig.Model = "ks3000"
	// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 		in.DeviceId = "019be702-190b-7128-970e-9a8bc4c31c76"

	// case "":
	// 		deviceInfo.ParseConfig.Vendor = "milesight"
	// 		deviceInfo.ParseConfig.Model = "ks3000"
	// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 		in.DeviceId = "019be702-190b-704e-ba39-dafbcfa73c02"

	// case "":
	// 		deviceInfo.ParseConfig.Vendor = "milesight"
	// 		deviceInfo.ParseConfig.Model = "ks3000"
	// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 		in.DeviceId = "019be702-190b-73b3-a8dc-3830751b3bd8"

	// case "":
	// 		deviceInfo.ParseConfig.Vendor = "milesight"
	// 		deviceInfo.ParseConfig.Model = "ks3000"
	// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 		in.DeviceId = "019be702-190b-78be-ad3f-599935f7745c"

	// em300_di
	case "24e124136f315508":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em300_di"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		in.DeviceId = "019b9ade-55a0-746e-8d41-b2537631441c"

	case "24e124136f483595":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em300_di"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		in.DeviceId = "019be6fa-0dee-729a-84c8-e468fd11af62"

	case "24e124136f484497":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em300_di"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		in.DeviceId = "019be6fa-0dee-7c6c-b791-6cfec79a3429"

	case "24e124136f484616":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em300_di"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		in.DeviceId = "019be6fa-0dee-72bf-9e40-96939916414e"

	// case "":
	// 	deviceInfo.ParseConfig.Vendor = "milesight"
	// 	deviceInfo.ParseConfig.Model = "em300_di"
	// 	deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 	in.DeviceId = "019be6fa-6531-7d2a-b8f6-4585bbe3e51d"

	// case "":
	// 	deviceInfo.ParseConfig.Vendor = "milesight"
	// 	deviceInfo.ParseConfig.Model = "em300_di"
	// 	deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 	in.DeviceId = "019be6fa-6531-72a3-a122-41815bec2f1e"

	// case "":
	// 	deviceInfo.ParseConfig.Vendor = "milesight"
	// 	deviceInfo.ParseConfig.Model = "em300_di"
	// 	deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 	in.DeviceId = "019be6fa-6531-755a-a7eb-95ccaa586305"

	// em500_swl
	case "24e124126d284622":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em500_swl"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		in.DeviceId = "019b9ae2-fc84-7396-9ea8-fd2a041b7664"

	case "24e124126f422301":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em500_swl"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		in.DeviceId = "019be6eb-b5bb-7fbf-ba3b-3101febc1129"

	case "24e124126f422693":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em500_swl"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		in.DeviceId = "019be6eb-b5bc-780a-a53e-0859edf1bf0a"

	case "24e124126f427639":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em500_swl"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		in.DeviceId = "019be6eb-b5bc-7669-af5c-488132dceadb"

	case "24e124126f427690":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em500_swl"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		in.DeviceId = "019be6eb-b5bc-77de-b058-9d4a78419e1a"

	case "24e124126f422141":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em500_swl"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		in.DeviceId = "019be6eb-b5bc-7751-839b-c05990ec0ea6"

	case "24e124126f427556":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em500_swl"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		in.DeviceId = "019be6eb-b5bc-7cb8-9ed1-1467f311ebf8"

	case "24e124126f427781":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em500_swl"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		in.DeviceId = "019be6eb-b5bc-7904-a84c-3bd0d9e304c7"

	case "24e124126f427831":
		deviceInfo.ParseConfig.Vendor = "milesight"
		deviceInfo.ParseConfig.Model = "em500_swl"
		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		in.DeviceId = "019be6eb-b5bc-75fb-8688-0cf22c21eb49"

	// ws101
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
	streamKey := fmt.Sprintf("stream:{%s}:data", deviceInfo.TenantID)
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

// func (s *Server) getDeviceInfo(ctx context.Context, deviceID string) (*DeviceInfo, error) {
// 	key := fmt.Sprintf("device:%s", deviceID)
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

// Optimized Redis stream write with pipelining
func (s *Server) writeToRedisStream(ctx context.Context, streamKey, deviceID string, data util.ParsedData) error {
	dataJSON := util.MarshalToJson(data)

	if dataJSON == "" {
		return fmt.Errorf("no data written to Redis, errors encountered. No fields were provided")
	}

	pipe := s.redis.Pipeline()

	values := map[string]interface{}{
		"device_id": deviceID,
		"data":      string(dataJSON), // Serialize as needed
		"timestamp": time.Now().Unix(),
	}

	pipe.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey,
		MaxLen: 10000, // Optional: limit stream size
		Approx: true,
		Values: values,
	})

	_, err := pipe.Exec(ctx)
	fmt.Printf("\nMessage wrote to redis: %v\n", dataJSON)

	return err
}

// func (s *Server) writeToRedisStream(ctx context.Context, streamKey, deviceID string, data util.ParsedData) error {
// 	// dataJSON, _ := json.Marshal(data)

// 	_, err := s.redis.XAdd(ctx, &redis.XAddArgs{
// 		Stream: streamKey,
// 		Values: map[string]interface{}{
// 			"device_id": deviceID,
// 			"timestamp": time.Now().Unix(),
// 			"data":      string(dataJSON),
// 		},
// 	}).Result()

// 	fmt.Printf("\nMessage wrote to redis: %v\n", dataJSON)

// 	return err
// }

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

// Multi-tier caching: L1 (local) -> L2 (Redis) -> L3 (PostgreSQL)
func (s *Server) getDeviceInfoCached(ctx context.Context, deviceID string) (*DeviceInfo, error) {
	cacheKey := "device:" + deviceID

	// L1: Check local in-memory cache (nanoseconds)
	if val, found := s.localCache.Get(cacheKey); found {
		return val.(*DeviceInfo), nil
	}

	// L2: Check Redis (microseconds)
	deviceInfo, err := s.getDeviceInfoFromRedis(ctx, cacheKey)
	if err == nil {
		// Store in local cache (5-minute TTL)
		s.localCache.SetWithTTL(cacheKey, deviceInfo, 1, 5*time.Minute)
		return deviceInfo, nil
	}
	if err != redis.Nil {
		// Redis error, but continue to DB
		// Log error but don't fail
	}

	// L3: Fallback to PostgreSQL (milliseconds)
	deviceInfo, err = s.getDeviceInfoFromDB(ctx, deviceID)
	if err != nil {
		return nil, err
	}

	// Async cache warming (don't block the response)
	go s.warmCache(context.Background(), cacheKey, deviceInfo)

	return deviceInfo, nil
}

func (s *Server) getDeviceInfoFromRedis(ctx context.Context, cacheKey string) (*DeviceInfo, error) {
	val, err := s.redis.Get(ctx, cacheKey).Result()
	if err != nil {
		return nil, err
	}

	deviceInfo := s.devicePool.Get().(*DeviceInfo)
	if err := json.Unmarshal([]byte(val), deviceInfo); err != nil {
		s.devicePool.Put(deviceInfo)
		return nil, err
	}

	return deviceInfo, nil
}

// The pool automatically handles statement preparation
// Just use QueryRow directly - pgx caches prepared statements automatically
func (s *Server) getDeviceInfoFromDB(ctx context.Context, deviceID string) (*DeviceInfo, error) {
	deviceInfo := &DeviceInfo{}

	var parseConfigJSON []byte

	err := s.postgres.QueryRow(ctx, `
		SELECT is_active, is_authorized, tenant_id, team_id, parse_config
		FROM devices
		WHERE device_id = $1
	`, deviceID).Scan(
		&deviceInfo.IsActive,
		&deviceInfo.IsAuthorized,
		&deviceInfo.TenantID,
		&deviceInfo.TeamID,
		&parseConfigJSON,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("device not found")
		}
		return nil, err
	}

	if len(parseConfigJSON) > 0 {
		if err := json.Unmarshal(parseConfigJSON, &deviceInfo.ParseConfig); err != nil {
			return nil, err
		}
	}

	return deviceInfo, nil
}

func (s *Server) warmCache(ctx context.Context, cacheKey string, deviceInfo *DeviceInfo) {
	// Store in local cache
	s.localCache.SetWithTTL(cacheKey, deviceInfo, 1, 5*time.Minute)

	// Store in Redis with 1-hour TTL
	data, err := json.Marshal(deviceInfo)
	if err != nil {
		return
	}
	s.redis.Set(ctx, cacheKey, data, time.Hour)
}

// Optional: Batch prefetch for known hot devices
func (s *Server) PrefetchHotDevices(ctx context.Context, deviceIDs []string) {
	for _, deviceID := range deviceIDs {
		go func(id string) {
			s.getDeviceInfoCached(ctx, id)
		}(deviceID)
	}
}

// Optional: Cache invalidation when device info changes
func (s *Server) InvalidateDeviceCache(ctx context.Context, deviceID string) error {
	cacheKey := "device:" + deviceID

	// Remove from local cache
	s.localCache.Del(cacheKey)

	// Remove from Redis
	return s.redis.Del(ctx, cacheKey).Err()
}
