package redis

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// EventData represents event data to publish
type EventData struct {
	DeviceKey uint64                 `json:"device_key"`
	Fields    map[string]interface{} `json:"fields"`
	Timestamp int64                  `json:"timestamp"`
}

// Publisher publishes events to Redis
type Publisher struct {
	client  *Client
	channel string
}

// NewPublisher creates a new Redis publisher
func NewPublisher(client *Client, channel string) *Publisher {
	return &Publisher{
		client:  client,
		channel: channel,
	}
}

// PublishEvent publishes a single event
func (p *Publisher) PublishEvent(ctx context.Context, eventData EventData) error {
	payload, err := json.Marshal(eventData)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	cmd := p.client.Client().Publish(context.Background(), p.channel, payload)
	return cmd.Err()
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

		cmd := p.client.Client().Publish(context.Background(), p.channel, buf.Bytes())
		if err := cmd.Err(); err != nil {
			return err
		}
	}

	return nil
}

// PublishRaw publishes raw bytes to a channel
func (p *Publisher) PublishRaw(ctx context.Context, payload []byte) error {
	cmd := p.client.Client().Publish(context.Background(), p.channel, payload)
	return cmd.Err()
}

// PublishWithContext publishes with context timeout
func (p *Publisher) PublishWithContext(ctx context.Context, eventData EventData) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	payload, err := json.Marshal(eventData)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	cmd := p.client.Client().Publish(ctx, p.channel, payload)
	return cmd.Err()
}

// Close closes the publisher
func (p *Publisher) Close() error {
	return p.client.Close()
}
