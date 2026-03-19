package fanout

import (
	"context"
	"time"

	"github.com/rogeriocassares/zc8/packages/go-data"
	"github.com/rogeriocassares/zc8/packages/go-infra/nats"
	"github.com/rogeriocassares/zc8/packages/go-infra/redis"
)

// Fanout dispatches events to dashboard destinations:
//   - Redis HSET (DeviceCacheWriter) — persistent dashboard cache (last values + history)
//   - NATS Core (RealtimePublisher) — ephemeral real-time push to connected dashboards
type Fanout struct {
	cacheWriter       *redis.DeviceCacheWriter
	realtimePublisher *nats.RealtimePublisher
}

// NewFanout creates a fanout dispatcher with Redis cache writer and NATS realtime publisher.
func NewFanout(
	cacheWriter *redis.DeviceCacheWriter,
	realtimePublisher *nats.RealtimePublisher,
) *Fanout {
	return &Fanout{
		cacheWriter:       cacheWriter,
		realtimePublisher: realtimePublisher,
	}
}

// Dispatch sends an event to enabled destinations.
// If Event.Routing is set, it controls which targets receive the event.
func (f *Fanout) Dispatch(e data.Event) {
	fieldsFloat := make(map[string]float64, len(e.Fields))
	for _, field := range e.Fields {
		fieldsFloat[field.Key] = field.Value
	}

	writeRedis := true
	writeNATS := true

	if e.Routing != nil {
		writeRedis = e.Routing.WriteToRedis
		writeNATS = e.Routing.WriteToNATS
	}

	now := time.Now()

	// Redis HSET cache (dashboard last-values + history)
	if writeRedis && f.cacheWriter != nil {
		var historyN int
		if e.Routing != nil && e.Routing.RedisMaxHashEntries > 0 {
			historyN = int(e.Routing.RedisMaxHashEntries)
		}
		_ = f.cacheWriter.WriteFields(
			context.Background(),
			uint64(e.DeviceKey),
			fieldsFloat,
			now.UnixMilli(),
			historyN,
		)
	}

	// NATS Core real-time push (ephemeral dashboard events)
	if writeNATS && f.realtimePublisher != nil {
		_ = f.realtimePublisher.Publish(nats.RealtimeEvent{
			DeviceKey:      uint64(e.DeviceKey),
			OrganizationID: e.OrganizationID,
			TeamID:         e.TeamID,
			Fields:         fieldsFloat,
			Timestamp:      now.Unix(),
		})
	}
}
