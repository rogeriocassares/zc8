package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	infranats "github.com/rogeriocassares/zc8/packages/go-infra/nats"
)

// stringLRUCache implements hot tier with string keys
type stringLRUCache struct {
	mu    sync.RWMutex
	cache *lru.Cache[string, interface{}]
}

// newStringLRUCache creates a string-keyed LRU cache
func newStringLRUCache(size int) (*stringLRUCache, error) {
	if size <= 0 {
		size = 100000 // Default: 100k entries
	}
	c, err := lru.New[string, interface{}](size)
	if err != nil {
		return nil, err
	}
	return &stringLRUCache{cache: c}, nil
}

// Get retrieves from LRU cache
func (s *stringLRUCache) Get(key string) (interface{}, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cache.Get(key)
}

// Set stores in LRU cache
func (s *stringLRUCache) Set(key string, val interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache.Add(key, val)
}

// Del removes from LRU cache
func (s *stringLRUCache) Del(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache.Remove(key)
}

// stringKVCache implements warm tier with string keys backed by NATS JetStream KV.
type stringKVCache struct {
	store *infranats.KVStore
}

// newStringKVCache creates a NATS KV-backed string cache for a given entity namespace.
func newStringKVCache(ctx context.Context, client *infranats.JetStreamClient, prefix string, ttl time.Duration) (*stringKVCache, error) {
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	if prefix == "" {
		prefix = "entity"
	}
	// KV bucket names: alphanumeric + hyphens only
	bucket := fmt.Sprintf("entity-%s", prefix)
	store, err := infranats.NewKVStore(ctx, client, infranats.KVConfig{
		Bucket:   bucket,
		TTL:      ttl,
		Replicas: 1,
	})
	if err != nil {
		return nil, fmt.Errorf("nats kv init for %s: %w", prefix, err)
	}
	return &stringKVCache{store: store}, nil
}

// Get retrieves from NATS KV warm cache with JSON deserialization.
func (s *stringKVCache) Get(ctx context.Context, key string) (interface{}, error) {
	data, err := s.store.Get(ctx, key)
	if err != nil {
		if errors.Is(err, infranats.ErrKeyNotFound) {
			return nil, nil // cache miss — not an error
		}
		return nil, err
	}
	var result interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal kv value for %s: %w", key, err)
	}
	return result, nil
}

// Set stores in NATS KV warm cache with JSON serialization.
func (s *stringKVCache) Set(ctx context.Context, key string, val interface{}) error {
	data, err := json.Marshal(val)
	if err != nil {
		return fmt.Errorf("marshal value for %s: %w", key, err)
	}
	return s.store.Put(ctx, key, data)
}

// Del removes from NATS KV warm cache.
func (s *stringKVCache) Del(ctx context.Context, key string) error {
	return s.store.Delete(ctx, key)
}

// GenericResolver implements 3-tier caching for any entity type.
// Provides cascading lookup: LRU → NATS KV → Database
type GenericResolver struct {
	lru        *stringLRUCache
	warm       *stringKVCache
	repository GenericRepository
	mu         sync.RWMutex
	metrics    ResolverMetrics
}

// ResolverMetrics tracks cache performance
type ResolverMetrics struct {
	HitLRU   uint64
	HitWarm  uint64 // NATS KV warm tier
	MissCold uint64
	TotalOps uint64
	HitRate  float64
	LRUStats map[string]interface{}
}

// GenericEntry is the interface for cacheable entities
type GenericEntry interface {
	// GetID returns the unique identifier for this entry
	GetID() string
	// MarshalJSON implements json.Marshaler
	MarshalJSON() ([]byte, error)
	// UnmarshalJSON implements json.Unmarshaler
	UnmarshalJSON([]byte) error
}

// GenericRepository provides interface for data persistence
type GenericRepository interface {
	// Find retrieves a single entity by ID
	Find(ctx context.Context, id string) (interface{}, error)
	// FindAll retrieves all entities (for cache warming)
	FindAll(ctx context.Context) ([]interface{}, error)
}

// ReverseIndexRepository extends GenericRepository with reverse lookup support
// Useful for lookups by alternative keys (e.g., DevEUI → DeviceID)
type ReverseIndexRepository interface {
	GenericRepository
	// FindByIndex looks up entity by secondary index key
	// indexKey: the secondary key name (e.g., "deveui", "mac_address")
	// value: the value to look up
	FindByIndex(ctx context.Context, indexKey string, value string) (interface{}, error)
	// GetIndexes returns list of supported reverse indexes
	GetIndexes() []string
}

// NewGenericResolver creates a new generic resolver with 3-tier caching.
// jsClient is the NATS JetStream client used for the warm tier.
func NewGenericResolver(
	ctx context.Context,
	jsClient *infranats.JetStreamClient,
	repository GenericRepository,
	lruSize int,
) (*GenericResolver, error) {
	lruCache, err := newStringLRUCache(lruSize)
	if err != nil {
		return nil, err
	}

	warm, err := newStringKVCache(ctx, jsClient, "entity", 30*time.Minute)
	if err != nil {
		return nil, fmt.Errorf("generic resolver warm tier: %w", err)
	}

	return &GenericResolver{
		lru:        lruCache,
		warm:       warm,
		repository: repository,
	}, nil
}

// Resolve performs 3-tier cascading lookup
func (g *GenericResolver) Resolve(ctx context.Context, id string) (interface{}, error) {
	g.recordOp()

	// L1: LRU Cache (hot tier)
	if val, ok := g.lru.Get(id); ok {
		g.recordLRUHit()
		return val, nil
	}

	// L2: NATS KV warm tier
	if val, err := g.warm.Get(ctx, id); err == nil && val != nil {
		g.recordWarmHit()
		// Populate L1
		g.lru.Set(id, val)
		return val, nil
	}

	// L3: Repository (cold tier)
	entity, err := g.repository.Find(ctx, id)
	if err != nil {
		g.recordMiss()
		return nil, err
	}

	if entity == nil {
		g.recordMiss()
		return nil, nil
	}

	// Populate both warm and hot tiers
	g.lru.Set(id, entity)
	_ = g.warm.Set(ctx, id, entity) // best-effort

	return entity, nil
}

// ResolveRaw returns the raw entity from repository (for full object access)
func (g *GenericResolver) ResolveRaw(ctx context.Context, id string) (interface{}, error) {
	return g.repository.Find(ctx, id)
}

// ResolveByIndex performs cascading lookup using secondary index (e.g., DevEUI → DeviceID)
// Only works if repository implements ReverseIndexRepository interface
func (g *GenericResolver) ResolveByIndex(ctx context.Context, indexKey string, value string) (interface{}, error) {
	g.recordOp()

	// L1-L2: Try cache first with composite key
	cacheKey := fmt.Sprintf("%s:%s", indexKey, value)

	if val, ok := g.lru.Get(cacheKey); ok {
		g.recordLRUHit()
		return val, nil
	}

	if val, err := g.warm.Get(ctx, cacheKey); err == nil && val != nil {
		g.recordWarmHit()
		g.lru.Set(cacheKey, val)
		return val, nil
	}

	// L3: Use repository's reverse index if available
	revRepo, ok := g.repository.(ReverseIndexRepository)
	if !ok {
		g.recordMiss()
		return nil, fmt.Errorf("repository does not support reverse index lookup for %s", indexKey)
	}

	entity, err := revRepo.FindByIndex(ctx, indexKey, value)
	if err != nil {
		g.recordMiss()
		return nil, err
	}

	if entity == nil {
		g.recordMiss()
		return nil, nil
	}

	// Populate cache with both forward and reverse keys
	g.lru.Set(cacheKey, entity)
	_ = g.warm.Set(ctx, cacheKey, entity)

	return entity, nil
}

// WarmCache pre-populates cache with all entities from repository
func (g *GenericResolver) WarmCache(ctx context.Context) error {
	entities, err := g.repository.FindAll(ctx)
	if err != nil {
		return err
	}

	for _, entity := range entities {
		// For generic entities, we need to extract ID from the object
		// This is a simple approach - derive ID from the object itself
		var id string
		if b, err := json.Marshal(entity); err == nil {
			var m map[string]interface{}
			if err := json.Unmarshal(b, &m); err == nil {
				if idVal, ok := m["id"].(string); ok {
					id = idVal
				}
			}
		}

		if id != "" {
			g.lru.Set(id, entity)
			_ = g.warm.Set(ctx, id, entity)
		}
	}

	return nil
}

// WarmCacheWithIndexes pre-populates cache including reverse indexes (for repositories that support them)
func (g *GenericResolver) WarmCacheWithIndexes(ctx context.Context) error {
	// First, warm normal cache
	if err := g.WarmCache(ctx); err != nil {
		return err
	}

	// If repository supports reverse indexes, populate those too
	revRepo, ok := g.repository.(ReverseIndexRepository)
	if !ok {
		return nil // No reverse index support, that's OK
	}

	// Warm all reverse indexes
	for _, indexKey := range revRepo.GetIndexes() {
		entities, err := revRepo.FindAll(ctx)
		if err != nil {
			continue // Non-fatal, skip this index
		}

		for _, entity := range entities {
			// Extract the index value from entity
			b, _ := json.Marshal(entity)
			var m map[string]interface{}
			if json.Unmarshal(b, &m) != nil {
				continue
			}

			// Store with composite key: indexKey:value
			indexValue := fmt.Sprintf("%v", m[indexKey])
			cacheKey := fmt.Sprintf("%s:%s", indexKey, indexValue)
			g.lru.Set(cacheKey, entity)
			_ = g.warm.Set(ctx, cacheKey, entity)
		}
	}

	return nil
}

// InvalidateEntry removes entity from all cache tiers
func (g *GenericResolver) InvalidateEntry(ctx context.Context, id string) error {
	g.lru.Del(id)
	_ = g.warm.Del(ctx, id)
	return nil
}

// UpdateEntry updates entity in all cache tiers
func (g *GenericResolver) UpdateEntry(ctx context.Context, id string, entity interface{}) error {
	g.lru.Set(id, entity)
	_ = g.warm.Set(ctx, id, entity)
	return nil
}

// Metrics returns current cache performance metrics
func (g *GenericResolver) Metrics() ResolverMetrics {
	g.mu.RLock()
	defer g.mu.RUnlock()

	metrics := g.metrics
	if metrics.TotalOps > 0 {
		metrics.HitRate = float64(metrics.HitLRU+metrics.HitWarm) / float64(metrics.TotalOps) * 100
	}
	return metrics
}

// recordOp records a lookup operation
func (g *GenericResolver) recordOp() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.metrics.TotalOps++
}

// recordLRUHit records an LRU cache hit
func (g *GenericResolver) recordLRUHit() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.metrics.HitLRU++
}

// recordWarmHit records a NATS KV warm cache hit
func (g *GenericResolver) recordWarmHit() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.metrics.HitWarm++
}

// recordMiss records a database hit/miss
func (g *GenericResolver) recordMiss() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.metrics.MissCold++
}
