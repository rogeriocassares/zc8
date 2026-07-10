package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync/atomic"
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
		return newGRPCClientAdapter(entry, db, jsClient, logger)
	}

	manager := integration.NewWorkerManager(integration.WorkerManagerConfig{
		DB:                db,
		ServiceType:       "output.grpc-push",
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
	log.Println("gRPC Client Output running. Press Ctrl+C to stop.")
	<-sigChan

	log.Println("Shutting down...")
	manager.Stop()
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 3*time.Second)
	healthSrv.Shutdown(shutCtx)
	shutCancel()
	log.Println("Shutdown complete")
}

type grpcClientAdapter struct {
	entry             *integration.IntegrationEntry
	db                *sql.DB
	allowlist         *integration.DeviceAllowlist
	orgID             int64
	teamID            int64
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
	messageCount      atomic.Int64
	errorCount        atomic.Int64
	lastMsgAt         atomic.Int64 // Unix nanoseconds
}

func newGRPCClientAdapter(entry *integration.IntegrationEntry, db *sql.DB, jsClient *infranats.JetStreamClient, logger *log.Logger) (*grpcClientAdapter, error) {
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
		db:                db,
		orgID:             entry.OrganizationID,
		teamID:            entry.TeamID,
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

func (a *grpcClientAdapter) natsSubject() string {
	if a.orgID == 0 {
		return "data.>"
	}
	if a.teamID != 0 {
		return fmt.Sprintf("data.%d.%d.>.decoded", a.orgID, a.teamID)
	}
	return fmt.Sprintf("data.%d.>.decoded", a.orgID)
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
	subject := a.natsSubject()
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

	a.logger.Printf("Started: %s tls=%v subject=%s workers=%d", target, a.useTLS, subject, a.workers)
	return nil
}

func (a *grpcClientAdapter) Stop() {
	if a.cancel != nil {
		a.cancel()
	}
	if a.grpcConn != nil {
		a.grpcConn.Close()
	}
}

func (a *grpcClientAdapter) Status() map[string]interface{} {
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
		"is_connected":    a.grpcConn != nil && a.cancel != nil,
		"is_running":      a.cancel != nil,
		"message_count":   a.messageCount.Load(),
		"error_count":     a.errorCount.Load(),
		"last_message_at": lastMsg,
		"host":            a.host,
		"port":            a.port,
	}
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
	env, err := pb.UnmarshalEnvelope(msg.Data())
	if err != nil {
		a.logger.Printf("worker %d: unmarshal error: %v", workerID, err)
		msg.Ack()
		return
	}

	if env.DeviceKey == 0 || !a.allowlist.ContainsDevice(env.DeviceKey) {
		msg.Ack()
		return
	}

	callCtx, callCancel := context.WithTimeout(ctx, 5*time.Second)
	defer callCancel()

	_, err = a.ingestClient.IngestUnary(callCtx, env)
	if err != nil {
		a.logger.Printf("worker %d: grpc ingest error: %v", workerID, err)
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

func configBool(m map[string]interface{}, key string, defaultVal bool) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return defaultVal
}

var _ integration.Adapter = (*grpcClientAdapter)(nil)
