package transport

import (
	"time"

	"github.com/rogeriocassares/zc8/packages/go-data"
	"github.com/rogeriocassares/zc8/packages/go-parser"
)

// Message is the unified message produced by all transport adapters (MQTT, HTTP, gRPC).
// It carries parsed telemetry data from the adapter to the ingest pipeline.
type Message struct {
	TransportRegistryID int64
	TransportType       string
	TeamID              int64
	TeamName            string
	OrganizationID      int64
	DeviceKey           string
	DeviceUUID          string
	DeviceModelCode     string
	VendorID            int64
	GatewayParserCode   string
	DeviceParserCode    string
	GatewayFrame        *parser.GatewayFrame
	DeviceData          *parser.DeviceData
	Routing             *data.IngestRouting
	Metadata            map[string]interface{}
	ReceivedAt          time.Time
}

// DeviceConfig represents device identity and routing resolved from v_device_ingest_routing.
type DeviceConfig struct {
	DeviceUUID      string
	DeviceKey       string
	DeviceModelCode string
	VendorID        int64
	TeamID          int64
	ParserCode      string
	ParserConfig    map[string]interface{}
	Routing         *data.IngestRouting
}

// TransportEntry is a discovered transport_registry row with joined metadata.
type TransportEntry struct {
	ID                int64
	Name              string
	OrganizationID    int64
	TeamID            int64
	IsGlobal          bool
	TransportTypeCode string
	TeamName          string
	OrgName           string
	ParserID          int64
	ParserCode        string
	Config            map[string]interface{} // Config holds the decoded config map for backward compatibility.
}
