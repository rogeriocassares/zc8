package nats

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/nats-io/nats.go/jetstream"
)

// KVConfig configures a NATS JetStream Key-Value bucket.
type KVConfig struct {
	// Bucket is the KV bucket name (e.g., "device-cache").
	Bucket string
	// TTL is the per-key time-to-live (0 = no expiry).
	TTL time.Duration
	// MaxValueSize limits the size of each value in bytes (0 = unlimited).
	MaxValueSize int32
	// Replicas for HA (1 for dev/edge, 3 for prod).
	Replicas int
}

// KVStore wraps a NATS JetStream KV bucket for typed get/put/delete operations.
type KVStore struct {
	kv     jetstream.KeyValue
	logger interface{ Printf(string, ...any) }
}

// ErrKeyNotFound is returned when a key does not exist in the KV store.
var ErrKeyNotFound = errors.New("key not found")

// NewKVStore creates or opens a NATS JetStream KV bucket using an existing JetStreamClient.
func NewKVStore(ctx context.Context, client *JetStreamClient, cfg KVConfig) (*KVStore, error) {
	if cfg.Bucket == "" {
		return nil, fmt.Errorf("kv bucket name is required")
	}
	replicas := cfg.Replicas
	if replicas < 1 {
		replicas = 1
	}

	kvCfg := jetstream.KeyValueConfig{
		Bucket:       cfg.Bucket,
		TTL:          cfg.TTL,
		MaxValueSize: cfg.MaxValueSize,
		Replicas:     replicas,
		Storage:      jetstream.FileStorage,
	}

	kv, err := client.js.CreateOrUpdateKeyValue(ctx, kvCfg)
	if err != nil {
		return nil, fmt.Errorf("create/update kv bucket %q: %w", cfg.Bucket, err)
	}

	client.logger.Printf("NATS KV bucket %q ready (ttl=%v, replicas=%d)", cfg.Bucket, cfg.TTL, replicas)

	return &KVStore{kv: kv, logger: client.logger}, nil
}

// Get retrieves the raw bytes for a key.
// Returns ErrKeyNotFound when the key does not exist.
func (s *KVStore) Get(ctx context.Context, key string) ([]byte, error) {
	entry, err := s.kv.Get(ctx, key)
	if err != nil {
		if errors.Is(err, jetstream.ErrKeyNotFound) {
			return nil, ErrKeyNotFound
		}
		return nil, fmt.Errorf("kv get %q: %w", key, err)
	}
	return entry.Value(), nil
}

// Put stores raw bytes for a key. Overwrites any existing value.
func (s *KVStore) Put(ctx context.Context, key string, val []byte) error {
	if _, err := s.kv.Put(ctx, key, val); err != nil {
		return fmt.Errorf("kv put %q: %w", key, err)
	}
	return nil
}

// Delete removes a key from the bucket.
func (s *KVStore) Delete(ctx context.Context, key string) error {
	if err := s.kv.Delete(ctx, key); err != nil {
		return fmt.Errorf("kv delete %q: %w", key, err)
	}
	return nil
}

// WatchKey returns a channel that emits updates to a single key.
// The channel closes when ctx is cancelled.
func (s *KVStore) WatchKey(ctx context.Context, key string) (<-chan jetstream.KeyValueEntry, error) {
	watcher, err := s.kv.Watch(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("kv watch %q: %w", key, err)
	}

	ch := make(chan jetstream.KeyValueEntry, 16)
	go func() {
		defer close(ch)
		defer watcher.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case entry, ok := <-watcher.Updates():
				if !ok {
					return
				}
				if entry != nil {
					ch <- entry
				}
			}
		}
	}()
	return ch, nil
}

// WatchAll returns a channel that emits updates to all keys in the bucket.
// The channel closes when ctx is cancelled.
func (s *KVStore) WatchAll(ctx context.Context) (<-chan jetstream.KeyValueEntry, error) {
	watcher, err := s.kv.WatchAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("kv watch all: %w", err)
	}

	ch := make(chan jetstream.KeyValueEntry, 64)
	go func() {
		defer close(ch)
		defer watcher.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case entry, ok := <-watcher.Updates():
				if !ok {
					return
				}
				if entry != nil {
					ch <- entry
				}
			}
		}
	}()
	return ch, nil
}
