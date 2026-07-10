package grpcserver

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	command "github.com/rogeriocassares/zc8/packages/go-command"
	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	integration "github.com/rogeriocassares/zc8/packages/go-integration"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// GRPCServerAdapter accepts incoming gRPC IngestUnary / IngestBatch calls
// for one integration_registry row. It receives raw proto messages, runs
// 2-stage parsing on the payload, and forwards to the ingest pipeline.
type GRPCServerAdapter struct {
	integrationID int64
	entry         *integration.IntegrationEntry

	// gRPC config extracted from entry.Config
	serviceName string

	db        *sql.DB
	allowlist *integration.DeviceAllowlist

	parserRegistry    *integration.ParserRegistry
	deviceLookup      *integration.DeviceLookup
	messageCallback   func(*integration.Message)
	gatewayParserCode string
	deviceParserCode  string

	mu              sync.RWMutex
	isRunning       bool
	messageCount    atomic.Int64
	errorCount      atomic.Int64
	lastMessageTime atomic.Int64

	stopCh   chan struct{}
	stopOnce sync.Once
	logger   *log.Logger

	// Command dispatch (optional — nil disables downlink)
	jsCommands  *infranats.JetStreamClient
	commandReg  *command.Registry
	cmdCancelFn context.CancelFunc
}

// NewGRPCServerAdapter creates a gRPC server adapter for an integration entry.
func NewGRPCServerAdapter(
	db *sql.DB,
	entry *integration.IntegrationEntry,
	parserRegistry *integration.ParserRegistry,
	deviceLookup *integration.DeviceLookup,
	messageCallback func(*integration.Message),
	logger *log.Logger,
	jsCommands *infranats.JetStreamClient,
	commandReg *command.Registry,
) *GRPCServerAdapter {
	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[gRPC-Server:integration_%d] ", entry.ID), log.LstdFlags)
	}

	gatewayParserCode := entry.ProviderCode
	if gatewayParserCode == "" {
		gatewayParserCode = "default"
	}

	serviceName := configString(entry.Config, "service_name", "telemetry")

	return &GRPCServerAdapter{
		integrationID:     entry.ID,
		entry:             entry,
		db:                db,
		serviceName:       serviceName,
		parserRegistry:    parserRegistry,
		deviceLookup:      deviceLookup,
		messageCallback:   messageCallback,
		gatewayParserCode: gatewayParserCode,
		deviceParserCode:  "agent",
		stopCh:            make(chan struct{}),
		logger:            logger,
		jsCommands:        jsCommands,
		commandReg:        commandReg,
	}
}

func (a *GRPCServerAdapter) Start(ctx context.Context) error {
	a.allowlist = integration.NewDeviceAllowlist(a.db, a.integrationID, a.logger)
	a.allowlist.Start(ctx, 30*time.Second)
	a.mu.Lock()
	a.isRunning = true
	a.mu.Unlock()
	// Start command consumer if command dispatch is configured.
	if a.jsCommands != nil && a.commandReg != nil {
		cmdCtx, cmdCancel := context.WithCancel(context.Background())
		a.cmdCancelFn = cmdCancel
		go a.startCommandConsumer(cmdCtx)
	}
	a.logger.Printf("gRPC server adapter started for integration %d (parser: %s)", a.integrationID, a.gatewayParserCode)
	return nil
}

func (a *GRPCServerAdapter) Stop() {
	a.stopOnce.Do(func() {
		close(a.stopCh)
		if a.cmdCancelFn != nil {
			a.cmdCancelFn()
		}
		a.mu.Lock()
		a.isRunning = false
		a.mu.Unlock()
		a.logger.Printf("gRPC server adapter stopped")
	})
}

func (a *GRPCServerAdapter) Status() map[string]interface{} {
	a.mu.RLock()
	running := a.isRunning
	a.mu.RUnlock()

	lastMsg := ""
	if ts := a.lastMessageTime.Load(); ts > 0 {
		lastMsg = time.Unix(0, ts).Format(time.RFC3339)
	}

	return map[string]interface{}{
		"service_id":       a.integrationID,
		"service_type":     "input.grpc-server",
		"integration_id":   a.integrationID,
		"integration_type": "grpc-server",
		"org_id":           a.entry.OrganizationID,
		"team_id":          a.entry.TeamID,
		"team_name":        a.entry.TeamName,
		"service_name":     a.serviceName,
		"is_running":       running,
		"message_count":    a.messageCount.Load(),
		"error_count":      a.errorCount.Load(),
		"last_message_at":  lastMsg,
	}
}

// HandleIngestEnvelope processes a single IngestEnvelope received by the shared gRPC server.
// It extracts the payload, runs 2-stage parsing, and forwards to ingest.
func (a *GRPCServerAdapter) HandleIngestEnvelope(ctx context.Context, env *pb.IngestEnvelope) (*pb.IngestAck, error) {
	// Resolve team from DeviceContext if present, otherwise fall back to adapter entry.
	orgID := a.entry.OrganizationID
	teamID := a.entry.TeamID

	var devCfg *integration.DeviceConfig
	if dc := env.GetContext(); dc != nil && dc.DeviceKey != 0 {
		deviceKey := strconv.FormatUint(dc.DeviceKey, 10)
		if a.deviceLookup != nil {
			var err error
			devCfg, err = a.deviceLookup.Lookup(ctx, deviceKey, teamID)
			if err != nil {
				a.errorCount.Add(1)
				return &pb.IngestAck{EventId: env.EventId, Accepted: false, Reason: err.Error()}, nil
			}
			if devCfg == nil {
				a.errorCount.Add(1)
				return &pb.IngestAck{EventId: env.EventId, Accepted: false, Reason: "device not registered"}, nil
			}
			// Use the device's actual team.
			teamID = devCfg.TeamID
		}
		if dc.OrganizationId != 0 {
			orgID = dc.OrganizationId
		}
	}

	if devCfg != nil && !a.allowlist.ContainsDeviceUUID(devCfg.DeviceUUID) {
		return &pb.IngestAck{EventId: env.EventId, Accepted: false, Reason: "device not routed to this service"}, nil
	}

	var rawPayload []byte
	if raw := env.GetRaw(); raw != nil {
		rawPayload = raw.Data
	}

	devicePayload := rawPayload

	// Stage 1: Gateway parser
	if len(rawPayload) > 0 && a.gatewayParserCode != "" && a.gatewayParserCode != "default" {
		gp, err := a.parserRegistry.GetGatewayParser(a.gatewayParserCode)
		if err != nil {
			a.errorCount.Add(1)
			return &pb.IngestAck{EventId: env.EventId, Accepted: false, Reason: err.Error()}, nil
		}
		frame, err := gp.Parse(rawPayload)
		if err != nil {
			a.errorCount.Add(1)
			return &pb.IngestAck{EventId: env.EventId, Accepted: false, Reason: err.Error()}, nil
		}
		devicePayload = frame.DevicePayload
	}

	// Stage 2: Device parser
	if len(devicePayload) > 0 {
		dp, err := a.parserRegistry.GetDeviceParser(a.deviceParserCode)
		if err != nil {
			a.errorCount.Add(1)
			return &pb.IngestAck{EventId: env.EventId, Accepted: false, Reason: err.Error()}, nil
		}
		deviceData, err := dp.Parse(devicePayload)
		if err != nil {
			a.errorCount.Add(1)
			return &pb.IngestAck{EventId: env.EventId, Accepted: false, Reason: err.Error()}, nil
		}

		msg := &integration.Message{
			ServiceID:        a.integrationID,
			ServiceType:      "input.grpc-server",
			TeamID:           teamID,
			TeamName:         a.entry.TeamName,
			OrganizationID:   orgID,
			DeviceParserCode: a.deviceParserCode,
			ProviderCode:     a.gatewayParserCode,
			DeviceData:       deviceData,
			Metadata:         map[string]interface{}{"event_id": env.EventId},
			ReceivedAt:       time.Now(),
		}
		if devCfg != nil {
			msg.DeviceUUID = devCfg.DeviceUUID
			msg.DeviceKey = devCfg.DeviceKey
			msg.DeviceModelCode = devCfg.DeviceModelCode
			msg.VendorID = devCfg.VendorID
		}

		if a.messageCallback != nil {
			a.messageCallback(msg)
		}
	} else if env.GetDecoded() != nil {
		// Pre-decoded envelope path: forward the message
		if a.messageCallback != nil {
			msg := &integration.Message{
				ServiceID:      a.integrationID,
				ServiceType:    "input.grpc-server",
				TeamID:         teamID,
				TeamName:       a.entry.TeamName,
				OrganizationID: orgID,
				Metadata:       map[string]interface{}{"event_id": env.EventId},
				ReceivedAt:     time.Now(),
			}
			a.messageCallback(msg)
		}
	}

	a.messageCount.Add(1)
	a.lastMessageTime.Store(time.Now().UnixNano())

	return &pb.IngestAck{EventId: env.EventId, Accepted: true}, nil
}

// IntegrationID returns the integration registry ID.
func (a *GRPCServerAdapter) IntegrationID() int64 { return a.integrationID }

// Config extraction helpers for map[string]interface{}.

func configString(m map[string]interface{}, key, def string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return def
}

func configInt(m map[string]interface{}, key string, def int) int {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		case int64:
			return int(n)
		case json.Number:
			if i, err := n.Int64(); err == nil {
				return int(i)
			}
		}
	}
	return def
}

// startCommandConsumer creates a durable JetStream consumer for this integration's
// gRPC server downlink commands.
func (a *GRPCServerAdapter) startCommandConsumer(ctx context.Context) {
	consumerName := fmt.Sprintf("grpc-server-cmd-%d", a.integrationID)
	subject := fmt.Sprintf("commands.dispatch.grpc-server.%d", a.integrationID)

	cons, err := a.jsCommands.CreateConsumer(ctx, infranats.ConsumerConfig{
		Durable:        consumerName,
		FilterSubjects: []string{subject},
		MaxAckPending:  64,
		AckWait:        30 * time.Second,
	})
	if err != nil {
		a.logger.Printf("[cmd] consumer create error: %v", err)
		return
	}

	a.logger.Printf("[cmd] command consumer ready: subject=%s", subject)

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		msgs, err := cons.Fetch(8, infranats.FetchMaxWait(500*time.Millisecond))
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			time.Sleep(100 * time.Millisecond)
			continue
		}

		for msg := range msgs.Messages() {
			a.processCommand(ctx, msg)
		}

		if err := msgs.Error(); err != nil && ctx.Err() == nil {
			a.logger.Printf("[cmd] batch error: %v", err)
		}
	}
}

// processCommand formats and dispatches a single command envelope.
func (a *GRPCServerAdapter) processCommand(_ context.Context, msg infranats.ConsumerMsg) {
	env, err := pb.UnmarshalCommandEnvelope(msg.Data())
	if err != nil {
		a.logger.Printf("[cmd] unmarshal error: %v", err)
		msg.Ack()
		return
	}

	formatted, err := a.commandReg.Format(env)
	if err != nil {
		a.logger.Printf("[cmd] format error [%s]: %v", env.CommandId, err)
		a.publishCommandAck(env, false, err.Error())
		msg.Ack()
		return
	}

	a.logger.Printf("[cmd] dispatched [%s] target=%s", env.CommandId, formatted.Target)
	a.publishCommandAck(env, true, "")
	msg.Ack()
}

// publishCommandAck publishes a command acknowledgement to NATS Core.
func (a *GRPCServerAdapter) publishCommandAck(env *pb.CommandEnvelope, success bool, errMsg string) {
	subject := fmt.Sprintf("commands.ack.%s", env.DeviceKey)
	ack := map[string]interface{}{
		"command_id": env.CommandId,
		"device_key": env.DeviceKey,
		"success":    success,
		"error":      errMsg,
	}
	data, _ := json.Marshal(ack)
	if err := a.jsCommands.Conn().Publish(subject, data); err != nil {
		a.logger.Printf("[cmd] ack publish error: %v", err)
	}
}
