package nats

import (
	"context"
	"log"
	"time"

	"github.com/rogeriocassares/zc8/packages/go-data"
	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
	"github.com/rogeriocassares/zc8/services/ingest/internal/engine"
)

type ConsumerConfig struct {
	NATSURL        string
	StreamName     string
	ConsumerName   string
	FilterSubjects []string
	MaxAckPending  int
	BatchSize      int
	Workers        int
}

type Consumer struct {
	client *infranats.JetStreamClient
	engine *engine.Engine
	cfg    ConsumerConfig
	cancel context.CancelFunc
	logger *log.Logger
}

func NewConsumer(ctx context.Context, cfg ConsumerConfig, eng *engine.Engine, logger *log.Logger) (*Consumer, error) {
	if logger == nil {
		logger = log.New(log.Writer(), "[js-consumer] ", log.LstdFlags)
	}
	if cfg.StreamName == "" {
		cfg.StreamName = "TELEMETRY"
	}
	if cfg.ConsumerName == "" {
		cfg.ConsumerName = "ingest-workers"
	}
	if len(cfg.FilterSubjects) == 0 {
		cfg.FilterSubjects = []string{"telemetry.raw.>"}
	}
	if cfg.MaxAckPending <= 0 {
		cfg.MaxAckPending = 4096
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 256
	}
	if cfg.Workers <= 0 {
		cfg.Workers = 4
	}

	client, err := infranats.NewJetStream(ctx, infranats.JetStreamConfig{
		URL:        cfg.NATSURL,
		StreamName: cfg.StreamName,
		Subjects:   []string{"telemetry.raw.>"},
		Replicas:   1,
	}, logger)
	if err != nil {
		return nil, err
	}

	return &Consumer{
		client: client,
		engine: eng,
		cfg:    cfg,
		logger: logger,
	}, nil
}

func (c *Consumer) Start(ctx context.Context) error {
	cons, err := c.client.CreateConsumer(ctx, infranats.ConsumerConfig{
		Durable:        c.cfg.ConsumerName,
		FilterSubjects: c.cfg.FilterSubjects,
		MaxAckPending:  c.cfg.MaxAckPending,
		AckWait:        30 * time.Second,
	})
	if err != nil {
		return err
	}

	consumeCtx, cancel := context.WithCancel(ctx)
	c.cancel = cancel

	for i := range c.cfg.Workers {
		go c.consumeLoop(consumeCtx, cons, i)
	}

	c.logger.Printf("JetStream consumer started: %d workers, max_ack_pending=%d",
		c.cfg.Workers, c.cfg.MaxAckPending)
	return nil
}

func (c *Consumer) Stop() error {
	if c.cancel != nil {
		c.cancel()
	}
	return c.client.Close()
}

func (c *Consumer) consumeLoop(ctx context.Context, cons infranats.PullConsumer, workerID int) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		msgs, err := cons.Fetch(c.cfg.BatchSize, infranats.FetchMaxWait(500*time.Millisecond))
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			c.logger.Printf("worker %d: fetch error: %v", workerID, err)
			time.Sleep(100 * time.Millisecond)
			continue
		}

		for msg := range msgs.Messages() {
			c.processMessage(msg)
		}

		if err := msgs.Error(); err != nil {
			if ctx.Err() != nil {
				return
			}
			c.logger.Printf("worker %d: messages error: %v", workerID, err)
		}
	}
}

// processMessage deserializes an IngestRequest, feeds it to the engine,
// and waits for the InfluxDB3 write to complete before ACKing.
// If the write fails, the message is NAKed for redelivery.
func (c *Consumer) processMessage(msg infranats.ConsumerMsg) {
	req, err := pb.UnmarshalIngestRequest(msg.Data())
	if err != nil {
		c.logger.Printf("proto unmarshal error: %v", err)
		msg.Ack() // bad data — don't redeliver
		return
	}

	engineMsg := c.reqToMessage(req)
	if engineMsg == nil {
		msg.Ack()
		return
	}

	// Ack channel: shard signals after InfluxDB3 write completes
	ackCh := make(chan error, 1)
	engineMsg.Ack = ackCh

	c.engine.Ingest(engineMsg)

	// Block until the shard flushes the batch and InfluxDB3 confirms persistence
	if err := <-ackCh; err != nil {
		c.logger.Printf("write failed, NAKing for redelivery: %v", err)
		msg.Nak()
		return
	}

	msg.Ack()
}

func (c *Consumer) reqToMessage(req *pb.IngestRequest) *engine.Message {
	if len(req.PreParsedFields) == 0 {
		return nil // transport must always pre-parse
	}

	fields := make([]data.Field, 0, len(req.PreParsedFields))
	for _, pf := range req.PreParsedFields {
		fields = append(fields, data.Field{Key: pf.Key, Value: pf.Value})
	}

	msg := &engine.Message{
		DeviceKey:       engine.DeviceKey(req.DeviceKey),
		PreParsedFields: fields,
	}

	if dc := req.DeviceContext; dc != nil {
		msg.OrganizationID = dc.OrganizationId
		msg.TeamID = dc.TeamId
		msg.ParserID = data.ParserID(dc.ParserId)

		if ir := dc.IngestRouting; ir != nil {
			msg.Routing = &data.IngestRouting{
				InfluxDBConfigID:    ir.InfluxdbConfigId,
				WriteToInfluxDB:     ir.WriteToInfluxdb,
				RequireInfluxDBAck:  ir.RequireInfluxdbAck,
				InfluxDBHost:        ir.InfluxdbHost,
				InfluxDBToken:       ir.InfluxdbToken,
				InfluxDBBucket:      ir.InfluxdbBucket,
				InfluxDBMeasurement: ir.InfluxdbMeasurement,
				RedisConfigID:       ir.RedisConfigId,
				WriteToRedis:        ir.WriteToRedis,
				RedisMaxHashEntries: ir.RedisMaxHashEntries,
				RedisHost:           ir.RedisHost,
				RedisKeyPrefix:      ir.RedisKeyPrefix,
				NATSConfigID:        ir.NatsConfigId,
				WriteToNATS:         ir.WriteToNats,
				NATSURL:             ir.NatsUrl,
				NATSSubjectPrefix:   ir.NatsSubjectPrefix,
			}
		}
	}

	return msg
}
