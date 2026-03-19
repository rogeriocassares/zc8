package transport

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
)

// ============================================================================
// ConfigRepository loads and caches transport configurations
// ============================================================================

type ConfigRepository struct {
	db    *sql.DB
	mu    sync.RWMutex
	cache map[int64]*TransportConfig // transport_registry_id -> config
}

func NewConfigRepository(db *sql.DB) *ConfigRepository {
	return &ConfigRepository{
		db:    db,
		cache: make(map[int64]*TransportConfig),
	}
}

// LoadTransportConfig loads configuration for a specific transport registry entry
// This method is maintained for backward compatibility.
// NEW: Use LoadConfigRegistry and LoadFromRegistry instead for better type safety.
func (cr *ConfigRepository) LoadTransportConfig(transportRegistryID int64, transportTypeCode string) (*TransportConfig, error) {
	// Check cache first
	cr.mu.RLock()
	if cached, ok := cr.cache[transportRegistryID]; ok {
		cr.mu.RUnlock()
		return cached, nil
	}
	cr.mu.RUnlock()

	// Load from database
	config := &TransportConfig{}

	switch transportTypeCode {
	case "mqtt-subscriber":
		mqttCfg, err := cr.loadMQTTConfig(transportRegistryID)
		if err != nil {
			return nil, fmt.Errorf("failed to load MQTT config: %w", err)
		}
		config.Type = TransportMQTT
		config.MQTT = mqttCfg

	case "http-subscriber":
		httpCfg, err := cr.loadHTTPConfig(transportRegistryID)
		if err != nil {
			return nil, fmt.Errorf("failed to load HTTP config: %w", err)
		}
		config.Type = TransportHTTP
		config.HTTP = httpCfg

	case "grpc-subscriber":
		grpcCfg, err := cr.loadGRPCConfig(transportRegistryID)
		if err != nil {
			return nil, fmt.Errorf("failed to load gRPC config: %w", err)
		}
		config.Type = TransportGRPC
		config.GRPC = grpcCfg

	default:
		return nil, fmt.Errorf("unknown transport type: %s", transportTypeCode)
	}

	// Validate the config
	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("config validation failed: %w", err)
	}

	// Cache it
	cr.mu.Lock()
	cr.cache[transportRegistryID] = config
	cr.mu.Unlock()

	return config, nil
}

// loadMQTTConfig loads MQTT configuration from database
func (cr *ConfigRepository) loadMQTTConfig(transportRegistryID int64) (*MQTTConfig, error) {
	query := `
		SELECT
			tmc.id,
			tmc.transport_type_id,
			tmc.host,
			tmc.port,
			tmc.username,
			tmc.password,
			tmc.qos,
			tmc.clean_session,
			tmc.keep_alive_sec,
			tmc.connection_timeout_sec,
			tmc.use_tls,
			tmc.tls_ca_cert,
			tmc.tls_client_cert,
			tmc.tls_client_key,
			tmc.tls_skip_verify,
			tmc.topics,
			tmc.max_reconnect_interval_sec,
			tmc.created_at,
			tmc.updated_at
		FROM transport_registry tr
		JOIN transport_mqtt_config tmc ON tr.transport_mqtt_config_id = tmc.id
		WHERE tr.id = $1
	`

	var cfg MQTTConfig
	var topicsJSON []byte

	err := cr.db.QueryRow(query, transportRegistryID).Scan(
		&cfg.ID,
		&cfg.TransportTypeID,
		&cfg.Host,
		&cfg.Port,
		&cfg.Username,
		&cfg.Password,
		&cfg.QoS,
		&cfg.CleanSession,
		&cfg.KeepAliveSec,
		&cfg.ConnectionTimeoutSec,
		&cfg.UseTLS,
		&cfg.TLSCACert,
		&cfg.TLSClientCert,
		&cfg.TLSClientKey,
		&cfg.TLSSkipVerify,
		&topicsJSON,
		&cfg.MaxReconnectIntervalSec,
		&cfg.CreatedAt,
		&cfg.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("MQTT config not found for transport %d", transportRegistryID)
	}
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}

	// Parse topics JSON
	if err := json.Unmarshal(topicsJSON, &cfg.Topics); err != nil {
		return nil, fmt.Errorf("failed to parse topics: %w", err)
	}

	return &cfg, nil
}

// loadHTTPConfig loads HTTP configuration from database
func (cr *ConfigRepository) loadHTTPConfig(transportRegistryID int64) (*HTTPConfig, error) {
	query := `
		SELECT
			thc.id,
			thc.transport_type_id,
			thc.base_url,
			thc.method,
			thc.headers,
			thc.auth_type,
			thc.auth_credentials,
			thc.use_tls,
			thc.tls_ca_cert,
			thc.tls_client_cert,
			thc.tls_client_key,
			thc.tls_skip_verify,
			thc.timeout_sec,
			thc.content_type,
			thc.retry_count,
			thc.retry_delay_sec,
			thc.created_at,
			thc.updated_at
		FROM transport_registry tr
		JOIN transport_http_config thc ON tr.transport_http_config_id = thc.id
		WHERE tr.id = $1
	`

	var cfg HTTPConfig
	var headersJSON []byte

	err := cr.db.QueryRow(query, transportRegistryID).Scan(
		&cfg.ID,
		&cfg.TransportTypeID,
		&cfg.BaseURL,
		&cfg.Method,
		&headersJSON,
		&cfg.AuthType,
		&cfg.AuthCredentials,
		&cfg.UseTLS,
		&cfg.TLSCACert,
		&cfg.TLSClientCert,
		&cfg.TLSClientKey,
		&cfg.TLSSkipVerify,
		&cfg.TimeoutSec,
		&cfg.ContentType,
		&cfg.RetryCount,
		&cfg.RetryDelaySec,
		&cfg.CreatedAt,
		&cfg.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("HTTP config not found for transport %d", transportRegistryID)
	}
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}

	// Parse headers JSON
	if err := json.Unmarshal(headersJSON, &cfg.Headers); err != nil {
		return nil, fmt.Errorf("failed to parse headers: %w", err)
	}

	return &cfg, nil
}

// loadGRPCConfig loads gRPC configuration from database
func (cr *ConfigRepository) loadGRPCConfig(transportRegistryID int64) (*GRPCConfig, error) {
	query := `
		SELECT
			tgc.id,
			tgc.transport_type_id,
			tgc.host,
			tgc.port,
			tgc.service_name,
			tgc.use_tls,
			tgc.tls_ca_cert,
			tgc.tls_client_cert,
			tgc.tls_client_key,
			tgc.connection_timeout_sec,
			tgc.keep_alive_sec,
			tgc.keep_alive_timeout_sec,
			tgc.max_idle_conns,
			tgc.max_connections,
			tgc.created_at,
			tgc.updated_at
		FROM transport_registry tr
		JOIN transport_grpc_config tgc ON tr.transport_grpc_config_id = tgc.id
		WHERE tr.id = $1
	`

	var cfg GRPCConfig

	err := cr.db.QueryRow(query, transportRegistryID).Scan(
		&cfg.ID,
		&cfg.TransportTypeID,
		&cfg.Host,
		&cfg.Port,
		&cfg.ServiceName,
		&cfg.UseTLS,
		&cfg.TLSCACert,
		&cfg.TLSClientCert,
		&cfg.TLSClientKey,
		&cfg.ConnectionTimeoutSec,
		&cfg.KeepAliveSec,
		&cfg.KeepAliveTimeoutSec,
		&cfg.MaxIdleConns,
		&cfg.MaxConnections,
		&cfg.CreatedAt,
		&cfg.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("gRPC config not found for transport %d", transportRegistryID)
	}
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}

	return &cfg, nil
}

// ============================================================================
// NEW METHODS: Using TransportConfigRegistry intermediate table
// ============================================================================

// LoadConfigRegistry loads the transport_config registry entry for a given transport registry ID
func (cr *ConfigRepository) LoadConfigRegistry(transportRegistryID int64) (*TransportConfigRegistry, error) {
	query := `
		SELECT
			tc.id,
			tc.transport_type_id,
			tc.config_type,
			tc.mqtt_config_id,
			tc.http_config_id,
			tc.grpc_config_id,
			tc.created_at,
			tc.updated_at
		FROM transport_registry tr
		JOIN transport_config tc ON tr.transport_config_id = tc.id
		WHERE tr.id = $1
	`

	var tcr TransportConfigRegistry

	err := cr.db.QueryRow(query, transportRegistryID).Scan(
		&tcr.ID,
		&tcr.TransportTypeID,
		&tcr.ConfigType,
		&tcr.MQTTConfigID,
		&tcr.HTTPConfigID,
		&tcr.GRPCConfigID,
		&tcr.CreatedAt,
		&tcr.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("config registry not found for transport %d", transportRegistryID)
	}
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}

	// Validate the registry entry
	if err := tcr.Validate(); err != nil {
		return nil, fmt.Errorf("config registry validation failed: %w", err)
	}

	return &tcr, nil
}

// LoadFromRegistry loads the typed configuration based on a TransportConfigRegistry entry
func (cr *ConfigRepository) LoadFromRegistry(registry *TransportConfigRegistry) (*TransportConfig, error) {
	config := &TransportConfig{}

	switch registry.ConfigType {
	case ConfigTypeMQTT:
		if registry.MQTTConfigID == nil {
			return nil, fmt.Errorf("MQTT config ID is nil for MQTT registry entry")
		}
		mqttCfg, err := cr.loadMQTTConfigByID(*registry.MQTTConfigID)
		if err != nil {
			return nil, fmt.Errorf("failed to load MQTT config: %w", err)
		}
		config.Type = TransportMQTT
		config.MQTT = mqttCfg

	case ConfigTypeHTTP:
		if registry.HTTPConfigID == nil {
			return nil, fmt.Errorf("HTTP config ID is nil for HTTP registry entry")
		}
		httpCfg, err := cr.loadHTTPConfigByID(*registry.HTTPConfigID)
		if err != nil {
			return nil, fmt.Errorf("failed to load HTTP config: %w", err)
		}
		config.Type = TransportHTTP
		config.HTTP = httpCfg

	case ConfigTypeGRPC:
		if registry.GRPCConfigID == nil {
			return nil, fmt.Errorf("gRPC config ID is nil for gRPC registry entry")
		}
		grpcCfg, err := cr.loadGRPCConfigByID(*registry.GRPCConfigID)
		if err != nil {
			return nil, fmt.Errorf("failed to load gRPC config: %w", err)
		}
		config.Type = TransportGRPC
		config.GRPC = grpcCfg

	default:
		return nil, fmt.Errorf("unknown config type: %s", registry.ConfigType)
	}

	// Validate the loaded config
	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("config validation failed: %w", err)
	}

	return config, nil
}

// loadMQTTConfigByID loads MQTT configuration by config ID (not transport registry ID)
func (cr *ConfigRepository) loadMQTTConfigByID(mqttConfigID int64) (*MQTTConfig, error) {
	query := `
		SELECT
			id,
			transport_type_id,
			host,
			port,
			username,
			password,
			qos,
			clean_session,
			keep_alive_sec,
			connection_timeout_sec,
			use_tls,
			tls_ca_cert,
			tls_client_cert,
			tls_client_key,
			tls_skip_verify,
			topics,
			max_reconnect_interval_sec,
			created_at,
			updated_at
		FROM transport_mqtt_config
		WHERE id = $1
	`

	var (
		cfg       MQTTConfig
		topicsJSON []byte
	)

	err := cr.db.QueryRow(query, mqttConfigID).Scan(
		&cfg.ID,
		&cfg.TransportTypeID,
		&cfg.Host,
		&cfg.Port,
		&cfg.Username,
		&cfg.Password,
		&cfg.QoS,
		&cfg.CleanSession,
		&cfg.KeepAliveSec,
		&cfg.ConnectionTimeoutSec,
		&cfg.UseTLS,
		&cfg.TLSCACert,
		&cfg.TLSClientCert,
		&cfg.TLSClientKey,
		&cfg.TLSSkipVerify,
		&topicsJSON,
		&cfg.MaxReconnectIntervalSec,
		&cfg.CreatedAt,
		&cfg.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("MQTT config not found: id=%d", mqttConfigID)
	}
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}

	// Parse topics JSON
	if err := cfg.ScanTopics(topicsJSON); err != nil {
		return nil, fmt.Errorf("failed to parse topics: %w", err)
	}

	return &cfg, nil
}

// loadHTTPConfigByID loads HTTP configuration by config ID (not transport registry ID)
func (cr *ConfigRepository) loadHTTPConfigByID(httpConfigID int64) (*HTTPConfig, error) {
	query := `
		SELECT
			id,
			transport_type_id,
			base_url,
			method,
			headers,
			auth_type,
			auth_credentials,
			use_tls,
			tls_ca_cert,
			tls_client_cert,
			tls_client_key,
			tls_skip_verify,
			timeout_sec,
			content_type,
			retry_count,
			retry_delay_sec,
			created_at,
			updated_at
		FROM transport_http_config
		WHERE id = $1
	`

	var (
		cfg        HTTPConfig
		headersJSON []byte
	)

	err := cr.db.QueryRow(query, httpConfigID).Scan(
		&cfg.ID,
		&cfg.TransportTypeID,
		&cfg.BaseURL,
		&cfg.Method,
		&headersJSON,
		&cfg.AuthType,
		&cfg.AuthCredentials,
		&cfg.UseTLS,
		&cfg.TLSCACert,
		&cfg.TLSClientCert,
		&cfg.TLSClientKey,
		&cfg.TLSSkipVerify,
		&cfg.TimeoutSec,
		&cfg.ContentType,
		&cfg.RetryCount,
		&cfg.RetryDelaySec,
		&cfg.CreatedAt,
		&cfg.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("HTTP config not found: id=%d", httpConfigID)
	}
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}

	// Parse headers JSON
	if err := json.Unmarshal(headersJSON, &cfg.Headers); err != nil {
		return nil, fmt.Errorf("failed to parse headers: %w", err)
	}

	return &cfg, nil
}

// loadGRPCConfigByID loads gRPC configuration by config ID (not transport registry ID)
func (cr *ConfigRepository) loadGRPCConfigByID(grpcConfigID int64) (*GRPCConfig, error) {
	query := `
		SELECT
			id,
			transport_type_id,
			host,
			port,
			service_name,
			use_tls,
			tls_ca_cert,
			tls_client_cert,
			tls_client_key,
			connection_timeout_sec,
			keep_alive_sec,
			keep_alive_timeout_sec,
			max_idle_conns,
			max_connections,
			created_at,
			updated_at
		FROM transport_grpc_config
		WHERE id = $1
	`

	var cfg GRPCConfig

	err := cr.db.QueryRow(query, grpcConfigID).Scan(
		&cfg.ID,
		&cfg.TransportTypeID,
		&cfg.Host,
		&cfg.Port,
		&cfg.ServiceName,
		&cfg.UseTLS,
		&cfg.TLSCACert,
		&cfg.TLSClientCert,
		&cfg.TLSClientKey,
		&cfg.ConnectionTimeoutSec,
		&cfg.KeepAliveSec,
		&cfg.KeepAliveTimeoutSec,
		&cfg.MaxIdleConns,
		&cfg.MaxConnections,
		&cfg.CreatedAt,
		&cfg.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("gRPC config not found: id=%d", grpcConfigID)
	}
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}

	return &cfg, nil
}

// InvalidateCache clears the configuration cache (useful for hot-reload)
func (cr *ConfigRepository) InvalidateCache(transportRegistryID int64) {
	cr.mu.Lock()
	delete(cr.cache, transportRegistryID)
	cr.mu.Unlock()
}

// InvalidateCacheAll clears all cached configurations
func (cr *ConfigRepository) InvalidateCacheAll() {
	cr.mu.Lock()
	cr.cache = make(map[int64]*TransportConfig)
	cr.mu.Unlock()
}
