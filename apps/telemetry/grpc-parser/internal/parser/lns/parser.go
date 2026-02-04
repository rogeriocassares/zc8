package lns

import (
	"encoding/json"
	"fmt"

	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/util"
)

type LnsUp struct {
	Measurement        string
	DevEUI             string
	RxInfoMac_0        string
	RxInfoTime_0       int64
	RxInfoRssi_0       int64
	RxInfoSnr_0        float64
	RxInfoLat_0        float64
	RxInfoLon_0        float64
	RxInfoAlt_0        uint64
	TxInfoFrequency    float64
	TxInfoModulation   string
	TxInfoBandWidth    uint64
	TxInfoSpreadFactor uint64
	TxInfoCodeRate     string
	FCnt               uint64
	FPort              uint64
	FType              string
	Data               string
}

func ParseLns(origin string, message []byte) (*util.ParsedData, error) {

	var lnsUp LnsUp
	var err error
	var dp = &util.ParsedData{
		Fields: make(map[string]any),
		Tags:   make(map[string]string),
	}
	// var lnsAtcUp LnsAtcUp
	var lnsChirpStackV4Up LnsChirpStackV4Up

	switch origin {
	case "chirpstackv4":
		// if direction == "up" {
		json.Unmarshal([]byte(message), &lnsChirpStackV4Up)
		// fmt.Printf("\nmessage from chirpstackv4 parseLns %s", message)

		lnsUp.DevEUI = lnsChirpStackV4Up.DeviceInfo.DevEui
		lnsUp.RxInfoMac_0 = lnsChirpStackV4Up.RxInfo[0].GatewayId
		lnsUp.RxInfoTime_0 = lnsChirpStackV4Up.RxInfo[0].NsTime.UnixNano()
		lnsUp.RxInfoRssi_0 = lnsChirpStackV4Up.RxInfo[0].Rssi
		lnsUp.RxInfoSnr_0 = lnsChirpStackV4Up.RxInfo[0].Snr
		lnsUp.RxInfoLat_0 = lnsChirpStackV4Up.RxInfo[0].Location.Latitude
		lnsUp.RxInfoLon_0 = lnsChirpStackV4Up.RxInfo[0].Location.Longitude
		lnsUp.RxInfoAlt_0 = lnsChirpStackV4Up.RxInfo[0].Location.Altitude
		lnsUp.TxInfoFrequency = lnsChirpStackV4Up.TxInfo.Frequency / 1000000
		lnsUp.TxInfoModulation = "LORA"
		lnsUp.TxInfoBandWidth = lnsChirpStackV4Up.TxInfo.Modulation.Lora.Bandwidth / 1000
		lnsUp.TxInfoSpreadFactor = lnsChirpStackV4Up.TxInfo.Modulation.Lora.SpreadingFactor
		lnsUp.TxInfoCodeRate = lnsChirpStackV4Up.TxInfo.Modulation.Lora.CodeRate
		lnsUp.FCnt = lnsChirpStackV4Up.FCnt
		lnsUp.FPort = lnsChirpStackV4Up.FPort
		lnsUp.FType = "uplink"
		lnsUp.Data = lnsChirpStackV4Up.Data
		// fmt.Printf("\nlnsUp.Data %s", lnsUp.Data)
	}

	dp.Tags["dev_eui"] = lnsUp.DevEUI
	// dp.Tags["gw_mac"] = lnsUp.RxInfoMac_0
	// dp.Tags["tx_modulation"] = lnsUp.TxInfoModulation
	// Each point value in the measurment
	// dp.Fields["frequency"] = lnsUp.TxInfoFrequency
	// dp.Fields["tx_band_width"] = lnsUp.TxInfoBandWidth
	// dp.Fields["tx_spread_factor"] = lnsUp.TxInfoSpreadFactor

	// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "frequency", Value: lnsUp.TxInfoFrequency})
	// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "rssi", Value: lnsUp.RxInfoRssi_0})
	// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "snr", Value: lnsUp.RxInfoSnr_0})
	// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "gw_lat", Value: lnsUp.RxInfoLat_0})
	// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "gw_lon", Value: lnsUp.RxInfoLon_0})
	// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "gw_alt", Value: lnsUp.RxInfoAlt_0})

	// RFU
	// dp.Fields["frequency"] = util.FieldsValue{Key: "frequency", Value: lnsUp.TxInfoFrequency}
	// dp.Fields["rssi"] = util.FieldsValue{Key: "rssi", Value: lnsUp.RxInfoRssi_0}
	// dp.Fields["snr"] = util.FieldsValue{Key: "snr", Value: lnsUp.RxInfoSnr_0}
	// dp.Fields["gw_lat"] = util.FieldsValue{Key: "gw_lat", Value: lnsUp.RxInfoLat_0}
	// dp.Fields["gw_lon"] = util.FieldsValue{Key: "gw_lon", Value: lnsUp.RxInfoLon_0}
	// dp.Fields["gw_alt"] = util.FieldsValue{Key: "gw_alt", Value: lnsUp.RxInfoAlt_0}

	// dp.Fields["rssi"] = lnsUp.RxInfoRssi_0
	// dp.Fields["snr"] = lnsUp.RxInfoSnr_0
	// dp.Fields["lat"] = lnsUp.RxInfoLat_0
	// dp.Fields["lon"] = lnsUp.RxInfoLon_0
	// dp.Fields["alt"] = lnsUp.RxInfoAlt_0

	// Values: {
	//     "temperature": 23.4,
	//     "humidity": 45.1,
	//     "pressure": 1013.2,
	// }

	data, err := util.Base64ToByte(lnsUp.Data)
	if err != nil {
		fmt.Printf("Error decoding base64 data: %v", err)
	}
	// dp.Fields = append(dp.Fields, util.FieldsValue{Key: "data", Value: data})
	// dp.Fields["data"] = util.FieldsValue{Key: "data", Value: data}
	dp.Fields["data"] = data

	// dp.Fields["gw_alt"] = util.FieldsValue{Key: "gw_alt", Value: lnsUp.RxInfoAlt_0}

	// dp.Fields["data"], err = util.Base64ToByte(lnsUp.Data)
	// if err != nil {
	// 	fmt.Printf("Error decoding base64 data: %v", err)
	// }

	// dp.Fields["data"] = util.HexToBytes(lnsUp.Data)

	dp.Timestamp = uint64(lnsUp.RxInfoTime_0)

	fmt.Printf("\n============= dp: %v\n", dp)
	return dp, nil
}
