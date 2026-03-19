package transport

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"
)

// ============================================================================
// MQTT Configuration
// ============================================================================

type MQTTConfig struct {
	ID                      int64
	TransportTypeID         int64
	Host                    string
	Port                    int
	Username                *string // nullable
	Password                *string // nullable
	QoS                     int8    // 0, 1, or 2
	CleanSession            bool
	KeepAliveSec            int
	ConnectionTimeoutSec    int
	UseTLS                  bool
	TLSCACert               *string // nullable
	TLSClientCert           *string // nullable
	TLSClientKey            *string // nullable
	TLSSkipVerify           bool
	Topics                  []string `db:"-"` // Loaded from JSONB
	MaxReconnectIntervalSec int
	CreatedAt               time.Time
	UpdatedAt               time.Time
}

// Scan implements sql.Scanner for Topics JSONB field
func (mc *MQTTConfig) ScanTopics(data []byte) error {
	if data == nil || len(data) == 0 {
		mc.Topics = []string{}
		return nil
	}
	return json.Unmarshal(data, &mc.Topics)
}

// Value implements driver.Valuer for Topics
func (mc *MQTTConfig) ValueTopics() (driver.Value, error) {
	return json.Marshal(mc.Topics)
}

func (mc *MQTTConfig) Validate() error {
	if mc.Host == "" {
		return fmt.Errorf("MQTT host is required")
	}
	if mc.Port <= 0 || mc.Port > 65535 {
		return fmt.Errorf("MQTT port must be between 1 and 65535, got %d", mc.Port)
	}
	if mc.QoS < 0 || mc.QoS > 2 {
		return fmt.Errorf("MQTT QoS must be 0, 1, or 2, got %d", mc.QoS)
	}
	if mc.ConnectionTimeoutSec <= 0 {
		return fmt.Errorf("MQTT connection timeout must be positive")
	}
	if mc.KeepAliveSec <= 0 {
		return fmt.Errorf("MQTT keep alive must be positive")
	}
	return nil
}

func (mc *MQTTConfig) BrokerAddress() string {
	return fmt.Sprintf("%s:%d", mc.Host, mc.Port)
}

// ============================================================================
// HTTP Configuration
// ============================================================================

type HTTPConfig struct {
	ID                  int64
	TransportTypeID     int64
	BaseURL              string
	Method              string            // GET, POST, PUT, PATCH, DELETE
	Headers             map[string]string `db:"-"` // Loaded from JSONB
	AuthType            string            // none, basic, bearer, api-key, custom
	AuthCredentials     *string           // nullable
	UseTLS              bool
	TLSCACert           *string
	TLSClientCert       *string
	TLSClientKey        *string
	TLSSkipVerify       bool
	TimeoutSec          int
	ContentType         string
	RetryCount          int
	RetryDelaySec       int
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// Scan implements sql.Scanner for Headers JSONB field
func (hc *HTTPConfig) ScanHeaders(data []byte) error {
	if data == nil || len(data) == 0 {
		hc.Headers = make(map[string]string)
		return nil
	}
	return json.Unmarshal(data, &hc.Headers)
}

// Value implements driver.Valuer for Headers
func (hc *HTTPConfig) ValueHeaders() (driver.Value, error) {
	return json.Marshal(hc.Headers)
}

func (hc *HTTPConfig) Validate() error {
	if hc.BaseURL == "" {
		return fmt.Errorf("HTTP base URL is required")
	}
	validMethods := map[string]bool{"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true}
	if !validMethods[hc.Method] {
		return fmt.Errorf("HTTP method must be one of GET, POST, PUT, PATCH, DELETE, got %s", hc.Method)
	}
	validAuthTypes := map[string]bool{"none": true, "basic": true, "bearer": true, "api-key": true, "custom": true}
	if !validAuthTypes[hc.AuthType] {
		return fmt.Errorf("HTTP auth type must be one of none, basic, bearer, api-key, custom, got %s", hc.AuthType)
	}
	if hc.TimeoutSec <= 0 {
		return fmt.Errorf("HTTP timeout must be positive")
	}
	return nil
}

// ============================================================================
// gRPC Configuration
// ============================================================================

type GRPCConfig struct {
	ID                   int64
	TransportTypeID      int64
	Host                 string
	Port                 int
	ServiceName          string
	UseTLS               bool
	TLSCACert            *string
	TLSClientCert        *string
	TLSClientKey         *string
	ConnectionTimeoutSec int
	KeepAliveSec         int
	KeepAliveTimeoutSec  int
	MaxIdleConns         int
	MaxConnections       int
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

func (gc *GRPCConfig) Validate() error {
	if gc.Host == "" {
		return fmt.Errorf("gRPC host is required")
	}
	if gc.Port <= 0 || gc.Port > 65535 {
		return fmt.Errorf("gRPC port must be between 1 and 65535, got %d", gc.Port)
	}
	if gc.ServiceName == "" {
		return fmt.Errorf("gRPC service name is required")
	}
	if gc.ConnectionTimeoutSec <= 0 {
		return fmt.Errorf("gRPC connection timeout must be positive")
	}
	return nil
}

func (gc *GRPCConfig) Address() string {
	return fmt.Sprintf("%s:%d", gc.Host, gc.Port)
}

// ============================================================================
// Union type for transport config (discriminated union pattern)
// ============================================================================

type TransportConfigType string

const (
	TransportMQTT TransportConfigType = "mqtt-subscriber"
	TransportHTTP TransportConfigType = "http-subscriber"
	TransportGRPC TransportConfigType = "grpc-subscriber"
)

type TransportConfig struct {
	Type   TransportConfigType
	MQTT   *MQTTConfig
	HTTP   *HTTPConfig
	GRPC   *GRPCConfig
}

func (tc *TransportConfig) Validate() error {
	switch tc.Type {
	case TransportMQTT:
		if tc.MQTT == nil {
			return fmt.Errorf("MQTT config is nil for mqtt-subscriber transport")
		}
		return tc.MQTT.Validate()
	case TransportHTTP:
		if tc.HTTP == nil {
			return fmt.Errorf("HTTP config is nil for http-subscriber transport")
		}
		return tc.HTTP.Validate()
	case TransportGRPC:
		if tc.GRPC == nil {
			return fmt.Errorf("gRPC config is nil for grpc-subscriber transport")
		}
		return tc.GRPC.Validate()
	default:
		return fmt.Errorf("unknown transport config type: %s", tc.Type)
	}
}

// ============================================================================
// Transport Config Registry (intermediate table)
// ============================================================================
// TransportConfigRegistry represents a row from the transport_config table,
// which acts as a polymorphic foreign key resolver. Each registry entry points
// to exactly one specific config table (MQTT, HTTP, or gRPC) based on config_type.

type ConfigType string

const (
	ConfigTypeMQTT ConfigType = "mqtt"
	ConfigTypeHTTP ConfigType = "http"
	ConfigTypeGRPC ConfigType = "grpc"
)

type TransportConfigRegistry struct {
	ID              int64
	TransportTypeID int64
	ConfigType      ConfigType
	MQTTConfigID    *int64    // Non-null if ConfigType == ConfigTypeMQTT
	HTTPConfigID    *int64    // Non-null if ConfigType == ConfigTypeHTTP
	GRPCConfigID    *int64    // Non-null if ConfigType == ConfigTypeGRPC
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (tcr *TransportConfigRegistry) Validate() error {
	if tcr.TransportTypeID <= 0 {
		return fmt.Errorf("transport type ID must be positive")
	}

	switch tcr.ConfigType {
	case ConfigTypeMQTT:
		if tcr.MQTTConfigID == nil || *tcr.MQTTConfigID <= 0 {
			return fmt.Errorf("MQTT config must have valid mqtt_config_id")
		}
		if tcr.HTTPConfigID != nil || tcr.GRPCConfigID != nil {
			return fmt.Errorf("MQTT config should not have HTTP or gRPC config IDs")
		}
	case ConfigTypeHTTP:
		if tcr.HTTPConfigID == nil || *tcr.HTTPConfigID <= 0 {
			return fmt.Errorf("HTTP config must have valid http_config_id")
		}
		if tcr.MQTTConfigID != nil || tcr.GRPCConfigID != nil {
			return fmt.Errorf("HTTP config should not have MQTT or gRPC config IDs")
		}
	case ConfigTypeGRPC:
		if tcr.GRPCConfigID == nil || *tcr.GRPCConfigID <= 0 {
			return fmt.Errorf("gRPC config must have valid grpc_config_id")
		}
		if tcr.MQTTConfigID != nil || tcr.HTTPConfigID != nil {
			return fmt.Errorf("gRPC config should not have MQTT or HTTP config IDs")
		}
	default:
		return fmt.Errorf("unknown config type: %s", tcr.ConfigType)
	}

	return nil
}
