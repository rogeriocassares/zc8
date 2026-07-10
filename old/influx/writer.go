package influx

import (
	"context"
	"hash/fnv"
)

type Writer struct {
	workers []*worker
	size    int
}

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

func (w *Writer) Dispatch(ctx context.Context, model WriteModel) error {
	idx := shard(model.DeviceKey(), w.size)
	return w.workers[idx].enqueue(ctx, model)
}

func (w *Writer) Shutdown(ctx context.Context) {
	for _, wk := range w.workers {
		wk.shutdown()
	}
}

func shard(key string, n int) int {
	h := fnv.New32a()
	h.Write([]byte(key))
	return int(h.Sum32()) % n
}
