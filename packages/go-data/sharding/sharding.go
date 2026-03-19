package sharding

import (
	"crypto/md5"
	"encoding/binary"
	"fmt"
	"sync"
)

// ShardConfig defines the sharding configuration for a protocol
type ShardConfig struct {
	Protocol        string // "mqtt", "http", "grpc"
	TotalShards     int    // Total number of shards for this protocol
	CurrentShard    int    // Current shard ID (0-based)
	Replicas        int    // Replicas per shard
	MaxOrgsPerShard int    // Estimated max orgs this shard will handle
}

// ShardManager handles tenant-to-shard assignment
type ShardManager struct {
	config *ShardConfig
	mu     sync.RWMutex
}

// NewShardManager creates a new shard manager
func NewShardManager(config *ShardConfig) *ShardManager {
	if config.TotalShards < 1 {
		config.TotalShards = 1
	}
	if config.CurrentShard < 0 || config.CurrentShard >= config.TotalShards {
		config.CurrentShard = 0
	}
	return &ShardManager{
		config: config,
	}
}

// GetShardID returns the shard ID for an organization using consistent hashing
// Uses MD5 hash of org_id for distribution
func (sm *ShardManager) GetShardID(orgID int32) int {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	// Hash org_id to 32-bit value
	hash := md5.Sum([]byte(fmt.Sprintf("org_%d", orgID)))
	hashValue := binary.LittleEndian.Uint32(hash[:4])

	// Map to shard range [0, TotalShards)
	return int(hashValue % uint32(sm.config.TotalShards))
}

// IsResponsibleFor checks if this manager is responsible for an organization
func (sm *ShardManager) IsResponsibleFor(orgID int32) bool {
	return sm.GetShardID(orgID) == sm.config.CurrentShard
}

// GetConfig returns the current shard configuration
func (sm *ShardManager) GetConfig() *ShardConfig {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.config
}

// GetShardInfo returns shard identification info for logging/monitoring
func (sm *ShardManager) GetShardInfo() ShardInfo {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return ShardInfo{
		Protocol:    sm.config.Protocol,
		ShardID:     sm.config.CurrentShard,
		TotalShards: sm.config.TotalShards,
		Replicas:    sm.config.Replicas,
		WorkerID:    fmt.Sprintf("%s-shard-%d", sm.config.Protocol, sm.config.CurrentShard),
	}
}

// ShardInfo contains identification information about this shard
type ShardInfo struct {
	Protocol    string
	ShardID     int
	TotalShards int
	Replicas    int
	WorkerID    string
}

// ConsistentHashRing provides efficient consistent hashing for load balancing
// across shards with minimal rebalancing on topology changes
type ConsistentHashRing struct {
	mu             sync.RWMutex
	shards         map[int]*ShardNode
	ring           []int       // Sorted ring of shard IDs (virtual nodes)
	virtualNodes   int         // Virtual nodes per shard for better distribution
	shardNodeCount map[int]int // Count of virtual nodes per shard
}

// ShardNode represents a physical shard in the ring
type ShardNode struct {
	ShardID  int
	Weight   int // For weighted distribution
	MaxOrgs  int
	Replicas int
}

// NewConsistentHashRing creates a new consistent hash ring
func NewConsistentHashRing(virtualNodesPerShard int) *ConsistentHashRing {
	if virtualNodesPerShard < 1 {
		virtualNodesPerShard = 150 // Default: 150 virtual nodes per shard
	}
	return &ConsistentHashRing{
		shards:         make(map[int]*ShardNode),
		ring:           make([]int, 0),
		virtualNodes:   virtualNodesPerShard,
		shardNodeCount: make(map[int]int),
	}
}

// AddShard adds a new shard/replica to the ring
func (chr *ConsistentHashRing) AddShard(shardID int, weight int, maxOrgs int, replicas int) {
	chr.mu.Lock()
	defer chr.mu.Unlock()

	if _, exists := chr.shards[shardID]; exists {
		return // Shard already exists
	}

	node := &ShardNode{
		ShardID:  shardID,
		Weight:   weight,
		MaxOrgs:  maxOrgs,
		Replicas: replicas,
	}
	chr.shards[shardID] = node
	chr.rebuildRing()
}

// RemoveShard removes a shard from the ring
func (chr *ConsistentHashRing) RemoveShard(shardID int) {
	chr.mu.Lock()
	defer chr.mu.Unlock()

	delete(chr.shards, shardID)
	delete(chr.shardNodeCount, shardID)
	chr.rebuildRing()
}

// GetShard returns the responsible shard for an key (org_id)
func (chr *ConsistentHashRing) GetShard(orgID int32) int {
	chr.mu.RLock()
	defer chr.mu.RUnlock()

	if len(chr.ring) == 0 {
		return -1 // No shards available
	}

	hash := hashOrgID(orgID)

	// Binary search to find the first shard >= hash
	left, right := 0, len(chr.ring)
	for left < right {
		mid := (left + right) / 2
		if chr.getVirtualNodeHash(chr.ring[mid]) < hash {
			left = mid + 1
		} else {
			right = mid
		}
	}

	if left >= len(chr.ring) {
		return chr.ring[0] // Wrap around to first shard
	}
	return chr.ring[left]
}

// rebuildRing rebuilds the hash ring after topology changes
func (chr *ConsistentHashRing) rebuildRing() {
	chr.ring = make([]int, 0)
	chr.shardNodeCount = make(map[int]int)

	// Add virtual nodes for each shard
	for shardID, node := range chr.shards {
		virtualNodeCount := chr.virtualNodes * node.Weight
		for i := 0; i < virtualNodeCount; i++ {
			chr.ring = append(chr.ring, shardID)
			chr.shardNodeCount[shardID]++
		}
	}

	// Sort ring for binary search
	quickSort(chr.ring, 0, len(chr.ring)-1, func(i, j int) int {
		hashI := chr.getVirtualNodeHash(chr.ring[i])
		hashJ := chr.getVirtualNodeHash(chr.ring[j])
		if hashI < hashJ {
			return -1
		} else if hashI > hashJ {
			return 1
		}
		return 0
	})
}

// getVirtualNodeHash computes hash for a virtual node of a shard
func (chr *ConsistentHashRing) getVirtualNodeHash(shardID int) uint32 {
	hash := md5.Sum([]byte(fmt.Sprintf("shard_%d_vnode", shardID)))
	return binary.LittleEndian.Uint32(hash[:4])
}

// GetStats returns statistics about shard distribution
func (chr *ConsistentHashRing) GetStats() map[int]int {
	chr.mu.RLock()
	defer chr.mu.RUnlock()

	stats := make(map[int]int)
	for shardID, count := range chr.shardNodeCount {
		stats[shardID] = count
	}
	return stats
}

// Helper functions

// hashOrgID computes a consistent hash for an organization ID
func hashOrgID(orgID int32) uint32 {
	hash := md5.Sum([]byte(fmt.Sprintf("org_%d", orgID)))
	return binary.LittleEndian.Uint32(hash[:4])
}

// quickSort is a simple quicksort helper for sorting the ring
func quickSort(arr []int, low, high int, cmp func(int, int) int) {
	if low < high {
		pi := partition(arr, low, high, cmp)
		quickSort(arr, low, pi-1, cmp)
		quickSort(arr, pi+1, high, cmp)
	}
}

func partition(arr []int, low, high int, cmp func(int, int) int) int {
	pivot := arr[high]
	i := low - 1
	for j := low; j < high; j++ {
		if cmp(arr[j], pivot) < 0 {
			i++
			arr[i], arr[j] = arr[j], arr[i]
		}
	}
	arr[i+1], arr[high] = arr[high], arr[i+1]
	return i + 1
}
