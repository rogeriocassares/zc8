package normalizer

import (
	"fmt"
	"sync"
	"time"
)

// Deduplicator defines the interface for detecting and tracking duplicate messages
type Deduplicator interface {
	IsDuplicate(deviceID string, timestamp int64) bool
	RecordMessage(deviceID string, timestamp int64)
	CleanupExpired()
}

// defaultDeduplicator implements Deduplicator with TTL-based message tracking
type defaultDeduplicator struct {
	mu       sync.RWMutex
	messages map[string]int64 // key: deviceID:timestamp, value: expiration time
	ttl      time.Duration
}

// NewDeduplicator creates a new default deduplicator with 5 minute TTL
func NewDeduplicator() Deduplicator {
	return &defaultDeduplicator{
		messages: make(map[string]int64),
		ttl:      5 * time.Minute,
	}
}

// NewDeduplicatorWithTTL creates a deduplicator with custom TTL
func NewDeduplicatorWithTTL(ttl time.Duration) Deduplicator {
	return &defaultDeduplicator{
		messages: make(map[string]int64),
		ttl:      ttl,
	}
}

// IsDuplicate checks if a message with deviceID and timestamp was recently processed
func (d *defaultDeduplicator) IsDuplicate(deviceID string, timestamp int64) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()

	key := fmt.Sprintf("%s:%d", deviceID, timestamp)
	expirationTime, exists := d.messages[key]

	if !exists {
		return false
	}

	// Check if expired
	if time.Now().UnixMilli() > expirationTime {
		return false
	}

	return true
}

// RecordMessage marks a message as processed with TTL expiration
func (d *defaultDeduplicator) RecordMessage(deviceID string, timestamp int64) {
	d.mu.Lock()
	defer d.mu.Unlock()

	key := fmt.Sprintf("%s:%d", deviceID, timestamp)
	expirationTime := time.Now().Add(d.ttl).UnixMilli()
	d.messages[key] = expirationTime
}

// CleanupExpired removes expired entries from the message map
func (d *defaultDeduplicator) CleanupExpired() {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now().UnixMilli()
	for key, expirationTime := range d.messages {
		if now > expirationTime {
			delete(d.messages, key)
		}
	}
}

// NoOpDeduplicator is a no-op deduplicator for testing
type NoOpDeduplicator struct{}

// IsDuplicate always returns false
func (n *NoOpDeduplicator) IsDuplicate(deviceID string, timestamp int64) bool {
	return false
}

// RecordMessage does nothing
func (n *NoOpDeduplicator) RecordMessage(deviceID string, timestamp int64) {
}

// CleanupExpired does nothing
func (n *NoOpDeduplicator) CleanupExpired() {
}
