package influx

import (
	"context"
	"hash/fnv"
)

// Writer manages worker shards for load distribution
type Writer struct {
	workers []*worker
	size    int
}

// NewWriter creates a new Writer with multiple sharded workers
func NewWriter(
	ctx context.Context,
	client *Client,
	database string,
	workers int,
	batchSize int,
	flushSeconds int,
) *Writer {
	w := &Writer{
		size:    workers,
		workers: make([]*worker, workers),
	}

	for i := 0; i < workers; i++ {
		w.workers[i] = newWorker(
			ctx,
			client,
			database,
			batchSize,
			flushSeconds,
		)
	}

	return w
}

// Dispatch sends a model to a worker shard based on device key
func (w *Writer) Dispatch(ctx context.Context, model WriteModel) error {
	idx := shard(model.DeviceKey(), w.size)
	return w.workers[idx].enqueue(ctx, model)
}

// Shutdown gracefully shuts down all workers
func (w *Writer) Shutdown(ctx context.Context) {
	for _, wk := range w.workers {
		wk.shutdown()
	}
}

// shard computes a consistent shard index from a device key
func shard(key string, n int) int {
	h := fnv.New32a()
	h.Write([]byte(key))
	return int(h.Sum32()) % n
}
