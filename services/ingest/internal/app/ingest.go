package app

import (
	"context"
	"fmt"
	"log"
	"time"

	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	infrapostgres "github.com/rogeriocassares/zc8/packages/go-infra/postgres"
	redisinfra "github.com/rogeriocassares/zc8/packages/go-infra/redis"

	"github.com/rogeriocassares/zc8/services/ingest/internal/config"
	"github.com/rogeriocassares/zc8/services/ingest/internal/engine"
	fanoutpkg "github.com/rogeriocassares/zc8/services/ingest/internal/infra/fanout"
	infraadapter "github.com/rogeriocassares/zc8/services/ingest/internal/infra/influx"
	"github.com/rogeriocassares/zc8/services/ingest/internal/repository"
)

type Ingest struct {
	config         *config.Config
	engine         *engine.Engine
	influxRegistry *infraadapter.InfluxDB3ConfigRegistry
	influxWatcher  *infraadapter.InfluxDB3ConfigWatcher
	watcherCancel  context.CancelFunc
	fanout         *fanoutpkg.Fanout
	natsClient     *infranats.Client
	db             *infrapostgres.Client
	redisClient    *redisinfra.Client
	logger         *log.Logger
}

func NewIngest(ctx context.Context, cfg *config.Config, logger *log.Logger) (*Ingest, error) {
	ingest := &Ingest{
		config: cfg,
		logger: logger,
	}

	// --------- Database Setup ---------
	db, err := repository.InitDB(&cfg.Postgres)
	if err != nil {
		ingest.shutdown(ctx)
		return nil, fmt.Errorf("failed to initialize database: %w", err)
	}
	ingest.db = db

	// --------- Redis Setup ---------
	redisClient, err := redisinfra.New(ctx, redisinfra.Config{
		Host:     cfg.Redis.Host,
		Port:     cfg.Redis.Port,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})
	if err != nil {
		ingest.shutdown(ctx)
		return nil, fmt.Errorf("failed to connect to redis: %w", err)
	}
	ingest.redisClient = redisClient

	// --------- InfluxDB3 Config Registry ---------
	influxRegistry := infraadapter.NewInfluxDB3ConfigRegistry(logger)
	ingest.influxRegistry = influxRegistry

	// --------- InfluxDB3 Config Watcher ---------
	// Syncs the registry with device_influxdb3_config every 30 seconds.
	// First sync is blocking so the registry is populated before traffic starts.
	configRepo := repository.NewInfluxDB3ConfigRepo(db)
	watcher := infraadapter.NewInfluxDB3ConfigWatcher(
		influxRegistry,
		configRepo,
		30*time.Second,
		logger,
	)
	ingest.influxWatcher = watcher
	watcherCtx, watcherCancel := context.WithCancel(context.Background())
	ingest.watcherCancel = watcherCancel
	watcher.Start(watcherCtx)
	logger.Printf("InfluxDB3 registry initialized: %d tenant instance(s) active", influxRegistry.Size())

	// --------- NATS Client (for realtime fanout) ---------
	natsClient, err := infranats.New(ctx, infranats.Config{
		URL: cfg.NATS.URL,
	})
	if err != nil {
		ingest.shutdown(ctx)
		return nil, fmt.Errorf("failed to create NATS client: %w", err)
	}
	ingest.natsClient = natsClient
	realtimePublisher := infranats.NewRealtimePublisher(natsClient.Conn(), "telemetry.realtime")
	logger.Println("NATS realtime publisher initialized")

	// --------- Redis Cache Writer for Fanout ---------
	cacheWriter := redisinfra.NewDeviceCacheWriter(redisClient, "device:", 10)
	logger.Println("Redis device cache writer initialized")

	// --------- Fanout Dispatcher ---------
	fanout := fanoutpkg.NewFanout(cacheWriter, realtimePublisher)
	ingest.fanout = fanout
	logger.Println("Event fanout (Redis HSET + NATS realtime) initialized")

	// --------- Engine ---------
	reg := engine.NewRegistry()
	eng := engine.NewEngine(reg, influxRegistry, fanout)
	ingest.engine = eng
	logger.Println("Engine initialized with InfluxDB3 registry + fanout")

	logger.Println("Ingest service initialized")
	return ingest, nil
}

func (i *Ingest) GetEngine() *engine.Engine {
	return i.engine
}

func (i *Ingest) Shutdown(ctx context.Context) {
	i.shutdown(ctx)
}

func (i *Ingest) shutdown(ctx context.Context) {
	if i.watcherCancel != nil {
		i.logger.Println("Stopping InfluxDB3 config watcher...")
		i.watcherCancel()
	}

	if i.influxRegistry != nil {
		i.logger.Println("Shutting down InfluxDB3 registry...")
		i.influxRegistry.Shutdown(ctx)
	}

	if i.natsClient != nil {
		i.logger.Println("Closing NATS client...")
		i.natsClient.Close()
	}

	if i.db != nil {
		i.db.Close()
		i.logger.Println("Database connection closed")
	}

	if i.redisClient != nil {
		i.redisClient.Close()
		i.logger.Println("Redis connection closed")
	}

	i.logger.Println("Ingest service shutdown complete")
}
