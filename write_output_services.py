#!/usr/bin/env python3
"""Write clean output service main.go files for mqtt-publisher, http-client, grpc-client."""
import os

base = '/Users/rogeriocassares/Git/rogeriocassares/zc8'

files = {}

# ─── MQTT Publisher ─────────────────────────────────────────────────────
files['services/output/mqtt-publisher/cmd/mqtt-publisher/main.go'] = r'''package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
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
		DatabaseURL: getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/zc8"),
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
		StreamName: "TELEMETRY",
		Subjects:   []string{"telemetry.raw.>"},
		Replicas:   1,
	}, logger)
	if err != nil {
		log.Fatalf("JetStream connection failed: %v", err)
	}
	defer jsClient.Close()
	log.Println("JetStream connected")

	adapterFactory := func(entry *integration.IntegrationEntry) (integration.Adapter, error) {
		return newMQTTPublisherAdapter(entry, jsClient, logger)
	}

	manager := integration.NewWorkerManager(integration.WorkerManagerConfig{
		DB:                  db,
		IntegrationTypeCode: "mqtt",
		Direction:           "output",
		DiscoveryInterval:   30 * time.Second,
		AdapterFactory:      adapterFactory,
		Logger:              logger,
	})

	startCtx, startCancel := context.WithTimeout(ctx, 10*time.Second)
	if err := manager.Start(startCtx); err != nil {
		startCancel()
		log.Fatalf("Failed to start worker manager: %v", err)
	}
	startCancel()
	log.Println("Worker manager started")

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	log.Println("MQTT Publisher Output running. Press Ctrl+C to stop.")
	<-sigChan

	log.Println("Shutting down...")
	manager.Stop()
	log.Println("Shutdown complete")
}

type mqttPublisherAdapter struct {
	entry    *integration.IntegrationEntry
	mqttCli  mqtt.Client
	jsClient *infranats.JetStreamClient
	consumer infranats.PullConsumer
	cancel   context.CancelFunc
	logger   *log.Logger
	// config
	host      string
	port      int
	username  string
	password  string
	topic     string
	qos       byte
	batchSize int
	workers   int
}

func newMQTTPublisherAdapter(entry *integration.IntegrationEntry, jsClient *infranats.JetStreamClient, logger *log.Logger) (*mqttPublisherAdapter, error) {
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
	cons, err := a.jsClient.CreateConsumer(ctx, infranats.ConsumerConfig{
		Durable:        consumerName,
		FilterSubjects: []string{"telemetry.raw.>"},
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

	for i := range a.workers {
		go a.consumeLoop(consumeCtx, i)
	}

	a.logger.Printf("Started: %s topic=%s qos=%d workers=%d", broker, a.topic, a.qos, a.workers)
	return nil
}

func (a *mqttPublisherAdapter) Stop(ctx context.Context) error {
	if a.cancel != nil {
		a.cancel()
	}
	if a.mqttCli != nil && a.mqttCli.IsConnected() {
		a.mqttCli.Disconnect(250)
	}
	return nil
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
	DeviceKey uint64            `json:"device_key"`
	Fields    map[string]float64 `json:"fields"`
	Timestamp int64             `json:"timestamp"`
}

func (a *mqttPublisherAdapter) processMessage(ctx context.Context, workerID int, msg infranats.ConsumerMsg) {
	req, err := pb.UnmarshalIngestRequest(msg.Data())
	if err != nil {
		a.logger.Printf("worker %d: unmarshal error: %v", workerID, err)
		msg.Ack()
		return
	}

	if len(req.PreParsedFields) == 0 {
		msg.Ack()
		return
	}

	fields := make(map[string]float64, len(req.PreParsedFields))
	for _, pf := range req.PreParsedFields {
		fields[pf.Key] = pf.Value
	}

	payload := mqttPayload{
		DeviceKey: req.DeviceKey,
		Fields:    fields,
		Timestamp: time.Now().UnixMilli(),
	}

	data, err := json.Marshal(payload)
	if err != nil {
		a.logger.Printf("worker %d: json marshal error: %v", workerID, err)
		msg.Ack()
		return
	}

	publishTopic := fmt.Sprintf("%s/%s", a.topic, strconv.FormatUint(req.DeviceKey, 10))
	token := a.mqttCli.Publish(publishTopic, a.qos, false, data)
	if !token.WaitTimeout(5 * time.Second) {
		a.logger.Printf("worker %d: publish timeout", workerID)
		msg.Nak()
		return
	}
	if token.Error() != nil {
		a.logger.Printf("worker %d: publish error: %v", workerID, token.Error())
		msg.Nak()
		return
	}

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
'''

# ─── HTTP Client Output ────────────────────────────────────────────────
files['services/output/http-client/cmd/http-client/main.go'] = r'''package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
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
		DatabaseURL: getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/zc8"),
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
		StreamName: "TELEMETRY",
		Subjects:   []string{"telemetry.raw.>"},
		Replicas:   1,
	}, logger)
	if err != nil {
		log.Fatalf("JetStream connection failed: %v", err)
	}
	defer jsClient.Close()
	log.Println("JetStream connected")

	adapterFactory := func(entry *integration.IntegrationEntry) (integration.Adapter, error) {
		return newHTTPClientAdapter(entry, jsClient, logger)
	}

	manager := integration.NewWorkerManager(integration.WorkerManagerConfig{
		DB:                  db,
		IntegrationTypeCode: "http",
		Direction:           "output",
		DiscoveryInterval:   30 * time.Second,
		AdapterFactory:      adapterFactory,
		Logger:              logger,
	})

	startCtx, startCancel := context.WithTimeout(ctx, 10*time.Second)
	if err := manager.Start(startCtx); err != nil {
		startCancel()
		log.Fatalf("Failed to start worker manager: %v", err)
	}
	startCancel()
	log.Println("Worker manager started")

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	log.Println("HTTP Client Output running. Press Ctrl+C to stop.")
	<-sigChan

	log.Println("Shutting down...")
	manager.Stop()
	log.Println("Shutdown complete")
}

type httpClientAdapter struct {
	entry          *integration.IntegrationEntry
	httpClient     *http.Client
	jsClient       *infranats.JetStreamClient
	consumer       infranats.PullConsumer
	cancel         context.CancelFunc
	logger         *log.Logger
	baseURL        string
	method         string
	headers        map[string]string
	authType       string
	authCreds      string
	tlsSkipVerify  bool
	timeout        time.Duration
	retryDelay     time.Duration
	batchSize      int
	workers        int
}

func newHTTPClientAdapter(entry *integration.IntegrationEntry, jsClient *infranats.JetStreamClient, logger *log.Logger) (*httpClientAdapter, error) {
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
	cons, err := a.jsClient.CreateConsumer(ctx, infranats.ConsumerConfig{
		Durable:        consumerName,
		FilterSubjects: []string{"telemetry.raw.>"},
		MaxAckPending:  a.batchSize * a.workers,
		AckWait:        30 * time.Second,
	})
	if err != nil {
		return fmt.Errorf("create consumer: %w", err)
	}
	a.consumer = cons

	consumeCtx, cancel := context.WithCancel(ctx)
	a.cancel = cancel

	for i := range a.workers {
		go a.consumeLoop(consumeCtx, i)
	}

	a.logger.Printf("Started: %s %s workers=%d", a.method, a.baseURL, a.workers)
	return nil
}

func (a *httpClientAdapter) Stop(ctx context.Context) error {
	if a.cancel != nil {
		a.cancel()
	}
	if a.httpClient != nil {
		a.httpClient.CloseIdleConnections()
	}
	return nil
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
	req, err := pb.UnmarshalIngestRequest(msg.Data())
	if err != nil {
		a.logger.Printf("worker %d: unmarshal error: %v", workerID, err)
		msg.Ack()
		return
	}

	if len(req.PreParsedFields) == 0 {
		msg.Ack()
		return
	}

	fields := make(map[string]float64, len(req.PreParsedFields))
	for _, pf := range req.PreParsedFields {
		fields[pf.Key] = pf.Value
	}

	payload := httpPayload{
		DeviceKey: req.DeviceKey,
		Fields:    fields,
		Timestamp: time.Now().UnixMilli(),
	}

	data, err := json.Marshal(payload)
	if err != nil {
		a.logger.Printf("worker %d: json marshal error: %v", workerID, err)
		msg.Ack()
		return
	}

	url := fmt.Sprintf("%s/%s", a.baseURL, strconv.FormatUint(req.DeviceKey, 10))
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
		msg.Ack()
	} else {
		a.logger.Printf("worker %d: http status %d", workerID, resp.StatusCode)
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
'''

# ─── gRPC Client Output ────────────────────────────────────────────────
files['services/output/grpc-client/cmd/grpc-client/main.go'] = r'''package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	integration "github.com/rogeriocassares/zc8/packages/go-integration"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

type Config struct {
	DatabaseURL string
	NATSURL     string
}

func loadConfig() Config {
	return Config{
		DatabaseURL: getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/zc8"),
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
	log.Println("Starting gRPC Client Output Service...")

	cfg := loadConfig()
	logger := log.New(log.Writer(), "[grpc-client-out] ", log.LstdFlags)

	db, err := integration.OpenDatabase(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer db.Close()
	log.Println("Database connected")

	ctx := context.Background()

	jsClient, err := infranats.NewJetStream(ctx, infranats.JetStreamConfig{
		URL:        cfg.NATSURL,
		StreamName: "TELEMETRY",
		Subjects:   []string{"telemetry.raw.>"},
		Replicas:   1,
	}, logger)
	if err != nil {
		log.Fatalf("JetStream connection failed: %v", err)
	}
	defer jsClient.Close()
	log.Println("JetStream connected")

	adapterFactory := func(entry *integration.IntegrationEntry) (integration.Adapter, error) {
		return newGRPCClientAdapter(entry, jsClient, logger)
	}

	manager := integration.NewWorkerManager(integration.WorkerManagerConfig{
		DB:                  db,
		IntegrationTypeCode: "grpc",
		Direction:           "output",
		DiscoveryInterval:   30 * time.Second,
		AdapterFactory:      adapterFactory,
		Logger:              logger,
	})

	startCtx, startCancel := context.WithTimeout(ctx, 10*time.Second)
	if err := manager.Start(startCtx); err != nil {
		startCancel()
		log.Fatalf("Failed to start worker manager: %v", err)
	}
	startCancel()
	log.Println("Worker manager started")

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	log.Println("gRPC Client Output running. Press Ctrl+C to stop.")
	<-sigChan

	log.Println("Shutting down...")
	manager.Stop()
	log.Println("Shutdown complete")
}

type grpcClientAdapter struct {
	entry             *integration.IntegrationEntry
	grpcConn          *grpc.ClientConn
	ingestClient      pb.TelemetryIngestServiceClient
	jsClient          *infranats.JetStreamClient
	consumer          infranats.PullConsumer
	cancel            context.CancelFunc
	logger            *log.Logger
	host              string
	port              int
	useTLS            bool
	tlsCACert         string
	tlsClientCert     string
	tlsClientKey      string
	connectionTimeout time.Duration
	batchSize         int
	workers           int
}

func newGRPCClientAdapter(entry *integration.IntegrationEntry, jsClient *infranats.JetStreamClient, logger *log.Logger) (*grpcClientAdapter, error) {
	host := configString(entry.Config, "host", "localhost")
	port := configInt(entry.Config, "port", 50051)
	useTLS := configBool(entry.Config, "use_tls", false)
	tlsCACert := configString(entry.Config, "tls_ca_cert", "")
	tlsClientCert := configString(entry.Config, "tls_client_cert", "")
	tlsClientKey := configString(entry.Config, "tls_client_key", "")
	connectionTimeoutSec := configInt(entry.Config, "connection_timeout_seconds", 10)
	batchSize := configInt(entry.Config, "batch_size", 256)
	workers := configInt(entry.Config, "workers", 4)

	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[grpc-out-%d] ", entry.ID), log.LstdFlags)
	}

	return &grpcClientAdapter{
		entry:             entry,
		jsClient:          jsClient,
		logger:            logger,
		host:              host,
		port:              port,
		useTLS:            useTLS,
		tlsCACert:         tlsCACert,
		tlsClientCert:     tlsClientCert,
		tlsClientKey:      tlsClientKey,
		connectionTimeout: time.Duration(connectionTimeoutSec) * time.Second,
		batchSize:         batchSize,
		workers:           workers,
	}, nil
}

func (a *grpcClientAdapter) Start(ctx context.Context) error {
	target := fmt.Sprintf("%s:%d", a.host, a.port)

	var dialOpts []grpc.DialOption
	if a.useTLS {
		tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}

		if a.tlsCACert != "" {
			caCert, err := os.ReadFile(a.tlsCACert)
			if err != nil {
				return fmt.Errorf("read CA cert: %w", err)
			}
			certPool := x509.NewCertPool()
			if !certPool.AppendCertsFromPEM(caCert) {
				return fmt.Errorf("failed to add CA cert")
			}
			tlsCfg.RootCAs = certPool
		}

		if a.tlsClientCert != "" && a.tlsClientKey != "" {
			cert, err := tls.LoadX509KeyPair(a.tlsClientCert, a.tlsClientKey)
			if err != nil {
				return fmt.Errorf("load client cert: %w", err)
			}
			tlsCfg.Certificates = []tls.Certificate{cert}
		}

		dialOpts = append(dialOpts, grpc.WithTransportCredentials(credentials.NewTLS(tlsCfg)))
	} else {
		dialOpts = append(dialOpts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	}

	dialCtx, dialCancel := context.WithTimeout(ctx, a.connectionTimeout)
	defer dialCancel()

	conn, err := grpc.DialContext(dialCtx, target, dialOpts...)
	if err != nil {
		return fmt.Errorf("grpc dial %s: %w", target, err)
	}
	a.grpcConn = conn
	a.ingestClient = pb.NewTelemetryIngestServiceClient(conn)

	consumerName := fmt.Sprintf("grpc-client-out-%d", a.entry.ID)
	cons, err := a.jsClient.CreateConsumer(ctx, infranats.ConsumerConfig{
		Durable:        consumerName,
		FilterSubjects: []string{"telemetry.raw.>"},
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

	for i := range a.workers {
		go a.consumeLoop(consumeCtx, i)
	}

	a.logger.Printf("Started: %s tls=%v workers=%d", target, a.useTLS, a.workers)
	return nil
}

func (a *grpcClientAdapter) Stop(ctx context.Context) error {
	if a.cancel != nil {
		a.cancel()
	}
	if a.grpcConn != nil {
		return a.grpcConn.Close()
	}
	return nil
}

func (a *grpcClientAdapter) consumeLoop(ctx context.Context, workerID int) {
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

func (a *grpcClientAdapter) processMessage(ctx context.Context, workerID int, msg infranats.ConsumerMsg) {
	req, err := pb.UnmarshalIngestRequest(msg.Data())
	if err != nil {
		a.logger.Printf("worker %d: unmarshal error: %v", workerID, err)
		msg.Ack()
		return
	}

	callCtx, callCancel := context.WithTimeout(ctx, 5*time.Second)
	defer callCancel()

	_, err = a.ingestClient.IngestUnary(callCtx, req)
	if err != nil {
		a.logger.Printf("worker %d: grpc ingest error: %v", workerID, err)
		msg.Nak()
		return
	}

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

func configBool(m map[string]interface{}, key string, defaultVal bool) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return defaultVal
}

var _ integration.Adapter = (*grpcClientAdapter)(nil)
'''

for rel_path, content in files.items():
    path = os.path.join(base, rel_path)
    if content.startswith('\n'):
        content = content[1:]
    with open(path, 'w') as f:
        f.write(content)
    print(f'{rel_path}: {os.path.getsize(path)} bytes')
