package milesight

import (
	"encoding/binary"
	"fmt"
	"math"

	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/parser"
	"github.com/rogeriocassares/zc8/apps/telemetry/grpc-parser/internal/util"
)

func init() {
	// vendor/model/direction
	parser.RegisterParser("milesight/em300_di/uplink", ParseMilesightUplink)
	parser.RegisterParser("milesight/em500_swl/uplink", ParseMilesightUplink)
	parser.RegisterParser("milesight/ws101/uplink", ParseMilesightUplink)

}

type ButtonPress uint64

const (
	ButtonPressUnknown ButtonPress = iota // 0
	ButtonPressShort                      // 1
	ButtonPressLong                       // 2
	ButtonPressDouble                     // 3
)

type ReadSensorStatus uint64

const (
	ReadSensorStatusNoError          ReadSensorStatus = iota // 0
	ReadSensorStatusCollectionFailed                         // 1
	ReadSensorStatusOutOfRange                               // 2
)

func ParseMilesightUplink(payload []byte, model string) (*util.ParsedData, error) {
	dp := &util.ParsedData{
		Name:   "",
		Fields: make(map[string]interface{}),
		Tags:   make(map[string]interface{}),
	}

	for i := 0; i < len(payload); {
		if i+2 > len(payload) {
			break
		}
		chID, chType := payload[i], payload[i+1]
		i += 2

		switch chID {
		case 0x01:
			if chType == 0x75 && i < len(payload) {
				dp.Fields["battery"] = uint64(payload[i])
				i++
			}
		case 0x03:
			switch chType {
			case 0x67:
				if i+1 < len(payload) {
					fmt.Printf("\nHandle Temperature\n")
					temperature := binary.LittleEndian.Uint16(payload[i : i+2])
					dp.Fields["temperature"] = float64(temperature) / 10
					i += 2
				}

			case 0x77:
				if i+1 < len(payload) {
					v := binary.LittleEndian.Uint16(payload[i : i+2])
					switch v {
					case 0xffff:
						dp.Fields["water_level"] = float64(v)
						dp.Fields["water_level_error"] = uint64(ReadSensorStatusCollectionFailed)
					case 0xfffd:
						dp.Fields["water_level"] = float64(v)
						dp.Fields["water_level_error"] = uint64(ReadSensorStatusOutOfRange)
					default:
						dp.Fields["water_level"] = float64(v) / 100.0
						dp.Fields["water_level_error"] = uint64(ReadSensorStatusNoError)
					}
					i += 2
					continue
				}
			}

		case 0x04:
			switch chType {
			case 0x68:
				if i < len(payload) {
					fmt.Printf("\nHandle Humidity\n")
					dp.Fields["humidity"] = float64(payload[i] / 2)
					i += 1
				}
			}
		case 0x05:
			switch chType {
			case 0xe1:
				if i+7 < len(payload) {
					waterConv := float32(binary.LittleEndian.Uint16(payload[i:i+2])) / 10.0
					pulseConv := float32(binary.LittleEndian.Uint16(payload[i+2:i+4])) / 10.0
					_ = waterConv
					_ = pulseConv
					// IEEE-754 float32 pulse counter (little-endian)
					raw := binary.LittleEndian.Uint32(payload[i+4 : i+8])
					pulseCount := math.Float32frombits(raw)
					dp.Fields["pulse_count"] = pulseCount
					i += 8
				}
			}

		case 0xff:
			switch chType {
			case 0x2e:
				if i < len(payload) {
					switch payload[i] {
					case 1:
						dp.Fields["button_press"] = uint64(ButtonPressShort)
					case 2:
						dp.Fields["button_press"] = uint64(ButtonPressLong)
					case 3:
						dp.Fields["button_press"] = uint64(ButtonPressDouble)
					default:
						dp.Fields["button_press"] = uint64(ButtonPressUnknown)
					}
					i++
				}

				// case 0x01:
				// 	if i+1 < len(payload) {
				// 		dp.Tags["protocol_version"] = fmt.Sprintf("%d.%d", payload[i], payload[i+1])
				// 		i += 2
				// 	}
				// case 0x09:
				// 	if i+1 < len(payload) {
				// 		dp.Tags["hardware_version"] = fmt.Sprintf("%d.%d", payload[i], payload[i+1])
				// 		i += 2
				// 	}
				// case 0x0a:
				// 	if i+1 < len(payload) {
				// 		dp.Tags["firmware_version"] = fmt.Sprintf("%d.%d", payload[i], payload[i+1])
				// 		i += 2
				// 	}
				// case 0xff:
				// 	if i+1 < len(payload) {
				// 		dp.Fields["tsl"] = uint64(binary.LittleEndian.Uint16(payload[i:]))
				// 		i += 2
				// 	}
				// case 0x08:
				// 	if i+5 < len(payload) {
				// 		dp.Tags["serial_number"] = fmt.Sprintf("%X", payload[i:i+6])
				// 		i += 6
				// 	}
				// case 0x0f:
				// 	if i < len(payload) {
				// 		dp.Tags["lorawan_class"] = fmt.Sprintf("Class %c", 'A'+rune(payload[i]))
				// 		i++
				// 	}
				// case 0xfe:
				// 	if i < len(payload) {
				// 		dp.Fields["reset_event"] = uint64(payload[i])
				// 		i++
				// 	}
				// case 0x0b:
				// 	if i < len(payload) {
				// 		dp.Fields["device_status"] = uint64(payload[i])
				// 		i++
				// 	}
			}

		}
	}

	return dp, nil
}
