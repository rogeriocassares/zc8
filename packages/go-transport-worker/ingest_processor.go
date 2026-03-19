package transport

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// IngestProcessor handles unified message processing from all transports
type IngestProcessor struct {
	db         *sql.DB
	incoming   chan Message
	processors map[string]MessageProcessor
	mu         sync.RWMutex
	logger     *log.Logger
	stopCh     chan struct{}
	stopOnce   sync.Once
	stats      *IngestStats
}

// MessageProcessor is an interface for custom message processing
type MessageProcessor interface {
	Process(ctx context.Context, msg Message) error
	Name() string
}

// IngestStats tracks processor statistics
type IngestStats struct {
	TotalMessages     uint64
	ProcessedMessages uint64
	FailedMessages    uint64
	LastMessage       time.Time
	mu                sync.RWMutex
}

// NewIngestProcessor creates a new unified ingest processor
func NewIngestProcessor(db *sql.DB, bufferSize int, logger *log.Logger) *IngestProcessor {
	if logger == nil {
		logger = log.New(log.Writer(), "[IngestProcessor] ", log.LstdFlags)
	}

	return &IngestProcessor{
		db:         db,
		incoming:   make(chan Message, bufferSize),
		processors: make(map[string]MessageProcessor),
		logger:     logger,
		stopCh:     make(chan struct{}),
		stats:      &IngestStats{},
	}
}

// RegisterProcessor adds a custom message processor
func (ip *IngestProcessor) RegisterProcessor(name string, proc MessageProcessor) error {
	ip.mu.Lock()
	defer ip.mu.Unlock()

	if _, exists := ip.processors[name]; exists {
		return fmt.Errorf("processor %s already registered", name)
	}

	ip.processors[name] = proc
	ip.logger.Printf("Registered processor: %s", name)
	return nil
}

// Start begins processing incoming messages
func (ip *IngestProcessor) Start(ctx context.Context) error {
	ip.logger.Printf("Starting ingest processor with %d registered processors", len(ip.processors))

	go ip.processLoop(ctx)
	return nil
}

// processLoop continuously processes incoming messages
func (ip *IngestProcessor) processLoop(ctx context.Context) {
	for {
		select {
		case <-ip.stopCh:
			ip.logger.Printf("Ingest processor stopping")
			return
		case <-ctx.Done():
			ip.logger.Printf("Context cancelled, stopping processor")
			return
		case msg := <-ip.incoming:
			ip.processMessage(ctx, msg)
		}
	}
}

// processMessage handles a single message from any transport
func (ip *IngestProcessor) processMessage(ctx context.Context, msg Message) {
	ip.stats.mu.Lock()
	ip.stats.TotalMessages++
	ip.stats.LastMessage = time.Now()
	ip.stats.mu.Unlock()

	ip.logger.Printf(
		"Processing message: transport=%s, team=%s (%d), provider=%s, device=%s",
		msg.TransportType, msg.TeamName, msg.TeamID, msg.ProviderName, msg.DeviceKey,
	)

	// Store in database
	if err := ip.storeMessage(ctx, &msg); err != nil {
		ip.logger.Printf("Failed to store message: %v", err)
		ip.stats.mu.Lock()
		ip.stats.FailedMessages++
		ip.stats.mu.Unlock()
		return
	}

	// Run registered processors
	for name, processor := range ip.getProcessors() {
		if err := processor.Process(ctx, msg); err != nil {
			ip.logger.Printf("Processor %s failed: %v", name, err)
			continue
		}
	}

	ip.stats.mu.Lock()
	ip.stats.ProcessedMessages++
	ip.stats.mu.Unlock()

	ip.logger.Printf("Message processed successfully")
}

// storeMessage persists message to database
func (ip *IngestProcessor) storeMessage(ctx context.Context, msg *Message) error {
	query := `
	INSERT INTO ingest_messages (
		worker_id, transport_type, team_id, device_key, 
		payload, metadata, received_at, processed_at, latency_ms
	) VALUES (
		$1, $2, $3, $4, $5, $6, $7, $8, $9
	)
	`

	payloadJSON, _ := json.Marshal(msg.Payload)
	metadataJSON, _ := json.Marshal(msg.Metadata)
	latencyMs := int(time.Since(msg.ReceivedAt).Milliseconds())

	_, err := ip.db.ExecContext(ctx, query,
		msg.WorkerID,
		msg.TransportType,
		msg.TeamID,
		msg.DeviceKey,
		payloadJSON,
		metadataJSON,
		msg.ReceivedAt,
		msg.ProcessedAt,
		latencyMs,
	)

	if err != nil {
		return fmt.Errorf("failed to insert message: %w", err)
	}

	return nil
}

// getProcessors returns a copy of registered processors
func (ip *IngestProcessor) getProcessors() map[string]MessageProcessor {
	ip.mu.RLock()
	defer ip.mu.RUnlock()

	processors := make(map[string]MessageProcessor)
	for k, v := range ip.processors {
		processors[k] = v
	}
	return processors
}

// ReceiveMessage adds a message to the ingest queue
func (ip *IngestProcessor) ReceiveMessage(msg Message) error {
	select {
	case ip.incoming <- msg:
		return nil
	case <-ip.stopCh:
		return fmt.Errorf("processor stopped")
	default:
		return fmt.Errorf("ingest queue full")
	}
}

// Stop gracefully stops the processor
func (ip *IngestProcessor) Stop(ctx context.Context) error {
	ip.stopOnce.Do(func() {
		close(ip.stopCh)
	})

	// Wait for queue to drain or timeout
	timeout := time.NewTimer(5 * time.Second)
	defer timeout.Stop()

	for {
		select {
		case <-timeout.C:
			ip.logger.Printf("Timeout waiting for queue to drain")
			return fmt.Errorf("timeout")
		default:
			if len(ip.incoming) == 0 {
				ip.logger.Printf("Ingest processor stopped")
				return nil
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
}

// GetStats returns current processor statistics
func (ip *IngestProcessor) GetStats() map[string]interface{} {
	ip.stats.mu.RLock()
	defer ip.stats.mu.RUnlock()

	return map[string]interface{}{
		"total_messages":     ip.stats.TotalMessages,
		"processed_messages": ip.stats.ProcessedMessages,
		"failed_messages":    ip.stats.FailedMessages,
		"queue_size":         len(ip.incoming),
		"last_message_at":    ip.stats.LastMessage,
	}
}

// ============================================================
// DEFAULT PROCESSORS
// ============================================================

// InfluxDBProcessor sends messages to InfluxDB
type InfluxDBProcessor struct {
	client interface{} // *influxdb.Client in real implementation
	logger *log.Logger
}

// NewInfluxDBProcessor creates a new InfluxDB processor
func NewInfluxDBProcessor(logger *log.Logger) *InfluxDBProcessor {
	return &InfluxDBProcessor{
		logger: logger,
	}
}

// Process sends message to InfluxDB
func (p *InfluxDBProcessor) Process(ctx context.Context, msg Message) error {
	// Convert message to InfluxDB point format
	fields := make(map[string]interface{})
	fields["message_count"] = 1

	// Extract numeric values from payload
	for k, v := range msg.Payload {
		if num, ok := toFloat64(v); ok {
			fields[k] = num
		}
	}

	if len(fields) == 0 {
		return nil // No numeric data
	}

	// TODO: Send to InfluxDB
	// point, _ := client.NewPoint("device_data",
	//     map[string]string{
	//         "team":     msg.TeamName,
	//         "device":   msg.DeviceKey,
	//         "provider": msg.ProviderName,
	//     },
	//     fields,
	//     msg.ReceivedAt,
	// )

	return nil
}

// Name returns processor name
func (p *InfluxDBProcessor) Name() string {
	return "influxdb"
}

// WebhookProcessor sends messages to registered webhooks
type WebhookProcessor struct {
	webhooks map[int64]string // team_id -> webhook_url
	client   *http.Client
	logger   *log.Logger
}

// NewWebhookProcessor creates a new webhook processor
func NewWebhookProcessor(logger *log.Logger) *WebhookProcessor {
	return &WebhookProcessor{
		webhooks: make(map[int64]string),
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		logger: logger,
	}
}

// RegisterWebhook registers a webhook for a team
func (p *WebhookProcessor) RegisterWebhook(teamID int64, url string) {
	p.webhooks[teamID] = url
}

// Process sends message to registered webhooks
func (p *WebhookProcessor) Process(ctx context.Context, msg Message) error {
	url, exists := p.webhooks[msg.TeamID]
	if !exists {
		return nil // No webhook registered for this team
	}

	// Prepare payload
	payload, _ := json.Marshal(msg)

	// Send to webhook
	resp, err := http.Post(url, "application/json", nil)
	if err != nil {
		p.logger.Printf("Webhook delivery failed: %v", err)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		p.logger.Printf("Webhook returned status %d", resp.StatusCode)
		return fmt.Errorf("webhook failed with status %d", resp.StatusCode)
	}

	return nil
}

// Name returns processor name
func (p *WebhookProcessor) Name() string {
	return "webhooks"
}

// Helper function to convert value to float64
func toFloat64(v interface{}) (float64, bool) {
	switch vv := v.(type) {
	case float64:
		return vv, true
	case float32:
		return float64(vv), true
	case int:
		return float64(vv), true
	case int32:
		return float64(vv), true
	case int64:
		return float64(vv), true
	default:
		return 0, false
	}
}
