package lns

type LnsAtcUp struct {
	Type   string         `json:"type"`
	Meta   LnsAtcUpMeta   `json:"meta"`
	Params LnsAtcUpParams `json:"params"`
}

type LnsAtcUpMeta struct {
	Application string  `json:"application"`
	Device_addr string  `json:"device_addr"`
	Time        float64 `json:"time"`
	Device      string  `json:"device"`
	Gateway     string  `json:"gateway"`
}

type LnsAtcUpParams struct {
	Payload    string        `json:"payload"`
	Port       uint64        `json:"port"`
	Counter_up uint64        `json:"counter_up"`
	Rx_time    float64       `json:"rx_time"`
	Radio      LnsAtcUpRadio `json:"radio"`
}

type LnsAtcUpRadio struct {
	Datarate   uint64             `json:"datarate"`
	Hardware   LnsAtcUpHardware   `json:"hardware"`
	Modulation LnsAtcUpModulation `json:"modulation"`
	Time       float64            `json:"time"`
	Freq       float64            `json:"freq"`
	Size       uint64             `json:"size"`
}

type LnsAtcUpModulation struct {
	Bandwidth uint64 `json:"bandwidth"`
	Type      string `json:"type"`
	Spreading uint64 `json:"spreading"`
	Coderate  string `json:"coderate"`
}

type LnsAtcUpHardware struct {
	Snr  float64     `json:"snr"`
	Rssi float64     `json:"rssi"`
	Gps  LnsAtcUpGps `json:"gps"`
}

type LnsAtcUpGps struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
	Alt float64 `json:"alt"`
}
