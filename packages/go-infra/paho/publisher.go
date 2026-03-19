package mqtt

import (
	"context"
	"encoding/json"
	"fmt"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

// TopicHandler defines a handler for MQTT topic messages
type TopicHandler struct {
	handlers map[string]func([]byte) error
}

// NewTopicHandler creates a new topic handler
func NewTopicHandler() *TopicHandler {
	return &TopicHandler{
		handlers: make(map[string]func([]byte) error),
	}
}

// Register registers a handler for a topic
func (m *TopicHandler) Register(topic string, handler func([]byte) error) {
	m.handlers[topic] = handler
}

// Handle processes incoming MQTT messages
func (m *TopicHandler) Handle(client mqtt.Client, msg mqtt.Message) {
	topic := msg.Topic()
	payload := msg.Payload()

	if handler, exists := m.handlers[topic]; exists {
		if err := handler(payload); err != nil {
			fmt.Printf("Error handling message from topic %s: %v\n", topic, err)
		}
	}
}

// Publisher publishes events to MQTT
type Publisher struct {
	client *Client
}

// NewPublisher creates a new MQTT publisher
func NewPublisher(client *Client) *Publisher {
	return &Publisher{client: client}
}

// Publish publishes data to a topic
func (p *Publisher) Publish(ctx context.Context, topic string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	return p.client.Publish(topic, 1, false, data)
}

// PublishRaw publishes raw bytes to a topic
func (p *Publisher) PublishRaw(ctx context.Context, topic string, payload []byte) error {
	return p.client.Publish(topic, 1, false, payload)
}

// Close closes the publisher
func (p *Publisher) Close() error {
	return p.client.Close()
}
