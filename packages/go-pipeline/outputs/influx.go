package outputs

import (
	"fmt"
	"strings"

	"github.com/rogeriocassares/zc8/packages/go-data"
)

// InfluxLineProtocol converts a normalized message to InfluxDB line protocol format
func InfluxLineProtocol(msg *data.NormalizedMessage) string {
	// Measurement name
	measurement := fmt.Sprintf("telemetry_%s", msg.DeviceType)

	// Tags
	var tags []string
	tags = append(tags, fmt.Sprintf("device_id=%s", escapeTagKey(msg.DeviceID)))
	tags = append(tags, fmt.Sprintf("device_type=%s", escapeTagKey(msg.DeviceType)))

	for k, v := range msg.Tags {
		tags = append(tags, fmt.Sprintf("%s=%s", escapeTagKey(k), escapeTagValue(v)))
	}

	tagsStr := strings.Join(tags, ",")

	// Fields
	var fields []string
	for k, v := range msg.Fields {
		fields = append(fields, fmt.Sprintf("%s=%v", escapeFieldKey(k), v))
	}

	if msg.CorrelationID != "" {
		fields = append(fields, fmt.Sprintf("correlation_id=\"%s\"", msg.CorrelationID))
	}

	fieldsStr := strings.Join(fields, ",")

	// Timestamp in nanoseconds
	timestampNs := msg.Timestamp * 1_000_000

	return fmt.Sprintf("%s,%s %s %d", measurement, tagsStr, fieldsStr, timestampNs)
}

// escapeTagKey escapes a tag key for InfluxDB line protocol
func escapeTagKey(key string) string {
	key = strings.ReplaceAll(key, " ", "\\ ")
	key = strings.ReplaceAll(key, ",", "\\,")
	key = strings.ReplaceAll(key, "=", "\\=")
	return key
}

// escapeTagValue escapes a tag value for InfluxDB line protocol
func escapeTagValue(value string) string {
	value = strings.ReplaceAll(value, " ", "\\ ")
	value = strings.ReplaceAll(value, ",", "\\,")
	value = strings.ReplaceAll(value, "=", "\\=")
	return value
}

// escapeFieldKey escapes a field key for InfluxDB line protocol
func escapeFieldKey(key string) string {
	key = strings.ReplaceAll(key, " ", "\\ ")
	key = strings.ReplaceAll(key, ",", "\\,")
	key = strings.ReplaceAll(key, "=", "\\=")
	return key
}

// InfluxBatch converts a slice of normalized messages to InfluxDB line protocol batch format
func InfluxBatch(messages []*data.NormalizedMessage) string {
	var lines []string
	for _, msg := range messages {
		lines = append(lines, InfluxLineProtocol(msg))
	}
	return strings.Join(lines, "\n")
}
