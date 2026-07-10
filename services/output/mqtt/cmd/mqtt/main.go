package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
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
	log.Println("Starting MQTT Publisher Output Service...")

	cfg := loadConfig()
	logger := log.New(log.Writer(), "[mqtt-publisher] ", log.LstdFlags)

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
		return newMQTTPublisherAdapter(entry, db, jsClient, logger)
	}

	manager := integration.NewWorkerManager(integration.WorkerManagerConfig{
		DB:                db,
		ServiceType:       "output.mqtt",
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
	log.Println("MQTT Publisher Output running. Press Ctrl+C to stop.")
	<-sigChan

	log.Println("Shutting down...")
	manager.Stop()
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 3*time.Second)
	healthSrv.Shutdown(shutCtx)
	shutCancel()
	log.Println("Shutdown complete")
}

type mqttPublisherAdapter struct {
	entry     *integration.IntegrationEntry
	db        *sql.DB
	allowlist *integration.DeviceAllowlist
	orgID     int64
	teamID    int64
	mqttCli   mqtt.Client
	jsClient  *infranats.JetStreamClient
	consumer  infranats.PullConsumer
	cancel    context.CancelFunc
	logger    *log.Logger
	// config
	host         string
	port         int
	username     string
	password     string
	topic        string
	qos          byte
	batchSize    int
	workers      int
	messageCount atomic.Int64
	errorCount   atomic.Int64
	lastMsgAt    atomic.Int64 // Unix nanoseconds
}

func newMQTTPublisherAdapter(entry *integration.IntegrationEntry, db *sql.DB, jsClient *infranats.JetStreamClient, logger *log.Logger) (*mqttPublisherAdapter, error) {
	host := configString(entry.Config, "host", "localhost")
	port := configInt(entry.Config, "port", 1883)
	username := configString(entry.Config, "username", "")
	password := configString(entry.Config, "password", "")
	topic := configString(entry.Config, "topic", "telemetry/out")
	qos := byte(configInt(entry.Config, "qos", 0))
	batchSize := configInt(entry.Config, "batch_size", 256)
	workers := configInt(entry.Config, "workers", 4)

	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[mqtt-pub-%d] ", entry.ID), log.LstdFlags)
	}

	return &mqttPublisherAdapter{
		entry:     entry,
		db:        db,
		orgID:     entry.OrganizationID,
		teamID:    entry.TeamID,
		jsClient:  jsClient,
		logger:    logger,
		host:      host,
		port:      port,
		username:  username,
		password:  password,
		topic:     topic,
		qos:       qos,
		batchSize: batchSize,
		workers:   workers,
	}, nil
}

func (a *mqttPublisherAdapter) natsSubject() string {
	if a.orgID == 0 {
		return "data.>"
	}
	if a.teamID != 0 {
		return fmt.Sprintf("data.%d.%d.>.decoded", a.orgID, a.teamID)
	}
	return fmt.Sprintf("data.%d.>.decoded", a.orgID)
}

func (a *mqttPublisherAdapter) Start(ctx context.Context) error {
	broker := fmt.Sprintf("tcp://%s:%d", a.host, a.port)
	clientID := fmt.Sprintf("zc8-mqtt-pub-%d", a.entry.ID)

	opts := mqtt.NewClientOptions().
		AddBroker(broker).
		SetClientID(clientID).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(5 * time.Second)

	if a.username != "" {
		opts.SetUsername(a.username)
		opts.SetPassword(a.password)
	}

	a.mqttCli = mqtt.NewClient(opts)
	token := a.mqttCli.Connect()
	if !token.WaitTimeout(10 * time.Second) {
		return fmt.Errorf("mqtt connect timeout")
	}
	if token.Error() != nil {
		return fmt.Errorf("mqtt connect: %w", token.Error())
	}

	consumerName := fmt.Sprintf("mqtt-publisher-%d", a.entry.ID)
	subject := a.natsSubject()
	cons, err := a.jsClient.CreateConsumer(ctx, infranats.ConsumerConfig{
		Durable:        consumerName,
		FilterSubjects: []string{subject},
		MaxAckPending:  a.batchSize * a.workers,
		AckWait:        30 * time.Second,
	})
	if err != nil {
		a.mqttCli.Disconnect(250)
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

	a.logger.Printf("Started: %s topic=%s qos=%d subject=%s workers=%d", broker, a.topic, a.qos, subject, a.workers)
	return nil
}

func (a *mqttPublisherAdapter) Stop() {
	if a.cancel != nil {
		a.cancel()
	}
	if a.mqttCli != nil && a.mqttCli.IsConnected() {
		a.mqttCli.Disconnect(250)
	}
}

func (a *mqttPublisherAdapter) Status() map[string]interface{} {
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
		"is_connected":    a.mqttCli != nil && a.mqttCli.IsConnected(),
		"is_running":      a.cancel != nil,
		"message_count":   a.messageCount.Load(),
		"error_count":     a.errorCount.Load(),
		"last_message_at": lastMsg,
		"broker":          fmt.Sprintf("%s:%d", a.host, a.port),
		"topic":           a.topic,
	}
}

func (a *mqttPublisherAdapter) consumeLoop(ctx context.Context, workerID int) {
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

		for msg := range msgs.Messages() {
			a.processMessage(ctx, workerID, msg)
		}

		if err := msgs.Error(); err != nil && ctx.Err() == nil {
			a.logger.Printf("worker %d: messages error: %v", workerID, err)
		}
	}
}

type mqttPayload struct {
	DeviceKey uint64             `json:"device_key"`
	Fields    map[string]float64 `json:"fields"`
	Timestamp int64              `json:"timestamp"`
}

func (a *mqttPublisherAdapter) processMessage(ctx context.Context, workerID int, msg infranats.ConsumerMsg) {
	env, err := pb.UnmarshalEnvelope(msg.Data())
	if err != nil {
		a.logger.Printf("worker %d: unmarshal error: %v", workerID, err)
		msg.Ack()
		return
	}

	decoded := env.GetDecoded()
	if decoded == nil || len(decoded.Fields) == 0 {
		msg.Ack()
		return
	}

	if env.DeviceKey == 0 || !a.allowlist.ContainsDevice(env.DeviceKey) {
		msg.Ack()
		return
	}

	fields := make(map[string]float64, len(decoded.Fields))
	for _, sf := range decoded.Fields {
		fields[sf.SensorType] = sf.CalibratedValue
	}

	payload := mqttPayload{
		DeviceKey: env.DeviceKey,
		Fields:    fields,
		Timestamp: time.Now().UnixMilli(),
	}

	data, err := json.Marshal(payload)
	if err != nil {
		a.logger.Printf("worker %d: json marshal error: %v", workerID, err)
		msg.Ack()
		return
	}

	publishTopic := fmt.Sprintf("%s/%s", a.topic, strconv.FormatUint(env.DeviceKey, 10))

	token := a.mqttCli.Publish(publishTopic, a.qos, false, data)
	if !token.WaitTimeout(5 * time.Second) {
		a.logger.Printf("worker %d: publish timeout", workerID)
		a.errorCount.Add(1)
		msg.Nak()
		return
	}
	if token.Error() != nil {
		a.logger.Printf("worker %d: publish error: %v", workerID, token.Error())
		a.errorCount.Add(1)
		msg.Nak()
		return
	}

	a.messageCount.Add(1)
	a.lastMsgAt.Store(time.Now().UnixNano())
	msg.Ack()
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

var _ integration.Adapter = (*mqttPublisherAdapter)(nil)
