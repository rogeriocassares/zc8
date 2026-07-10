package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
	timestampinfra "github.com/rogeriocassares/zc8/packages/go-infra/time"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// Adapter is the interface every integration adapter (input or output) must implement.
type Adapter interface {
	Start(ctx context.Context) error
	Stop()
	Status() map[string]interface{}
}

// AdapterFactory creates an Adapter for a discovered IntegrationEntry.
type AdapterFactory func(entry *IntegrationEntry) (Adapter, error)

// WorkerManager discovers services from the services table and manages adapters.
// Parameterized by serviceType (e.g. "input.mqtt", "output.influxdb3") so it
// can be reused across all input and output services.
type WorkerManager struct {
	db             *sql.DB
	serviceType    string // e.g. "input.mqtt", "output.influxdb3"
	adapterFactory AdapterFactory
	logger         *log.Logger

	mu       sync.RWMutex
	adapters map[int64]Adapter

	stopCh            chan struct{}
	discoveryTicker   *time.Ticker
	discoveryInterval time.Duration

	lastDiscovery  time.Time
	discoveryCount int64

	// Optional JetStream SVC stream client for publishing adapter status heartbeats.
	svcJS          *infranats.JetStreamClient
	statusInterval time.Duration
}

// WorkerManagerConfig configures the WorkerManager.
type WorkerManagerConfig struct {
	DB                *sql.DB
	ServiceType       string // e.g. "input.mqtt", "output.influxdb3"
	DiscoveryInterval time.Duration
	AdapterFactory    AdapterFactory
	Logger            *log.Logger

	// SvcJS is an optional JetStream client for the SVC stream. When set,
	// WorkerManager publishes ServiceEvent protos to "svc.{orgId}.{svcId}"
	// every StatusInterval (default 15s) so the API can surface live state.
	SvcJS          *infranats.JetStreamClient
	StatusInterval time.Duration
}

// NewWorkerManager creates a new generic worker manager.
func NewWorkerManager(cfg WorkerManagerConfig) *WorkerManager {
	if cfg.Logger == nil {
		cfg.Logger = log.New(log.Writer(), "[WorkerManager] ", log.LstdFlags)
	}
	if cfg.DiscoveryInterval == 0 {
		cfg.DiscoveryInterval = 30 * time.Second
	}
	statusInterval := cfg.StatusInterval
	if statusInterval == 0 {
		statusInterval = 15 * time.Second
	}
	return &WorkerManager{
		db:                cfg.DB,
		serviceType:       cfg.ServiceType,
		adapterFactory:    cfg.AdapterFactory,
		logger:            cfg.Logger,
		adapters:          make(map[int64]Adapter),
		stopCh:            make(chan struct{}),
		discoveryInterval: cfg.DiscoveryInterval,
		svcJS:             cfg.SvcJS,
		statusInterval:    statusInterval,
	}
}

// Start begins the discovery loop.
func (m *WorkerManager) Start(ctx context.Context) error {
	m.logger.Printf("Starting worker manager for %s (interval: %v)", m.serviceType, m.discoveryInterval)

	if err := m.discoverAndSync(ctx); err != nil {
		return err
	}

	m.discoveryTicker = time.NewTicker(m.discoveryInterval)
	go func() {
		for {
			select {
			case <-m.stopCh:
				m.discoveryTicker.Stop()
				return
			case <-m.discoveryTicker.C:
				if err := m.discoverAndSync(context.Background()); err != nil {
					m.logger.Printf("Discovery cycle failed: %v", err)
				}
			}
		}
	}()

	if m.svcJS != nil {
		go m.runStatusPublisher()
	}

	return nil
}

// runStatusPublisher periodically publishes each adapter's status as a
// ServiceEvent proto to the JetStream SVC stream:
// subject: svc.{orgId}.{svcId}
func (m *WorkerManager) runStatusPublisher() {
	ticker := time.NewTicker(m.statusInterval)
	defer ticker.Stop()

	// Publish immediately on start so the API doesn't wait for the first tick.
	m.publishStatuses()

	for {
		select {
		case <-m.stopCh:
			return
		case <-ticker.C:
			m.publishStatuses()
		}
	}
}

func (m *WorkerManager) publishStatuses() {
	m.mu.RLock()
	snapshot := make(map[int64]Adapter, len(m.adapters))
	for id, a := range m.adapters {
		snapshot[id] = a
	}
	m.mu.RUnlock()

	for id, adapter := range snapshot {
		status := adapter.Status()
		m.publishServiceEvent(id, pb.ServiceEventType_SVC_HEARTBEAT, status)
	}
}

// publishServiceEvent marshals a ServiceEvent proto and publishes it to the
// SVC JetStream stream at subject svc.{orgId}.{svcId}.
func (m *WorkerManager) publishServiceEvent(id int64, evtType pb.ServiceEventType, status map[string]interface{}) {
	if m.svcJS == nil {
		return
	}

	orgID := int64(0)
	if v, ok := status["org_id"]; ok {
		switch t := v.(type) {
		case int64:
			orgID = t
		case float64:
			orgID = int64(t)
		case int:
			orgID = int64(t)
		}
	}

	ev := &pb.ServiceEvent{
		EventType:   evtType,
		ServiceId:   id,
		ServiceType: m.serviceType,
		OrgId:       orgID,
		ReportedAt:  timestampinfra.Now(),
	}

	// Populate heartbeat/tombstone-specific fields from status map.
	if v, ok := status["team_id"]; ok {
		switch t := v.(type) {
		case int64:
			ev.TeamId = t
		case float64:
			ev.TeamId = int64(t)
		case int:
			ev.TeamId = int64(t)
		}
	}
	if v, ok := status["team_name"]; ok {
		if s, ok := v.(string); ok {
			ev.TeamName = s
		}
	}
	if v, ok := status["is_connected"]; ok {
		if b, ok := v.(bool); ok {
			ev.IsConnected = b
		}
	}
	if v, ok := status["is_running"]; ok {
		if b, ok := v.(bool); ok {
			ev.IsRunning = b
		}
	}
	if v, ok := status["message_count"]; ok {
		switch t := v.(type) {
		case int64:
			ev.MessageCount = t
		case float64:
			ev.MessageCount = int64(t)
		case int:
			ev.MessageCount = int64(t)
		}
	}
	if v, ok := status["error_count"]; ok {
		switch t := v.(type) {
		case int64:
			ev.ErrorCount = t
		case float64:
			ev.ErrorCount = int64(t)
		case int:
			ev.ErrorCount = int64(t)
		}
	}
	if v, ok := status["broker"]; ok {
		if s, ok := v.(string); ok {
			ev.Broker = s
		}
	}
	if v, ok := status["topics"]; ok {
		switch t := v.(type) {
		case []string:
			ev.Topics = t
		case []interface{}:
			for _, item := range t {
				if s, ok := item.(string); ok {
					ev.Topics = append(ev.Topics, s)
				}
			}
		}
	}
	if evtType == pb.ServiceEventType_SVC_TOMBSTONE {
		ev.IsRunning = false
		ev.IsConnected = false
	}

	data, err := pb.MarshalServiceEvent(ev)
	if err != nil {
		m.logger.Printf("ServiceEvent marshal error for service %d: %v", id, err)
		return
	}

	subject := fmt.Sprintf("svc.%d.%d", orgID, id)
	if _, err := m.svcJS.Publish(context.Background(), subject, data); err != nil {
		m.logger.Printf("ServiceEvent publish error for service %d (subject=%s): %v", id, subject, err)
	}
}

// Stop gracefully stops all adapters and publishes a tombstone for each.
func (m *WorkerManager) Stop() {
	m.logger.Printf("Stopping worker manager for %s", m.serviceType)
	close(m.stopCh)

	m.mu.Lock()
	defer m.mu.Unlock()
	for id, a := range m.adapters {
		lastStatus := a.Status()
		a.Stop()
		m.publishTombstone(id, lastStatus)
	}
	m.adapters = make(map[int64]Adapter)
}

// publishTombstone publishes a final "tombstone" ServiceEvent for a stopped adapter
// so the API and browser both learn the adapter is no longer running.
func (m *WorkerManager) publishTombstone(id int64, lastStatus map[string]interface{}) {
	if m.svcJS == nil {
		return
	}
	m.publishServiceEvent(id, pb.ServiceEventType_SVC_TOMBSTONE, lastStatus)
}

// discoverAndSync queries the services table and syncs adapters.
func (m *WorkerManager) discoverAndSync(ctx context.Context) error {
	query := `
		SELECT
			ir.id,
			ir.name,
			ir.service_type,
			COALESCE(ir.organization_id, 0),
			COALESCE(ir.team_id, 0),
			COALESCE(ir.is_global, false),
			COALESCE(ir.provider_id, 0),
			COALESCE(ip.code, ''),
			COALESCE(ip.default_subscribe_topics, '[]'),
			COALESCE(o.name, ''),
			COALESCE(t.name, ''),
			COALESCE(ir.is_active, true)
		FROM services ir
		LEFT JOIN service_providers ip ON ir.provider_id = ip.id
		LEFT JOIN organizations o ON ir.organization_id = o.id
		LEFT JOIN teams t ON ir.team_id = t.id
		WHERE ir.is_active = true
			AND ir.service_type = $1
		ORDER BY ir.organization_id, ir.team_id, ir.id
	`

	rows, err := m.db.QueryContext(ctx, query, m.serviceType)
	if err != nil {
		return fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	discovered := make(map[int64]*IntegrationEntry)
	for rows.Next() {
		var e IntegrationEntry
		var providerDefaultTopicsJSON []byte
		if err := rows.Scan(
			&e.ID, &e.Name, &e.ServiceType,
			&e.OrganizationID, &e.TeamID, &e.IsGlobal,
			&e.ProviderID, &e.ProviderCode,
			&providerDefaultTopicsJSON,
			&e.OrgName, &e.TeamName, &e.IsActive,
		); err != nil {
			m.logger.Printf("Scan error: %v", err)
			continue
		}
		if len(providerDefaultTopicsJSON) > 0 {
			var topics []string
			if err := json.Unmarshal(providerDefaultTopicsJSON, &topics); err == nil {
				e.ProviderDefaultTopics = topics
			}
		}

		// Load type-specific config
		cfg, err := m.loadConfig(ctx, e.ID, e.ServiceType)
		if err != nil {
			m.logger.Printf("Failed to load config for service %d (%s): %v", e.ID, e.ServiceType, err)
			continue
		}
		e.Config = cfg

		discovered[e.ID] = &e
		m.logger.Printf("Discovered service: type=%s id=%d name=%s provider=%s", m.serviceType, e.ID, e.Name, e.ProviderCode)
	}
	if err = rows.Err(); err != nil {
		return fmt.Errorf("rows error: %w", err)
	}

	m.syncAdapters(ctx, discovered)

	m.mu.Lock()
	m.lastDiscovery = time.Now()
	m.discoveryCount++
	m.mu.Unlock()

	m.logger.Printf("Discovery complete: %d discovered, %d active", len(discovered), len(m.adapters))
	return nil
}

// loadConfig loads the type-specific config from the corresponding config table.
func (m *WorkerManager) loadConfig(ctx context.Context, serviceID int64, serviceType string) (map[string]interface{}, error) {
	table := configTableForServiceType(serviceType)
	if table == "" {
		return nil, fmt.Errorf("unknown service type: %s", serviceType)
	}

	// Query all columns from the config table for this service.
	query := fmt.Sprintf(
		`SELECT row_to_json(c.*) FROM %s c WHERE c.service_id = $1 LIMIT 1`,
		table,
	)

	var raw []byte
	if err := m.db.QueryRowContext(ctx, query, serviceID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return map[string]interface{}{}, nil
		}
		return nil, fmt.Errorf("config query for %s failed: %w", table, err)
	}

	var cfg map[string]interface{}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("config unmarshal failed: %w", err)
	}
	return cfg, nil
}

// configTableForServiceType maps a service_type to its per-service config table.
func configTableForServiceType(st string) string {
	switch st {
	case "input.mqtt":
		return "service_input_mqtt_config"
	case "output.mqtt":
		return "service_output_mqtt_config"
	case "input.grpc-server":
		return "service_input_grpcserver_config"
	case "input.grpc-pull":
		return "service_input_grpcpull_config"
	case "output.grpc-push":
		return "service_output_grpcpush_config"
	case "input.http-server":
		return "service_input_httpserver_config"
	case "input.http-pull":
		return "service_input_httppull_config"
	case "output.http-push":
		return "service_output_httppush_config"
	case "input.influxdb3":
		return "service_input_influxdb3_config"
	case "output.influxdb3":
		return "service_output_influxdb3_config"
	case "output.clickhouse":
		return "service_output_clickhouse_config"
	default:
		return ""
	}
}

// syncAdapters compares discovered integrations with running adapters.
func (m *WorkerManager) syncAdapters(ctx context.Context, discovered map[int64]*IntegrationEntry) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Stop adapters that are no longer discovered.
	for id, a := range m.adapters {
		if _, ok := discovered[id]; !ok {
			m.logger.Printf("Stopping adapter for service %d", id)
			lastStatus := a.Status()
			a.Stop()
			delete(m.adapters, id)
			m.publishTombstone(id, lastStatus)
		}
	}

	// Start newly discovered adapters.
	for id, entry := range discovered {
		if _, ok := m.adapters[id]; ok {
			continue
		}

		adapter, err := m.adapterFactory(entry)
		if err != nil {
			m.logger.Printf("Failed to create adapter for service %d: %v", id, err)
			continue
		}

		if err := adapter.Start(ctx); err != nil {
			m.logger.Printf("Failed to start adapter for service %d: %v", id, err)
			continue
		}

		m.adapters[id] = adapter
	}
}

// GetAdapterStatus returns status of all adapters.
func (m *WorkerManager) GetAdapterStatus() map[string]interface{} {
	m.mu.RLock()
	defer m.mu.RUnlock()

	statuses := make([]map[string]interface{}, 0, len(m.adapters))
	for _, a := range m.adapters {
		statuses = append(statuses, a.Status())
	}
	return map[string]interface{}{
		"service_type":    m.serviceType,
		"adapters_count":  len(m.adapters),
		"adapters":        statuses,
		"last_discovery":  m.lastDiscovery.Format(time.RFC3339),
		"discovery_count": m.discoveryCount,
	}
}
