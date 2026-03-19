package influx

import (
	"context"
)

// Manager orchestrates writers for multiple databases
type Manager struct {
	writers map[string]*Writer
}

// NewManager creates a new Manager with writers for each database
func NewManager(
	ctx context.Context,
	client *Client,
	databases []string,
	workers int,
	batchSize int,
	flushSeconds int,
) *Manager {
	m := &Manager{
		writers: make(map[string]*Writer),
	}

	for _, db := range databases {
		m.writers[db] = NewWriter(
			ctx,
			client,
			db,
			workers,
			batchSize,
			flushSeconds,
		)
	}

	return m
}

// Write dispatches a model to the appropriate writer by database
func (m *Manager) Write(ctx context.Context, model WriteModel) error {
	db := model.Database()

	writer, ok := m.writers[db]
	if !ok {
		return nil // Silently ignore writes to unknown databases
	}

	return writer.Dispatch(ctx, model)
}

// Shutdown gracefully shuts down all writers
func (m *Manager) Shutdown(ctx context.Context) {
	for _, w := range m.writers {
		w.Shutdown(ctx)
	}
}
