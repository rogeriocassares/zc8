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

	data, err := util.Base64ToByte(lnsUp.Data)
	if err != nil {
		fmt.Printf("Error decoding base64 data: %v", err)
	}
	dp.Fields["data"] = data

	dp.Timestamp = uint64(lnsUp.RxInfoTime_0)
	return dp, nil
}
