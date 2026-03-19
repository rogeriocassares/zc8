package nats

import (
	"encoding/json"
	"fmt"

	"github.com/nats-io/nats.go"
)

// RealtimePublisher publishes ephemeral events via NATS Core (not JetStream).
// Used for real-time dashboard push where persistence is not needed.
// If no subscriber is connected, messages are silently dropped — the dashboard
// reads initial state from Redis on connect.
type RealtimePublisher struct {
	conn          *nats.Conn
	subjectPrefix string // e.g., "telemetry.realtime"
}

// NewRealtimePublisher creates a publisher for real-time dashboard events.
// subjectPrefix is expanded to: {prefix}.{org_id}.{team_id}.{device_key}
func NewRealtimePublisher(conn *nats.Conn, subjectPrefix string) *RealtimePublisher {
	return &RealtimePublisher{
		conn:          conn,
		subjectPrefix: subjectPrefix,
	}
}

// RealtimeEvent is the payload pushed to dashboard subscribers.
type RealtimeEvent struct {
	DeviceKey      uint64             `json:"device_key"`
	OrganizationID int64              `json:"organization_id"`
	TeamID         int64              `json:"team_id"`
	Fields         map[string]float64 `json:"fields"`
	Timestamp      int64              `json:"ts"`
}

// Publish sends a real-time event scoped to org + team + device.
// Subject: telemetry.realtime.{org_id}.{team_id}.{device_key}
func (p *RealtimePublisher) Publish(event RealtimeEvent) error {
	subject := fmt.Sprintf("%s.%d.%d.%d", p.subjectPrefix, event.OrganizationID, event.TeamID, event.DeviceKey)

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal realtime event: %w", err)
	}

	return p.conn.Publish(subject, data)
}
