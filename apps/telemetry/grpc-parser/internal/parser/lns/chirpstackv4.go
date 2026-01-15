package lns

import (
	"time"
)

type LnsChirpStackV4Up struct {
	DeduplicationId string                      `json:"deduplicationId"`
	DeviceInfo      LnsChirpStackV4UpDeviceInfo `json:"deviceInfo"`
	DevAddr         string                      `json:"devAddr"`
	Adr             bool                        `json:"adr"`
	Dr              uint64                      `json:"dr"`
	FCnt            uint64                      `json:"fCnt"`
	FPort           uint64                      `json:"fPort"`
	Confirmed       string                      `json:"Confirmed"`
	RxInfo          []LnsChirpStackV4UpRxInfo   `json:"rxInfo"`
	TxInfo          LnsChirpStackV4UpTxInfo     `json:"txInfo"`
	Data            string                      `json:"data"`
}

type LnsChirpStackV4UpDeviceInfo struct {
	TenantId           string `json:"tenantId"`
	TenantName         string `json:"tenantName"`
	ApplicationId      string `json:"applicationId"`
	ApplicationName    string `json:"applicationName"`
	DeviceProfileId    string `json:"deviceProfileId"`
	DeviceProfileName  string `json:"deviceProfileName"`
	DeviceName         string `json:"deviceName"`
	DevEui             string `json:"devEui"`
	DeviceClassEnabled string `json:"deviceClassEnabled"`
	Tags               any    `json:"tags"`
}

type LnsChirpStackV4UpRxInfo struct {
	GatewayId         string                    `json:"gatewayId"`
	UplinkId          uint64                    `json:"uplinkId"`
	NsTime            time.Time                 `json:"nsTime"`
	TimeSinceGpsEpoch string                    `json:"timeSinceGpsEpoch"`
	Rssi              int64                     `json:"rssi"`
	Snr               float64                   `json:"snr"`
	Channel           uint64                    `json:"channel"`
	Board             uint64                    `json:"board"`
	Location          LnsChirpStackV4UpLocation `json:"location"`
	Context           string                    `json:"context"`
	Metadata          LnsChirpStackV4UpMetadata `json:"metadata"`
	CrcStatus         string                    `json:"crcStatus"`
}

type LnsChirpStackV4UpLocation struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Altitude  uint64  `json:"altitude"`
}

type LnsChirpStackV4UpMetadata struct {
	Region_config_id   string `json:"region_config_id"`
	Region_common_name string `json:"region_common_name"`
}

type LnsChirpStackV4UpTxInfo struct {
	Frequency  float64                     `json:"frequency"`
	Modulation LnsChirpStackV4UpModulation `json:"modulation"`
}

type LnsChirpStackV4UpModulation struct {
	Lora LnsChirpStackV4UpLora `json:"lora"`
}

type LnsChirpStackV4UpLora struct {
	Bandwidth       uint64 `json:"bandwidth"`
	SpreadingFactor uint64 `json:"spreadingFactor"`
	CodeRate        string `json:"codeRate"`
}
