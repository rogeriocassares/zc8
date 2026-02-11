package grpcserver

// receive the grpc streaming request, get postgres deviceInfo with Redis Cache and In-memory, parse the payload, write to InfluxDB (confirmation), Redis Hash and NATS Core for real-time processing and alerting
// Worker pool for InfluxDB writes (batching, backpressure, retries)
// Worker pool for Redis Hash (Latest, low latency)
// Worker pool for NATS (Real-time, low latency, fire and forget)

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/InfluxCommunity/influxdb3-go/v2/influxdb3"
	"github.com/dgraph-io/ristretto"
	"github.com/nats-io/nats.go"
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

const (
	// MaxBatchPoints = 5000
	MaxBatchPoints = 10
	MaxBatchBytes  = 5 * 1024 * 1024 // 5MB
	MaxBatchAge    = 5 * time.Second
	// NumWorkers     = 16
	NumWorkers = 1
)

type TelemetryParser interface {
	Parse(cfg parser.ParseConfig, payload []byte) (*util.ParsedData, error)
}

type TimeSeriesWriterInterface interface {
	Write(data IngestEvent) error
}
type RealTimeWriterInterface interface {
	Write(data IngestEvent) error
}

type CacheWriterInterface interface {
	Write(data IngestEvent) error
}

type deviceCache interface {
	validateDeviceInCacheOrDB(ctx context.Context, deviceID string) (bool, error)
	getDeviceInfoCached(ctx context.Context, deviceID string) (*DeviceInfo, error)
	PrefetchHotDevices(ctx context.Context, deviceIDs []string)
	InvalidateDeviceCache(ctx context.Context, deviceID string) error
}

type DeviceRepository interface {
	getDeviceInfoFromDB(ctx context.Context, deviceID string) (*DeviceInfo, error)
}

var _ TelemetryParser = (*parser.Parser)(nil)
var _ TimeSeriesWriterInterface = (*TimeSeriesWriter)(nil)
var _ RealTimeWriterInterface = (*RealTimeWriter)(nil)
var _ CacheWriterInterface = (*CacheWriter)(nil)

// var _ deviceCache = (*RealTimeWriter)(nil)
// var _ DeviceRepository = (*TimeSeriesWriter)(nil)

type WriteBatcher struct {
	buf       bytes.Buffer
	points    int
	startTime time.Time
}

type IngestEvent struct {
	EventID    string    // UUIDv7 or similar
	IngestedAt time.Time // authoritative ingest time (UTC)
	DeviceID   string
	Source     pb.IngestSource // mqtt, grpc, cli, etc

	RawPayloadB64 string          // for telemetry_ingest
	Parsed        util.ParsedData // for sensor_data
}

// WRITERS: TimeSeriesWriter (InfluxDB), RealTimeWriter (Redis), CacheWriter (Ristretto + Redis)
type TimeSeriesWriter struct {
	client   *influxdb3.Client
	dataChan chan IngestEvent
	// batch    WriteBatcher
	postgres *postgres.Client
	workers  []*TimeSeriesWriteWorker
	wg       sync.WaitGroup
	shutdown chan struct{}
}
type RealTimeWriter struct {
	client   *nats.Conn
	dataChan chan IngestEvent
	workers  []*RealTimeWriteWorker
	wg       sync.WaitGroup // Add this
	shutdown chan struct{}  // Add this
}

type CacheWriter struct {
	client     *redis.Client
	dataChan   chan IngestEvent
	localCache *ristretto.Cache // Local in-memory cache
	devicePool *sync.Pool       // Object pooling
	postgres   *postgres.Client
	workers    []*CacheWriteWorker
	wg         sync.WaitGroup // Add this
	shutdown   chan struct{}  // Add this
}

// WORKERS: TimeSeriesWriteWorker (InfluxDB), RealTimeWriteWorker (Redis), CacheWriteWorker (Ristretto + Redis)
type TimeSeriesWriteWorker struct {
	id     int
	client *influxdb3.Client
	batch  *WriteBatcher
	timer  *time.Timer
	mu     sync.Mutex
}

type RealTimeWriteWorker struct {
	id     int
	client *nats.Conn
	timer  *time.Timer
	mu     sync.Mutex
}

type CacheWriteWorker struct {
	id     int
	client *redis.Client
	timer  *time.Timer
	mu     sync.Mutex
}

type Server struct {
	// redis *redis.Client
	// pb.UnimplementedTelemetryServiceServer
	pb.UnimplementedTelemetryIngestServiceServer
	parser *parser.Parser
	// localCache             *ristretto.Cache // Local in-memory cache
	// devicePool             *sync.Pool       // Object pooling
	timeSeriesWriter *TimeSeriesWriter
	realTimeWriter   *RealTimeWriter
	cacheWriter      *CacheWriter
}

type SensorReading struct {
	SensorID  string
	DeviceID  string
	Location  string
	Timestamp time.Time
	Values    map[string]float64 // sensor_type → value
}

type DeviceInfo struct {
	IsActive     bool               `json:"is_active"`
	IsAuthorized bool               `json:"is_authorized"`
	TenantID     string             `json:"tenant_id"`
	TeamID       string             `json:"team_id"`
	ParseConfig  parser.ParseConfig `json:"parse_config"`
}

// TODO: UNIFIY GLOBAL CONSTANTS FROM ENV AND CONFIG
const (
	measurement    = "sensor_data"
	maxBatchPoints = 1
	// maxBatchPoints = 5000
	maxBatchBytes = 2 * 1024 * 1024 // 2 MB
)

// INSTANTIATE SERVER WITH CLIENTS DEPENDENCIES
func NewServer(redisClient *redis.Client, influxdb3Client *influxdb3.Client, natsClient *nats.Conn) *Server {
	// Initialize Ristretto cache (high-performance local cache)
	// cache, err := ristretto.NewCache(&ristretto.Config{
	// 	NumCounters: 1e7,     // 10M counters
	// 	MaxCost:     1 << 30, // 1GB max memory
	// 	BufferItems: 64,
	// })
	// if err != nil {
	// 	return nil
	// }

	s := &Server{
		parser:         parser.NewServer(),
		realTimeWriter: NewRealTimeWriter(natsClient),
		cacheWriter:    NewCacheWriter(redisClient),
		// timeSeriesWriter: NewSensorTimeSeriesWriter(influxdb3Client, postgresClient),
		timeSeriesWriter: NewTimeSeriesWriter(influxdb3Client),
	}
	return s
}

// NEW CLIENTS
func NewTimeSeriesWriter(client *influxdb3.Client) *TimeSeriesWriter {
	dataChanSize := 100_000
	w := &TimeSeriesWriter{
		client:   client,
		dataChan: make(chan IngestEvent, dataChanSize),
		shutdown: make(chan struct{}),
		workers:  make([]*TimeSeriesWriteWorker, NumWorkers),
	}

	for i := 0; i < NumWorkers; i++ {
		w.workers[i] = &TimeSeriesWriteWorker{
			id:     i,
			client: client,
			batch:  &WriteBatcher{startTime: time.Now()},
			timer:  time.NewTimer(MaxBatchAge),
		}
	}
	return w
}

func NewRealTimeWriter(client *nats.Conn) *RealTimeWriter {
	dataChanSize := 100_000

	w := &RealTimeWriter{
		client:   client,
		dataChan: make(chan IngestEvent, dataChanSize),
		shutdown: make(chan struct{}), // Add this
		workers:  make([]*RealTimeWriteWorker, NumWorkers),
	}
	for i := 0; i < NumWorkers; i++ {
		w.workers[i] = &RealTimeWriteWorker{
			id:     i,
			client: client,
			timer:  time.NewTimer(MaxBatchAge),
		}
	}
	return w
}

func NewCacheWriter(client *redis.Client) *CacheWriter {
	dataChanSize := 100_000
	cache, err := ristretto.NewCache(&ristretto.Config{
		NumCounters: 1e7,     // 10M counters
		MaxCost:     1 << 30, // 1GB max memory
		BufferItems: 64,
	})
	if err != nil {
		return nil
	}

	w := &CacheWriter{
		client:     client,
		dataChan:   make(chan IngestEvent, dataChanSize),
		localCache: cache,
		devicePool: &sync.Pool{
			New: func() interface{} {
				return &DeviceInfo{}
			},
		},
		shutdown: make(chan struct{}), // Add this
		workers:  make([]*CacheWriteWorker, NumWorkers),
	}
	for i := 0; i < NumWorkers; i++ {
		w.workers[i] = &CacheWriteWorker{
			id:     i,
			client: client,
			timer:  time.NewTimer(MaxBatchAge),
		}
	}
	return w
}

// START WORKER POOLS
func (w *TimeSeriesWriter) Start() {
	for i := 0; i < NumWorkers; i++ {
		w.wg.Add(1)
		go w.runWorker(w.workers[i])
	}
	fmt.Printf("Started %d workers\n", NumWorkers)
}

func (w *RealTimeWriter) Start() {
	for i := 0; i < NumWorkers; i++ {
		w.wg.Add(1)
		go w.runWorker(w.workers[i])
	}
	fmt.Printf("Started %d workers\n", NumWorkers)
}

func (w *CacheWriter) Start() {
	for i := 0; i < NumWorkers; i++ {
		w.wg.Add(1)
		go w.runWorker(w.workers[i])
	}
	fmt.Printf("Started %d workers\n", NumWorkers)
}

// STOP WORKER POOLS
func (w *TimeSeriesWriter) Stop() {
	close(w.shutdown)
	close(w.dataChan)
	w.wg.Wait()
	fmt.Println("TimeSeriesWriter stopped")
}

func (w *RealTimeWriter) Stop() {
	close(w.shutdown)
	close(w.dataChan)
	w.wg.Wait()
	log.Println("RealTimeWriter stopped")
}

func (w *CacheWriter) Stop() {
	close(w.shutdown)
	close(w.dataChan)
	w.wg.Wait()
	log.Println("CacheWriter stopped")
}

func (worker *TimeSeriesWriteWorker) addData(data IngestEvent) {
	worker.mu.Lock()
	defer worker.mu.Unlock()

	deviceID := util.EscapeTag(data.DeviceID)

	// for sensorType, value := range data.Fields {
	for sensorType, value := range data.Parsed.Fields {
		// Determine type and convert to string
		dataType := util.DiscoverType(value)
		// if strValue == "" {
		// 	continue // Skip invalid values
		// }

		// Write line protocol
		// telemetry_ingest, device_id=DEVICE_ID event_id=UUIDV7,raw_payload_base64=PAYLOAD_BASE64 TIMESTAMP_NS

		worker.ToLineProtocol(
			&worker.batch.buf,
			data.EventID,
			data.IngestedAt,
			deviceID,
			dataType,
			sensorType,
			value,
		)
		worker.batch.points++
	}
}

// RUN WORKERS
func (w *TimeSeriesWriter) runWorker(worker *TimeSeriesWriteWorker) {
	defer w.wg.Done()

	for {
		select {
		case data, ok := <-w.dataChan:
			if !ok {
				worker.flush()
				return
			}

			// fmt.Printf("[Worker %d] Received data for device_id=%s with %d fields\n", worker.id, data.Tags["device_id"], len(data.Fields))
			worker.addData(data)

			if worker.shouldFlush() {
				worker.flush()
			}

		case <-worker.timer.C:
			worker.flush()
			worker.timer.Reset(MaxBatchAge)

		case <-w.shutdown:
			worker.flush()
			return
		}
	}
}

func (w *RealTimeWriter) runWorker(worker *RealTimeWriteWorker) {
	defer w.wg.Done()

	for {
		select {
		case data, ok := <-w.dataChan:
			if !ok {
				return
			}

			worker.flush(&data)

		case <-worker.timer.C:
			worker.flush(nil)
			worker.timer.Reset(MaxBatchAge)

		case <-w.shutdown:
			worker.flush(nil)
			return
		}
	}
}

func (w *CacheWriter) runWorker(worker *CacheWriteWorker) {
	defer w.wg.Done()

	for {
		select {
		case data, ok := <-w.dataChan:
			if !ok {
				return
			}

			worker.flush(&data)

		case <-worker.timer.C:
			worker.flush(nil)
			worker.timer.Reset(MaxBatchAge)

		case <-w.shutdown:
			worker.flush(nil)
			return
		}
	}
}

// START AND STOP SERVERS
func (s *Server) StartWriters() {
	log.Println("Starting Writers...")
	s.timeSeriesWriter.Start()
	s.realTimeWriter.Start()
	s.cacheWriter.Start()
	// Redis writer is already started in NewRealTimeWriter
	log.Println("Writers started successfully")
}

func (s *Server) StopWriters() {
	log.Println("Stopping Writers...")

	// Stop TimeSeriesWriter (waits for workers to finish)
	s.timeSeriesWriter.Stop()
	s.realTimeWriter.Stop()
	s.cacheWriter.Stop()

	log.Println("Writers stopped successfully")
}

// func (w *RealTimeWriter) redisWorker(id int) {
// 	fmt.Printf("\nRedis worker started\n")

// 	defer w.wg.Done()

// 	log.Printf("Redis worker %d started\n", id)
// 	flushTicker := time.NewTicker(10 * time.Millisecond)
// 	defer flushTicker.Stop()

// 	for {
// 		select {
// 		case data, ok := <-w.queue:
// 			if !ok {
// 				// Queue closed
// 				return
// 			}
// 			fmt.Printf("\nPrepare to write data to Redis\n")

// 			if err := w.flushWithRetry(data); err != nil {
// 				// Handle error appropriately (e.g., log and possibly send to DLQ)
// 				log.Printf("Failed to flush Redis data: %v", err)
// 			}

//			case <-w.shutdown:
//				// Drain remaining items
//				for {
//					select {
//					case data := <-w.queue:
//						w.flushWithRetry(data)
//					default:
//						return
//					}
//				}
//			case <-flushTicker.C:
//				return
//			}
//		}
//	}

func (s *Server) IngestStream(
	stream pb.TelemetryIngestService_IngestStreamServer,
) error {

	for {
		req, err := stream.Recv()
		if err == io.EOF {
			return stream.SendAndClose(&pb.IngestResponse{Status: pb.IngestStatus_INGEST_OK})
		}
		if err != nil {
			return err
		}

		// >>>>>>>>>>>>>>>>>
		// Fast validation
		// if in.DeviceId == "" {
		if req.DeviceId == "" {
			return status.Error(codes.InvalidArgument, "device_id is required")
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
		// up: Uplink application data (e.g., sensor Parsed)
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

		switch req.DeviceId {
		case "019b76c4-d38a-7eba-9036-3586652112a4":
			deviceInfo.ParseConfig.Vendor = "agent"
			deviceInfo.ParseConfig.Model = "ping"

		// Khomp
		case "a8404123415f13fe":
			deviceInfo.ParseConfig.Vendor = "khomp"
			deviceInfo.ParseConfig.Model = "dtl200_swl"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019c2f32-0637-7304-8bc3-bc5c58b2961c"

		case "a8404188945f13dd":
			deviceInfo.ParseConfig.Vendor = "khomp"
			deviceInfo.ParseConfig.Model = "dtl200_swl"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019c2f32-0637-729b-99a3-86f5f6f49fc6"

		// Kron
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
		// 		req.DeviceId = "019be702-190b-7d8d-b057-4b6ab585792c"

		// case "":
		// 		deviceInfo.ParseConfig.Vendor = "kron"
		// 		deviceInfo.ParseConfig.Model = "ks3000"
		// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		// 		req.DeviceId = "019be702-190b-764a-9dbf-d28c33b11b3d"

		// case "":
		// 		deviceInfo.ParseConfig.Vendor = "kron"
		// 		deviceInfo.ParseConfig.Model = "ks3000"
		// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		// 		req.DeviceId = "019be702-190b-7bc0-83f2-48660dc8681b"

		// case "":
		// 		deviceInfo.ParseConfig.Vendor = "kron"
		// 		deviceInfo.ParseConfig.Model = "ks3000"
		// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		// 		req.DeviceId = "019be702-190b-7128-970e-9a8bc4c31c76"

		// case "":
		// 		deviceInfo.ParseConfig.Vendor = "kron"
		// 		deviceInfo.ParseConfig.Model = "ks3000"
		// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		// 		req.DeviceId = "019be702-190b-704e-ba39-dafbcfa73c02"

		// case "":
		// 		deviceInfo.ParseConfig.Vendor = "kron"
		// 		deviceInfo.ParseConfig.Model = "ks3000"
		// 		deviceInfo.ParseConfig.Origin = "chirpstackv4"
		// 		req.DeviceId = "019be702-190b-73b3-a8dc-3830751b3bd8"

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
			req.DeviceId = "019b9ade-55a0-746e-8d41-b2537631441c"

		case "24e124136f483595":
			deviceInfo.ParseConfig.Vendor = "milesight"
			deviceInfo.ParseConfig.Model = "em300_di"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019be6fa-0dee-729a-84c8-e468fd11af62"

		case "24e124136f484497":
			deviceInfo.ParseConfig.Vendor = "milesight"
			deviceInfo.ParseConfig.Model = "em300_di"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019be6fa-0dee-7c6c-b791-6cfec79a3429"

		case "24e124136f484616":
			deviceInfo.ParseConfig.Vendor = "milesight"
			deviceInfo.ParseConfig.Model = "em300_di"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019be6fa-0dee-72bf-9e40-96939916414e"

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
			req.DeviceId = "019b9ae2-fc84-7396-9ea8-fd2a041b7664"

		case "24e124126f422301":
			deviceInfo.ParseConfig.Vendor = "milesight"
			deviceInfo.ParseConfig.Model = "em500_swl"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019be6eb-b5bb-7fbf-ba3b-3101febc1129"

		case "24e124126f422693":
			deviceInfo.ParseConfig.Vendor = "milesight"
			deviceInfo.ParseConfig.Model = "em500_swl"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019be6eb-b5bc-780a-a53e-0859edf1bf0a"

		case "24e124126f427639":
			deviceInfo.ParseConfig.Vendor = "milesight"
			deviceInfo.ParseConfig.Model = "em500_swl"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019be6eb-b5bc-7669-af5c-488132dceadb"

		case "24e124126f427690":
			deviceInfo.ParseConfig.Vendor = "milesight"
			deviceInfo.ParseConfig.Model = "em500_swl"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019be6eb-b5bc-77de-b058-9d4a78419e1a"

		case "24e124126f422141":
			deviceInfo.ParseConfig.Vendor = "milesight"
			deviceInfo.ParseConfig.Model = "em500_swl"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019be6eb-b5bc-7751-839b-c05990ec0ea6"

		case "24e124126f427556":
			deviceInfo.ParseConfig.Vendor = "milesight"
			deviceInfo.ParseConfig.Model = "em500_swl"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019be6eb-b5bc-7cb8-9ed1-1467f311ebf8"

		case "24e124126f427781":
			deviceInfo.ParseConfig.Vendor = "milesight"
			deviceInfo.ParseConfig.Model = "em500_swl"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019be6eb-b5bc-7904-a84c-3bd0d9e304c7"

		case "24e124126f427831":
			deviceInfo.ParseConfig.Vendor = "milesight"
			deviceInfo.ParseConfig.Model = "em500_swl"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019be6eb-b5bc-75fb-8688-0cf22c21eb49"

		// ws101
		case "24e124535f318437":
			deviceInfo.ParseConfig.Vendor = "milesight"
			deviceInfo.ParseConfig.Model = "ws101"
			deviceInfo.ParseConfig.Origin = "chirpstackv4"
			req.DeviceId = "019b9ae3-337e-7fa0-9b72-3861f0e6c6bd"
		}

		// Check activation
		if !deviceInfo.IsActive {
			return status.Error(codes.PermissionDenied, "device is inactive")
		}

		// Check authorization
		if !deviceInfo.IsAuthorized {
			return status.Error(codes.PermissionDenied, "device not authorized")
		}

		// <<<<<<<<<<<<<<<<<

		fmt.Printf("\nDevice info: %v", deviceInfo)
		data, err := s.parser.Parse(deviceInfo.ParseConfig, req.Payload)
		if err != nil {
			continue
		}
		data.Tags["device_id"] = req.DeviceId
		data.Tags["tenant_id"] = deviceInfo.TenantID

		fmt.Printf("\nParsed data: %v", data)
		// fan-out (same as before)
		// select {
		// case s.rtQueue <- *data:

		// default:
		// 	// metrics.RedisDrops.Inc()
		// }

		// select {
		// case s.tsQueue <- *data:
		// default:
		// 	// metrics.InfluxDrops.Inc()
		// }

		// Convert ParsedData to IngestEvent
		event := IngestEvent{
			EventID:    "",
			IngestedAt: time.Now(),
			DeviceID:   req.DeviceId,
			Source:     pb.IngestSource_SOURCE_MQTT,
			Parsed:     *data,
		}

		// if err := s.timeSeriesWriter.WriteToInfluxdb3(ctx, *parsedData); err != nil {
		if err := s.timeSeriesWriter.Write(event); err != nil {
			// metrics.InfluxDrops.Inc()
			return status.Error(codes.Internal, fmt.Sprintf("failed to write: %v", err))
		}

		// Write to NATS
		if err := s.realTimeWriter.Write(event); err != nil {
			// metrics.RedisDrops.Inc()
			return status.Error(codes.Internal, fmt.Sprintf("failed to write: %v", err))
		}

		// Write to Redis Hash
		if err := s.cacheWriter.Write(event); err != nil {
			// metrics.RedisDrops.Inc()
			return status.Error(codes.Internal, fmt.Sprintf("failed to write: %v", err))
		}

	}
}

func (w *TimeSeriesWriteWorker) ToLineProtocol(
	buf *bytes.Buffer,
	eventID string,
	ingestedAt time.Time,
	deviceID,
	dataType string,
	sensorType string,
	value any,
) {
	// telemetry_ingest, device_id=DEVICE_ID event_id=UUIDV7,raw_payload_base64=PAYLOAD_BASE64 TIMESTAMP_NS
	if sensorType == "data" {
		buf.WriteString("telemetry_ingest")
		buf.WriteString(",device_id=")
		buf.WriteString(deviceID)
		buf.WriteString(" ")
		buf.WriteString(",event_id=")
		buf.WriteString(eventID)
		buf.WriteString("raw_payload_base64=\"")
		buf.WriteString(value.(string))
		buf.WriteString("\"")
		buf.WriteString(" ")
		buf.WriteString(strconv.FormatInt(ingestedAt.UnixNano(), 10))
	} else if sensorType != "created_at" {
		buf.WriteString("sensor_data")
		buf.WriteString(",device_id=")
		buf.WriteString(deviceID)
		buf.WriteString(",sensor_type=")
		buf.WriteString(sensorType)
		if dataType == "int" {
			buf.WriteString(" value_int=")
			buf.WriteString(strconv.FormatInt(value.(int64), 10))
		} else if dataType == "float" {
			buf.WriteString(" value_float=")
			buf.WriteString(strconv.FormatFloat(value.(float64), 'f', -1, 64))
		} else if dataType == "bool" {
			buf.WriteString(" value_bool=")
			buf.WriteString(strconv.FormatBool(value.(bool)))
		} else {
			fmt.Printf("invalid data type: %s\n", dataType)
			return
		}
	} else if sensorType == "created_at" {
		buf.WriteByte(' ')
		buf.Write(strconv.AppendInt(nil, value.(int64), 10))
	}
	buf.WriteByte('\n')
}

// FLUSH METHODS
func (worker *TimeSeriesWriteWorker) flush() {
	worker.mu.Lock()
	defer worker.mu.Unlock()

	if worker.batch.points == 0 {
		return
	}

	payload := worker.batch.buf.Bytes()
	points := worker.batch.points

	// Write with retry
	fmt.Printf("worker.writeWithRetry called with %d points\n", points)
	if err := worker.writeWithRetry(payload); err != nil {
		fmt.Printf("[Worker %d] Failed to write %d points: %v\n",
			worker.id, points, err)
	}

	// Reset
	worker.batch.buf.Reset()
	worker.batch.points = 0
	worker.batch.startTime = time.Now()
}

func (worker *RealTimeWriteWorker) flush(data *IngestEvent) {
	worker.mu.Lock()
	defer worker.mu.Unlock()

	if worker.client == nil {
		fmt.Printf("[Worker %d] NATS client is not initialized\n", worker.id)
		return
	}

	if data == nil {
		return
	}

	deviceID := data.Parsed.Tags["device_id"]
	tenantID := data.Parsed.Tags["tenant_id"]

	// telemetry.<orgId>.<deviceId>
	// device.state.<orgId>.<deviceId>
	// public.telemetry.<deviceId>

	natsSubj := fmt.Sprintf("stream.%s.%s", tenantID, deviceID)

	//  parsed.fields array into many points
	for sensorType, value := range data.Parsed.Fields {
		payload := []byte(fmt.Sprintf("%s=%v", sensorType, value))
		// Write with retry
		if err := worker.client.Publish(natsSubj, []byte(payload)); err != nil {
			fmt.Printf("[Worker %d] Failed to write to NATS: %v\n", worker.id, err)
		}
	}
	fmt.Printf("\nMessage wrote to NATS: %v: %v\n", natsSubj, data.Parsed.Fields)

}

func (worker *CacheWriteWorker) flush(data *IngestEvent) {
	worker.mu.Lock()
	defer worker.mu.Unlock()

	var ctx = context.Background()

	if worker.client == nil {
		fmt.Printf("[Worker %d] Redis client is not initialized\n", worker.id)
		return
	}

	if data == nil {
		return
	}

	deviceID := data.Parsed.Tags["device_id"]
	tenantID := data.Parsed.Tags["tenant_id"]

	lastKey := fmt.Sprintf("last:{%s}:%s", tenantID, deviceID)
	pipe := worker.client.Pipeline()
	now := time.Now().UnixNano()

	//  parsed.fields array into many points
	for sensorType, value := range data.Parsed.Fields {
		pipe.HSet(ctx, lastKey, map[string]any{
			sensorType: value,
			"ts":       now,
		})
	}
	fmt.Printf("\nMessage wrote to Redis: %v\n", lastKey)
	pipe.Exec(ctx)
}

// FLUSH CONDITIONS AND RETRY LOGIC (TIMESERIES ONLY)
func (worker *TimeSeriesWriteWorker) shouldFlush() bool {
	return worker.batch.points >= MaxBatchPoints ||
		worker.batch.buf.Len() >= MaxBatchBytes ||
		time.Since(worker.batch.startTime) >= MaxBatchAge
}

func (worker *TimeSeriesWriteWorker) writeWithRetry(payload []byte) error {
	backoff := 50 * time.Millisecond
	maxRetries := 3

	for attempt := 0; attempt < maxRetries; attempt++ {
		fmt.Printf("\n[Worker %d] Attempting to write batch: \n %v \n (attempt %d)\n", worker.id, payload, attempt+1)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		err := worker.client.Write(ctx, payload)
		cancel()

		if err == nil {
			return nil
		} else {
			fmt.Printf("\n[Worker %d] Write error (attempt %d): %v\n", worker.id, attempt+1, err)
		}

		// Don't retry schema conflicts
		if strings.Contains(err.Error(), "schema conflict") {
			fmt.Printf("[Worker %d] Schema conflict: %v\n", worker.id, err)
			return err
		}

		if attempt < maxRetries-1 {
			time.Sleep(backoff)
			backoff *= 2
		}
	}

	return fmt.Errorf("failed after %d retries", maxRetries)
}

// WRITE ENQUEUEING DATA FOR WORKERS
func (w *TimeSeriesWriter) Write(data IngestEvent) error {
	select {
	case w.dataChan <- data:
		return nil
	case <-w.shutdown:
		return fmt.Errorf("writer shutting down")
	default:
		return fmt.Errorf("channel full")
	}
}

func (w *RealTimeWriter) Write(data IngestEvent) error {
	// Non-blocking enqueue with backpressure
	select {
	case w.dataChan <- data:
		return nil
	case <-w.shutdown:
		return fmt.Errorf("writer shutting down")
	default:
		return fmt.Errorf("channel full")
	}
}

func (w *CacheWriter) Write(data IngestEvent) error {
	// Non-blocking enqueue with backpressure
	select {
	case w.dataChan <- data:
		return nil
	case <-w.shutdown:
		return fmt.Errorf("writer shutting down")
	default:
		return status.Error(codes.ResourceExhausted, "redis ingest queue full")
	}
}

// OUTPUT LAYER <<<<<<<<<<<<<<<<<

// // CACHING LAYER >>>>>>>>>>>>>>>>>>>
// // Multi-tier caching: L1 (local) -> L2 (Redis) -> L3 (PostgreSQL)
// func (w *CacheReader) validateDeviceInCacheOrDB(ctx context.Context, deviceID string) (bool, error) {
// 	// 1. Check Redis first
// 	val, err := w.client.Get(ctx, "auth:"+deviceID).Result()
// 	if err == nil {
// 		valid := val == "true"
// 		return valid, nil
// 	}
// 	if err != redis.Nil {
// 		return false, err // Redis error
// 	}

// 	// // 2. Fallback to PostgreSQL
// 	// valid, err := validateDeviceInDB(deviceID)
// 	// if err != nil {
// 	// 	return false, err
// 	// }
// 	// bypass:
// 	valid := true

// 	// 3. Cache result (even if false)
// 	status := "false"
// 	if valid {
// 		status = "true"
// 	}
// 	w.client.Set(ctx, "auth:"+deviceID, status, time.Hour)

// 	return valid, nil
// }

// func (w *CacheReader) getDeviceInfoCached(ctx context.Context, deviceID string) (*DeviceInfo, error) {
// 	cacheKey := "device:" + deviceID

// 	// L1: Check local in-memory cache (nanoseconds)
// 	if val, found := w.localCache.Get(cacheKey); found {
// 		return val.(*DeviceInfo), nil
// 	}

// 	// L2: Check Redis (microseconds)
// 	deviceInfo, err := w.getDeviceInfoFromRedis(ctx, cacheKey)
// 	if err == nil {
// 		// Store in local cache (5-minute TTL)
// 		w.localCache.SetWithTTL(cacheKey, deviceInfo, 1, 5*time.Minute)
// 		return deviceInfo, nil
// 	}
// 	if err != redis.Nil {
// 		// Redis error, but continue to DB
// 		// Log error but don't fail
// 	}

// 	// L3: Fallback to PostgreSQL (milliseconds)
// 	// deviceInfo, err = w.getDeviceInfoFromDB(ctx, deviceID)
// 	// if err != nil {
// 	// 	return nil, err
// 	// }

// 	// Async cache warming (don't block the response)
// 	go w.warmCache(context.Background(), cacheKey, deviceInfo)

// 	return deviceInfo, nil
// }

// func (w *CacheReader) getDeviceInfoFromRedis(ctx context.Context, cacheKey string) (*DeviceInfo, error) {
// 	val, err := w.client.Get(ctx, cacheKey).Result()
// 	if err != nil {
// 		return nil, err
// 	}

// 	deviceInfo := w.devicePool.Get().(*DeviceInfo)
// 	if err := json.Unmarshal([]byte(val), deviceInfo); err != nil {
// 		w.devicePool.Put(deviceInfo)
// 		return nil, err
// 	}

// 	return deviceInfo, nil
// }

// // The pool automatically handles statement preparation
// // Just use QueryRow directly - pgx caches prepared statements automatically
// // func (w *PostgresReader) getDeviceInfoFromDB(ctx context.Context, deviceID string) (*DeviceInfo, error) {
// func (w *CacheReader) getDeviceInfoFromDB(ctx context.Context, deviceID string) (*DeviceInfo, error) {
// 	deviceInfo := &DeviceInfo{}

// 	var parseConfigJSON []byte

// 	err := w.postgres.QueryRow(ctx, `
// 		SELECT is_active, is_authorized, tenant_id, team_id, parse_config
// 		FROM devices
// 		WHERE device_id = $1
// 	`, deviceID).Scan(
// 		&deviceInfo.IsActive,
// 		&deviceInfo.IsAuthorized,
// 		&deviceInfo.TenantID,
// 		&deviceInfo.TeamID,
// 		&parseConfigJSON,
// 	)

// 	if err != nil {
// 		if err == pgx.ErrNoRows {
// 			return nil, fmt.Errorf("device not found")
// 		}
// 		return nil, err
// 	}

// 	if len(parseConfigJSON) > 0 {
// 		if err := json.Unmarshal(parseConfigJSON, &deviceInfo.ParseConfig); err != nil {
// 			return nil, err
// 		}
// 	}

// 	return deviceInfo, nil
// }

// func (w *CacheReader) warmCache(ctx context.Context, cacheKey string, deviceInfo *DeviceInfo) {
// 	// Store in local cache
// 	w.localCache.SetWithTTL(cacheKey, deviceInfo, 1, 5*time.Minute)

// 	// Store in Redis with 1-hour TTL
// 	data, err := json.Marshal(deviceInfo)
// 	if err != nil {
// 		return
// 	}
// 	w.client.Set(ctx, cacheKey, data, time.Hour)
// }

// // Optional: Batch prefetch for known hot devices
// func (w *CacheReader) PrefetchHotDevices(ctx context.Context, deviceIDs []string) {
// 	for _, deviceID := range deviceIDs {
// 		go func(id string) {
// 			w.getDeviceInfoCached(ctx, id)
// 		}(deviceID)
// 	}
// }

// // Optional: Cache invalidation when device info changes
// func (w *CacheReader) InvalidateDeviceCache(ctx context.Context, deviceID string) error {
// 	cacheKey := "device:" + deviceID

// 	// Remove from local cache
// 	w.localCache.Del(cacheKey)
// 	// Remove from Redis
// 	return w.client.Del(ctx, cacheKey).Err()
// }

// // CACHING LAYER <<<<<<<<<<<<<<<<<
