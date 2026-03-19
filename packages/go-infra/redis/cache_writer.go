package redis

import (
	"context"
	"fmt"
	"strconv"

	"github.com/redis/go-redis/v9"
)

// DeviceCacheWriter writes device telemetry to Redis hashes for dashboard display.
// It maintains two structures per device:
//   - Hash:  device:{key}:latest  → all current field values
//   - List:  device:{key}:history:{field} → last N values per field (capped)
type DeviceCacheWriter struct {
	client    *redis.Client
	keyPrefix string
	historyN  int // number of history entries to keep per field (default 10)
}

// NewDeviceCacheWriter creates a writer that maintains device dashboard cache.
func NewDeviceCacheWriter(client *Client, keyPrefix string, historyN int) *DeviceCacheWriter {
	if historyN <= 0 {
		historyN = 10
	}
	return &DeviceCacheWriter{
		client:    client.Client(),
		keyPrefix: keyPrefix,
		historyN:  historyN,
	}
}

// WriteFields updates the latest hash and history lists for a device.
// Uses a pipeline for atomicity and performance.
// If historyN > 0, it overrides the default history depth for this write.
func (w *DeviceCacheWriter) WriteFields(ctx context.Context, deviceKey uint64, fields map[string]float64, timestampMs int64, historyN int) error {
	if historyN <= 0 {
		historyN = w.historyN
	}
	latestKey := fmt.Sprintf("%s%d:latest", w.keyPrefix, deviceKey)

	pipe := w.client.Pipeline()

	// HSET device:{key}:latest field1 val1 field2 val2 ... _ts timestamp
	hashFields := make(map[string]interface{}, len(fields)+1)
	for k, v := range fields {
		hashFields[k] = strconv.FormatFloat(v, 'f', -1, 64)
	}
	hashFields["_ts"] = strconv.FormatInt(timestampMs, 10)
	pipe.HSet(ctx, latestKey, hashFields)

	// LPUSH + LTRIM per field for history
	for k, v := range fields {
		historyKey := fmt.Sprintf("%s%d:history:%s", w.keyPrefix, deviceKey, k)
		pipe.LPush(ctx, historyKey, strconv.FormatFloat(v, 'f', -1, 64))
		pipe.LTrim(ctx, historyKey, 0, int64(historyN-1))
	}

	_, err := pipe.Exec(ctx)
	return err
}
