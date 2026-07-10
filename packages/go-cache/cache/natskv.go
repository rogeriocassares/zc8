package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
)

// DeviceMetaJSON is the JSON representation of device metadata for warm-tier caching.
type DeviceMetaJSON struct {
	ParserID uint64
	VendorID uint64
	Model    string
}

// NATSKVCache implements warm-tier caching backed by a NATS JetStream KV bucket.
// It is a drop-in replacement for the Redis warm tier: callers get/put JSON-encoded
// device metadata with a configurable TTL without any Redis dependency.
type NATSKVCache struct {
	store *infranats.KVStore
	ttl   time.Duration
}

// NewNATSKVCache creates a warm-tier KV cache using an existing JetStreamClient.
// The bucket is named "device-cache" by default; pass a non-empty name to override.
func NewNATSKVCache(
	ctx context.Context,
	client *infranats.JetStreamClient,
	ttl time.Duration,
	bucket string,
) (*NATSKVCache, error) {
	if ttl <= 0 {
		ttl = 1 * time.Hour
	}
	if bucket == "" {
		bucket = "device-cache"
	}

	store, err := infranats.NewKVStore(ctx, client, infranats.KVConfig{
		Bucket:   bucket,
		TTL:      ttl,
		Replicas: 1,
	})
	if err != nil {
		return nil, fmt.Errorf("nats kv cache init: %w", err)
	}

	return &NATSKVCache{store: store, ttl: ttl}, nil
}

// deviceKey converts a uint64 device key to the KV bucket key string.
func deviceCacheKey(deviceKey uint64) string {
	return fmt.Sprintf("device:%d", deviceKey)
}

// Get retrieves device metadata from the NATS KV bucket.
// Returns (nil, nil) on cache miss; returns an error only on transport failure.
func (n *NATSKVCache) Get(ctx context.Context, deviceKey uint64) (*DeviceMetaJSON, error) {
	data, err := n.store.Get(ctx, deviceCacheKey(deviceKey))
	if err != nil {
		if errors.Is(err, infranats.ErrKeyNotFound) {
			return nil, nil // Cache miss — not an error
		}
		return nil, err
	}

	var meta DeviceMetaJSON
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, fmt.Errorf("unmarshal device %d: %w", deviceKey, err)
	}
	return &meta, nil
}

// Set stores device metadata in the NATS KV bucket.
// TTL is enforced server-side by JetStream; no client-side timer needed.
func (n *NATSKVCache) Set(ctx context.Context, deviceKey uint64, meta *DeviceMetaJSON) error {
	data, err := json.Marshal(meta)
	if err != nil {
		return fmt.Errorf("marshal device %d: %w", deviceKey, err)
	}
	return n.store.Put(ctx, deviceCacheKey(deviceKey), data)
}

// Del removes a device from the NATS KV bucket (e.g., on device update/delete).
func (n *NATSKVCache) Del(ctx context.Context, deviceKey uint64) error {
	return n.store.Delete(ctx, deviceCacheKey(deviceKey))
}

// WarmAll pre-populates the bucket from a map of device metadata.
// Useful for cold-start warming from the database.
func (n *NATSKVCache) WarmAll(ctx context.Context, devices map[uint64]*DeviceMetaJSON) error {
	for id, meta := range devices {
		if err := n.Set(ctx, id, meta); err != nil {
			return fmt.Errorf("warm device %d: %w", id, err)
		}
	}
	return nil
}
