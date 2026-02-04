package parser

import (
	"fmt"
	"sync"
	"time"

	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser/lns"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/util"
)

// ParseConfig defines how to parse device data
type ParseConfig struct {
	Direction   string `json:"direction"`
	Vendor      string `json:"vendor"`
	Origin      string `json:"origin"`
	Model       string `json:"model"`
	Measurement string `json:"measurement"`
}

type Parser struct {
	// Can add custom parsers or plugins here
}

// New creates a new Parser instance
func NewServer() *Parser {
	return &Parser{}
}

type ParserFunc func([]byte, string) (*util.ParsedData, error)

var parserMap sync.Map

func RegisterParser(key string, parser ParserFunc) {
	parserMap.Store(key, parser)
}

func GetParser(key string) (ParserFunc, bool) {
	if v, ok := parserMap.Load(key); ok {
		return v.(ParserFunc), true
	}
	return nil, false
}

func (p *Parser) Parse(config ParseConfig, data []byte) (*util.ParsedData, error) {

	var pd = &util.ParsedData{
		Name: "",
		// Fields:    make(map[string]interface{}),
		Fields:    make(map[string]any),
		Tags:      make(map[string]string),
		Timestamp: uint64(time.Now().UnixNano()),
	}

	var err error

	pd.Name = config.Measurement
	pd.Tags["vendor"] = config.Vendor
	pd.Tags["model"] = config.Model
	pd.Tags["origin"] = config.Origin
	pd.Tags["direction"] = config.Direction

	switch config.Origin {
	case "chirpstackv4":
		pd, err = lns.ParseLns(config.Origin, data)
		if err != nil {
			return nil, err
		}
	default:
		// pd.Tags["sensor_type"] = "raw_data"
		pd.Fields["data"] = data
		pd.Tags["origin"] = "mqtt"

		// return nil, fmt.Errorf("unsupported Transport: %s", config.Transport)
	}

	// vendor/direction
	key := config.Vendor + "/" + config.Model + "/" + config.Direction
	parseVMD, ok := GetParser(key) // parse by vendor, transport and direction
	if !ok {
		return nil, fmt.Errorf("no parser for %s", key)
	}

	isData, ok := pd.Fields["data"]
	if !ok || isData == nil {
		return nil, fmt.Errorf("missing data field")
	}
	dataBytes, ok := isData.([]byte)
	if !ok {
		return nil, fmt.Errorf("data is not []byte")
	}
	dd, err := parseVMD(dataBytes, config.Model) // LongTermThoughts: pass model if necessary

	if err != nil {
		return nil, err
	}

	// Merge Fields
	if dd.Fields != nil {
		pd.Fields = dd.Fields
	}

	// Merge Tags
	if dd.Tags != nil {
		if pd.Tags == nil {
			pd.Tags = make(map[string]string)
		}
		for k, v := range dd.Tags {
			pd.Tags[k] = v
		}
	}

	// Merge Timestamp
	if dd.Timestamp != 0 {
		pd.Timestamp = dd.Timestamp
	}

	return pd, nil
}
