package nats

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
)

// EventData represents event data to publish
type EventData struct {
	DeviceKey uint64                 `json:"device_key"`
	Fields    map[string]interface{} `json:"fields"`
	Timestamp int64                  `json:"timestamp"`
}

// Publisher publishes events to NATS
type Publisher struct {
	client  *Client
	subject string
}

// NewPublisher creates a new NATS publisher
func NewPublisher(client *Client, subject string) *Publisher {
	return &Publisher{
		client:  client,
		subject: subject,
	}
}

// PublishEvent publishes a single event
func (p *Publisher) PublishEvent(ctx context.Context, eventData EventData) error {
	payload, err := json.Marshal(eventData)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	subject := fmt.Sprintf("%s.%d", p.subject, eventData.DeviceKey)

	err = p.client.Conn().Publish(subject, payload)
	if err != nil {
		return fmt.Errorf("publish to nats: %w", err)
	}

	return nil
}

// PublishBatch publishes multiple events
func (p *Publisher) PublishBatch(ctx context.Context, events []EventData) error {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)

	for _, event := range events {
		buf.Reset()

		if err := encoder.Encode(event); err != nil {
			continue
		}

		subject := fmt.Sprintf("%s.%d", p.subject, event.DeviceKey)

		err := p.client.Conn().Publish(subject, buf.Bytes())
		if err != nil {
			return err
		}
	}

	return nil
}

// PublishRaw publishes raw bytes to a subject
func (p *Publisher) PublishRaw(ctx context.Context, subject string, payload []byte) error {
	return p.client.Conn().Publish(subject, payload)
}

// Close closes the publisher
func (p *Publisher) Close() error {
	return p.client.Close()
}
