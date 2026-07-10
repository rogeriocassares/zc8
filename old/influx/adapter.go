package influx

import (
	"context"
	"fmt"
	"strconv"

	"github.com/rogeriocassares/zc8/services/ingest/internal/config"
	"github.com/rogeriocassares/zc8/services/ingest/internal/engine"
)

// EventToWriteModel converts an engine.Event to a WriteModel.
type eventModel struct {
	deviceKey string
	database  string
	fields    map[string]interface{}
	timestamp int64
}

func (em *eventModel) DeviceKey() string {
	return em.deviceKey
}

func (em *eventModel) Database() string {
	return em.database
}

func (em *eventModel) LineProtocol() string {
	// Simplified line protocol format: measurement,tag_key=tag_val field_key=field_val timestamp
	var line string
	line = "telemetry"
	line += ",device=" + em.deviceKey
	line += " "

	first := true
	for k, v := range em.fields {
		if !first {
			line += ","
		}
		line += fmt.Sprintf("%s=%v", k, v)
		first = false
	}

	line += fmt.Sprintf(" %d", em.timestamp)
	return line
}

// ManagerAdapter wraps the Manager to implement engine.Writer interface.
type ManagerAdapter struct {
	manager  *Manager
	database string
	ctx      context.Context
}

// NewManagerAdapter creates an adapter that wraps the Manager for use with engine.Writer.
func NewManagerAdapter(ctx context.Context, manager *Manager, database string) *ManagerAdapter {
	return &ManagerAdapter{
		manager:  manager,
		database: database,
		ctx:      ctx,
	}
}

// Write implements engine.Writer interface.
// It converts engine.Event batch to EventModels and dispatches through the manager.
func (ma *ManagerAdapter) Write(events []engine.Event) error {
	for _, e := range events {
		fields := make(map[string]interface{}, len(e.Fields))
		for _, f := range e.Fields {
			fields[f.Key] = f.Value
		}

		model := &eventModel{
			deviceKey: strconv.FormatUint(uint64(e.DeviceKey), 10),
			database:  ma.database,
			fields:    fields,
			timestamp: 0, // Let InfluxDB use current time
		}

		if err := ma.manager.Write(ma.ctx, model); err != nil {
			return err
		}
	}
	return nil
}

// Shutdown gracefully shuts down the manager.
func (ma *ManagerAdapter) Shutdown(ctx context.Context) {
	ma.manager.Shutdown(ctx)
}

// NewManager initializes an infra Manager from config with single database.
func NewManagerFromConfig(ctx context.Context, cfg *config.InfluxConfig) (*ManagerAdapter, error) {
	client, err := New(ctx, cfg)
	if err != nil {
		return nil, err
	}

	manager := NewManager(
		ctx,
		client,
		[]string{cfg.Database},
		4, // workers (TODO: make configurable)
		cfg.BatchSize,
		cfg.FlushInterval,
	)

	return NewManagerAdapter(ctx, manager, cfg.Database), nil
}
