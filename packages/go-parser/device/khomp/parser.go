package khomp

import (
	"encoding/binary"
	"math"

	"github.com/rogeriocassares/zc8/packages/go-parser"
)

// KhompParser parses Khomp telemetry device payloads
// Supports binary encoding for various digital and analog inputs
type KhompParser struct{}

// NewKhompParser creates a new Khomp parser
func NewKhompParser() *KhompParser {
	return &KhompParser{}
}

// Parse implements parser.DeviceParser interface for Khomp devices
// Payload format: variable-length TLV (Type-Length-Value) encoding
// [channelID:1byte][length:1byte][value:variable]
func (p *KhompParser) Parse(payload []byte) (*parser.DeviceData, error) {
	values := make(map[string]interface{})

	if len(payload) == 0 {
		return &parser.DeviceData{
			Values:    values,
			Metadata:  make(map[string]string),
			Raw:       payload,
			Timestamp: 0,
		}, nil
	}

	i := 0
	for i < len(payload) {
		if i+2 > len(payload) {
			break
		}

		channelID := payload[i]
		channelLen := int(payload[i+1])
		i += 2

		if i+channelLen > len(payload) {
			break
		}

		channelData := payload[i : i+channelLen]
		i += channelLen

		// Parse channel based on ID and length
		switch channelID {
		case 0x01: // Digital Input 1 (1 byte: 0x00 or 0x01)
			if channelLen >= 1 {
				val := uint8(channelData[0])
				values["di1"] = float64(val)
			}

		case 0x02: // Digital Input 2
			if channelLen >= 1 {
				val := uint8(channelData[0])
				values["di2"] = float64(val)
			}

		case 0x03: // Digital Input 3
			if channelLen >= 1 {
				val := uint8(channelData[0])
				values["di3"] = float64(val)
			}

		case 0x04: // Digital Input 4
			if channelLen >= 1 {
				val := uint8(channelData[0])
				values["di4"] = float64(val)
			}

		case 0x11: // Analog Input 1 (2 bytes, little-endian int16)
			if channelLen >= 2 {
				val := int16(binary.LittleEndian.Uint16(channelData))
				values["ai1"] = float64(val)
			}

		case 0x12: // Analog Input 2
			if channelLen >= 2 {
				val := int16(binary.LittleEndian.Uint16(channelData))
				values["ai2"] = float64(val)
			}

		case 0x13: // Analog Input 3
			if channelLen >= 2 {
				val := int16(binary.LittleEndian.Uint16(channelData))
				values["ai3"] = float64(val)
			}

		case 0x14: // Analog Input 4
			if channelLen >= 2 {
				val := int16(binary.LittleEndian.Uint16(channelData))
				values["ai4"] = float64(val)
			}

		case 0x21: // Temperature (2 bytes, signed, value/100 in Celsius)
			if channelLen >= 2 {
				raw := int16(binary.LittleEndian.Uint16(channelData))
				temp := float64(raw) / 100.0
				values["temperature"] = temp
			}

		case 0x22: // Humidity (1 byte, 0-100%)
			if channelLen >= 1 {
				val := uint8(channelData[0])
				values["humidity"] = float64(val)
			}

		case 0x31: // Counter 1 (4 bytes, unsigned, little-endian)
			if channelLen >= 4 {
				val := binary.LittleEndian.Uint32(channelData)
				values["counter1"] = float64(val)
			}

		case 0x32: // Counter 2
			if channelLen >= 4 {
				val := binary.LittleEndian.Uint32(channelData)
				values["counter2"] = float64(val)
			}

		case 0x41: // Real Power Consumption (4 bytes, float32, little-endian)
			if channelLen >= 4 {
				bits := binary.LittleEndian.Uint32(channelData)
				val := math.Float32frombits(bits)
				values["power_consumption"] = float64(val)
			}

		case 0x42: // Energy Consumption (4 bytes, float32, little-endian)
			if channelLen >= 4 {
				bits := binary.LittleEndian.Uint32(channelData)
				val := math.Float32frombits(bits)
				values["energy_consumption"] = float64(val)
			}

		case 0x51: // Device Status (1 byte: bitmask)
			if channelLen >= 1 {
				val := uint8(channelData[0])
				values["status"] = float64(val)
			}

		case 0x52: // Device Signal Strength (1 byte: 0-100)
			if channelLen >= 1 {
				val := uint8(channelData[0])
				values["signal_strength"] = float64(val)
			}

		case 0x53: // Device Battery Level (1 byte: 0-100)
			if channelLen >= 1 {
				val := uint8(channelData[0])
				values["battery_level"] = float64(val)
			}
		}
	}

	return &parser.DeviceData{
		Values:    values,
		Metadata:  make(map[string]string),
		Raw:       payload,
		Timestamp: 0,
	}, nil
}

// Name implements parser.DeviceParser interface
func (p *KhompParser) Name() string {
	return "khomp"
}
