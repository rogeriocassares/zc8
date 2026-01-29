package kron

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/util"
)

func init() {
	// vendor/model/direction
	parser.RegisterParser("kron/ks3000/uplink", ParseKronKS3000Uplink)
}

type KS3000 struct {
	Variable string          `json:"variable"`
	Param    string          `json:"param"`
	Time     string          `json:"time"`
	Metadata KS3000_Metadata `json:"metadata"`
	Id       string          `json:"ID"`
	Msg      string          `json:"msg"`
}

type KS3000_Metadata struct {
	Variable string             `json:"variable"`
	Time     string             `json:"time"`
	Metadata KS3000_Metadata_IM `json:"metadata"`
}

type KS3000_Metadata_IM struct {
	U0  float64 `json:"U0"`
	I0  float64 `json:"I0"`
	F1  float64 `json:"F1"`
	P0  float64 `json:"P0"`
	Q0  float64 `json:"Q0"`
	FP0 float64 `json:"FP0"`
	EA  float64 `json:"EA"`
	ER  float64 `json:"ER"`
	EAN float64 `json:"EAN"`
	ERN float64 `json:"ERN"`
	CE  float64 `json:"CE"`
}

func (r *KS3000) UnmarshalKS3000JSON(data []byte) error {
	// First, unmarshal into a map to inspect structure
	var objMap map[string]json.RawMessage
	if err := json.Unmarshal(data, &objMap); err != nil {
		return err
	}

	// Check for 'variable' field to determine type
	if _, hasVar := objMap["variable"]; hasVar {
		// First format: data with metadata
		json.Unmarshal(objMap["variable"], &r.Variable)
		json.Unmarshal(objMap["time"], &r.Time)
		json.Unmarshal(objMap["metadata"], &r.Metadata)
	} else if _, hasParam := objMap["param"]; hasParam {
		// Second format: log message
		json.Unmarshal(objMap["param"], &r.Param)
		json.Unmarshal(objMap["id"], &r.Id)
		json.Unmarshal(objMap["msg"], &r.Msg)
		// Time not present in this format
	}
	return nil
}

func ParseKronKS3000Uplink(payload []byte, model string) (*util.ParsedData, error) {
	fmt.Printf("\n ### DecodeKronKS3000WiFi ###\n")
	dp := &util.ParsedData{
		Fields: make(map[string]interface{}),
		Tags:   make(map[string]interface{}),
	}

	if util.IsJSONArray(payload) {
		var ks3000_metadata []KS3000_Metadata
		if err := json.Unmarshal(payload, &ks3000_metadata); err != nil {
			return nil, err
		}
		if len(ks3000_metadata) == 0 {
			return nil, fmt.Errorf("empty metadata array")
		}
		// Use the first element's embedded metadata IM
		im := ks3000_metadata[0].Metadata
		ts, err := time.Parse("2006-01-02 15:04:05", ks3000_metadata[0].Time)
		if err != nil {
			fmt.Println("Error parsing time:", err)
			return nil, err
		}

		dp.Fields = map[string]interface{}{
			"u_ll_avg":     im.U0,
			"i_avg":        im.I0,
			"frequency":    im.F1,
			"p_total":      im.P0,
			"q_total":      im.Q0,
			"power_factor": im.FP0,
			"a_plus":       im.EA,
			"q_plus":       im.ER,
			"a_minus":      im.EAN,
			"q_minus":      im.ERN,
			"error_code":   im.CE,
			"created_at":   uint64(time.Now().UnixNano()),
			"data":         "<data_omitted>",
		}
		dp.Tags = map[string]interface{}{
			// "variable": ks3000_metadata[0].Variable,
		}
		dp.Timestamp = uint64(ts.UnixNano())

	} else if util.IsJSONObject(payload) {
		// payload = "eyJwYXJhbSI6ImxvZyIsIklEIjoiMjUxNTExNCIsIm1zZyI6IktTLTMwMDAgdjQuODpFMjU1In0"
		var ks3000_stats KS3000
		if err := json.Unmarshal(payload, &ks3000_stats); err != nil {
			return nil, err
		}
		var sbMsg strings.Builder
		// sbMsg.WriteString(`'`)
		sbMsg.WriteString(ks3000_stats.Msg)
		// sbMsg.WriteString(`'`)
		dp.Name = "ks3000_stats"
		dp.Fields = map[string]interface{}{
			"msg": sbMsg.String(),
		}

		dp.Tags = map[string]interface{}{
			"device_id": ks3000_stats.Id,
			"params":    ks3000_stats.Param,
		}

	} else {
		// DECODE BINARY FROM LNS
	}
	return dp, nil
}
