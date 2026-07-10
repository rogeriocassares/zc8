package influx

import (
	"bytes"
	"context"
	"sync"
	"time"

	influxdb3 "github.com/InfluxCommunity/influxdb3-go/v2/influxdb3"
)

const (
	queueSize        = 8192
	writeTimeout     = 5 * time.Second
	maxReusableBytes = 256 * 1024 // 256KB safety limit for pooled buffers
)

var bufferPool = sync.Pool{
	New: func() any {
		return new(bytes.Buffer)
	},
}

type worker struct {
	client        *Client
	database      string
	queue         chan WriteModel
	stop          chan struct{}
	batchSize     int
	flushInterval time.Duration
}

func newWorker(
	ctx context.Context,
	client *Client,
	database string,
	batchSize int,
	flushSeconds int,
) *worker {

	w := &worker{
		client:        client,
		database:      database,
		queue:         make(chan WriteModel, queueSize),
		stop:          make(chan struct{}),
		batchSize:     batchSize,
		flushInterval: time.Duration(flushSeconds) * time.Second,
	}

	go w.run(ctx)

	return w
}

func (w *worker) enqueue(ctx context.Context, m WriteModel) error {
	select {
	case w.queue <- m:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (w *worker) run(ctx context.Context) {

	ticker := time.NewTicker(w.flushInterval)
	defer ticker.Stop()

	buffer := make([]WriteModel, 0, w.batchSize)

	for {
		select {

		case <-ctx.Done():
			w.flush(ctx, buffer)
			return

		case <-w.stop:
			w.flush(ctx, buffer)
			return

		case m := <-w.queue:
			buffer = append(buffer, m)

			if len(buffer) >= w.batchSize {
				w.flush(ctx, buffer)
				buffer = buffer[:0]
			}

		case <-ticker.C:
			if len(buffer) > 0 {
				w.flush(ctx, buffer)
				buffer = buffer[:0]
			}
		}
	}
}

func (w *worker) flush(ctx context.Context, batch []WriteModel) {

	if len(batch) == 0 {
		return
	}

	// Acquire buffer from pool
	buf := bufferPool.Get().(*bytes.Buffer)
	buf.Reset()

	for _, m := range batch {
		buf.WriteString(m.LineProtocol())
		buf.WriteByte('\n')
	}

	writeCtx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()

	err := w.client.Unwrap().Write(
		writeCtx,
		buf.Bytes(),
		influxdb3.WithDatabase(w.database),
	)

	// Reset before returning to pool
	if buf.Cap() <= maxReusableBytes {
		buf.Reset()
		bufferPool.Put(buf)
	}
	// If buffer too large, let GC reclaim it

	if err != nil {
		// TODO: add logging, retry, metrics
	}
}

func (w *worker) shutdown() {
	close(w.stop)
}
