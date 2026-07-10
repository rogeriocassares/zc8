package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

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
	log.Println("Starting HTTP Client Output Service...")

	cfg := loadConfig()
	logger := log.New(log.Writer(), "[http-client-out] ", log.LstdFlags)

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
		return newHTTPClientAdapter(entry, db, jsClient, logger)
	}

	manager := integration.NewWorkerManager(integration.WorkerManagerConfig{
		DB:                db,
		ServiceType:       "output.http-push",
		DiscoveryInterval: 30 * time.Second,
		AdapterFactory:    adapterFactory,
		Logger:            logger,
		SvcJS:             jsClient,
		StatusInterval:    15 * time.Second,
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
	log.Println("HTTP Client Output running. Press Ctrl+C to stop.")
	<-sigChan

	log.Println("Shutting down...")
	manager.Stop()
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 3*time.Second)
	healthSrv.Shutdown(shutCtx)
	shutCancel()
	log.Println("Shutdown complete")
}

type httpClientAdapter struct {
	entry         *integration.IntegrationEntry
	db            *sql.DB
	allowlist     *integration.DeviceAllowlist
	orgID         int64
	teamID        int64
	httpClient    *http.Client
	jsClient      *infranats.JetStreamClient
	consumer      infranats.PullConsumer
	cancel        context.CancelFunc
	logger        *log.Logger
	baseURL       string
	method        string
	headers       map[string]string
	authType      string
	authCreds     string
	tlsSkipVerify bool
	timeout       time.Duration
	retryDelay    time.Duration
	batchSize     int
	workers       int
	messageCount  atomic.Int64
	errorCount    atomic.Int64
	lastMsgAt     atomic.Int64 // Unix nanoseconds
}

func newHTTPClientAdapter(entry *integration.IntegrationEntry, db *sql.DB, jsClient *infranats.JetStreamClient, logger *log.Logger) (*httpClientAdapter, error) {
	baseURL := configString(entry.Config, "base_url", "http://localhost:8080/telemetry")
	method := strings.ToUpper(configString(entry.Config, "method", "POST"))
	authType := configString(entry.Config, "auth_type", "")
	authCreds := configString(entry.Config, "auth_credentials", "")
	tlsSkipVerify := configBool(entry.Config, "tls_skip_verify", false)
	timeoutSec := configInt(entry.Config, "timeout_seconds", 10)
	retryDelaySec := configInt(entry.Config, "retry_delay_seconds", 1)
	batchSize := configInt(entry.Config, "batch_size", 256)
	workers := configInt(entry.Config, "workers", 4)

	headers := make(map[string]string)
	if rawHeaders, ok := entry.Config["headers"]; ok {
		if hmap, ok := rawHeaders.(map[string]interface{}); ok {
			for k, v := range hmap {
				if s, ok := v.(string); ok {
					headers[k] = s
				}
			}
		}
	}

	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[http-out-%d] ", entry.ID), log.LstdFlags)
	}

	return &httpClientAdapter{
		entry:         entry,
		db:            db,
		orgID:         entry.OrganizationID,
		teamID:        entry.TeamID,
		jsClient:      jsClient,
		logger:        logger,
		baseURL:       baseURL,
		method:        method,
		headers:       headers,
		authType:      authType,
		authCreds:     authCreds,
		tlsSkipVerify: tlsSkipVerify,
		timeout:       time.Duration(timeoutSec) * time.Second,
		retryDelay:    time.Duration(retryDelaySec) * time.Second,
		batchSize:     batchSize,
		workers:       workers,
	}, nil
}

func (a *httpClientAdapter) natsSubject() string {
	if a.orgID == 0 {
		return "data.>"
	}
	if a.teamID != 0 {
		return fmt.Sprintf("data.%d.%d.>.decoded", a.orgID, a.teamID)
	}
	return fmt.Sprintf("data.%d.>.decoded", a.orgID)
}

func (a *httpClientAdapter) Start(ctx context.Context) error {
	transport := &http.Transport{}
	if a.tlsSkipVerify {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // user-configured
	}
	a.httpClient = &http.Client{
		Timeout:   a.timeout,
		Transport: transport,
	}

	consumerName := fmt.Sprintf("http-client-out-%d", a.entry.ID)
	subject := a.natsSubject()
	cons, err := a.jsClient.CreateConsumer(ctx, infranats.ConsumerConfig{
		Durable:        consumerName,
		FilterSubjects: []string{subject},
		MaxAckPending:  a.batchSize * a.workers,
		AckWait:        30 * time.Second,
	})
	if err != nil {
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

	a.logger.Printf("Started: %s %s subject=%s workers=%d", a.method, a.baseURL, subject, a.workers)
	return nil
}

func (a *httpClientAdapter) Stop() {
	if a.cancel != nil {
		a.cancel()
	}
	if a.httpClient != nil {
		a.httpClient.CloseIdleConnections()
	}
}

func (a *httpClientAdapter) Status() map[string]interface{} {
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
		"is_connected":    a.httpClient != nil && a.cancel != nil,
		"is_running":      a.cancel != nil,
		"message_count":   a.messageCount.Load(),
		"error_count":     a.errorCount.Load(),
		"last_message_at": lastMsg,
		"base_url":        a.baseURL,
		"method":          a.method,
	}
}

func (a *httpClientAdapter) consumeLoop(ctx context.Context, workerID int) {
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

type httpPayload struct {
	DeviceKey uint64             `json:"device_key"`
	Fields    map[string]float64 `json:"fields"`
	Timestamp int64              `json:"timestamp"`
}

func (a *httpClientAdapter) processMessage(ctx context.Context, workerID int, msg infranats.ConsumerMsg) {
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

	payload := httpPayload{
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

	url := fmt.Sprintf("%s/%s", a.baseURL, strconv.FormatUint(env.DeviceKey, 10))
	httpReq, err := http.NewRequestWithContext(ctx, a.method, url, bytes.NewReader(data))
	if err != nil {
		a.logger.Printf("worker %d: request create error: %v", workerID, err)
		msg.Nak()
		return
	}

	httpReq.Header.Set("Content-Type", "application/json")
	for k, v := range a.headers {
		httpReq.Header.Set(k, v)
	}

	switch a.authType {
	case "bearer":
		httpReq.Header.Set("Authorization", "Bearer "+a.authCreds)
	case "basic":
		httpReq.Header.Set("Authorization", "Basic "+a.authCreds)
	}

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		a.logger.Printf("worker %d: http error: %v", workerID, err)
		msg.Nak()
		return
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		a.messageCount.Add(1)
		a.lastMsgAt.Store(time.Now().UnixNano())
		msg.Ack()
	} else {
		a.logger.Printf("worker %d: http status %d", workerID, resp.StatusCode)
		a.errorCount.Add(1)
		msg.Nak()
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

var _ integration.Adapter = (*httpClientAdapter)(nil)
