package integration

import (
	"time"

	parser "github.com/rogeriocassares/zc8/packages/go-parser"
	pb "github.com/rogeriocassares/zc8/packages/proto/telemetry/v1"
)

// IntegrationEntry is a discovered service row with joined metadata.
type IntegrationEntry struct {
	ID                    int64
	Name                  string
	ServiceType           string // e.g. "input.mqtt", "output.influxdb3", ...
	OrganizationID        int64
	TeamID                int64
	IsGlobal              bool
	ProviderID            int64
	ProviderCode          string   // e.g. "chirpstack", "everynet", "schneider"
	ProviderDefaultTopics []string // default_subscribe_topics from service_providers (populated by WorkerManager)
	OrgName               string
	TeamName              string
	IsActive              bool
	Config                map[string]interface{} // type-specific config from the related config table
}

// Message is the unified message produced by all input adapters.
// It carries parsed telemetry data from the adapter to the NATS JetStream pipeline.
type Message struct {
	ServiceID        int64
	ServiceType      string
	TeamID           int64
	TeamName         string
	OrganizationID   int64
	DeviceKey        string
	DeviceUUID       string
	DeviceModelCode  string
	VendorID         int64
	ProviderCode     string
	DeviceParserCode string
	GatewayFrame     *parser.GatewayFrame
	DeviceData       *parser.DeviceData
	Metadata         map[string]interface{}
	ReceivedAt       time.Time
	// Location + asset tags loaded from device_tags table via LRU cache
	DeviceTags *pb.DeviceTags
	// Sensor calibrations loaded from sensor_calibrations table via LRU cache
	Calibrations []*pb.SensorCalibration
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
	// Location/asset tags from device_tags table (populated by DeviceLookup)
	Tags *pb.DeviceTags
	// Active calibrations from sensor_calibrations table (populated by DeviceLookup)
	Calibrations []*pb.SensorCalibration
}
