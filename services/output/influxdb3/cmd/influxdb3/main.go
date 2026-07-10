package main

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"

	infrainflux "github.com/rogeriocassares/zc8/packages/go-infra/influx"
	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	integration "github.com/rogeriocassares/zc8/packages/go-integration"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

type Config struct {
	DatabaseURL string
	NATSURL     string
}

func loadConfig() Config {
	return Config{
		DatabaseURL: getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/zc8?sslmode=disable"),
		NATSURL:     getenv("NATS_URL", "nats://localhost:4222"),
	}
}

func getenv(key, defaultValue string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultValue
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Starting InfluxDB3 Writer Output Service...")

	cfg := loadConfig()
	logger := log.New(log.Writer(), "[influxdb3-writer] ", log.LstdFlags)

	db, err := integration.OpenDatabase(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer db.Close()
	log.Println("Database connected")

	ctx := context.Background()

	jsClient, err := infranats.NewJetStream(ctx, infranats.JetStreamConfig{
		URL:        cfg.NATSURL,
		StreamName: "DATA",
		Subjects:   []string{"data.>"},
		Replicas:   1,
	}, logger)
	if err != nil {
		log.Fatalf("JetStream connection failed: %v", err)
	}
	defer jsClient.Close()
	log.Println("JetStream connected")

	adapterFactory := func(entry *integration.IntegrationEntry) (integration.Adapter, error) {
		return newInfluxDB3Adapter(entry, db, jsClient, logger)
	}

	manager := integration.NewWorkerManager(integration.WorkerManagerConfig{
		DB:                db,
		ServiceType:       "output.influxdb3",
		DiscoveryInterval: 30 * time.Second,
		AdapterFactory:    adapterFactory,
		SvcJS:             jsClient,
		StatusInterval:    15 * time.Second,
		Logger:            logger,
	})

	startCtx, startCancel := context.WithTimeout(ctx, 10*time.Second)
	if err := manager.Start(startCtx); err != nil {
		startCancel()
		log.Fatalf("Failed to start worker manager: %v", err)
	}
	startCancel()
	log.Println("Worker manager started")

	healthSrv := integration.NewHealthServer(getenv("HEALTH_PORT", ":9090"), db, jsClient.Conn())
	healthSrv.Start()
	log.Printf("Health server listening on %s", getenv("HEALTH_PORT", ":9090"))

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	log.Println("InfluxDB3 Writer Output running. Press Ctrl+C to stop.")
	<-sigChan

	log.Println("Shutting down...")
	manager.Stop()
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 3*time.Second)
	healthSrv.Shutdown(shutCtx)
	shutCancel()
	log.Println("Shutdown complete")
}

type influxDB3Adapter struct {
	entry       *integration.IntegrationEntry
	db          *sql.DB
	allowlist   *integration.DeviceAllowlist
	influxConn  *infrainflux.Client
	jsClient    *infranats.JetStreamClient
	consumer    infranats.PullConsumer
	cancel      context.CancelFunc
	logger      *log.Logger
	host        string
	port        int
	token       string
	bucket      string
	measurement string
	useTLS      bool
	batchSize   int
	workers     int
	// orgID / teamID from the service's own scope; zero means global.
	orgID        int64
	teamID       int64
	messageCount atomic.Int64
	errorCount   atomic.Int64
	lastMsgAt    atomic.Int64 // Unix nanoseconds
}

func newInfluxDB3Adapter(entry *integration.IntegrationEntry, db *sql.DB, jsClient *infranats.JetStreamClient, logger *log.Logger) (*influxDB3Adapter, error) {
	host := configString(entry.Config, "host", "localhost")
	port := configInt(entry.Config, "port", 8181)
	token := configString(entry.Config, "token", "")
	bucket := configString(entry.Config, "bucket", "telemetry")
	measurement := configString(entry.Config, "measurement", "telemetry")
	useTLS := configBool(entry.Config, "use_tls", false)
	batchSize := configInt(entry.Config, "batch_size", 256)
	workers := configInt(entry.Config, "workers", 4)

	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[influxdb3-%d] ", entry.ID), log.LstdFlags)
	}

	return &influxDB3Adapter{
		entry:       entry,
		db:          db,
		jsClient:    jsClient,
		logger:      logger,
		host:        host,
		port:        port,
		token:       token,
		bucket:      bucket,
		measurement: measurement,
		useTLS:      useTLS,
		batchSize:   batchSize,
		workers:     workers,
		orgID:       entry.OrganizationID,
		teamID:      entry.TeamID,
	}, nil
}

func (a *influxDB3Adapter) Start(ctx context.Context) error {
	// Routing is now fully handled by NATS subject scope:
	// each service subscribes only to telemetry for its own org (and optionally
	// team).  No per-device routing table needed.
	subject := a.natsSubject()

	scheme := "http"
	if a.useTLS {
		scheme = "https"
	}
	url := fmt.Sprintf("%s://%s:%d", scheme, a.host, a.port)

	conn, err := infrainflux.New(ctx, infrainflux.Config{
		URL:   url,
		Token: a.token,
	})
	if err != nil {
		return fmt.Errorf("influxdb3 connect: %w", err)
	}
	a.influxConn = conn

	consumerName := fmt.Sprintf("influxdb3-writer-%d", a.entry.ID)
	cons, err := a.jsClient.CreateConsumer(ctx, infranats.ConsumerConfig{
		Durable:        consumerName,
		FilterSubjects: []string{subject},
		MaxAckPending:  a.batchSize * a.workers,
		AckWait:        30 * time.Second,
	})
	if err != nil {
		conn.Close()
		return fmt.Errorf("create consumer: %w", err)
	}
	a.consumer = cons

	consumeCtx, cancel := context.WithCancel(ctx)
	a.cancel = cancel

	a.allowlist = integration.NewDeviceAllowlist(a.db, a.entry.ID, a.logger)
	a.allowlist.Start(context.Background(), 30*time.Second)

	for i := range a.workers {
		go a.consumeLoop(consumeCtx, i)
	}

	a.logger.Printf("Started: %s bucket=%s measurement=%s subject=%s workers=%d",
		url, a.bucket, a.measurement, subject, a.workers)
	return nil
}

func (a *influxDB3Adapter) Stop() {
	if a.cancel != nil {
		a.cancel()
	}
	if a.influxConn != nil {
		a.influxConn.Close()
	}
}

// natsSubject returns the JetStream filter subject for this adapter's scope.
// Output services subscribe to the decoded subjects only:
//
//	data.{orgId}.{teamId}.{deviceKey}.decoded
//
// Global services (OrganizationID==0) receive everything decoded;
// org-scoped services receive only their org; team-scoped receive only their team.
func (a *influxDB3Adapter) natsSubject() string {
	if a.orgID == 0 {
		return "data.>"
	}
	if a.teamID != 0 {
		return fmt.Sprintf("data.%d.%d.>.decoded", a.orgID, a.teamID)
	}
	return fmt.Sprintf("data.%d.>.decoded", a.orgID)
}

func (a *influxDB3Adapter) Status() map[string]interface{} {
	lastMsg := ""
	if ts := a.lastMsgAt.Load(); ts > 0 {
		lastMsg = time.Unix(0, ts).Format(time.RFC3339)
	}
	return map[string]interface{}{
		"service_id":      a.entry.ID,
		"service_type":    a.entry.ServiceType,
		"org_id":          a.entry.OrganizationID,
		"team_id":         a.entry.TeamID,
		"team_name":       a.entry.TeamName,
		"is_connected":    a.influxConn != nil && a.cancel != nil,
		"is_running":      a.cancel != nil,
		"message_count":   a.messageCount.Load(),
		"error_count":     a.errorCount.Load(),
		"last_message_at": lastMsg,
		"host":            a.host,
		"bucket":          a.bucket,
		"measurement":     a.measurement,
	}
}

func (a *influxDB3Adapter) consumeLoop(ctx context.Context, workerID int) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		msgs, err := a.consumer.Fetch(a.batchSize, infranats.FetchMaxWait(500*time.Millisecond))
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			a.logger.Printf("worker %d: fetch error: %v", workerID, err)
			time.Sleep(100 * time.Millisecond)
			continue
		}

		var buf bytes.Buffer
		var ackMsgs []infranats.ConsumerMsg
		now := time.Now().UnixNano()

		for msg := range msgs.Messages() {
			env, err := pb.UnmarshalEnvelope(msg.Data())
			if err != nil {
				a.logger.Printf("worker %d: unmarshal error: %v", workerID, err)
				msg.Ack()
				continue
			}

			decoded := env.GetDecoded()
			if decoded == nil || len(decoded.Fields) == 0 {
				msg.Ack()
				continue
			}

			if env.DeviceKey == 0 || !a.allowlist.ContainsDevice(env.DeviceKey) {
				msg.Ack()
				continue
			}

			a.writeLineProtocol(&buf, env, now)
			ackMsgs = append(ackMsgs, msg)
		}

		if err := msgs.Error(); err != nil && ctx.Err() == nil {
			a.logger.Printf("worker %d: messages error: %v", workerID, err)
		}

		if buf.Len() > 0 {
			writeCtx, writeCancel := context.WithTimeout(context.Background(), 10*time.Second)
			err := a.influxConn.WriteLineProtocol(writeCtx, a.bucket, buf.Bytes())
			writeCancel()

			if err != nil {
				a.logger.Printf("worker %d: write error: %v", workerID, err)
				a.errorCount.Add(int64(len(ackMsgs)))
				for _, m := range ackMsgs {
					m.Nak()
				}
			} else {
				a.messageCount.Add(int64(len(ackMsgs)))
				a.lastMsgAt.Store(time.Now().UnixNano())
				for _, m := range ackMsgs {
					m.Ack()
				}
			}
		}
	}
}

// writeLineProtocol writes InfluxDB line protocol for sensor_data and sensor_calibration
// measurements. Each SensorField produces one point per measurement.
func (a *influxDB3Adapter) writeLineProtocol(buf *bytes.Buffer, env *pb.IngestEnvelope, tsNano int64) {
	decoded := env.GetDecoded()
	if decoded == nil {
		return
	}

	deviceKey := strconv.FormatUint(env.DeviceKey, 10)
	timestamp := strconv.FormatInt(tsNano, 10)

	// Build shared tag set (identical for sensor_data and sensor_calibration per field)
	// InfluxDB3 tags: org_id, team_id, device_key, model_code, location_name, asset_id, category
	sharedTags := "org_id=" + decoded.OrgId +
		",team_id=" + decoded.TeamId +
		",device_key=" + deviceKey
	if decoded.ModelCode != "" {
		sharedTags += ",model_code=" + decoded.ModelCode
	}
	if decoded.LocationName != "" {
		sharedTags += ",location_name=" + decoded.LocationName
	}
	if decoded.AssetId != "" {
		sharedTags += ",asset_id=" + decoded.AssetId
	}
	if decoded.Category != "" {
		sharedTags += ",category=" + decoded.Category
	}

	for _, sf := range decoded.Fields {
		// --- sensor_data measurement ---
		buf.WriteString("sensor_data,")
		buf.WriteString(sharedTags)
		buf.WriteString(",sensor_type=")
		buf.WriteString(sf.SensorType)
		buf.WriteByte(' ')

		// value fields by type
		switch sf.ValueType {
		case pb.ValueType_VALUE_FLOAT:
			buf.WriteString("value_float=")
			buf.WriteString(strconv.FormatFloat(sf.ValueFloat, 'f', -1, 64))
		case pb.ValueType_VALUE_INT:
			buf.WriteString("value_int=")
			buf.WriteString(strconv.FormatInt(sf.ValueInt, 10))
			buf.WriteString("i")
		case pb.ValueType_VALUE_BOOL:
			if sf.ValueBool {
				buf.WriteString("value_bool=true")
			} else {
				buf.WriteString("value_bool=false")
			}
		}
		buf.WriteString(",value_type=")
		buf.WriteString("\"" + sf.ValueType.String() + "\"")
		buf.WriteString(",calibrated_value=")
		buf.WriteString(strconv.FormatFloat(sf.CalibratedValue, 'f', -1, 64))
		if sf.Unit != "" {
			buf.WriteString(",unit=\"")
			buf.WriteString(sf.Unit)
			buf.WriteString("\"")
		}
		buf.WriteByte(' ')
		buf.WriteString(timestamp)
		buf.WriteByte('\n')

		// --- sensor_calibration measurement (snapshot) ---
		buf.WriteString("sensor_calibration,")
		buf.WriteString("device_key=" + deviceKey)
		buf.WriteString(",sensor_type=")
		buf.WriteString(sf.SensorType)
		buf.WriteString(" scale=")
		buf.WriteString(strconv.FormatFloat(sf.Scale, 'f', -1, 64))
		buf.WriteString(",offset=")
		buf.WriteString(strconv.FormatFloat(sf.Offset, 'f', -1, 64))
		if sf.Unit != "" {
			buf.WriteString(",unit=\"")
			buf.WriteString(sf.Unit)
			buf.WriteString("\"")
		}
		buf.WriteByte(' ')
		buf.WriteString(timestamp)
		buf.WriteByte('\n')
	}
}

func configString(m map[string]interface{}, key, defaultVal string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return defaultVal
}

func configInt(m map[string]interface{}, key string, defaultVal int) int {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		case int64:
			return int(n)
		}
	}
	return defaultVal
}

func configBool(m map[string]interface{}, key string, defaultVal bool) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return defaultVal
}

var _ integration.Adapter = (*influxDB3Adapter)(nil)
