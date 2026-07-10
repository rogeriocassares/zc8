package influx

import (
	"context"
)

type Manager struct {
	writers map[string]*Writer
}

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

func (m *Manager) Write(ctx context.Context, model WriteModel) error {

	db := model.Database()

	writer, ok := m.writers[db]
	if !ok {
		return nil // or return error
	}

	return writer.Dispatch(ctx, model)
}

func (m *Manager) Shutdown(ctx context.Context) {
	for _, w := range m.writers {
		w.Shutdown(ctx)
	}
}
