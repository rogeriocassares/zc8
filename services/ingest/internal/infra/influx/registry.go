package influx

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"strconv"
	"sync"
	"time"

	"github.com/rogeriocassares/zc8/packages/go-data"
	infrainflux "github.com/rogeriocassares/zc8/packages/go-infra/influx"
	"github.com/rogeriocassares/zc8/services/ingest/internal/engine"
)

// InfluxDB3ConfigEntry is a single active row from device_influxdb3_config.
type InfluxDB3ConfigEntry struct {
	ID              int64
	OrganizationID  int64
	TeamID          int64
	Host            string
	Port            int
	Token           string
	InfluxDBOrg     string
	Bucket          string
	Measurement     string
	UseTLS          bool
	Workers         int
	BatchSize       int
	FlushIntervalMs int
}

// InfluxDB3ConfigRepository is the interface expected by InfluxDB3ConfigWatcher.
type InfluxDB3ConfigRepository interface {
	ListActive(ctx context.Context) ([]InfluxDB3ConfigEntry, error)
}

// managedInstance holds a live InfluxDB3 connection for one config entry.
// No async Manager — writes go directly through the HTTP client.
type managedInstance struct {
	conn  *infrainflux.Client
	entry InfluxDB3ConfigEntry
}

// InfluxDB3ConfigRegistry manages one InfluxDB3 connection per
// device_influxdb3_config row (keyed by config ID). It implements engine.Writer.
//
// Write() is synchronous: it builds line protocol from the event batch and
// POSTs directly to InfluxDB3 via HTTP. The JetStream consumer ACKs only
// after Write() returns nil, guaranteeing persistence.
type InfluxDB3ConfigRegistry struct {
	mu        sync.RWMutex
	instances map[int64]*managedInstance
	logger    *log.Logger
}

func NewInfluxDB3ConfigRegistry(logger *log.Logger) *InfluxDB3ConfigRegistry {
	return &InfluxDB3ConfigRegistry{
		instances: make(map[int64]*managedInstance),
		logger:    logger,
	}
}

// Register creates a connection for the given config entry. Idempotent.
func (r *InfluxDB3ConfigRegistry) Register(ctx context.Context, entry InfluxDB3ConfigEntry) error {
	r.mu.RLock()
	_, exists := r.instances[entry.ID]
	r.mu.RUnlock()
	if exists {
		return nil
	}

	scheme := "http"
	if entry.UseTLS {
		scheme = "https"
	}
	url := fmt.Sprintf("%s://%s:%d", scheme, entry.Host, entry.Port)

	conn, err := infrainflux.New(ctx, infrainflux.Config{
		URL:   url,
		Token: entry.Token,
	})
	if err != nil {
		return fmt.Errorf("influxdb3 connect (configID=%d org=%d): %w", entry.ID, entry.OrganizationID, err)
	}

	r.mu.Lock()
	if _, exists = r.instances[entry.ID]; !exists {
		r.instances[entry.ID] = &managedInstance{
			conn:  conn,
			entry: entry,
		}
	} else {
		_ = conn.Close()
	}
	r.mu.Unlock()

	r.logger.Printf(
		"InfluxDB3ConfigRegistry: registered configID=%d org=%d team=%d %s bucket=%s",
		entry.ID, entry.OrganizationID, entry.TeamID, url, entry.Bucket,
	)
	return nil
}

// Deregister closes the InfluxDB3 connection for a config entry.
func (r *InfluxDB3ConfigRegistry) Deregister(ctx context.Context, configID int64) {
	r.mu.Lock()
	inst, ok := r.instances[configID]
	if ok {
		delete(r.instances, configID)
	}
	r.mu.Unlock()

	if !ok {
		return
	}

	if inst.conn != nil {
		_ = inst.conn.Close()
	}
	r.logger.Printf("InfluxDB3ConfigRegistry: deregistered configID=%d", configID)
}

func (r *InfluxDB3ConfigRegistry) ActiveIDs() map[int64]struct{} {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[int64]struct{}, len(r.instances))
	for id := range r.instances {
		out[id] = struct{}{}
	}
	return out
}

// Write implements engine.Writer. Events are grouped by InfluxDB3ConfigID
// and written synchronously via HTTP POST (line protocol).
//
// Returns error if ANY write fails — the caller (shard) propagates this
// via the Ack channel so the JetStream consumer can NAK for redelivery.
func (r *InfluxDB3ConfigRegistry) Write(events []engine.Event) error {
	if len(events) == 0 {
		return nil
	}

	groups := make(map[int64][]engine.Event, 4)
	for _, e := range events {
		if e.Routing == nil || !e.Routing.WriteToInfluxDB {
			continue
		}
		id := e.Routing.InfluxDBConfigID
		if id == 0 {
			continue
		}
		groups[id] = append(groups[id], e)
	}

	for configID, evts := range groups {
		r.mu.RLock()
		inst, ok := r.instances[configID]
		r.mu.RUnlock()

		if !ok {
			r.logger.Printf(
				"InfluxDB3ConfigRegistry: configID=%d not registered, dropping %d events",
				configID, len(evts),
			)
			continue
		}

		measurement := inst.entry.Measurement
		if measurement == "" {
			measurement = "telemetry"
		}

		// Build line protocol batch
		var buf bytes.Buffer
		now := time.Now().UnixNano()
		for _, e := range evts {
			writeLineProtocol(&buf, e, measurement, now)
			buf.WriteByte('\n')
		}

		// Synchronous HTTP POST — blocks until InfluxDB3 confirms
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := inst.conn.WriteLineProtocol(ctx, inst.entry.Bucket, buf.Bytes())
		cancel()

		if err != nil {
			r.logger.Printf("InfluxDB3ConfigRegistry: write error configID=%d: %v", configID, err)
			return fmt.Errorf("influxdb3 write configID=%d: %w", configID, err)
		}
	}

	return nil
}

func (r *InfluxDB3ConfigRegistry) Shutdown(ctx context.Context) {
	r.mu.Lock()
	ids := make([]int64, 0, len(r.instances))
	for id := range r.instances {
		ids = append(ids, id)
	}
	r.mu.Unlock()

	for _, id := range ids {
		r.Deregister(ctx, id)
	}
}

func (r *InfluxDB3ConfigRegistry) Size() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.instances)
}

// writeLineProtocol writes a single event as InfluxDB line protocol into buf.
// Format: measurement,device=KEY field1=val1,field2=val2 TIMESTAMP_NS
func writeLineProtocol(buf *bytes.Buffer, e engine.Event, measurement string, tsNano int64) {
	buf.WriteString(measurement)
	buf.WriteString(",device=")
	buf.WriteString(strconv.FormatUint(uint64(e.DeviceKey), 10))
	buf.WriteByte(' ')

	for i, f := range e.Fields {
		if i > 0 {
			buf.WriteByte(',')
		}
		buf.WriteString(f.Key)
		buf.WriteByte('=')
		buf.WriteString(strconv.FormatFloat(f.Value, 'f', -1, 64))
	}

	buf.WriteByte(' ')
	buf.WriteString(strconv.FormatInt(tsNano, 10))
}

func fieldMap(fields []data.Field) map[string]interface{} {
	m := make(map[string]interface{}, len(fields))
	for _, f := range fields {
		m[f.Key] = f.Value
	}
	return m
}
