package outputs

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/rogeriocassares/zc8/packages/go-data"
)

// NATSMessage represents a message formatted for NATS publish/subscribe
type NATSMessage struct {
	Subject string // NATS subject
	Payload []byte // Message payload
}

// NATSSubjectTelemetry generates the base NATS subject for telemetry
func NATSSubjectTelemetry() string {
	return "telemetry"
}

// NATSSubjectByType generates a NATS subject by device type
func NATSSubjectByType(deviceType string) string {
	return fmt.Sprintf("telemetry.%s", sanitizeSubjectPart(deviceType))
}

// NATSSubjectAll generates a wildcard NATS subject for all telemetry
func NATSSubjectAll() string {
	return "telemetry.>"
}

// ToNATSMessage converts a normalized message to a NATS message
func ToNATSMessage(msg *data.NormalizedMessage) NATSMessage {
	data := map[string]interface{}{
		"deviceID":      msg.DeviceID,
		"deviceType":    msg.DeviceType,
		"timestamp":     msg.Timestamp,
		"fields":        msg.Fields,
		"tags":          msg.Tags,
		"correlationID": msg.CorrelationID,
	}

	payload, _ := json.Marshal(data)

	return NATSMessage{
		Subject: NATSSubjectByType(msg.DeviceType),
		Payload: payload,
	}
}

// NATSMessageBatch converts a slice of normalized messages to NATS messages
func NATSMessageBatch(messages []*data.NormalizedMessage) []NATSMessage {
	var natsMessages []NATSMessage
	for _, msg := range messages {
		natsMessages = append(natsMessages, ToNATSMessage(msg))
	}
	return natsMessages
}

// sanitizeSubjectPart sanitizes a string for use as a NATS subject part
// NATS subjects can contain alphanumerics, underscores, hyphens, and dots
// Here we convert invalid characters to underscores
func sanitizeSubjectPart(part string) string {
	// Convert to lowercase
	part = strings.ToLower(part)

	// Replace spaces with underscores
	part = strings.ReplaceAll(part, " ", "_")

	// Remove or replace invalid characters
	// Valid chars: a-z, 0-9, _, -, .
	// We'll use regex to keep only valid characters and replace invalid ones with underscores
	reg := regexp.MustCompile(`[^a-z0-9_.\-]`)
	part = reg.ReplaceAllString(part, "_")

	// Clean up multiple consecutive underscores
	for strings.Contains(part, "__") {
		part = strings.ReplaceAll(part, "__", "_")
	}

	// Remove leading/trailing underscores
	part = strings.Trim(part, "_")

	return part
}
