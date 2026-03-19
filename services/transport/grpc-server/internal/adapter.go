package grpcserver

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	tcfg "github.com/rogeriocassares/zc8/packages/go-config/transport"
	transport "github.com/rogeriocassares/zc8/packages/go-transport"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// GRPCServerAdapter accepts incoming gRPC IngestUnary / IngestBatch calls
// for one transport_registry row. It receives raw proto messages, runs
// 2-stage parsing on the payload, and forwards to the ingest pipeline.
type GRPCServerAdapter struct {
	transportID int64
	entry       *transport.TransportEntry
	grpcCfg     *tcfg.GRPCConfig

	parserRegistry    *transport.ParserRegistry
	deviceLookup      *transport.DeviceLookup
	messageCallback   func(*transport.Message)
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
}

// NewGRPCServerAdapter creates a gRPC server adapter for a transport entry.
func NewGRPCServerAdapter(
	entry *transport.TransportEntry,
	grpcCfg *tcfg.GRPCConfig,
	parserRegistry *transport.ParserRegistry,
	deviceLookup *transport.DeviceLookup,
	messageCallback func(*transport.Message),
	logger *log.Logger,
) *GRPCServerAdapter {
	if logger == nil {
		logger = log.New(log.Writer(), fmt.Sprintf("[gRPC-Server:transport_%d] ", entry.ID), log.LstdFlags)
	}

	gatewayParserCode := entry.ParserCode
	if gatewayParserCode == "" {
		gatewayParserCode = "default"
	}

	return &GRPCServerAdapter{
		transportID:       entry.ID,
		entry:             entry,
		grpcCfg:           grpcCfg,
		parserRegistry:    parserRegistry,
		deviceLookup:      deviceLookup,
		messageCallback:   messageCallback,
		gatewayParserCode: gatewayParserCode,
		deviceParserCode:  "agent",
		stopCh:            make(chan struct{}),
		logger:            logger,
	}
}

func (a *GRPCServerAdapter) Start(_ context.Context) error {
	a.mu.Lock()
	a.isRunning = true
	a.mu.Unlock()
	a.logger.Printf("gRPC server adapter started for transport %d (parser: %s)", a.transportID, a.gatewayParserCode)
	return nil
}

func (a *GRPCServerAdapter) Stop() {
	a.stopOnce.Do(func() {
		close(a.stopCh)
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
		"transport_id":    a.transportID,
		"transport_type":  "grpc-server",
		"team_id":         a.entry.TeamID,
		"team_name":       a.entry.TeamName,
		"service_name":    a.grpcCfg.ServiceName,
		"is_running":      running,
		"message_count":   a.messageCount.Load(),
		"error_count":     a.errorCount.Load(),
		"last_message_at": lastMsg,
	}
}

// HandleIngestRequest processes a single IngestRequest received by the shared gRPC server.
// It extracts the payload, runs 2-stage parsing, and forwards to ingest.
func (a *GRPCServerAdapter) HandleIngestRequest(ctx context.Context, req *pb.IngestRequest) (*pb.IngestAck, error) {
	var rawPayload []byte
	switch p := req.Payload.(type) {
	case *pb.IngestRequest_MqttMessage:
		rawPayload = p.MqttMessage.Payload
	case *pb.IngestRequest_LnsMessage:
		if p.LnsMessage.Frame != nil {
			rawPayload = p.LnsMessage.Frame.Payload
		}
	default:
		// Accept pre-parsed fields without raw payload
	}

	devicePayload := rawPayload

	// Stage 1: Gateway parser
	if len(rawPayload) > 0 && a.gatewayParserCode != "" && a.gatewayParserCode != "default" {
		gp, err := a.parserRegistry.GetGatewayParser(a.gatewayParserCode)
		if err != nil {
			a.errorCount.Add(1)
			return &pb.IngestAck{EventId: req.EventId, Status: pb.IngestStatus_INGEST_INVALID, Reason: err.Error()}, nil
		}
		frame, err := gp.Parse(rawPayload)
		if err != nil {
			a.errorCount.Add(1)
			return &pb.IngestAck{EventId: req.EventId, Status: pb.IngestStatus_INGEST_INVALID, Reason: err.Error()}, nil
		}
		devicePayload = frame.DevicePayload
	}

	// Stage 2: Device parser
	if len(devicePayload) > 0 {
		dp, err := a.parserRegistry.GetDeviceParser(a.deviceParserCode)
		if err != nil {
			a.errorCount.Add(1)
			return &pb.IngestAck{EventId: req.EventId, Status: pb.IngestStatus_INGEST_INVALID, Reason: err.Error()}, nil
		}
		deviceData, err := dp.Parse(devicePayload)
		if err != nil {
			a.errorCount.Add(1)
			return &pb.IngestAck{EventId: req.EventId, Status: pb.IngestStatus_INGEST_INVALID, Reason: err.Error()}, nil
		}

		msg := &transport.Message{
			TransportRegistryID: a.transportID,
			TransportType:       "grpc-server",
			TeamID:              a.entry.TeamID,
			TeamName:            a.entry.TeamName,
			OrganizationID:      a.entry.OrganizationID,
			DeviceParserCode:    a.deviceParserCode,
			GatewayParserCode:   a.gatewayParserCode,
			DeviceData:          deviceData,
			Metadata:            map[string]interface{}{"event_id": req.EventId},
			ReceivedAt:          time.Now(),
		}

		if a.messageCallback != nil {
			a.messageCallback(msg)
		}
	} else if len(req.GetPreParsedFields()) > 0 {
		// Pre-parsed fields path: forward the proto directly
		if a.messageCallback != nil {
			msg := &transport.Message{
				TransportRegistryID: a.transportID,
				TransportType:       "grpc-server",
				TeamID:              a.entry.TeamID,
				TeamName:            a.entry.TeamName,
				OrganizationID:      a.entry.OrganizationID,
				Metadata:            map[string]interface{}{"event_id": req.EventId},
				ReceivedAt:          time.Now(),
			}
			a.messageCallback(msg)
		}
	}

	a.messageCount.Add(1)
	a.lastMessageTime.Store(time.Now().UnixNano())

	return &pb.IngestAck{EventId: req.EventId, Status: pb.IngestStatus_INGEST_OK}, nil
}

// TransportID returns the transport registry ID.
func (a *GRPCServerAdapter) TransportID() int64 { return a.transportID }
