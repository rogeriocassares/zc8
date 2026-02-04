package grpcserver

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
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

type WriteBatcher struct {
	buf    bytes.Buffer
	points int
}
type SensorTimeSeriesWriter struct {
	client *influxdb3.Client
	queue  chan util.ParsedData
	batch  WriteBatcher

	// queue   chan *Point
	// client  *influx.Client
}

type SensorRealTimeWriter struct {
	client *redis.Client
	queue  chan util.ParsedData

	// queue   chan *Point
	// client  *influx.Client
}

type Server struct {
	redis *redis.Client
	pb.UnimplementedTelemetryServiceServer
	postgres               *postgres.Client
	parser                 *parser.Parser
	localCache             *ristretto.Cache // Local in-memory cache
	devicePool             *sync.Pool       // Object pooling
	sensorRealTimeWriter   *SensorRealTimeWriter
	sensorTimeSeriesWriter *SensorTimeSeriesWriter
}

type SensorReading struct {
	SensorID  string
	DeviceID  string
	Location  string
	Timestamp time.Time
	Values    map[string]float64 // sensor_type → value
}

const (
	measurement    = "sensor_data"
	maxBatchPoints = 1
	// maxBatchPoints = 5000
	maxBatchBytes = 2 * 1024 * 1024 // 2 MB
)

// type Encoder interface {
// 	Encode(data util.ParsedData)
// 	ShouldFlush() bool
// 	Flush() error
// 	Reset()
// }

// type RedisEncoder struct {
// 	pipe      redis.Pipeliner
// 	count     int
// 	maxCount  int
// 	lastFlush time.Time
// }

func NewSensorTimeSeriesWriter(client *influxdb3.Client) *SensorTimeSeriesWriter {
	queueSize := 100_000 // tune based on memory

	w := &SensorTimeSeriesWriter{
		client: client,
		queue:  make(chan util.ParsedData, queueSize),
	}
	// start workers AFTER server is fully constructed
	w.startInfluxWorkers(8) // IO-bound → tune based on throughput	return w
	return w
}

func NewSensorRealTimeWriter(client *redis.Client) *SensorRealTimeWriter {
	queueSize := 100_000 // tune based on memory

	w := &SensorRealTimeWriter{
		client: client,
		queue:  make(chan util.ParsedData, queueSize),
	}
	// start workers AFTER server is fully constructed
	w.startRedisWorkers(8) // IO-bound → tune based on throughput	return w
	return w
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

	s := &Server{
		redis:  redisClient,
		parser: parser.NewServer(),
		// influxdb3:   influxdb3Client,
		localCache: cache,
		// influxQueue: make(chan util.ParsedData, queueSize),
		devicePool: &sync.Pool{
			New: func() interface{} {
				return &DeviceInfo{}
			},
		},
		sensorRealTimeWriter:   NewSensorRealTimeWriter(redisClient),
		sensorTimeSeriesWriter: NewSensorTimeSeriesWriter(influxdb3Client),
	}
	return s
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

	// sensors:{acme}:00
	// sensors:{acme}:01
	// sensors:{acme}:31

	deviceInfo.ParseConfig.Measurement = "sensor_data"
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
	// 		deviceInfo.ParseConfig.Vendor = "kron"
	// 		deviceInfo.ParseConfig.Model = "ks3000"
	// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 		in.DeviceId = "019be702-190b-7d8d-b057-4b6ab585792c"

	// case "":
	// 		deviceInfo.ParseConfig.Vendor = "kron"
	// 		deviceInfo.ParseConfig.Model = "ks3000"
	// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 		in.DeviceId = "019be702-190b-764a-9dbf-d28c33b11b3d"

	// case "":
	// 		deviceInfo.ParseConfig.Vendor = "kron"
	// 		deviceInfo.ParseConfig.Model = "ks3000"
	// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 		in.DeviceId = "019be702-190b-7bc0-83f2-48660dc8681b"

	// case "":
	// 		deviceInfo.ParseConfig.Vendor = "kron"
	// 		deviceInfo.ParseConfig.Model = "ks3000"
	// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 		in.DeviceId = "019be702-190b-7128-970e-9a8bc4c31c76"

	// case "":
	// 		deviceInfo.ParseConfig.Vendor = "kron"
	// 		deviceInfo.ParseConfig.Model = "ks3000"
	// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 		in.DeviceId = "019be702-190b-704e-ba39-dafbcfa73c02"

	// case "":
	// 		deviceInfo.ParseConfig.Vendor = "kron"
	// 		deviceInfo.ParseConfig.Model = "ks3000"
	// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
	// 		in.DeviceId = "019be702-190b-73b3-a8dc-3830751b3bd8"

	// case "":
	// 		deviceInfo.ParseConfig.Vendor = "kron"
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

	// Write to Redis Stream and Hash
	// if err := s.sensorRealTimeWriter.WriteToRedis(ctx, *parsedData); err != nil {
	if err := s.sensorRealTimeWriter.WriteToRedis(*parsedData); err != nil {
		return nil, status.Error(codes.Internal, fmt.Sprintf("failed to write: %v", err))
	}

	// Write to Influxdb3
	// if err := s.sensorTimeSeriesWriter.WriteToInfluxdb3(ctx, *parsedData); err != nil {
	if err := s.sensorTimeSeriesWriter.WriteToInfluxdb3(*parsedData); err != nil {
		return nil, status.Error(codes.Internal, fmt.Sprintf("failed to write: %v", err))
	}

	return &pb.IngestTelemetryResponse{
		Success: true,
		// Message:   "Data ingested successfully",
		// StreamKey: streamKey,
	}, nil
}

// func (r *RedisEncoder) Encode(batch util.ParsedData) {
// 	if len(batch) == 0 {
// 		return nil
// 	}

// 	deviceID := batch[0].Tags["device_id"]
// 	tenantID := batch[0].Tags["tenant_id"]

// 	const shardCount = 5
// 	shardID := util.ShardForDevice(deviceID, shardCount)

// 	streamKey := fmt.Sprintf("sensors:{%s}:%02d", tenantID, shardID)
// 	lastKey := fmt.Sprintf("last:{%s}:%s", tenantID, deviceID)

// 	pipe := s.redis.Pipeline()
// 	now := time.Now().UnixNano()

// 	for _, data := range batch {
// 		sensorType := data.Tags["sensor_type"]
// 		sensorValue := data.Fields["value"]

// 		pipe.HSet(ctx, lastKey, map[string]any{
// 			sensorType: sensorValue,
// 			"ts":       now,
// 		})

// 		pipe.XAdd(ctx, &redis.XAddArgs{
// 			Stream: streamKey,
// 			MaxLen: 10000,
// 			Approx: true,
// 			Values: map[string]any{
// 				"device": deviceID,
// 				"type":   sensorType,
// 				"value":  sensorValue,
// 				"ts":     now,
// 			},
// 		})
// 	}

// 	_, err := pipe.Exec(ctx)
// 	return err
// 	r.count++
// }

// func (w *SensorRealTimeWriter) ShouldFlush() bool {
// 	return w.count >= w.maxCount ||
// 		time.Since(w.lastFlush) > 10*time.Millisecond
// }

func (w *SensorTimeSeriesWriter) batchData(batch *WriteBatcher, data util.ParsedData) {
	// name: "sensor_data",
	// tags: {
	// 	device_id:019b08df-26e7-7866-a0fb-1768122b8584
	// 	direction:uplink
	// 	model:ks3000
	// 	origin: mqtt
	// 	vendor:kron
	// },
	// fields: {
	// 	temperature=23.4,
	// 	humidity=98,
	// },
	// Timestamp: 1770134069000000000,

	ts := data.Timestamp

	for sensorType, value := range data.Fields {
		w.ToLineProtocol(
			&batch.buf,
			// data.Tags["sensor_id"],
			data.Tags["device_id"],
			// data.Tags["location"],
			sensorType,
			value,
			ts,
		)
		batch.buf.WriteByte('\n')
		batch.points++
		// sensor_data,device_id=23a1,sensor_type=temperature value=23.4 1770134069000000000 \n
		// sensor_data,device_id=23a1,sensor_type=humidity value=98 1770134069000000000 \n
		// sensor_data,device_id=23a2,sensor_type=temperature value=23.4 1770134069000000001 \n

	}
}

func (w *SensorRealTimeWriter) flushWithRetry(data util.ParsedData) error {
	var ctx = context.Background()
	// name: "sensor_data",
	// tags: {
	// 	device_id:019b08df-26e7-7866-a0fb-1768122b8584
	// 	direction:uplink
	// 	model:ks3000
	// 	origin: mqtt
	// 	vendor:kron
	// },
	// fields: {
	// 	temperature=23.4,
	// 	humidity=98,
	// },
	// Timestamp: 1770134069000000000,

	deviceID := data.Tags["device_id"]
	tenantID := data.Tags["tenant_id"]

	const shardCount = 5
	shardID := util.ShardForDevice(deviceID, shardCount)

	streamKey := fmt.Sprintf("sensors:{%s}:%02d", tenantID, shardID)
	lastKey := fmt.Sprintf("last:{%s}:%s", tenantID, deviceID)

	pipe := w.client.Pipeline()
	now := time.Now().UnixNano()

	//  parsed.fields array into many points
	for sensorType, value := range data.Fields {

		pipe.HSet(ctx, lastKey, map[string]any{
			sensorType: value,
			"ts":       now,
		})

		pipe.XAdd(ctx, &redis.XAddArgs{
			Stream: streamKey,
			MaxLen: 10000,
			Approx: true,
			Values: map[string]any{
				"device": deviceID,
				"type":   sensorType,
				"value":  value,
				"ts":     now,
			},
		})
	}

	_, err := pipe.Exec(ctx)
	return err
}

// influxdb3 specific
func (w *SensorTimeSeriesWriter) ToLineProtocol(
	buf *bytes.Buffer,
	// sensorID,
	deviceID,
	// location,
	sensorType string,
	value any,
	ts uint64,
) {
	buf.WriteString(measurement)

	// buf.WriteString(",sensor_id=")
	// buf.WriteString(sensorID)

	buf.WriteString(",device_id=")
	buf.WriteString(deviceID)

	// buf.WriteString(",location=")
	// buf.WriteString(location)

	buf.WriteString(",sensor_type=")
	buf.WriteString(sensorType)

	buf.WriteString(" value=")
	switch v := value.(type) {
	case string:
		if sensorType == "data" {
			buf.WriteString(`"`)
			buf.WriteString(v)
			buf.WriteString(`"`)
		} else {
			buf.WriteString(v)
		}
	case []byte:
		if sensorType == "data" {
			buf.WriteString(`"`)
			buf.WriteString(hex.EncodeToString(v))
			buf.WriteString(`"`)
		} else {
			buf.WriteString(hex.EncodeToString(v))
		}
	case float64:
		buf.WriteString(strconv.FormatFloat(v, 'f', -1, 64))
	case uint64:
		buf.WriteString(strconv.FormatUint(v, 10))
	case int64:
		buf.WriteString(strconv.FormatInt(int64(v), 10))
	}

	buf.WriteByte(' ')
	buf.Write(strconv.AppendUint(nil, ts, 10))

	// buf.WriteByte('\n')
}

func (w *SensorTimeSeriesWriter) startInfluxWorkers(n int) {
	for i := 0; i < n; i++ {
		go w.influxWorker()
	}
}

func (w *SensorRealTimeWriter) startRedisWorkers(n int) {
	for i := 0; i < n; i++ {
		go w.redisWorker()
	}
}

// influxdb3 specific
func (w *SensorTimeSeriesWriter) influxWorker() {
	var batch WriteBatcher
	batch.buf.Grow(maxBatchBytes)

	flushTicker := time.NewTicker(500 * time.Millisecond)
	defer flushTicker.Stop()

	for {
		select {
		case data := <-w.queue:
			// influxdb needs batch for one line string insert
			// and buffer
			w.batchData(&batch, data)
			// batch is the array of batched points (buffer) to be flushed

			// if batch.shouldFlush() {
			// 	s.flushWithRetry(&batch)
			// }
			if w.shouldFlush() {
				w.flushWithRetry(&batch)
			}

		case <-flushTicker.C:
			w.flushWithRetry(&batch)
		}
	}
}

func (w *SensorRealTimeWriter) redisWorker() {

	flushTicker := time.NewTicker(10 * time.Millisecond)
	defer flushTicker.Stop()

	for {
		select {
		case data := <-w.queue:
			// encoder.Encode(data)

			if err := w.flushWithRetry(data); err != nil {
				// Handle error appropriately (e.g., log and possibly send to DLQ)
				log.Printf("Failed to flush Redis data: %v", err)
			}

		case <-flushTicker.C:
			return
		}
	}
}

func (w *SensorTimeSeriesWriter) flushWithRetry(batch *WriteBatcher) error {
	if batch.points == 0 {
		return fmt.Errorf("No data to flush")
	}

	payload := batch.buf.String()

	backoff := 50 * time.Millisecond
	for attempt := 0; attempt < 5; attempt++ {
		err := w.client.Write(context.Background(), []byte(payload))
		if err == nil {
			w.reset()
			return nil
		}

		time.Sleep(backoff)
		backoff *= 2
	}

	// last resort: log + drop or push to DLQ
	w.reset()
	return fmt.Errorf("failed to write to InfluxDB after retries")
}

type DeviceInfo struct {
	IsActive     bool               `json:"is_active"`
	IsAuthorized bool               `json:"is_authorized"`
	TenantID     string             `json:"tenant_id"`
	TeamID       string             `json:"team_id"`
	ParseConfig  parser.ParseConfig `json:"parse_config"`
}

// WritePoints -> addPoint + batch.append + batch.shouldFlush() + flushBatch -> Write to InfluxDB3
// func (influx *InfluxEncoder) append(line string) {
// 	influx.batch.buf.WriteString(line)
// 	influx.batch.buf.WriteByte('\n')
// 	influx.batch.points++
// }

func (w *SensorTimeSeriesWriter) shouldFlush() bool {
	return w.batch.points >= maxBatchPoints || w.batch.buf.Len() >= maxBatchBytes
}

// func (w *SensorRealTimeWriter) shouldFlush() bool {
// 	return w.batch.points >= maxBatchPoints || w.batch.buf.Len() >= maxBatchBytes
// }

func (w *SensorTimeSeriesWriter) reset() {
	w.batch.buf.Reset()
	w.batch.points = 0
}

// func (w *SensorRealTimeWriter) reset() {
// 	w.batch.buf.Reset()
// 	w.batch.points = 0
// }

// // influxdb3.addPoint
// func (influx *InfluxEncoder) addPoint(sensorID, deviceID, location, sensorType string, value float64, ts int64) string {

// 	// NOTE: escape tag values if needed
// 	// 		If you’re doing >50k points/sec, replace fmt.Sprintf
// 	// with manual strings.Builder writes (I can show that next).
// 	return fmt.Sprintf(
// 		"%s,sensor_id=%s,device_id=%s,location=%s,sensor_type=%s value=%f %d",
// 		measurement,
// 		sensorID,
// 		deviceID,
// 		location,
// 		sensorType,
// 		value,
// 		ts,
// 	)
// }

// func (influx *InfluxEncoder) flushBatch(ctx context.Context, influxdb3 *influxdb3.Client, batch *WriteBatcher) error {

// 	if batch.points == 0 {
// 		return nil
// 	}
// 	err := influxdb3.Write(ctx, batch.buf.Bytes())
// 	batch.buf.Reset()
// 	batch.points = 0
// 	return err
// }

// influxdb3.WritePoints
// func (influx *InfluxEncoder) WritePoints(ctx context.Context, influxdb3 *influxdb3.Client, readings []SensorReading) error {

// 	var batch WriteBatcher

// 	for _, r := range readings {
// 		ts := r.Timestamp.UnixNano()

// 		for sensorType, value := range r.Values {
// 			line := addPoint(
// 				r.SensorID,
// 				r.DeviceID,
// 				r.Location,
// 				sensorType,
// 				value,
// 				ts,
// 			)

// 			batch.append(line)

// 			if batch.shouldFlush() {
// 				if err := flushBatch(ctx, influxdb3, &batch); err != nil {
// 					return err
// 				}
// 			}
// 		}
// 	}

// 	return flushBatch(ctx, influxdb3, &batch)
// }

// OUTPUT LAYER >>>>>>>>>>>>>>>>>>>
// Optimized Redis stream write with pipelining
// func (s *Server) writeBatchToRedisStream(
// 	ctx context.Context,
// 	batch util.ParsedData,
// ) error {

// 	if len(batch) == 0 {
// 		return nil
// 	}

// 	deviceID := batch[0].Tags["device_id"]
// 	tenantID := batch[0].Tags["tenant_id"]

// 	const shardCount = 5
// 	shardID := shardForDevice(deviceID, shardCount)

// 	streamKey := fmt.Sprintf("sensors:{%s}:%02d", tenantID, shardID)
// 	lastKey := fmt.Sprintf("last:{%s}:%s", tenantID, deviceID)

// 	pipe := s.redis.Pipeline()
// 	now := time.Now().UnixNano()

// 	for _, data := range batch {
// 		sensorType := data.Tags["sensor_type"]
// 		sensorValue := data.Fields["value"]

// 		pipe.HSet(ctx, lastKey, map[string]any{
// 			sensorType: sensorValue,
// 			"ts":       now,
// 		})

// 		pipe.XAdd(ctx, &redis.XAddArgs{
// 			Stream: streamKey,
// 			MaxLen: 10000,
// 			Approx: true,
// 			Values: map[string]any{
// 				"device": deviceID,
// 				"type":   sensorType,
// 				"value":  sensorValue,
// 				"ts":     now,
// 			},
// 		})
// 	}

// 	_, err := pipe.Exec(ctx)
// 	return err
// }

// func (w *SensorTimeSeriesWriter) WriteToInfluxdb3(ctx context.Context, data util.ParsedData) error {
func (w *SensorTimeSeriesWriter) WriteToInfluxdb3(data util.ParsedData) error {
	fmt.Printf("\nMessage wrote to InfluxDB3: %v\n", data)
	// Non-blocking enqueue with backpressure
	select {
	case w.queue <- data:
		return nil
	default:
		return status.Error(codes.ResourceExhausted, "influx ingest queue full")
	}
}

// func (w *SensorRealTimeWriter) WriteToRedis(ctx context.Context, data util.ParsedData) error {
func (w *SensorRealTimeWriter) WriteToRedis(data util.ParsedData) error {
	fmt.Printf("\nMessage wrote to Redis: %v\n", data)
	// Non-blocking enqueue with backpressure
	select {
	case w.queue <- data:
		return nil
	default:
		return status.Error(codes.ResourceExhausted, "redis ingest queue full")
	}
}

// OUTPUT LAYER <<<<<<<<<<<<<<<<<

// CACHING LAYER >>>>>>>>>>>>>>>>>>>
// Multi-tier caching: L1 (local) -> L2 (Redis) -> L3 (PostgreSQL)
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

// CACHING LAYER <<<<<<<<<<<<<<<<<
