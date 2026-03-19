package mqtt

import (
	"context"
	"fmt"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

// MessageHandler is a simple callback for handling MQTT messages
// It receives the topic and payload as separate parameters
type MessageHandler func(topic string, payload []byte) error

// RichMessage contains full MQTT message metadata without exposing paho types.
type RichMessage struct {
	Topic    string
	Payload  []byte
	QoS      byte
	Retained bool
}

// RichMessageHandler is a callback that receives full MQTT message metadata.
type RichMessageHandler func(msg RichMessage)

// Client wraps MQTT connection
type Client struct {
	conn mqtt.Client
}

// Config holds MQTT connection configuration
type Config struct {
	Broker         string
	ClientID       string
	Username       string
	Password       string
	CleanSession   bool
	AutoReconnect  bool
	ReconnectWait  time.Duration
	ConnectTimeout time.Duration
	KeepAlive      time.Duration
	WriteTimeout   time.Duration
}

// DefaultConfig returns default MQTT configuration
func DefaultConfig() Config {
	return Config{
		Broker:         "tcp://localhost:1883",
		ClientID:       "zc8-client",
		CleanSession:   false,
		AutoReconnect:  true,
		ReconnectWait:  5 * time.Second,
		ConnectTimeout: 10 * time.Second,
		KeepAlive:      60 * time.Second,
		WriteTimeout:   5 * time.Second,
	}
}

// New creates a new MQTT client
func New(ctx context.Context, cfg Config) (*Client, error) {
	opts := mqtt.NewClientOptions()
	opts.AddBroker(cfg.Broker)
	opts.SetClientID(cfg.ClientID)
	opts.SetCleanSession(cfg.CleanSession)
	opts.SetAutoReconnect(cfg.AutoReconnect)
	opts.SetMaxReconnectInterval(cfg.ReconnectWait)
	opts.SetConnectTimeout(cfg.ConnectTimeout)
	opts.SetKeepAlive(cfg.KeepAlive)
	opts.SetWriteTimeout(cfg.WriteTimeout)

	if cfg.Username != "" {
		opts.SetUsername(cfg.Username)
	}
	if cfg.Password != "" {
		opts.SetPassword(cfg.Password)
	}

	opts.OnConnectionLost = func(client mqtt.Client, err error) {
		fmt.Printf("MQTT connection lost: %v\n", err)
	}

	opts.OnReconnecting = func(client mqtt.Client, options *mqtt.ClientOptions) {
		fmt.Printf("MQTT reconnecting...\n")
	}

	client := mqtt.NewClient(opts)

	if token := client.Connect(); !token.WaitTimeout(cfg.ConnectTimeout) {
		return nil, fmt.Errorf("mqtt connect timeout")
	} else if token.Error() != nil {
		return nil, fmt.Errorf("mqtt connect: %w", token.Error())
	}

	return &Client{conn: client}, nil
}

// Conn returns the underlying MQTT client
func (c *Client) Conn() mqtt.Client {
	return c.conn
}

// SubscribeHandler subscribes to a topic with a simple message handler callback
func (c *Client) SubscribeHandler(topic string, qos byte, handler MessageHandler) error {
	if handler == nil {
		return fmt.Errorf("handler cannot be nil")
	}

	// Wrap the simple handler to work with paho's mqtt.MessageHandler
	pahoHandler := func(client mqtt.Client, msg mqtt.Message) {
		if err := handler(msg.Topic(), msg.Payload()); err != nil {
			fmt.Printf("Error handling message from topic %s: %v\n", msg.Topic(), err)
		}
	}

	token := c.conn.Subscribe(topic, qos, pahoHandler)
	if !token.WaitTimeout(10 * time.Second) {
		return fmt.Errorf("mqtt subscribe timeout for topic: %s", topic)
	}
	return token.Error()
}

// Subscribe subscribes to a topic with a raw paho message handler (for backward compatibility)
func (c *Client) Subscribe(topic string, qos byte, handler mqtt.MessageHandler) error {
	token := c.conn.Subscribe(topic, qos, handler)
	if !token.WaitTimeout(10 * time.Second) {
		return fmt.Errorf("mqtt subscribe timeout for topic: %s", topic)
	}
	return token.Error()
}

// SubscribeRich subscribes to a topic with a RichMessageHandler that receives
// full message metadata (QoS, Retained) without exposing raw paho types.
func (c *Client) SubscribeRich(topic string, qos byte, handler RichMessageHandler) error {
	if handler == nil {
		return fmt.Errorf("handler cannot be nil")
	}

	pahoHandler := func(_ mqtt.Client, msg mqtt.Message) {
		handler(RichMessage{
			Topic:    msg.Topic(),
			Payload:  msg.Payload(),
			QoS:      msg.Qos(),
			Retained: msg.Retained(),
		})
	}

	token := c.conn.Subscribe(topic, qos, pahoHandler)
	if !token.WaitTimeout(10 * time.Second) {
		return fmt.Errorf("mqtt subscribe timeout for topic: %s", topic)
	}
	return token.Error()
}

// Publish publishes a message to a topic
func (c *Client) Publish(topic string, qos byte, retained bool, payload interface{}) error {
	token := c.conn.Publish(topic, qos, retained, payload)
	if !token.WaitTimeout(10 * time.Second) {
		return fmt.Errorf("mqtt publish timeout for topic: %s", topic)
	}
	return token.Error()
}

// IsConnected checks if client is connected
func (c *Client) IsConnected() bool {
	return c.conn.IsConnected()
}

// Health checks the MQTT connection
func (c *Client) Health() error {
	if !c.conn.IsConnected() {
		return fmt.Errorf("mqtt client not connected")
	}
	return nil
}

// Close closes the MQTT connection
func (c *Client) Close() error {
	c.conn.Disconnect(250)
	return nil
}
