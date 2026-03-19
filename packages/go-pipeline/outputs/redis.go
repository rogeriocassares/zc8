package outputs

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/rogeriocassares/zc8/packages/go-data"
)

// RedisMessage represents a message formatted for Redis storage
type RedisMessage struct {
	Key       string        // Redis key
	Value     string        // JSON-encoded value
	TTL       time.Duration // Time to live
	Timestamp int64         // Message timestamp
}

// RedisKeyLastReading generates the Redis key for the latest reading of a device
func RedisKeyLastReading(deviceID string) string {
	return fmt.Sprintf("device:%s:reading:latest", deviceID)
}

// RedisKeyHistory generates the Redis key for historical readings of a device
func RedisKeyHistory(deviceID string) string {
	return fmt.Sprintf("device:%s:readings:history", deviceID)
}

// ToRedisLastReading converts a normalized message to a Redis last reading entry
func ToRedisLastReading(msg *data.NormalizedMessage, ttl time.Duration) RedisMessage {
	data := map[string]interface{}{
		"deviceID":      msg.DeviceID,
		"deviceType":    msg.DeviceType,
		"timestamp":     msg.Timestamp,
		"fields":        msg.Fields,
		"tags":          msg.Tags,
		"correlationID": msg.CorrelationID,
	}

	jsonData, _ := json.Marshal(data)

	return RedisMessage{
		Key:       RedisKeyLastReading(msg.DeviceID),
		Value:     string(jsonData),
		TTL:       ttl,
		Timestamp: msg.Timestamp,
	}
}

// ToRedisHistory converts a normalized message to a Redis history entry
func ToRedisHistory(msg *data.NormalizedMessage, ttl time.Duration) RedisMessage {
	data := map[string]interface{}{
		"deviceID":      msg.DeviceID,
		"deviceType":    msg.DeviceType,
		"timestamp":     msg.Timestamp,
		"fields":        msg.Fields,
		"tags":          msg.Tags,
		"correlationID": msg.CorrelationID,
	}

	jsonData, _ := json.Marshal(data)

	return RedisMessage{
		Key:       RedisKeyHistory(msg.DeviceID),
		Value:     string(jsonData),
		TTL:       ttl,
		Timestamp: msg.Timestamp,
	}
}

// ToRedisMessages converts a normalized message to both latest reading and history entries
func ToRedisMessages(msg *data.NormalizedMessage, ttl time.Duration) []RedisMessage {
	return []RedisMessage{
		ToRedisLastReading(msg, ttl),
		ToRedisHistory(msg, ttl),
	}
}

// RedisMessageBatch converts a slice of normalized messages to Redis messages
func RedisMessageBatch(messages []*data.NormalizedMessage, ttl time.Duration) []RedisMessage {
	var redisMessages []RedisMessage
	for _, msg := range messages {
		redisMessages = append(redisMessages, ToRedisMessages(msg, ttl)...)
	}
	return redisMessages
}
