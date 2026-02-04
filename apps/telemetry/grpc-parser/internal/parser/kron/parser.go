package kron

import (
	"encoding/json"
	"fmt"
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

// measurement: sensor_data
// tags:
//   sensor_id
//   sensor_type        (temperature, pressure, vibration, etc)
//   device_id
//   location
// fields:
//   value              (float)

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
		// Fields: make([]util.FieldsValue, 0, 12),
		Fields: make(map[string]any),
		Tags:   make(map[string]string),
	}

	if util.IsJSONArray(payload) {
		var ks3000_metadata []KS3000_Metadata
		if err := json.Unmarshal(payload, &ks3000_metadata); err != nil {
			return nil, err
		}
		if len(ks3000_metadata) == 0 {
			return nil, fmt.Errorf("empty metadata array")
		}
		// Use the first element's embedded metadata md
		md := ks3000_metadata[0].Metadata
		ts, err := time.Parse("2006-01-02 15:04:05", ks3000_metadata[0].Time)
		if err != nil {
			fmt.Println("Error parsing time:", err)
			return nil, err
		}

		dp.Fields["u_ll_avg"] = md.U0
		dp.Fields["i_avg"] = md.I0
		dp.Fields["frequency"] = md.F1
		dp.Fields["p_total"] = md.P0
		dp.Fields["q_total"] = md.Q0
		dp.Fields["power_factor"] = md.FP0
		dp.Fields["a_plus"] = md.EA
		dp.Fields["q_plus"] = md.ER
		dp.Fields["a_minus"] = md.EAN
		dp.Fields["q_minus"] = md.ERN
		dp.Fields["error_code"] = md.CE
		dp.Fields["created_at"] = uint64(time.Now().UnixNano())
		dp.Fields["data"] = "<data_omitted>"
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "u_ll_avg", Value: md.U0})
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "i_avg", Value: md.I0})
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "frequency", Value: md.F1})
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "p_total", Value: md.P0})
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "q_total", Value: md.Q0})
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "power_factor", Value: md.FP0})
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "a_plus", Value: md.EA})
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "q_plus", Value: md.ER})
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "a_minus", Value: md.EAN})
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "q_minus", Value: md.ERN})
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "error_code", Value: md.CE})
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "created_at", Value: uint64(time.Now().UnixNano())})
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "data", Value: "<data_omitted>"})
		// 	"p_total":      md.P0,
		// 	"q_total":      md.Q0,
		// 	"power_factor": md.FP0,
		// 	"a_plus":       md.EA,
		// 	"q_plus":       md.ER,
		// 	"a_minus":      md.EAN,
		// 	"q_minus":      md.ERN,
		// 	"error_code":   md.CE,
		// 	"created_at":   uint64(time.Now().UnixNano()),
		// 	"data":         "<data_omitted>",
		// }
		dp.Tags = map[string]string{
			// "variable": ks3000_metadata[0].Variable,
		}
		dp.Timestamp = uint64(ts.UnixNano())

	} else if util.IsJSONObject(payload) {
		// payload = "eyJwYXJhbSI6ImxvZyIsIklEIjoiMjUxNTExNCIsIm1zZyI6IktTLTMwMDAgdjQuODpFMjU1In0"
		// var ks3000_stats KS3000
		// if err := json.Unmarshal(payload, &ks3000_stats); err != nil {
		// 	return nil, err
		// }
		// var sbMsg strings.Builder
		// // sbMsg.WriteString(`'`)
		// sbMsg.WriteString(ks3000_stats.Msg)
		// // sbMsg.WriteString(`'`)
		// dp.Tags["sensor_type"] = "ks3000_stats"
		// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "msg", Value: sbMsg.String()})

		// dp.Tags = map[string]interface{}{
		// 	"device_id": ks3000_stats.Id,
		// 	"params":    ks3000_stats.Param,
		// }

	} else {
		// DECODE BINARY FROM LNS
	}
	fmt.Printf("\n########## dp KRON KS3000, %v\n", dp)
	return dp, nil
}
