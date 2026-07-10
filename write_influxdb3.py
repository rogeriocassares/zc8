#!/usr/bin/env python3
"""Write clean output service files."""
import os

base = '/Users/rogeriocassares/Git/rogeriocassares/zc8'

files = {}

files['services/output/influxdb3-writer/cmd/influxdb3-writer/main.go'] = r'''package main

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
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
		return newInfluxDB3Adapter(entry, jsClient, logger)
	}

	manager := integration.NewWorkerManager(integration.WorkerManagerConfig{
		DB:                  db,
		IntegrationTypeCode: "influxdb3",
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
	log.Println("InfluxDB3 Writer Output running. Press Ctrl+C to stop.")
	<-sigChan

	log.Println("Shutting down...")
	manager.Stop()
	log.Println("Shutdown complete")
}

type influxDB3Adapter struct {
	entry       *integration.IntegrationEntry
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
}

func newInfluxDB3Adapter(entry *integration.IntegrationEntry, jsClient *infranats.JetStreamClient, logger *log.Logger) (*influxDB3Adapter, error) {
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
	}, nil
}

func (a *influxDB3Adapter) Start(ctx context.Context) error {
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

	a.logger.Printf("Started: %s bucket=%s measurement=%s workers=%d",
		url, a.bucket, a.measurement, a.workers)
	return nil
}

func (a *influxDB3Adapter) Stop(ctx context.Context) error {
	if a.cancel != nil {
		a.cancel()
	}
	if a.influxConn != nil {
		return a.influxConn.Close()
	}
	return nil
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
			req, err := pb.UnmarshalIngestRequest(msg.Data())
			if err != nil {
				a.logger.Printf("worker %d: unmarshal error: %v", workerID, err)
				msg.Ack()
				continue
			}

			if len(req.PreParsedFields) == 0 {
				msg.Ack()
				continue
			}

			a.writeLineProtocol(&buf, req, now)
			buf.WriteByte('\n')
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
				for _, m := range ackMsgs {
					m.Nak()
				}
			} else {
				for _, m := range ackMsgs {
					m.Ack()
				}
			}
		}
	}
}

func (a *influxDB3Adapter) writeLineProtocol(buf *bytes.Buffer, req *pb.IngestRequest, tsNano int64) {
	buf.WriteString(a.measurement)
	buf.WriteString(",device=")
	buf.WriteString(strconv.FormatUint(req.DeviceKey, 10))
	buf.WriteByte(' ')

	for i, pf := range req.PreParsedFields {
		if i > 0 {
			buf.WriteByte(',')
		}
		buf.WriteString(pf.Key)
		buf.WriteByte('=')
		buf.WriteString(strconv.FormatFloat(pf.Value, 'f', -1, 64))
	}

	buf.WriteByte(' ')
	buf.WriteString(strconv.FormatInt(tsNano, 10))
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
'''

for rel_path, content in files.items():
    path = os.path.join(base, rel_path)
    # Strip leading newline from raw string
    if content.startswith('\n'):
        content = content[1:]
    with open(path, 'w') as f:
        f.write(content)
    print(f'{rel_path}: {os.path.getsize(path)} bytes')
