package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// DeviceMetaJSON is the JSON representation of device metadata for caching
type DeviceMetaJSON struct {
	ParserID uint64
	VendorID uint64
	Model    string
}

// RedisCache implements warm tier caching using Redis
type RedisCache struct {
	client *redis.Client
	ttl    time.Duration
}

// NewRedisCache creates a new Redis cache wrapper
func NewRedisCache(client *redis.Client, ttl time.Duration) *RedisCache {
	if ttl == 0 {
		ttl = 1 * time.Hour // Default: 1 hour
	}
	return &RedisCache{
		client: client,
		ttl:    ttl,
	}
}

// Get retrieves device metadata from Redis
func (r *RedisCache) Get(ctx context.Context, deviceKey uint64) (*DeviceMetaJSON, error) {
	key := fmt.Sprintf("device:%d", deviceKey)

	val, err := r.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, nil // Not found, not an error
	}
	if err != nil {
		return nil, err
	}

	var meta DeviceMetaJSON
	if err := json.Unmarshal([]byte(val), &meta); err != nil {
		return nil, fmt.Errorf("unmarshal error for device %d: %w", deviceKey, err)
	}

	return &meta, nil
}

// Set stores device metadata in Redis with TTL
func (r *RedisCache) Set(ctx context.Context, deviceKey uint64, meta *DeviceMetaJSON) error {
	key := fmt.Sprintf("device:%d", deviceKey)

	data, err := json.Marshal(meta)
	if err != nil {
		return fmt.Errorf("marshal error for device %d: %w", deviceKey, err)
	}

	return r.client.Set(ctx, key, data, r.ttl).Err()
}

// Del removes device metadata from Redis
func (r *RedisCache) Del(ctx context.Context, deviceKey uint64) error {
	key := fmt.Sprintf("device:%d", deviceKey)
	return r.client.Del(ctx, key).Err()
}

// WarmCache pre-populates Redis with all devices using a pipeline
func (r *RedisCache) WarmCache(ctx context.Context, devices map[uint64]*DeviceMetaJSON) error {
	if len(devices) == 0 {
		return nil
	}

	pipe := r.client.Pipeline()

	for deviceKey, meta := range devices {
		key := fmt.Sprintf("device:%d", deviceKey)

		data, err := json.Marshal(meta)
		if err != nil {
			return fmt.Errorf("marshal error for device %d: %w", deviceKey, err)
		}

		pipe.Set(ctx, key, data, r.ttl)
	}

	_, err := pipe.Exec(ctx)
	return err
}

// Flush clears all device keys from Redis
func (r *RedisCache) Flush(ctx context.Context) error {
	iter := r.client.Scan(ctx, 0, "device:*", 0).Iterator()

	for iter.Next(ctx) {
		if err := r.client.Del(ctx, iter.Val()).Err(); err != nil {
			return err
		}
	}

	return iter.Err()
}
