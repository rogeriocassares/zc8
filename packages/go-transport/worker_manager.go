package transport

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sync"
	"time"

	tcfg "github.com/rogeriocassares/zc8/packages/go-config/transport"
)

// Adapter is the interface every transport adapter must implement.
type Adapter interface {
	Start(ctx context.Context) error
	Stop()
	Status() map[string]interface{}
}

// AdapterFactory creates an Adapter for a discovered TransportEntry.
// The factory receives the typed transport config loaded from the database.
type AdapterFactory func(entry *TransportEntry, typedCfg *tcfg.TransportConfig) (Adapter, error)

// WorkerManager discovers transports from transport_registry and manages adapters.
// It is parameterized by transportTypeCode and configType so it can be reused
// across MQTT, HTTP, and gRPC services.
type WorkerManager struct {
	db                *sql.DB
	transportTypeCode string // e.g. "mqtt-subscriber", "http-server", "grpc-server"
	configType        string // e.g. "mqtt", "http", "grpc"
	adapterFactory    AdapterFactory
	parserRegistry    *ParserRegistry
	configRepository  *tcfg.ConfigRepository
	logger            *log.Logger

	mu       sync.RWMutex
	adapters map[int64]Adapter

	stopCh            chan struct{}
	discoveryTicker   *time.Ticker
	discoveryInterval time.Duration

	lastDiscovery  time.Time
	discoveryCount int64
}

// WorkerManagerConfig configures the WorkerManager.
type WorkerManagerConfig struct {
	DB                *sql.DB
	TransportTypeCode string
	ConfigType        string
	DiscoveryInterval time.Duration
	AdapterFactory    AdapterFactory
	Logger            *log.Logger
}

// NewWorkerManager creates a new generic worker manager.
func NewWorkerManager(cfg WorkerManagerConfig) *WorkerManager {
	if cfg.Logger == nil {
		cfg.Logger = log.New(log.Writer(), "[WorkerManager] ", log.LstdFlags)
	}
	if cfg.DiscoveryInterval == 0 {
		cfg.DiscoveryInterval = 30 * time.Second
	}
	return &WorkerManager{
		db:                cfg.DB,
		transportTypeCode: cfg.TransportTypeCode,
		configType:        cfg.ConfigType,
		adapterFactory:    cfg.AdapterFactory,
		parserRegistry:    NewParserRegistry(cfg.DB, cfg.Logger),
		configRepository:  tcfg.NewConfigRepository(cfg.DB),
		logger:            cfg.Logger,
		adapters:          make(map[int64]Adapter),
		stopCh:            make(chan struct{}),
		discoveryInterval: cfg.DiscoveryInterval,
	}
}

// ParserRegistry returns the shared ParserRegistry.
func (m *WorkerManager) ParserRegistry() *ParserRegistry { return m.parserRegistry }

// Start loads parsers and begins the discovery loop.
func (m *WorkerManager) Start(ctx context.Context) error {
	m.logger.Printf("Starting worker manager for %s (interval: %v)", m.transportTypeCode, m.discoveryInterval)

	if err := m.parserRegistry.LoadFromDatabase(ctx); err != nil {
		m.logger.Printf("Warning: failed to load parsers: %v", err)
	}

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
	return nil
}

// Stop gracefully stops all adapters.
func (m *WorkerManager) Stop() {
	m.logger.Printf("Stopping worker manager for %s", m.transportTypeCode)
	close(m.stopCh)

	m.mu.Lock()
	defer m.mu.Unlock()
	for _, a := range m.adapters {
		a.Stop()
	}
	m.adapters = make(map[int64]Adapter)
}

// discoverAndSync queries transport_registry and syncs adapters.
func (m *WorkerManager) discoverAndSync(ctx context.Context) error {
	query := `
		SELECT
			tr.id,
			tr.name,
			tr.organization_id,
			tr.team_id,
			tr.is_global,
			tt.code AS transport_type_code,
			COALESCE(t.name, '') AS team_name,
			COALESCE(o.name, '') AS organization_name,
			tr.transport_parser_id,
			tp.code AS parser_code
		FROM transport_registry tr
		JOIN transport_type tt ON tr.transport_type_id = tt.id
		JOIN transport_parser tp ON tr.transport_parser_id = tp.id
		JOIN transport_config tc ON tr.transport_config_id = tc.id
		LEFT JOIN teams t ON tr.team_id = t.id
		LEFT JOIN organizations o ON tr.organization_id = o.id
		WHERE tr.is_active = true
			AND tt.code = $1
			AND tc.config_type = $2
		ORDER BY tr.organization_id, tr.team_id, tr.id
	`

	rows, err := m.db.QueryContext(ctx, query, m.transportTypeCode, m.configType)
	if err != nil {
		return fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	discovered := make(map[int64]*TransportEntry)
	for rows.Next() {
		var (
			id         int64
			name       string
			orgID      int64
			teamID     sql.NullInt64
			isGlobal   bool
			typeCode   string
			teamName   string
			orgName    string
			parserID   int64
			parserCode string
		)

		if err := rows.Scan(&id, &name, &orgID, &teamID, &isGlobal, &typeCode, &teamName, &orgName, &parserID, &parserCode); err != nil {
			m.logger.Printf("Scan error: %v", err)
			continue
		}

		finalTeamID := int64(0)
		if teamID.Valid {
			finalTeamID = teamID.Int64
		}

		discovered[id] = &TransportEntry{
			ID:                id,
			Name:              name,
			OrganizationID:    orgID,
			TeamID:            finalTeamID,
			IsGlobal:          isGlobal,
			TransportTypeCode: typeCode,
			TeamName:          teamName,
			OrgName:           orgName,
			ParserID:          parserID,
			ParserCode:        parserCode,
		}

		m.logger.Printf("Discovered %s transport: id=%d name=%s parser=%s", m.transportTypeCode, id, name, parserCode)
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

// syncAdapters compares discovered transports with running adapters.
func (m *WorkerManager) syncAdapters(ctx context.Context, discovered map[int64]*TransportEntry) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Stop adapters that are no longer discovered.
	for id, a := range m.adapters {
		if _, ok := discovered[id]; !ok {
			m.logger.Printf("Stopping adapter for transport %d", id)
			a.Stop()
			delete(m.adapters, id)
		}
	}

	// Start newly discovered adapters.
	for id, entry := range discovered {
		if _, ok := m.adapters[id]; ok {
			continue
		}

		// Load typed config through the config registry.
		configReg, err := m.configRepository.LoadConfigRegistry(id)
		if err != nil {
			m.logger.Printf("Failed to load config registry for transport %d: %v", id, err)
			continue
		}
		typedCfg, err := m.configRepository.LoadFromRegistry(configReg)
		if err != nil {
			m.logger.Printf("Failed to load typed config for transport %d: %v", id, err)
			continue
		}

		adapter, err := m.adapterFactory(entry, typedCfg)
		if err != nil {
			m.logger.Printf("Failed to create adapter for transport %d: %v", id, err)
			continue
		}

		if err := adapter.Start(ctx); err != nil {
			m.logger.Printf("Failed to start adapter for transport %d: %v", id, err)
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
		"transport_type":   m.transportTypeCode,
		"adapters_count":   len(m.adapters),
		"last_discovery":   m.lastDiscovery,
		"discovery_count":  m.discoveryCount,
		"adapter_statuses": statuses,
	}
}
