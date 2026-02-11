package kron

import (
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/util"
)

func init() {
	// vendor/model/direction
	parser.RegisterParser("agent/ping/uplink", ParsePingUplink)
	parser.RegisterParser("agent/storio/uplink", ParseStorioUplink)
	parser.RegisterParser("agent/storio/downlink", ParseStorioDownlink)
}

func ParsePingUplink(payload []byte, model string) (*util.ParsedData, error) {
	// payload = "64 bytes from 8.8.8.8: icmp_seq=7 ttl=118 time=9.666 ms"
	dp := &util.ParsedData{
		Fields: make(map[string]any),
	}

	dp.Fields["data"] = payload

	return dp, nil
}

func ParseStorioUplink(payload []byte, model string) (*util.ParsedData, error) {
	// payload = "log"
	dp := &util.ParsedData{
		Fields: make(map[string]any),
	}

	dp.Fields["data"] = payload
	return dp, nil
}

func ParseStorioDownlink(payload []byte, model string) (*util.ParsedData, error) {
	// payload = `{"dir":"/home/a", "cache":"256"}`
	dp := &util.ParsedData{
		Fields: make(map[string]any),
	}

	dp.Fields["data"] = payload
	return dp, nil
}
