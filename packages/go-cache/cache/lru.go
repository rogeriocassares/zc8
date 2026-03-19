package cache

import (
	"sync"

	lru "github.com/hashicorp/golang-lru/v2"
)

// LRUCache implements hot tier caching with least-recently-used eviction
type LRUCache struct {
	mu    sync.RWMutex
	cache *lru.Cache[uint64, *DeviceMetaJSON]
	size  int
}

// NewLRUCache creates a new LRU cache instance
func NewLRUCache(size int) (*LRUCache, error) {
	if size <= 0 {
		size = 10000 // Default: 10k devices
	}

	cache, err := lru.New[uint64, *DeviceMetaJSON](size)
	if err != nil {
		return nil, err
	}

	return &LRUCache{
		cache: cache,
		size:  size,
	}, nil
}

// Get retrieves device metadata from LRU cache
func (l *LRUCache) Get(deviceKey uint64) (*DeviceMetaJSON, bool) {
	l.mu.RLock()
	defer l.mu.RUnlock()

	val, ok := l.cache.Get(deviceKey)
	return val, ok
}

// Set stores device metadata in LRU cache
func (l *LRUCache) Set(deviceKey uint64, meta *DeviceMetaJSON) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.cache.Add(deviceKey, meta)
}

// Del removes device metadata from LRU cache
func (l *LRUCache) Del(deviceKey uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.cache.Remove(deviceKey)
}

// Len returns the number of items in the cache
func (l *LRUCache) Len() int {
	l.mu.RLock()
	defer l.mu.RUnlock()

	return l.cache.Len()
}

// Clear removes all items from the cache
func (l *LRUCache) Clear() {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.cache.Purge()
}

// Stats returns cache statistics
type CacheStats struct {
	HitCount   uint64
	MissCount  uint64
	ItemCount  int
	MaxSize    int
	ObjectSize int64 // Approximate size in bytes
}

// Len returns the number of items currently cached
func (l *LRUCache) Stats() CacheStats {
	l.mu.RLock()
	defer l.mu.RUnlock()

	// Approximate: 56 bytes per metadata object (uint64 + uint64 + string overhead)
	const objectSize = 56
	return CacheStats{
		ItemCount:  l.cache.Len(),
		MaxSize:    l.size,
		ObjectSize: int64(l.cache.Len()) * objectSize,
	}
}
