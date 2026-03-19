package milesight

import (
	"encoding/binary"
	"math"

	"github.com/rogeriocassares/zc8/packages/go-parser"
)

// MilesightParser parses Milesight environmental sensor payloads
type MilesightParser struct{}

// NewMilesightParser creates a new Milesight parser
func NewMilesightParser() *MilesightParser {
	return &MilesightParser{}
}

// Parse implements parser.DeviceParser interface for Milesight devices
// Parses the channel-based binary format of Milesight sensors
func (p *MilesightParser) Parse(payload []byte) (*parser.DeviceData, error) {
	if len(payload) == 0 {
		return &parser.DeviceData{
			Values:    make(map[string]interface{}),
			Metadata:  make(map[string]string),
			Raw:       payload,
			Timestamp: 0,
		}, nil
	}

	values := make(map[string]interface{})
	i := 0

	// Channel-based parsing: each sensor data starts with channelID and channelType
	for i < len(payload) {
		if i+2 > len(payload) {
			break
		}

		channelID := payload[i]
		channelType := payload[i+1]
		i += 2

		// Parse based on channel type and extract the value
		switch {
		case channelType == 0x00: // BOOL
			if i < len(payload) {
				val := payload[i] != 0
				values[parseChannelName(channelID)] = val
				i++
			}

		case channelType == 0x01: // INT8
			if i < len(payload) {
				val := int8(payload[i])
				values[parseChannelName(channelID)] = float64(val)
				i++
			}

		case channelType == 0x02: // UINT8
			if i < len(payload) {
				val := uint8(payload[i])
				values[parseChannelName(channelID)] = float64(val)
				i++
			}

		case channelType == 0x03: // INT16
			if i+1 < len(payload) {
				val := int16(binary.BigEndian.Uint16(payload[i : i+2]))
				values[parseChannelName(channelID)] = float64(val)
				i += 2
			}

		case channelType == 0x04: // UINT16
			if i+1 < len(payload) {
				val := uint16(binary.BigEndian.Uint16(payload[i : i+2]))
				values[parseChannelName(channelID)] = float64(val)
				i += 2
			}

		case channelType == 0x05: // INT32
			if i+3 < len(payload) {
				val := int32(binary.BigEndian.Uint32(payload[i : i+4]))
				values[parseChannelName(channelID)] = float64(val)
				i += 4
			}

		case channelType == 0x06: // UINT32
			if i+3 < len(payload) {
				val := uint32(binary.BigEndian.Uint32(payload[i : i+4]))
				values[parseChannelName(channelID)] = float64(val)
				i += 4
			}

		case channelType == 0x07: // FLOAT32
			if i+3 < len(payload) {
				bits := binary.BigEndian.Uint32(payload[i : i+4])
				val := math.Float32frombits(bits)
				values[parseChannelName(channelID)] = float64(val)
				i += 4
			}

		default:
			// Unknown type, skip
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
func (p *MilesightParser) Name() string {
	return "milesight"
}

// parseChannelName maps Milesight channel IDs to human-readable names
func parseChannelName(channelID byte) string {
	switch channelID {
	case 0x01:
		return "battery"
	case 0x02:
		return "temperature"
	case 0x03:
		return "humidity"
	case 0x04:
		return "co2"
	case 0x05:
		return "tvoc"
	case 0x06:
		return "pm10"
	case 0x07:
		return "pm25"
	case 0x08:
		return "pm1"
	case 0x09:
		return "light"
	case 0x0A:
		return "pressure"
	case 0x0B:
		return "sound"
	case 0x0C:
		return "motion"
	case 0x0D:
		return "occupancy"
	case 0x0E:
		return "people_count"
	case 0x0F:
		return "door_state"
	default:
		return "channel_" + string(rune(channelID))
	}
}
