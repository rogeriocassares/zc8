package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/redis/go-redis/v9"
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

// stringRedisCache implements warm tier with string keys and JSON serialization
type stringRedisCache struct {
	client *redis.Client
	ttl    time.Duration
	prefix string
}

// newStringRedisCache creates a string-keyed Redis cache
func newStringRedisCache(client *redis.Client, ttl time.Duration, prefix string) *stringRedisCache {
	if ttl == 0 {
		ttl = 30 * time.Minute
	}
	if prefix == "" {
		prefix = "cache"
	}
	return &stringRedisCache{
		client: client,
		ttl:    ttl,
		prefix: prefix,
	}
}

// Get retrieves from Redis cache with JSON deserialization
func (s *stringRedisCache) Get(ctx context.Context, key string) (interface{}, error) {
	fullKey := fmt.Sprintf("%s:%s", s.prefix, key)
	val, err := s.client.Get(ctx, fullKey).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	// Deserialize as generic interface{}
	var result interface{}
	if err := json.Unmarshal([]byte(val), &result); err != nil {
		return nil, fmt.Errorf("unmarshal redis value for %s: %w", key, err)
	}
	return result, nil
}

// Set stores in Redis cache with JSON serialization
func (s *stringRedisCache) Set(ctx context.Context, key string, val interface{}) error {
	fullKey := fmt.Sprintf("%s:%s", s.prefix, key)
	data, err := json.Marshal(val)
	if err != nil {
		return fmt.Errorf("marshal value for %s: %w", key, err)
	}
	return s.client.Set(ctx, fullKey, data, s.ttl).Err()
}

// Del removes from Redis cache
func (s *stringRedisCache) Del(ctx context.Context, key string) error {
	fullKey := fmt.Sprintf("%s:%s", s.prefix, key)
	return s.client.Del(ctx, fullKey).Err()
}

// GenericResolver implements 3-tier caching for any entity type
// Provides cascading lookup: LRU → Redis → Database
type GenericResolver struct {
	lru        *stringLRUCache
	redis      *stringRedisCache
	repository GenericRepository
	mu         sync.RWMutex
	metrics    ResolverMetrics
}

// ResolverMetrics tracks cache performance
type ResolverMetrics struct {
	HitLRU   uint64
	HitRedis uint64
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

// NewGenericResolver creates a new generic resolver with 3-tier caching
func NewGenericResolver(
	redisClient *redis.Client,
	repository GenericRepository,
	lruSize int,
) (*GenericResolver, error) {
	// Create string-based caches
	lru, err := newStringLRUCache(lruSize)
	if err != nil {
		return nil, err
	}

	redis := newStringRedisCache(redisClient, 30*time.Minute, "entity")

	return &GenericResolver{
		lru:        lru,
		redis:      redis,
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

	// L2: Redis Cache (warm tier)
	if val, err := g.redis.Get(ctx, id); err == nil && val != nil {
		g.recordRedisHit()
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
	_ = g.redis.Set(ctx, id, entity) // Best-effort async population

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

	if val, err := g.redis.Get(ctx, cacheKey); err == nil && val != nil {
		g.recordRedisHit()
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
	_ = g.redis.Set(ctx, cacheKey, entity)

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
			_ = g.redis.Set(ctx, id, entity)
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
			_ = g.redis.Set(ctx, cacheKey, entity)
		}
	}

	return nil
}

// InvalidateEntry removes entity from all cache tiers
func (g *GenericResolver) InvalidateEntry(ctx context.Context, id string) error {
	g.lru.Del(id)
	_ = g.redis.Del(ctx, id)
	return nil
}

// UpdateEntry updates entity in all cache tiers
func (g *GenericResolver) UpdateEntry(ctx context.Context, id string, entity interface{}) error {
	g.lru.Set(id, entity)
	_ = g.redis.Set(ctx, id, entity)
	return nil
}

// Metrics returns current cache performance metrics
func (g *GenericResolver) Metrics() ResolverMetrics {
	g.mu.RLock()
	defer g.mu.RUnlock()

	metrics := g.metrics
	if metrics.TotalOps > 0 {
		metrics.HitRate = float64(metrics.HitLRU+metrics.HitRedis) / float64(metrics.TotalOps) * 100
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

// recordRedisHit records a Redis cache hit
func (g *GenericResolver) recordRedisHit() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.metrics.HitRedis++
}

// recordMiss records a database hit/miss
func (g *GenericResolver) recordMiss() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.metrics.MissCold++
}
