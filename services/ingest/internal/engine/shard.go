package engine

import (
	"time"
)

const (
	shardQueueSize = 65536
	batchSize      = 4096
	flushInterval  = 5 * time.Millisecond
)

type Shard struct {
	queue  chan *Message
	reg    *ParserRegistry
	writer Writer
	fanout Fanout
}

func NewShard(
	reg *ParserRegistry,
	writer Writer,
	fanout Fanout, // REFACTORED: Now required for multi-destination fanout
) *Shard {

	s := &Shard{
		queue:  make(chan *Message, shardQueueSize),
		reg:    reg,
		writer: writer,
		fanout: fanout, // REFACTORED: Enable fanout
	}

	go s.loop()

	return s
}

func (s *Shard) Push(m *Message) {
	s.queue <- m // natural backpressure here
}

func (s *Shard) loop() {

	batch := make([]Event, 0, batchSize)

	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()

	flush := func() {
		if len(batch) == 0 {
			return
		}

		err := s.writer.Write(batch)

		// ACK propagation (Influx authoritative)
		for i := range batch {
			if batch[i].Ack != nil {
				batch[i].Ack <- err
			}
		}

		batch = batch[:0]
	}

	for {
		select {

		case msg := <-s.queue:

			// Prepare fields slice
			fields := make([]Field, 0, 8)

			// REFACTORED: Check if fields are pre-parsed (new adapters)
			// If Message has pre-parsed fields, use them directly.
			// Otherwise, parse the binary payload (backward compat).
			if len(msg.PreParsedFields) > 0 {
				// New path: Adapters have already parsed
				fields = msg.PreParsedFields
			} else {
				// Legacy path: Ingest parses locally
				parser := s.reg.Get(msg.ParserID)
				if parser == nil {
					if msg.Ack != nil {
						msg.Ack <- ErrParserNotFound
					}
					continue
				}

				parser.Parse(msg.Payload, &fields)
			}

			event := Event{
				DeviceKey:      msg.DeviceKey,
				Fields:         fields,
				Ack:            msg.Ack,
				Routing:        msg.Routing,
				OrganizationID: msg.OrganizationID,
				TeamID:         msg.TeamID,
			}

			// 🔥 REAL-TIME FANOUT (parallel, non-blocking)
			// REFACTORED: Enable fanout for multi-destination routing
			if s.fanout != nil {
				s.fanout.Dispatch(event)
			}

			// Add to Influx batch
			batch = append(batch, event)

			if len(batch) >= batchSize {
				flush()
			}

		case <-ticker.C:
			flush()
		}
	}
}
